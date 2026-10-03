/**
 * Раздел «Расчёты с мерчантами» админ-панели.
 *
 * Показывает долг перед продавцом и его выплату: список расчётов по периодам,
 * деталь одного расчёта с покрывающими платежами и ручной прогон расчёта.
 *
 * Три вещи, которые продиктованы сервисом, а не удобством верстки:
 *
 *  1. фильтра по статусу в API нет — `SettlementController.list` принимает только
 *     `merchantId`, `page`, `size`. Поэтому статус фильтруется по уже загруженной
 *     странице, и это прямо написано рядом с фильтром, а не выдаётся за серверный
 *     фильтр;
 *  2. деталь отдаёт `paymentIds` — идентификаторы покрытых платежей, без сумм.
 *     Поэтому в детали перечислены id, а не «суммы по платежам», которых нет;
 *  3. `POST /settlements/run` не принимает тело и не требует `Idempotency-Key`:
 *     повторный прогон безопасен внутри сервиса (один расчёт на мерчанта, валюту и
 *     конец периода). Клиент ничего лишнего в запрос не добавляет.
 */
import { useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { formatMoney, sumMinor } from '../../api/money';
import { Alert, ErrorAlert } from '../../components/ui/Alerts';
import { StatusBadge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { Card, CardBody, CardHeader, DetailRow } from '../../components/ui/Card';
import { CopyButton } from '../../components/ui/CopyButton';
import { EmptyState } from '../../components/ui/EmptyState';
import { SelectField, TextField } from '../../components/ui/Field';
import { Pagination } from '../../components/ui/Pagination';
import { SkeletonRows } from '../../components/ui/Skeleton';
import { useDebouncedValue } from '../../hooks/useDebouncedValue';
import { formatDateTime, roleLabel, shortId, statusLabel } from '../../lib/format';
import type { AdminSectionProps } from '../sections';
import { fetchSettlement, fetchSettlements, runSettlements } from '../api/settlements';
import type { Settlement, SettlementQuery, SettlementRunResult } from '../api/settlements';

const PAGE_SIZE = 20;

/** Три состояния выплаты из `SettlementStatus` сервиса. */
const STATUS_OPTIONS = ['PENDING', 'PAID', 'FAILED'];

/** Ключи запросов локальные для раздела: общий `lib/queryKeys.ts` не трогаем. */
const settlementKeys = {
  list: (query: SettlementQuery) => ['admin', 'settlements', 'list', query] as const,
  detail: (settlementId: string) => ['admin', 'settlements', 'detail', settlementId] as const,
};

/** Сумма по одной валюте: расчёты группируются сервисом по (мерчант, валюта). */
interface CurrencySum {
  currency: string;
  totalMinor: number;
  count: number;
}

/** Складывает деньги по валютам: суммировать KZT с USD в одно число нельзя. */
function sumsByCurrency(
  settlements: readonly Settlement[],
  amountOf: (settlement: Settlement) => number,
): CurrencySum[] {
  const totals = new Map<string, { totalMinor: number; count: number }>();
  for (const settlement of settlements) {
    const currency = settlement.currency === '' ? 'KZT' : settlement.currency;
    const bucket = totals.get(currency) ?? { totalMinor: 0, count: 0 };
    bucket.totalMinor = sumMinor([bucket.totalMinor, amountOf(settlement)]);
    bucket.count += 1;
    totals.set(currency, bucket);
  }
  return [...totals.entries()]
    .map(([currency, bucket]) => ({ currency, ...bucket }))
    .sort((left, right) => right.totalMinor - left.totalMinor);
}

function MoneyLines({ sums, empty }: { sums: CurrencySum[]; empty: string }) {
  if (sums.length === 0) {
    return <p className="text-sm text-ink-400">{empty}</p>;
  }
  return (
    <ul className="space-y-0.5">
      {sums.map((entry) => (
        <li key={entry.currency} className="tnum text-lg font-semibold text-ink-900">
          {formatMoney(entry.totalMinor, entry.currency)}
        </li>
      ))}
    </ul>
  );
}

function KpiCard({ label, children, note }: { label: string; children: ReactNode; note: ReactNode }) {
  return (
    <Card as="div">
      <CardBody>
        <p className="text-xs font-medium tracking-wide text-ink-500 uppercase">{label}</p>
        <div className="mt-1.5">{children}</div>
        <p className="mt-1.5 text-xs text-ink-500">{note}</p>
      </CardBody>
    </Card>
  );
}

/** Понятное объяснение статуса выплаты — формулировки из состояния сервиса. */
const STATUS_HINTS: Record<string, string> = {
  PENDING: 'Долг записан, деньги ещё не ушли: чаще всего мерчант не указал счёт для выплат.',
  PAID: 'Деньги выплачены на счёт мерчанта.',
  FAILED: 'Выплата не прошла, долг остался на платформе и будет повторён следующим прогоном.',
};

function RunResult({ result }: { result: SettlementRunResult }) {
  return (
    <Alert tone="info" title="Прогон завершён">
      <ul className="space-y-0.5">
        <li>Посчитано расчётов: {result.computed}</li>
        <li>Выплачено: {result.paid}</li>
        <li>Ошибок выплаты: {result.failed}</li>
        <li>Ждут счёт для выплаты: {result.awaitingPayoutAccount}</li>
        <li>Нечего рассчитывать: {result.nothingToSettle}</li>
      </ul>
      <p className="mt-2 text-xs">
        Это отчёт самого прогона, а не пересчёт строк ниже: список обновляется отдельным запросом.
      </p>
    </Alert>
  );
}

export default function SettlementsSection({ role, canWrite }: AdminSectionProps) {
  const [merchantInput, setMerchantInput] = useState('');
  const merchantId = useDebouncedValue(merchantInput.trim(), 400);
  const [page, setPage] = useState(0);
  const [statusFilter, setStatusFilter] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const queryClient = useQueryClient();

  const filters: SettlementQuery = {
    merchantId: merchantId === '' ? undefined : merchantId,
    page,
    size: PAGE_SIZE,
  };

  const listQuery = useQuery({
    queryKey: settlementKeys.list(filters),
    queryFn: () => fetchSettlements(filters),
    placeholderData: (previous) => previous,
    staleTime: 10_000,
  });

  const items = listQuery.data?.items ?? [];
  /** Пока данных нет, KPI не показывают ноль: это выглядело бы как настоящий итог. */
  const loaded = listQuery.data !== undefined;
  /** Фильтр по статусу — клиентский: сервис такого параметра не принимает. */
  const visible = useMemo(
    () => (statusFilter === '' ? items : items.filter((settlement) => settlement.status === statusFilter)),
    [items, statusFilter],
  );

  const detailQuery = useQuery({
    queryKey: settlementKeys.detail(selectedId ?? 'none'),
    queryFn: () => fetchSettlement(selectedId as string),
    enabled: Boolean(selectedId),
  });

  const runMutation = useMutation({
    mutationFn: () => runSettlements(),
    retry: 0,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['admin', 'settlements'] });
    },
  });

  const pending = useMemo(
    () => visible.filter((settlement) => settlement.status === 'PENDING'),
    [visible],
  );
  const paid = useMemo(() => visible.filter((settlement) => settlement.status === 'PAID'), [visible]);
  const failed = useMemo(() => visible.filter((settlement) => settlement.status === 'FAILED'), [visible]);

  const netOf = (settlement: Settlement) => settlement.netMinor;
  const commissionOf = (settlement: Settlement) => settlement.commissionMinor;

  const detail = detailQuery.data;

  const startRun = () => {
    const confirmed = window.confirm(
      'Запустить расчёт сейчас?\n\n' +
        'Сервис посчитает долги по закрытым периодам и попробует выплатить всё, что можно, — ' +
        'ровно то же, что делает планировщик. Повторный запуск безопасен: один расчёт на мерчанта, ' +
        'валюту и конец периода.',
    );
    if (confirmed) {
      runMutation.mutate();
    }
  };

  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard
          label="Расчётов на странице"
          note={
            listQuery.data
              ? `Всего по фильтру: ${listQuery.data.totalElements} · страница ${listQuery.data.page + 1} из ${Math.max(1, listQuery.data.totalPages)}`
              : 'Данные ещё не загружены'
          }
        >
          <span className="tnum text-lg font-semibold text-ink-900">{loaded ? items.length : '—'}</span>
        </KpiCard>

        <KpiCard
          label="Ждут выплаты"
          note={
            loaded
              ? `По текущей странице: ${pending.length} расчётов без выплаты`
              : 'Данные ещё не загружены'
          }
        >
          <MoneyLines sums={sumsByCurrency(pending, netOf)} empty="—" />
        </KpiCard>

        <KpiCard
          label="Выплачено"
          note={loaded ? `По текущей странице: ${paid.length} выплат` : 'Данные ещё не загружены'}
        >
          <MoneyLines sums={sumsByCurrency(paid, netOf)} empty="—" />
        </KpiCard>

        <KpiCard
          label="Комиссия платформы"
          note={
            !loaded
              ? 'Данные ещё не загружены'
              : failed.length > 0
                ? `По текущей странице · не удалось выплатить: ${failed.length} на ${sumsByCurrency(failed, netOf)
                    .map((entry) => formatMoney(entry.totalMinor, entry.currency))
                    .join(', ')}`
                : 'По текущей странице (все статусы)'
          }
        >
          <MoneyLines sums={sumsByCurrency(visible, commissionOf)} empty="—" />
        </KpiCard>
      </div>

      <Card>
        <CardHeader
          title="Расчёт вручную"
          subtitle="Тот же прогон, что делает планировщик: посчитать долги по закрытым периодам и выплатить то, что можно."
        />
        <CardBody className="space-y-3">
          {canWrite ? (
            <>
              <p className="text-sm text-ink-600">
                Запуск доступен роли {roleLabel('ADMIN')}. Прогон идемпотентен на стороне сервиса: повторный запуск
                по тому же периоду не создаёт второй расчёт и не платит дважды.
              </p>
              <Button
                onClick={startRun}
                data-admin-write="запуск расчёта"
                loading={runMutation.isPending}
                disabled={runMutation.isPending}
              >
                Запустить расчёт
              </Button>
            </>
          ) : (
            <p className="text-sm text-ink-600">
              Запуск расчёта доступен только роли {roleLabel('ADMIN')}. У роли {roleLabel(role)} раздел работает в
              режиме чтения, поэтому кнопка запуска здесь не показывается.
            </p>
          )}

          {runMutation.isError ? (
            <ErrorAlert error={runMutation.error} title="Прогон расчётов не выполнен" />
          ) : null}
          {runMutation.data ? <RunResult result={runMutation.data} /> : null}
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title="Расчёты"
          subtitle={listQuery.data ? `Найдено сервисом по фильтру: ${listQuery.data.totalElements}` : undefined}
          action={
            <div className="w-56">
              <SelectField
                id="settlements-status-filter"
                label="Статус (по странице)"
                value={statusFilter}
                options={STATUS_OPTIONS.map((value) => ({ value, label: statusLabel(value) }))}
                placeholder="Все статусы"
                hint="Сервис не принимает status: фильтр применяется к загруженной странице."
                onChange={(event) => setStatusFilter(event.target.value)}
              />
            </div>
          }
        />

        <CardBody>
          <div className="mb-3 max-w-md">
            <TextField
              id="settlements-merchant"
              label="Мерчант"
              value={merchantInput}
              placeholder="ID мерчанта (ULID)"
              hint="Серверный фильтр: GET /api/v1/settlements?merchantId=… Пусто — все мерчанты."
              onChange={(event) => {
                setMerchantInput(event.target.value);
                setPage(0);
              }}
            />
          </div>

          {listQuery.isPending ? <SkeletonRows count={6} /> : null}

          {listQuery.isError ? (
            <ErrorAlert
              error={listQuery.error}
              title="Не удалось загрузить расчёты"
              onRetry={() => void listQuery.refetch()}
            />
          ) : null}

          {listQuery.data && items.length === 0 ? (
            <EmptyState
              title="Расчётов нет"
              description={
                merchantId === ''
                  ? 'Сервис не вернул ни одного расчёта: значит, по закрытым периодам ещё нечего выплачивать.'
                  : `По мерчанту ${merchantId} расчётов не найдено. Проверьте идентификатор или очистите фильтр.`
              }
            />
          ) : null}

          {listQuery.data && items.length > 0 && visible.length === 0 ? (
            <EmptyState
              title={`На этой странице нет расчётов со статусом «${statusLabel(statusFilter)}»`}
              description="Фильтр по статусу работает по загруженной странице: сервис не принимает параметр status. Посмотрите другую страницу или снимите фильтр."
            />
          ) : null}

          {visible.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[1000px] text-left text-sm">
                <thead>
                  <tr className="border-b border-ink-200 text-xs text-ink-500 uppercase">
                    <th scope="col" className="py-2 pr-3 font-medium">Расчёт</th>
                    <th scope="col" className="py-2 pr-3 font-medium">Мерчант</th>
                    <th scope="col" className="py-2 pr-3 font-medium">Период</th>
                    <th scope="col" className="py-2 pr-3 text-right font-medium">Платежей</th>
                    <th scope="col" className="py-2 pr-3 text-right font-medium">Товары</th>
                    <th scope="col" className="py-2 pr-3 text-right font-medium">Комиссия</th>
                    <th scope="col" className="py-2 pr-3 text-right font-medium">Заплатил клиент</th>
                    <th scope="col" className="py-2 pr-3 text-right font-medium">К выплате</th>
                    <th scope="col" className="py-2 pr-3 font-medium">Статус</th>
                    <th scope="col" className="py-2 pr-3 font-medium">Создан</th>
                    <th scope="col" className="py-2 font-medium" />
                  </tr>
                </thead>
                <tbody>
                  {visible.map((settlement) => (
                    <tr
                      key={settlement.settlementId}
                      className={
                        settlement.settlementId === selectedId ? 'bg-brand-50' : 'border-b border-ink-100'
                      }
                    >
                      <td className="py-2 pr-3">
                        <span className="block font-medium text-ink-900">{settlement.settlementNumber}</span>
                        <span className="block font-mono text-xs text-ink-400">
                          {shortId(settlement.settlementId, 10)}
                        </span>
                      </td>
                      <td className="py-2 pr-3">
                        <span className="block font-mono text-xs text-ink-700">{shortId(settlement.merchantId, 10)}</span>
                        <span className="block text-xs text-ink-400">владелец {shortId(settlement.ownerUserId, 8)}</span>
                      </td>
                      <td className="py-2 pr-3 whitespace-nowrap text-xs text-ink-600">
                        <span className="block">{formatDateTime(settlement.periodStart)}</span>
                        <span className="block">→ {formatDateTime(settlement.periodEnd)}</span>
                      </td>
                      <td className="tnum py-2 pr-3 text-right">{settlement.paymentCount}</td>
                      <td className="tnum py-2 pr-3 text-right whitespace-nowrap">
                        {formatMoney(settlement.grossMinor, settlement.currency)}
                      </td>
                      <td className="tnum py-2 pr-3 text-right whitespace-nowrap">
                        {formatMoney(settlement.commissionMinor, settlement.currency)}
                      </td>
                      <td className="tnum py-2 pr-3 text-right whitespace-nowrap">
                        {formatMoney(settlement.customerPaidMinor, settlement.currency)}
                      </td>
                      <td className="tnum py-2 pr-3 text-right font-semibold whitespace-nowrap">
                        {formatMoney(settlement.netMinor, settlement.currency)}
                      </td>
                      <td className="py-2 pr-3">
                        <StatusBadge status={settlement.status} />
                      </td>
                      <td className="py-2 pr-3 whitespace-nowrap text-xs text-ink-600">
                        {formatDateTime(settlement.createdAt)}
                      </td>
                      <td className="py-2 text-right">
                        <Button
                          variant="secondary"
                          size="sm"
                          aria-pressed={settlement.settlementId === selectedId}
                          onClick={() =>
                            setSelectedId(
                              settlement.settlementId === selectedId ? null : settlement.settlementId,
                            )
                          }
                        >
                          {settlement.settlementId === selectedId ? 'Скрыть' : 'Детали'}
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}

          {listQuery.data ? (
            <Pagination
              page={listQuery.data.page}
              totalPages={listQuery.data.totalPages}
              hasNext={listQuery.data.hasNext}
              totalElements={listQuery.data.totalElements}
              isFetching={listQuery.isFetching}
              onPageChange={setPage}
            />
          ) : null}
        </CardBody>
      </Card>

      {selectedId ? (
        <Card>
          <CardHeader
            title="Деталь расчёта"
            subtitle={`Расчёт ${shortId(selectedId, 12)}`}
            action={
              <Button variant="ghost" size="sm" onClick={() => setSelectedId(null)}>
                Закрыть
              </Button>
            }
          />
          <CardBody>
            {detailQuery.isPending ? <SkeletonRows count={4} /> : null}

            {detailQuery.isError ? (
              <ErrorAlert
                error={detailQuery.error}
                title="Не удалось загрузить расчёт"
                onRetry={() => void detailQuery.refetch()}
              />
            ) : null}

            {detail ? (
              <div className="grid gap-4 xl:grid-cols-3">
                <div className="xl:col-span-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="text-base font-semibold text-ink-900">{detail.settlement.settlementNumber}</h3>
                    <StatusBadge status={detail.settlement.status} />
                  </div>
                  <p className="mt-1 text-xs text-ink-500">
                    {STATUS_HINTS[detail.settlement.status] ?? 'Состояние выплаты, как его вернул сервис.'}
                  </p>

                  <dl className="mt-3">
                    <DetailRow label="ID расчёта">
                      <span className="inline-flex items-center gap-1">
                        <span className="font-mono text-xs">{detail.settlement.settlementId}</span>
                        <CopyButton value={detail.settlement.settlementId} />
                      </span>
                    </DetailRow>
                    <DetailRow label="Мерчант">
                      <span className="inline-flex items-center gap-1">
                        <span className="font-mono text-xs">{detail.settlement.merchantId}</span>
                        <CopyButton value={detail.settlement.merchantId} />
                      </span>
                    </DetailRow>
                    <DetailRow label="Владелец (ownerUserId)">
                      <span className="font-mono text-xs">{detail.settlement.ownerUserId}</span>
                    </DetailRow>
                    <DetailRow label="Валюта">{detail.settlement.currency}</DetailRow>
                    <DetailRow label="Период">
                      {formatDateTime(detail.settlement.periodStart)} —{' '}
                      {formatDateTime(detail.settlement.periodEnd)}
                    </DetailRow>
                    <DetailRow label="Платежей в расчёте">{detail.settlement.paymentCount}</DetailRow>
                    <DetailRow label="Стоимость товаров (grossMinor)">
                      <span className="tnum">
                        {formatMoney(detail.settlement.grossMinor, detail.settlement.currency)}
                      </span>
                    </DetailRow>
                    <DetailRow label="Комиссия платформы (commissionMinor)">
                      <span className="tnum">
                        {formatMoney(detail.settlement.commissionMinor, detail.settlement.currency)}
                      </span>
                    </DetailRow>
                    <DetailRow label="Заплатил клиент (customerPaidMinor)">
                      <span className="tnum">
                        {formatMoney(detail.settlement.customerPaidMinor, detail.settlement.currency)}
                      </span>
                    </DetailRow>
                    <DetailRow label="К выплате мерчанту (netMinor)">
                      <span className="tnum">
                        {formatMoney(detail.settlement.netMinor, detail.settlement.currency)}
                      </span>
                    </DetailRow>
                    <DetailRow label="Счёт для выплаты">
                      {detail.settlement.payoutAccountId ? (
                        <span className="font-mono text-xs">{detail.settlement.payoutAccountId}</span>
                      ) : (
                        <span className="text-ink-500">не указан мерчантом</span>
                      )}
                    </DetailRow>
                    <DetailRow label="Создан">{formatDateTime(detail.settlement.createdAt)}</DetailRow>
                    <DetailRow label="Выплачен">
                      {detail.settlement.paidAt ? (
                        formatDateTime(detail.settlement.paidAt)
                      ) : (
                        <span className="text-ink-500">—</span>
                      )}
                    </DetailRow>
                  </dl>

                  {detail.settlement.failureReason ? (
                    <div className="mt-3">
                      <Alert tone="danger" title="Выплата не прошла">
                        {detail.settlement.failureReason}
                      </Alert>
                    </div>
                  ) : null}

                  <p className="mt-3 text-xs text-ink-500">
                    Комиссия платформы удерживается на checkout, поэтому мерчант получает стоимость товаров:
                    netMinor = grossMinor, а customerPaidMinor = grossMinor + commissionMinor. Обе величины пришли
                    от сервиса, ничего не пересчитывалось в браузере.
                  </p>
                </div>

                <div>
                  <h3 className="text-sm font-semibold text-ink-900">Покрывающие платежи</h3>
                  {detail.paymentIds.length === 0 ? (
                    <p className="mt-2 text-sm text-ink-500">
                      Сервис не вернул ни одного платежа в этом расчёте.
                    </p>
                  ) : (
                    <ul className="mt-2 space-y-1">
                      {detail.paymentIds.map((paymentId) => (
                        <li key={paymentId} className="flex items-center justify-between gap-2 text-xs">
                          <span className="font-mono text-ink-700 break-all">{paymentId}</span>
                          <CopyButton value={paymentId} label="Копировать" />
                        </li>
                      ))}
                    </ul>
                  )}
                  <p className="mt-3 text-xs text-ink-500">
                    Деталь расчёта отдаёт только идентификаторы платежей (`paymentIds`) — сумм по ним в этом ответе
                    нет, поэтому здесь их и не показываем. Сам платёж видно в разделе «Платежи».
                  </p>
                </div>
              </div>
            ) : null}
          </CardBody>
        </Card>
      ) : null}
    </div>
  );
}
