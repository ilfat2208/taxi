/**
 * Раздел «Расчёты с мерчантами» админ-панели.
 *
 * Экран собран так же, как «Платежи», и на тех же блоках из `src/admin/kit.tsx`:
 * тулбар с числом найденного, плитки, две диаграммы по загруженной странице, рейл
 * статусов слева от таблицы, карточка расчёта справа и прогон расчёта отдельной панелью.
 *
 * Три вещи, которые продиктованы сервисом, а не удобством вёрстки:
 *
 *  1. фильтра по статусу в API нет — `SettlementController.list` принимает только
 *     `merchantId`, `page`, `size`. Поэтому статус отбирается по уже загруженной странице,
 *     рейл статусов с числами подписан «по загруженной странице», а не выдан за серверный
 *     фильтр;
 *  2. деталь отдаёт `paymentIds` — идентификаторы покрытых платежей, без сумм. Поэтому в
 *     таблице покрывающих платежей стоит идентификатор, а колонка суммы честно пустая:
 *     сервис этих сумм в ответе не присылает;
 *  3. `POST /settlements/run` не принимает тело и не требует `Idempotency-Key`: повторный
 *     прогон безопасен внутри сервиса (один расчёт на мерчанта, валюту и конец периода).
 *     Клиент ничего лишнего в запрос не добавляет.
 */
import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { UseQueryResult } from '@tanstack/react-query';
import type { SVGProps } from 'react';
import { formatMoney, sumMinor } from '../../api/money';
import { PaymentsIcon, ServicesIcon, StoreIcon, TransferIcon, WalletIcon } from '../../components/layout/icons';
import { Alert, ErrorAlert } from '../../components/ui/Alerts';
import { Badge, StatusBadge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { DetailRow } from '../../components/ui/Card';
import { CopyButton } from '../../components/ui/CopyButton';
import { EmptyState } from '../../components/ui/EmptyState';
import { SelectField, TextField } from '../../components/ui/Field';
import { Pagination } from '../../components/ui/Pagination';
import { SkeletonRows, SkeletonText } from '../../components/ui/Skeleton';
import { BarList, Chip, Donut, KpiTile, Panel, StatusRail, Toolbar } from '../kit';
import { cx } from '../../lib/cx';
import { useDebouncedValue } from '../../hooks/useDebouncedValue';
import { formatDate, formatDateTime, roleLabel, shortId, statusLabel, statusTone } from '../../lib/format';
import type { AdminSectionProps } from '../sections';
import { fetchSettlement, fetchSettlements, runSettlements } from '../api/settlements';
import type { Settlement, SettlementDetail, SettlementQuery, SettlementRunResult } from '../api/settlements';

/* ------------------------------------------------------------------ константы */

const DEFAULT_PAGE_SIZE = 20;

const PAGE_SIZE_OPTIONS = [10, 20, 50, 100].map((value) => ({
  value: String(value),
  label: `${value} строк`,
}));

/** Три состояния выплаты из `SettlementStatus` сервиса. */
const STATUS_OPTIONS = ['PENDING', 'PAID', 'FAILED'];

/** Ключи запросов локальные для раздела: общий `lib/queryKeys.ts` не трогаем. */
const settlementKeys = {
  list: (query: SettlementQuery) => ['admin', 'settlements', 'list', query] as const,
  detail: (settlementId: string) => ['admin', 'settlements', 'detail', settlementId] as const,
};

/** Понятное объяснение статуса выплаты — формулировки из состояния сервиса. */
const STATUS_HINTS: Record<string, string> = {
  PENDING: 'Долг записан, деньги ещё не ушли: чаще всего мерчант не указал счёт для выплат.',
  PAID: 'Деньги выплачены на счёт мерчанта.',
  FAILED: 'Выплата не прошла, долг остался на платформе и будет повторён следующим прогоном.',
};

/* ------------------------------------------------------------------ деньги */

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

/** Сколько строк страницы в каждом статусе: клиентский счёт по загруженным данным. */
function countByStatus(items: readonly Settlement[]): Array<{ status: string; count: number }> {
  const counts = new Map<string, number>();
  for (const item of items) {
    counts.set(item.status, (counts.get(item.status) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([status, count]) => ({ status, count }))
    .sort((left, right) => right.count - left.count || left.status.localeCompare(right.status));
}

/**
 * Деньги по валютам одной строкой — для подписи рядом с полосой диаграммы и в плитке,
 * где многострочная вёрстка не помещается. Суммы по-прежнему не складываются.
 */
function moneyHint(sums: readonly CurrencySum[], empty = '—'): string {
  if (sums.length === 0) {
    return empty;
  }
  return sums.map((entry) => formatMoney(entry.totalMinor, entry.currency)).join(' · ');
}

/**
 * CSV загруженных строк.
 *
 * В файл попадает ровно то, что лежит на странице, и суммы в минорных единицах — как их
 * отдал сервис, чтобы выгрузку можно было сверить с API, а не с вёрсткой.
 */
export function settlementsCsv(items: readonly Settlement[]): string {
  const header = [
    'settlementId',
    'settlementNumber',
    'merchantId',
    'ownerUserId',
    'status',
    'currency',
    'grossMinor',
    'commissionMinor',
    'customerPaidMinor',
    'netMinor',
    'paymentCount',
    'periodStart',
    'periodEnd',
    'createdAt',
    'paidAt',
  ];
  const quote = (value: string) => `"${value.replace(/"/g, '""')}"`;
  const rows = items.map((item) =>
    [
      item.settlementId,
      item.settlementNumber,
      item.merchantId,
      item.ownerUserId,
      item.status,
      String(item.currency),
      String(item.grossMinor),
      String(item.commissionMinor),
      String(item.customerPaidMinor),
      String(item.netMinor),
      String(item.paymentCount),
      item.periodStart,
      item.periodEnd,
      item.createdAt,
      item.paidAt ?? '',
    ]
      .map(quote)
      .join(','),
  );
  return [header.join(','), ...rows].join('\r\n');
}

/* ------------------------------------------------------- мелкие детали вида */

/** Иконки тулбара: три пути, ради которых не тянем библиотеку. */
function RefreshIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" aria-hidden="true" {...props}>
      <path d="M20 12a8 8 0 1 1-2.6-5.9" />
      <path d="M20 4v4h-4" />
    </svg>
  );
}

function SlidersIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" aria-hidden="true" {...props}>
      <path d="M4 7h10M18 7h2M4 17h6M14 17h6" />
      <circle cx="16" cy="7" r="2" />
      <circle cx="12" cy="17" r="2" />
    </svg>
  );
}

function DownloadIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}>
      <path d="M12 4v10" />
      <path d="m8 11 4 4 4-4" />
      <path d="M5 19h14" />
    </svg>
  );
}

/**
 * Деньги разных валют в плитке: каждая валюта — своей строкой.
 *
 * `whitespace-normal` нужен потому, что значение плитки по умолчанию обрезается в одну
 * строку, а обрезанная сумма — это неправда.
 */
function MoneyValue({ sums, empty = '—' }: { sums: readonly CurrencySum[]; empty?: string }) {
  if (sums.length === 0) {
    return <span className="text-ink-400">{empty}</span>;
  }
  return (
    <span className={cx('block leading-tight whitespace-normal', sums.length === 1 ? 'text-xl' : 'text-lg')}>
      {sums.map((entry) => (
        <span key={entry.currency} className="block">
          {formatMoney(entry.totalMinor, entry.currency)}
        </span>
      ))}
    </span>
  );
}

/** Выгрузка загруженных строк в CSV — ровно то, что видно на экране, и ничего больше. */
function CopyCsvButton({ csv, rows }: { csv: string; rows: number }) {
  const [state, setState] = useState<'idle' | 'done' | 'failed'>('idle');

  useEffect(() => {
    if (state === 'idle') {
      return;
    }
    const timer = window.setTimeout(() => setState('idle'), 2_500);
    return () => window.clearTimeout(timer);
  }, [state]);

  return (
    <Button
      variant="secondary"
      size="sm"
      icon={<DownloadIcon className="h-4 w-4" />}
      disabled={rows === 0}
      onClick={() => {
        void (async () => {
          try {
            await navigator.clipboard.writeText(csv);
            setState('done');
          } catch {
            setState('failed');
          }
        })();
      }}
    >
      <span aria-live="polite">
        {state === 'done'
          ? `Скопировано строк: ${rows}`
          : state === 'failed'
            ? 'Буфер обмена недоступен'
            : `Скопировать CSV (${rows})`}
      </span>
    </Button>
  );
}

/** Идентификатор со кнопкой копирования: ULID не переписывают руками. */
function IdValue({ value, label }: { value: string | null | undefined; label: string }) {
  if (!value) {
    return <span className="text-ink-500">{label}</span>;
  }
  return (
    <span className="inline-flex min-w-0 items-center gap-1">
      <span className="font-mono text-xs break-all">{value}</span>
      <CopyButton value={value} label="копировать" />
    </span>
  );
}

/* --------------------------------------------------------- карточка расчёта */

/**
 * Тело карточки расчёта: сетка полей и таблица покрывающих платежей.
 *
 * Заголовок с номером и статусом рисует панель, поэтому здесь только данные.
 */
function SettlementDetailBody({
  settlementId,
  detail,
}: {
  settlementId: string;
  detail: UseQueryResult<SettlementDetail>;
}) {
  if (detail.isPending) {
    return <SkeletonRows count={4} />;
  }

  if (detail.isError) {
    return (
      <ErrorAlert error={detail.error} title="Не удалось загрузить расчёт" onRetry={() => void detail.refetch()} />
    );
  }

  const settlement = detail.data?.settlement;

  if (!settlement) {
    return (
      <EmptyState
        title="Сервис не вернул расчёт"
        description={`В ответе на ${shortId(settlementId, 12)} нет объекта расчёта: показать поля нечего, и придумывать их нельзя. Обновите страницу или откройте расчёт заново.`}
      />
    );
  }

  const paymentIds = detail.data?.paymentIds ?? [];

  return (
    <div className="space-y-4">
      <p className="text-xs leading-snug text-ink-500">
        {STATUS_HINTS[settlement.status] ?? 'Состояние выплаты, как его вернул сервис.'}
      </p>

      {/* Одна колонка: панель карточки узкая, а в две колонки ULID рвётся по символу. */}
      <dl className="divide-y divide-ink-100">
        <DetailRow label="ID расчёта">
          <IdValue value={settlement.settlementId} label="—" />
        </DetailRow>
        <DetailRow label="Номер">{settlement.settlementNumber}</DetailRow>
        <DetailRow label="Мерчант">
          <IdValue value={settlement.merchantId} label="—" />
        </DetailRow>
        <DetailRow label="Владелец (ownerUserId)">
          <IdValue value={settlement.ownerUserId} label="—" />
        </DetailRow>
        <DetailRow label="Валюта">{settlement.currency}</DetailRow>
        <DetailRow label="Период">
          <span className="text-xs">
            {formatDateTime(settlement.periodStart)} — {formatDateTime(settlement.periodEnd)}
          </span>
        </DetailRow>
        <DetailRow label="Платежей в расчёте">{settlement.paymentCount}</DetailRow>
        <DetailRow label="Стоимость товаров (grossMinor)">
          <span className="tnum">{formatMoney(settlement.grossMinor, settlement.currency)}</span>
        </DetailRow>
        <DetailRow label="Комиссия платформы (commissionMinor)">
          <span className="tnum">{formatMoney(settlement.commissionMinor, settlement.currency)}</span>
        </DetailRow>
        <DetailRow label="Заплатил клиент (customerPaidMinor)">
          <span className="tnum">{formatMoney(settlement.customerPaidMinor, settlement.currency)}</span>
        </DetailRow>
        <DetailRow label="К выплате мерчанту (netMinor)">
          <span className="tnum">{formatMoney(settlement.netMinor, settlement.currency)}</span>
        </DetailRow>
        <DetailRow label="Счёт для выплаты">
          {settlement.payoutAccountId ? (
            <span className="font-mono text-xs break-all">{settlement.payoutAccountId}</span>
          ) : (
            <span className="text-ink-500">не указан мерчантом</span>
          )}
        </DetailRow>
        <DetailRow label="Создан">{formatDateTime(settlement.createdAt)}</DetailRow>
        <DetailRow label="Выплачен">
          {settlement.paidAt ? formatDateTime(settlement.paidAt) : <span className="text-ink-500">—</span>}
        </DetailRow>
      </dl>

      <p className="text-xs leading-snug text-ink-500">
        Комиссия платформы удерживается на checkout, поэтому мерчант получает стоимость товаров: netMinor = grossMinor, а
        customerPaidMinor = grossMinor + commissionMinor. Обе величины пришли от сервиса, ничего не пересчитывалось в
        браузере.
      </p>

      {settlement.failureReason ? (
        <Alert tone="danger" title="Выплата не прошла">
          {settlement.failureReason}
        </Alert>
      ) : null}

      <div className="border-t border-ink-100 pt-3">
        <h3 className="text-sm font-semibold text-ink-900">Покрывающие платежи · {paymentIds.length}</h3>

        {paymentIds.length === 0 ? (
          <div className="mt-2">
            <EmptyState
              title="Сервис не вернул ни одного платежа в этом расчёте"
              description="Пустой paymentIds означает, что в ответе детали платежей нет: считать это нулём платежей нельзя, ведь paymentCount пришёл отдельным полем."
            />
          </div>
        ) : (
          <div className="relative overflow-x-auto mt-2">
            <table className="w-full min-w-[22rem] text-left text-sm">
              <caption className="sr-only">Покрывающие платежи расчёта: идентификатор и сумма</caption>
              <thead>
                <tr className="border-b border-ink-200 text-xs text-ink-500">
                  <th scope="col" className="py-1.5 pr-3 font-medium">Платёж</th>
                  <th scope="col" className="py-1.5 text-right font-medium">Сумма</th>
                </tr>
              </thead>
              <tbody>
                {paymentIds.map((paymentId) => (
                  <tr key={paymentId} className="border-b border-ink-100">
                    <td className="py-1.5 pr-3">
                      <span className="flex items-center gap-1">
                        <span className="font-mono text-xs break-all text-ink-700">{paymentId}</span>
                        <CopyButton value={paymentId} />
                      </span>
                    </td>
                    <td className="tnum py-1.5 text-right text-xs whitespace-nowrap text-ink-500">—</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <p className="mt-2 text-xs leading-snug text-ink-500">
          Деталь расчёта отдаёт только идентификаторы платежей (`paymentIds`) — сумм по ним в этом ответе нет, поэтому
          здесь их и не показываем. Сам платёж видно в разделе «Платежи». Колонка «Сумма» заполняется, только если
          сервис когда-нибудь начнёт присылать суммы вместе с идентификаторами.
        </p>
      </div>
    </div>
  );
}

/* --------------------------------------------------------------- прогон */

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

/* ------------------------------------------------------------------- раздел */

export default function SettlementsSection({ role, canWrite }: AdminSectionProps) {
  const [merchantInput, setMerchantInput] = useState('');
  const merchantId = useDebouncedValue(merchantInput.trim(), 400);
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);
  const [page, setPage] = useState(0);
  const [statusFilter, setStatusFilter] = useState('');
  const [filtersOpen, setFiltersOpen] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const queryClient = useQueryClient();

  const filters: SettlementQuery = {
    merchantId: merchantId === '' ? undefined : merchantId,
    page,
    size: pageSize,
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

  const statusCounts = useMemo(() => countByStatus(items), [items]);
  const countMap = useMemo(
    () => new Map(statusCounts.map((entry) => [entry.status, entry.count])),
    [statusCounts],
  );

  /** Статусы рейла: известные словарю плюс всё, что реально пришло в данных. */
  const railItems = useMemo(() => {
    const extra = statusCounts.map((entry) => entry.status).filter((value) => !STATUS_OPTIONS.includes(value));
    return [...STATUS_OPTIONS, ...extra].map((value) => ({
      value,
      label: statusLabel(value),
      count: countMap.get(value) ?? 0,
    }));
  }, [statusCounts, countMap]);

  const pending = useMemo(() => visible.filter((settlement) => settlement.status === 'PENDING'), [visible]);
  const paid = useMemo(() => visible.filter((settlement) => settlement.status === 'PAID'), [visible]);
  const failed = useMemo(() => visible.filter((settlement) => settlement.status === 'FAILED'), [visible]);

  /**
   * Последний расчёт страницы: у которого позже всех закрылся период. Сравниваем время
   * разбором даты, а не строкой, чтобы ответ сервиса без таймзоны не путал порядок.
   */
  const latest = useMemo(() => {
    let best: Settlement | null = null;
    let bestTime = Number.NEGATIVE_INFINITY;
    for (const settlement of visible) {
      const time = Date.parse(settlement.periodEnd);
      const comparable = Number.isNaN(time) ? Number.NEGATIVE_INFINITY : time;
      if (best === null || comparable > bestTime) {
        best = settlement;
        bestTime = comparable;
      }
    }
    return best;
  }, [visible]);

  const netOf = (settlement: Settlement) => settlement.netMinor;
  const commissionOf = (settlement: Settlement) => settlement.commissionMinor;

  /** Полосы: по строке на статус; полоса — число расчётов, суммы подписаны рядом. */
  const barItems = useMemo(
    () =>
      statusCounts.map((entry) => {
        const inStatus = visible.filter((settlement) => settlement.status === entry.status);
        return {
          key: entry.status,
          label: statusLabel(entry.status),
          value: entry.count,
          hint: moneyHint(sumsByCurrency(inStatus, netOf)),
          tone: statusTone(entry.status),
        };
      }),
    [statusCounts, visible],
  );

  const segments = statusCounts.map((entry) => ({
    key: entry.status,
    label: statusLabel(entry.status),
    value: entry.count,
    tone: statusTone(entry.status),
  }));

  const csv = settlementsCsv(visible);

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
      {/* Тулбар: сколько расчётов нашлось и что с ними можно сделать. */}
      <Toolbar
        right={
          <>
            <Button
              variant="secondary"
              size="sm"
              icon={<RefreshIcon className="h-4 w-4" />}
              loading={listQuery.isFetching}
              onClick={() => void listQuery.refetch()}
            >
              Обновить
            </Button>
            <Button
              variant="secondary"
              size="sm"
              icon={<SlidersIcon className="h-4 w-4" />}
              aria-expanded={filtersOpen}
              onClick={() => setFiltersOpen((open) => !open)}
            >
              Фильтр
            </Button>
            <CopyCsvButton csv={csv} rows={visible.length} />
          </>
        }
      >
        <h2 className="text-lg font-semibold text-ink-900">Расчёты</h2>
        <Badge tone="brand">{listQuery.data ? `Найдено: ${listQuery.data.totalElements}` : 'считаем…'}</Badge>
        {listQuery.isFetching ? <span className="text-xs text-ink-500">обновляем…</span> : null}
      </Toolbar>

      {filtersOpen ? (
        <div className="mb-4 flex flex-wrap items-end gap-x-4 gap-y-3 rounded-card border border-ink-200 bg-white px-4 py-3 shadow-sm">
          <div className="w-64">
            <TextField
              id="settlements-merchant"
              label="Мерчант"
              value={merchantInput}
              placeholder="ID мерчанта (ULID)"
              hint="Серверный фильтр: GET /api/v1/settlements?merchantId=… Пусто — все мерчанты. Уходит через 0,4 с после ввода."
              onChange={(event) => {
                setMerchantInput(event.target.value);
                setPage(0);
              }}
            />
          </div>

          <div className="w-36">
            <SelectField
              id="settlements-size"
              label="Строк на странице"
              value={String(pageSize)}
              options={PAGE_SIZE_OPTIONS}
              hint="Параметр size сервиса"
              onChange={(event) => {
                setPageSize(Number(event.target.value));
                setPage(0);
              }}
            />
          </div>

          <p className="pb-2 text-xs text-ink-500 lg:ml-auto">
            На странице {items.length}
            {statusFilter === '' ? '' : `, после отбора по статусу ${visible.length}`} из{' '}
            {listQuery.data?.totalElements ?? '—'} найденных сервисом
          </p>
        </div>
      ) : null}

      {/* Плитки: долг, выплата, комиссия и период последнего расчёта страницы. */}
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <KpiTile
          label="Расчётов по фильтру"
          icon={<StoreIcon className="h-5 w-5" />}
          tone="brand"
          loading={!loaded}
          value={listQuery.data ? listQuery.data.totalElements : undefined}
          caption={`Счёт сервиса${merchantId === '' ? ' по всем мерчантам' : ` по мерчанту ${shortId(merchantId, 10)}`}; на странице ${items.length}`}
        />

        <KpiTile
          label="К выплате"
          icon={<WalletIcon className="h-5 w-5" />}
          tone="warning"
          loading={!loaded}
          value={<MoneyValue sums={sumsByCurrency(pending, netOf)} />}
          caption={`PENDING на странице: ${pending.length} расчётов, деньги ещё не ушли; валюты не складываются`}
        />

        <KpiTile
          label="Выплачено"
          icon={<TransferIcon className="h-5 w-5" />}
          tone="success"
          loading={!loaded}
          value={<MoneyValue sums={sumsByCurrency(paid, netOf)} />}
          caption={`PAID на странице: ${paid.length} выплат по netMinor, как его вернул сервис`}
        />

        <KpiTile
          label="Комиссия платформы"
          icon={<PaymentsIcon className="h-5 w-5" />}
          tone="info"
          loading={!loaded}
          value={<MoneyValue sums={sumsByCurrency(visible, commissionOf)} />}
          caption={
            failed.length > 0
              ? `По странице, все статусы · не удалось выплатить ${failed.length} на ${moneyHint(sumsByCurrency(failed, netOf))}`
              : 'По странице, все статусы: commissionMinor как его вернул сервис'
          }
        />

        <KpiTile
          label="Период последнего расчёта"
          icon={<ServicesIcon className="h-5 w-5" />}
          tone="neutral"
          loading={!loaded}
          value={latest ? formatDate(latest.periodEnd) : '—'}
          caption={
            latest
              ? `По загруженной странице: поздний конец периода среди ${visible.length} расчётов, начало ${formatDate(latest.periodStart)}`
              : 'На загруженной странице нет расчётов — период показать не из чего'
          }
        />

        {/* Диаграммы: без библиотек, по той же загруженной странице. */}
        <Panel
          className="sm:col-span-1 xl:col-span-3"
          title="Расчёты по статусам"
          subtitle={`По загруженной странице: ${visible.length} расчётов. Сервис не принимает фильтр по статусу и агрегатов не отдаёт — числа считает клиент.`}
          action={<Chip tone="neutral">по загруженной странице</Chip>}
        >
          {!loaded ? <SkeletonText lines={4} /> : null}

          {loaded && visible.length === 0 ? (
            <EmptyState
              title="Нечего показывать: на странице нет расчётов"
              description="Диаграммы строятся из загруженных строк. Снимите отбор по статусу в рейле, очистите мерчанта или откройте соседнюю страницу."
            />
          ) : null}

          {visible.length > 0 ? (
            <div className="grid gap-6 xl:grid-cols-2">
              <div className="min-w-0">
                <h3 className="text-sm font-semibold text-ink-900">Расчёты и суммы к выплате</h3>
                <div className="mt-2">
                  <BarList items={barItems} />
                </div>
                <p className="mt-2 text-xs leading-snug text-ink-500">
                  Полоса — число расчётов в статусе; сумма netMinor подписана рядом и не складывается между валютами.
                </p>
              </div>

              <div className="min-w-0">
                <h3 className="text-sm font-semibold text-ink-900">Доли статусов</h3>
                <div className="mt-2">
                  <Donut segments={segments} centerValue={visible.length} centerLabel="расчётов" />
                </div>
                <p className="mt-2 text-xs leading-snug text-ink-500">
                  Кольцо считает строки, а не деньги: в центре — число расчётов загруженной страницы.
                </p>
              </div>
            </div>
          ) : null}
        </Panel>
      </div>

      {/* Рейл, таблица и карточка расчёта: две колонки на широком экране. */}
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,26rem)]">
        <Panel
          title="Список расчётов"
          subtitle={
            listQuery.data
              ? `Найдено сервисом: ${listQuery.data.totalElements} · показано ${visible.length} строк текущей страницы`
              : 'Загружаем страницу расчётов'
          }
          action={<p className="text-xs text-ink-500">Клик по строке открывает карточку справа</p>}
        >
          <div className="grid gap-4 xl:grid-cols-[9rem_minmax(0,1fr)]">
            <div className="min-w-0">
              <StatusRail
                items={railItems}
                active={statusFilter}
                allCount={items.length}
                ariaLabel="Статусы расчётов (по загруженной странице)"
                onSelect={setStatusFilter}
              />
              <p className="mt-2 text-xs leading-snug text-ink-500">
                Числа в пилюлях — по загруженной странице: сервисного фильтра по статусу нет,{' '}
                <code className="font-mono">SettlementController</code> принимает только{' '}
                <code className="font-mono">merchantId</code>, <code className="font-mono">page</code> и{' '}
                <code className="font-mono">size</code>.
              </p>
            </div>

            <div className="min-w-0">
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
                <div className="relative overflow-x-auto max-h-[32rem] overflow-y-auto">
                  <table className="w-full min-w-[66rem] text-left text-sm">
                    <caption className="sr-only">
                      Расчёты текущей страницы: мерчант, период, суммы, статус выплаты и время создания
                    </caption>
                    <thead>
                      <tr className="text-xs text-ink-500 uppercase">
                        <th scope="col" className="sticky top-0 z-10 border-b border-ink-200 bg-white py-2 pr-3 font-medium">
                          Расчёт
                        </th>
                        <th scope="col" className="sticky top-0 z-10 border-b border-ink-200 bg-white py-2 pr-3 font-medium">
                          Мерчант
                        </th>
                        <th scope="col" className="sticky top-0 z-10 border-b border-ink-200 bg-white py-2 pr-3 font-medium">
                          Период
                        </th>
                        <th scope="col" className="sticky top-0 z-10 border-b border-ink-200 bg-white py-2 pr-3 text-right font-medium">
                          Платежей
                        </th>
                        <th scope="col" className="sticky top-0 z-10 border-b border-ink-200 bg-white py-2 pr-3 text-right font-medium">
                          Товары
                        </th>
                        <th scope="col" className="sticky top-0 z-10 border-b border-ink-200 bg-white py-2 pr-3 text-right font-medium">
                          Комиссия
                        </th>
                        <th scope="col" className="sticky top-0 z-10 border-b border-ink-200 bg-white py-2 pr-3 text-right font-medium">
                          Заплатил клиент
                        </th>
                        <th scope="col" className="sticky top-0 z-10 border-b border-ink-200 bg-white py-2 pr-3 text-right font-medium">
                          К выплате
                        </th>
                        <th scope="col" className="sticky top-0 z-10 border-b border-ink-200 bg-white py-2 pr-3 font-medium">
                          Статус
                        </th>
                        <th scope="col" className="sticky top-0 z-10 border-b border-ink-200 bg-white py-2 pr-3 font-medium">
                          Создан
                        </th>
                        <th scope="col" className="sticky top-0 z-10 border-b border-ink-200 bg-white py-2 font-medium">
                          <span className="sr-only">Действия</span>
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {visible.map((settlement, index) => {
                        const isSelected = settlement.settlementId === selectedId;
                        return (
                          <tr
                            key={settlement.settlementId}
                            onClick={() => setSelectedId(isSelected ? null : settlement.settlementId)}
                            className={cx(
                              'cursor-pointer border-b border-ink-100 align-top',
                              isSelected ? 'bg-brand-50' : index % 2 === 1 ? 'bg-ink-50/60' : 'bg-white',
                            )}
                          >
                            <td className="py-2 pr-3">
                              <span className="block font-medium text-ink-900">{settlement.settlementNumber}</span>
                              <span className="block font-mono text-xs text-ink-400">
                                {shortId(settlement.settlementId, 10)}
                              </span>
                            </td>
                            <td className="py-2 pr-3">
                              <span className="block font-mono text-xs text-ink-700">
                                {shortId(settlement.merchantId, 10)}
                              </span>
                              <span className="block text-xs text-ink-400">
                                владелец {shortId(settlement.ownerUserId, 8)}
                              </span>
                            </td>
                            <td className="py-2 pr-3 text-xs whitespace-nowrap text-ink-600">
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
                            <td className="py-2 pr-3 text-xs whitespace-nowrap text-ink-600">
                              {formatDateTime(settlement.createdAt)}
                            </td>
                            <td className="py-2 text-right">
                              <Button
                                variant="secondary"
                                size="sm"
                                aria-pressed={isSelected}
                                onClick={(event) => {
                                  // Клик по кнопке не должен срабатывать дважды вместе с кликом по строке.
                                  event.stopPropagation();
                                  setSelectedId(isSelected ? null : settlement.settlementId);
                                }}
                              >
                                Детали
                              </Button>
                            </td>
                          </tr>
                        );
                      })}
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
            </div>
          </div>
        </Panel>

        <Panel
          className="xl:sticky xl:top-4 xl:max-h-[calc(100vh-2rem)] xl:self-start xl:overflow-y-auto"
          title={
            selectedId ? (
              <span className="flex flex-wrap items-center gap-2">
                {detailQuery.data ? detailQuery.data.settlement.settlementNumber : 'Карточка расчёта'}
                {detailQuery.data ? <StatusBadge status={detailQuery.data.settlement.status} /> : null}
              </span>
            ) : (
              'Карточка расчёта'
            )
          }
          action={
            selectedId ? (
              <Button variant="ghost" size="sm" onClick={() => setSelectedId(null)}>
                Закрыть
              </Button>
            ) : undefined
          }
        >
          {selectedId ? (
            <SettlementDetailBody settlementId={selectedId} detail={detailQuery} />
          ) : (
            <EmptyState
              title="Расчёт не выбран"
              description="Выберите строку в списке: здесь появятся поля расчёта и покрывающие его платежи. Клик по строке и кнопка «Детали» делают одно и то же."
            />
          )}
        </Panel>
      </div>

      {/* Единственное изменяющее действие раздела — своей панелью. */}
      <Panel
        title="Расчёт вручную"
        subtitle="Тот же прогон, что делает планировщик: посчитать долги по закрытым периодам и выплатить то, что можно."
      >
        <div className="space-y-3">
          {canWrite ? (
            <>
              <p className="text-sm text-ink-600">
                Запуск доступен роли {roleLabel('ADMIN')}. Прогон идемпотентен на стороне сервиса: повторный запуск по
                тому же периоду не создаёт второй расчёт и не платит дважды.
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
              Запуск расчёта доступен только роли {roleLabel('ADMIN')}. У роли {roleLabel(role)} раздел работает в режиме
              чтения, поэтому кнопка запуска здесь не показывается. Список расчётов, детали и покрывающие платежи
              доступны полностью.
            </p>
          )}

          {runMutation.isError ? (
            <ErrorAlert error={runMutation.error} title="Прогон расчётов не выполнен" />
          ) : null}
          {runMutation.data ? <RunResult result={runMutation.data} /> : null}
        </div>
      </Panel>
    </div>
  );
}
