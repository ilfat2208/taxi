/**
 * Раздел «Платежи и возвраты» админ-панели.
 *
 * Показывает все платежи платформы (сервис отдаёт ADMIN и SUPPORT всю выборку),
 * деталь платежа с историей переходов и возвратов и форму возврата.
 *
 * Что здесь принципиально:
 *
 *  - KPI считаются по уже загруженной странице и подписаны именно так: клиент не
 *    имеет права складывать всю базу, которой он не видел;
 *  - суммы по валютам не смешиваются: на одной странице могут лежать KZT и USD, и
 *    одно «итого» из них было бы неправдой, поэтому каждая валюта — своей строкой;
 *  - возврат — изменяющее действие: при `canWrite === false` формы нет вообще,
 *    вместо неё строка о том, что возврат доступен роли ADMIN;
 *  - остаток к возврату ограничен суммой платежа минус уже прошедшие возвраты,
 *    чтобы не отправлять заведомо отклоняемый запрос.
 *
 * Что здесь есть и чего нет по вине сервиса:
 *
 *  - `PaymentResponse.orderId` показан в таблице рядом с мерчантом: раньше его терял
 *    нормализатор, теперь заказ виден, и по нему оператор идёт в раздел «Заказы»;
 *  - `RefundResponse` не содержит `completedAt`: в ответе есть `createdAt` и `updatedAt`,
 *    поэтому в списке возвратов стоит время изменения (`updatedAt`), а не выдуманная дата
 *    завершения.
 */
import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { fetchPayment, fetchPayments, fetchRefunds, refundPayment } from '../../api/endpoints';
import type { PaymentQuery } from '../../api/endpoints';
import { fieldErrorOf, humanMessage } from '../../api/errors';
import { formatMoney, parseAmountInput, sumMinor, toMajorString } from '../../api/money';
import type { Payment, RefundRequest } from '../../api/types';
import { AmountField } from '../../components/ui/AmountField';
import { Alert, ErrorAlert } from '../../components/ui/Alerts';
import { Badge, StatusBadge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { Card, CardBody, CardHeader, DetailRow } from '../../components/ui/Card';
import { CopyButton } from '../../components/ui/CopyButton';
import { EmptyState } from '../../components/ui/EmptyState';
import { SelectField, TextField } from '../../components/ui/Field';
import { Pagination } from '../../components/ui/Pagination';
import { SkeletonRows, SkeletonText } from '../../components/ui/Skeleton';
import { Timeline, type TimelineEntry } from '../../components/ui/Timeline';
import { useIdempotencyKey, transferSignature } from '../../lib/idempotency';
import { formatDateTime, paymentTypeLabel, roleLabel, shortId, statusLabel, statusTone } from '../../lib/format';
import type { AdminSectionProps } from '../sections';

const PAGE_SIZE = 20;

/** Состояния из `PaymentStatus` сервиса: то, что реально принимает фильтр `status`. */
const STATUS_OPTIONS = [
  'CREATED',
  'PENDING',
  'PROCESSING',
  'COMPLETED',
  'FAILED',
  'CANCELLED',
  'REFUNDED',
  'PARTIALLY_REFUNDED',
];

/** Незавершённые состояния: деньги ещё в пути. */
const IN_FLIGHT_STATUSES = ['CREATED', 'PENDING', 'PROCESSING'];

/**
 * Статусы возврата (`RefundStatus` сервиса).
 *
 * `statusLabel` из `lib/format` их не знает и вернул бы английский enum, поэтому
 * словарь живёт рядом со списком возвратов. Состояния взяты из сервиса:
 * `INITIATED` — строка возврата создана, деньги ещё могут быть в пути.
 */
const REFUND_STATUS_LABELS: Record<string, string> = {
  INITIATED: 'Инициирован',
  COMPLETED: 'Выполнен',
  FAILED: 'Отклонён',
};

/** Ключи запросов локальные для раздела: общий `lib/queryKeys.ts` не трогаем. */
const paymentKeys = {
  list: (query: PaymentQuery) => ['admin', 'payments', 'list', query] as const,
  detail: (paymentId: string) => ['admin', 'payments', 'detail', paymentId] as const,
  refunds: (paymentId: string) => ['admin', 'payments', 'detail', paymentId, 'refunds'] as const,
};

export interface CurrencySum {
  currency: string;
  totalMinor: number;
  count: number;
}

/**
 * Складывает деньги по валютам.
 *
 * Без группировки «итого» по странице с KZT и USD было бы числом, которого нет ни
 * в одной реальности, — поэтому возвращаются отдельные суммы на каждую валюту.
 */
export function sumsByCurrency<T>(
  items: readonly T[],
  currencyOf: (item: T) => string,
  amountOf: (item: T) => number,
): CurrencySum[] {
  const totals = new Map<string, { totalMinor: number; count: number }>();
  for (const item of items) {
    const currency = currencyOf(item) || 'KZT';
    const bucket = totals.get(currency) ?? { totalMinor: 0, count: 0 };
    bucket.totalMinor = sumMinor([bucket.totalMinor, amountOf(item)]);
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

/** Сумма уже прошедших возвратов. Отклонённый возврат денег не двигал. */
function refundedMinorOf(refunds: readonly { amountMinor: number; status: string }[]): number {
  return sumMinor(
    refunds.filter((refund) => refund.status !== 'FAILED').map((refund) => refund.amountMinor),
  );
}

/**
 * Возврат возможен только по деньгам, которые дошли до получателя.
 *
 * Правило взято у сервиса: возврат относится к завершённому платежу, а сам возврат
 * (`type === 'REFUND'`) вернуть нельзя.
 */
function refundable(payment: Payment | undefined): boolean {
  if (!payment) {
    return false;
  }
  if (payment.type === 'REFUND') {
    return false;
  }
  return (
    (payment.status === 'COMPLETED' || payment.status === 'PARTIALLY_REFUNDED') && payment.amountMinor > 0
  );
}

function transitionsOf(payment: Payment, transitions: TimelineEntry[]): TimelineEntry[] {
  if (transitions.length > 0) {
    return transitions;
  }
  return [
    {
      key: 'current',
      status: payment.status,
      time: payment.completedAt ?? payment.createdAt,
      note: 'История переходов не пришла — показано текущее состояние платежа',
    },
  ];
}

/**
 * Возврат средств: выбор платежа, сумма, причина.
 *
 * Форма собрана здесь, а не только внутри карточки платежа, по двум причинам:
 * возврат — единственное изменяющее действие раздела, и его нельзя прятать за
 * выбором строки; а сумма к возврату известна только после ответа сервиса, поэтому
 * до выбора платежа форма честно говорит, чего ей не хватает, вместо того чтобы
 * подставлять ноль.
 *
 * Ключи запросов те же, что у панели деталей: react-query отдаёт один ответ на
 * одинаковый ключ, поэтому деталь и история возвратов не запрашиваются дважды.
 */
function RefundPanel({
  payments,
  selectedId,
  onSelect,
}: {
  /** Платежи текущей страницы: сервис не ищет платёж по номеру. */
  payments: Payment[];
  selectedId: string | null;
  onSelect: (paymentId: string | null) => void;
}) {
  const queryClient = useQueryClient();
  const [amountText, setAmountText] = useState('');
  const [amountTouched, setAmountTouched] = useState(false);
  const [reason, setReason] = useState('Возврат по запросу клиента');
  const [errors, setErrors] = useState<{ payment?: string; amount?: string; reason?: string }>({});

  const detailQuery = useQuery({
    queryKey: paymentKeys.detail(selectedId ?? 'none'),
    queryFn: () => fetchPayment(selectedId as string),
    enabled: Boolean(selectedId),
    staleTime: 5_000,
  });
  const refundsQuery = useQuery({
    queryKey: paymentKeys.refunds(selectedId ?? 'none'),
    queryFn: () => fetchRefunds(selectedId as string),
    enabled: Boolean(selectedId),
    retry: 0,
  });

  const payment = detailQuery.data?.payment;
  const refundsLoaded = refundsQuery.isSuccess;
  const refundedMinor = refundedMinorOf(refundsQuery.data ?? []);
  const refundableMinor = payment ? Math.max(0, payment.amountMinor - refundedMinor) : 0;

  const effectiveAmount = amountTouched ? amountText : payment ? toMajorString(refundableMinor) : '';
  const parsed = parseAmountInput(effectiveAmount, {
    label: 'сумму возврата',
    ...(payment
      ? {
          maxMinor: refundableMinor,
          maxMessage: `Больше остатка к возврату (${formatMoney(refundableMinor, payment.currency)})`,
        }
      : {}),
  });

  const { acquire, reset } = useIdempotencyKey(
    transferSignature({
      paymentId: selectedId,
      amountMinor: parsed.ok ? parsed.minor : null,
      reason: reason.trim(),
    }),
  );

  const refundMutation = useMutation({
    mutationFn: ({
      paymentId,
      body,
      idempotencyKey,
    }: {
      paymentId: string;
      body: RefundRequest;
      idempotencyKey: string;
    }) => refundPayment(paymentId, body, idempotencyKey),
    retry: 0,
    onSuccess: () => {
      setAmountTouched(false);
      setAmountText('');
      reset();
      void queryClient.invalidateQueries({ queryKey: ['admin', 'payments'] });
    },
  });

  /**
   * Проверка до запроса: сначала «есть ли вообще что возвращать», потом поля.
   * Ни один заведомо отклоняемый запрос в сервис не уходит.
   */
  const blockerOf = (): string | undefined => {
    if (!selectedId) {
      return 'Выберите платёж: возврат оформляется по конкретному платежу.';
    }
    if (detailQuery.isPending) {
      return 'Платёж ещё загружается — подождите секунду и повторите.';
    }
    if (detailQuery.isError) {
      return `Платёж не загрузился: ${humanMessage(detailQuery.error)}`;
    }
    if (!refundsLoaded) {
      return 'История возвратов ещё не загружена: без неё остаток к возврату неизвестен.';
    }
    if (!refundable(payment)) {
      return payment?.type === 'REFUND'
        ? 'Это сам возврат — вернуть его повторно нельзя.'
        : `Этот платёж нельзя вернуть в состоянии «${statusLabel(payment?.status)}». Возврат возможен для завершённого платежа.`;
    }
    if (refundableMinor <= 0) {
      return 'По этому платежу возвращена вся сумма — возвращать больше нечего.';
    }
    return undefined;
  };

  const submit = () => {
    if (refundMutation.isPending) {
      return;
    }
    // `blockerOf` уже отказал бы без выбранного платежа; проверка нужна ещё и для
    // сужения типа, иначе id остаётся `string | null`.
    const blocker = blockerOf();
    if (blocker || !selectedId) {
      if (blocker) {
        setErrors({ payment: blocker });
      }
      return;
    }
    const next: { amount?: string; reason?: string } = {};
    if (!parsed.ok) {
      next.amount = parsed.message;
    }
    if (reason.trim().length < 3) {
      next.reason = 'Опишите причину возврата (минимум 3 символа)';
    }
    setErrors(next);
    if (!parsed.ok || Object.keys(next).length > 0) {
      return;
    }
    refundMutation.mutate({
      paymentId: selectedId,
      body: { amountMinor: parsed.minor, reason: reason.trim() },
      idempotencyKey: acquire(),
    });
  };

  return (
    <form
      className="space-y-3"
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      <div className="max-w-md">
        <SelectField
          id="admin-refund-payment"
          label="Платёж"
          value={selectedId ?? ''}
          placeholder="— выберите платёж —"
          hint={
            payments.length === 0
              ? 'На текущей странице нет платежей: смените фильтр или страницу.'
              : 'Платежи текущей страницы. Возврат возможен для завершённого платежа и невозможен для самого возврата.'
          }
          options={payments.map((item) => ({
            value: item.paymentId,
            label: `${item.paymentNumber} · ${statusLabel(item.status)}`,
          }))}
          onChange={(event) => {
            onSelect(event.target.value === '' ? null : event.target.value);
            setErrors({});
            setAmountTouched(false);
            setAmountText('');
          }}
        />
      </div>

      {selectedId && detailQuery.isPending ? <SkeletonText lines={1} /> : null}

      {selectedId && payment && refundsLoaded ? (
        <p className="text-xs text-ink-500">
          К возврату доступно: {formatMoney(refundableMinor, payment.currency)}
          {refundedMinor > 0 ? ` · уже возвращено ${formatMoney(refundedMinor, payment.currency)}` : ''}
        </p>
      ) : null}

      {errors.payment ? <Alert tone="warning" title={errors.payment} /> : null}

      {detailQuery.isError && selectedId ? (
        <ErrorAlert
          error={detailQuery.error}
          title="Не удалось загрузить платёж для возврата"
          onRetry={() => void detailQuery.refetch()}
        />
      ) : null}

      {refundsQuery.isError && selectedId ? (
        <ErrorAlert
          error={refundsQuery.error}
          title="Не удалось загрузить историю возвратов"
          onRetry={() => void refundsQuery.refetch()}
        />
      ) : null}

      <AmountField
        id="admin-refund-amount"
        label="Сумма возврата"
        value={effectiveAmount}
        onValueChange={(value) => {
          setAmountTouched(true);
          setAmountText(value);
        }}
        currency={payment?.currency ?? 'KZT'}
        hint={payment ? undefined : 'Сумма подставится после выбора платежа'}
        error={errors.amount ?? fieldErrorOf(refundMutation.error, 'amountMinor')}
      />

      <TextField
        id="admin-refund-reason"
        label="Причина возврата"
        value={reason}
        onChange={(event) => setReason(event.target.value)}
        error={errors.reason ?? fieldErrorOf(refundMutation.error, 'reason')}
        required
      />

      {refundMutation.isError ? (
        <ErrorAlert error={refundMutation.error} title="Возврат не выполнен" />
      ) : null}
      {refundMutation.isSuccess ? (
        <Alert tone="success" title="Возврат создан">
          История возвратов, деталь платежа и список обновлены данными сервиса.
        </Alert>
      ) : null}

      <Button
        type="submit"
        data-admin-write="возврат средств"
        loading={refundMutation.isPending}
        disabled={refundMutation.isPending}
      >
        Вернуть деньги
      </Button>
    </form>
  );
}

export default function PaymentsSection({ role, canWrite }: AdminSectionProps) {
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(0);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const filters: PaymentQuery = { page, size: PAGE_SIZE, status: status === '' ? undefined : status };

  const listQuery = useQuery({
    queryKey: paymentKeys.list(filters),
    queryFn: () => fetchPayments(filters),
    placeholderData: (previous) => previous,
    staleTime: 10_000,
  });

  /** Пока данных нет, KPI не показывают ноль: это выглядело бы как настоящий итог. */
  const loaded = listQuery.data !== undefined;
  const items = listQuery.data?.items ?? [];

  // Ключ тот же, что у формы возврата: react-query отдаёт один ответ на двоих,
  // поэтому опции здесь и там одинаковые.
  const detailQuery = useQuery({
    queryKey: paymentKeys.detail(selectedId ?? 'none'),
    queryFn: () => fetchPayment(selectedId as string),
    enabled: Boolean(selectedId),
    staleTime: 5_000,
  });

  const refundsQuery = useQuery({
    queryKey: paymentKeys.refunds(selectedId ?? 'none'),
    queryFn: () => fetchRefunds(selectedId as string),
    enabled: Boolean(selectedId),
    retry: 0,
  });

  const detail = detailQuery.data;
  const payment = detail?.payment;
  const refunds = refundsQuery.data ?? [];
  const refundedMinor = refundedMinorOf(refunds);

  const inFlight = useMemo(
    () => items.filter((item) => IN_FLIGHT_STATUSES.includes(item.status)),
    [items],
  );
  const failed = useMemo(() => items.filter((item) => item.status === 'FAILED'), [items]);
  const refunded = useMemo(
    () => items.filter((item) => item.status === 'REFUNDED' || item.status === 'PARTIALLY_REFUNDED'),
    [items],
  );

  /** Переходы статусов: сервис отдаёт их в детали платежа. */
  const timelineEntries: TimelineEntry[] = (detail?.transitions ?? []).map((transition, index) => ({
    key: `${transition.id ?? transition.toStatus}-${index}`,
    status: transition.toStatus,
    time: transition.createdAt ?? transition.occurredAt ?? null,
    note: transition.reason ?? transition.comment ?? null,
  }));

  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard
          label="Платежей по фильтру"
          note={
            listQuery.data
              ? `Всего найдено сервисом: ${listQuery.data.totalElements} · на странице: ${items.length}`
              : 'Данные ещё не загружены'
          }
        >
          <span className="tnum text-lg font-semibold text-ink-900">
            {listQuery.data ? listQuery.data.totalElements : '—'}
          </span>
        </KpiCard>

        <KpiCard
          label="Сумма на странице"
          note={
            loaded
              ? `Итого к списанию (amount + fee) по ${items.length} платежам текущей страницы`
              : 'Данные ещё не загружены'
          }
        >
          <MoneyLines
            sums={sumsByCurrency(items, (item) => item.currency, (item) => item.totalMinor)}
            empty="—"
          />
        </KpiCard>

        <KpiCard
          label="Возвраты на странице"
          note={
            loaded
              ? `По текущей странице: ${refunded.length} платежей с возвратом или частичным возвратом`
              : 'Данные ещё не загружены'
          }
        >
          <MoneyLines
            sums={sumsByCurrency(refunded, (item) => item.currency, (item) => item.amountMinor)}
            empty="—"
          />
        </KpiCard>

        <KpiCard
          label="В работе и ошибки"
          note="По текущей странице: незавершённые (CREATED/PENDING/PROCESSING) и упавшие платежи"
        >
          <span className="tnum text-lg font-semibold text-ink-900">
            {loaded ? `${inFlight.length} / ${failed.length}` : '—'}
          </span>
          <span className="mt-0.5 block text-xs text-ink-500">в работе / с ошибкой</span>
        </KpiCard>
      </div>

      <Card>
        <CardHeader
          title="Возврат средств"
          subtitle="Одно возвращённое намерение — один Idempotency-Key: повторная отправка того же возврата не двигает деньги дважды."
        />
        <CardBody>
          {canWrite ? (
            <RefundPanel payments={items} selectedId={selectedId} onSelect={setSelectedId} />
          ) : (
            <p className="text-sm text-ink-600">
              Возврат средств доступен только роли {roleLabel('ADMIN')}: сервис проверяет право на операцию, а у роли{' '}
              {roleLabel(role)} в этом разделе только чтение. Формы возврата здесь нет — платежи, детали и история
              возвратов доступны полностью.
            </p>
          )}
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title="Платежи"
          subtitle={
            listQuery.data
              ? `Найдено сервисом по фильтру: ${listQuery.data.totalElements}`
              : undefined
          }
          action={
            <div className="w-52">
              <SelectField
                id="admin-payments-status"
                label="Статус"
                value={status}
                options={STATUS_OPTIONS.map((value) => ({ value, label: statusLabel(value) }))}
                placeholder="Все статусы"
                hint="Серверный фильтр платежей: GET /api/v1/payments?status=…"
                onChange={(event) => {
                  setStatus(event.target.value);
                  setPage(0);
                }}
              />
            </div>
          }
        />

        <CardBody>
          {listQuery.isPending ? <SkeletonRows count={6} /> : null}

          {listQuery.isError ? (
            <ErrorAlert
              error={listQuery.error}
              title="Не удалось загрузить платежи"
              onRetry={() => void listQuery.refetch()}
            />
          ) : null}

          {listQuery.data && items.length === 0 ? (
            <EmptyState
              title="Платежей не найдено"
              description={
                status === ''
                  ? 'Сервис не вернул ни одного платежа: в системе ещё не было ни одной операции.'
                  : `Нет платежей в состоянии «${statusLabel(status)}». Снимите фильтр, чтобы увидеть остальные.`
              }
            />
          ) : null}

          {items.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[1080px] text-left text-sm">
                <thead>
                  <tr className="border-b border-ink-200 text-xs text-ink-500 uppercase">
                    <th scope="col" className="py-2 pr-3 font-medium">Платёж</th>
                    <th scope="col" className="py-2 pr-3 font-medium">Тип</th>
                    <th scope="col" className="py-2 pr-3 font-medium">Назначение</th>
                    <th scope="col" className="py-2 pr-3 font-medium">Мерчант</th>
                    <th scope="col" className="py-2 pr-3 text-right font-medium">Сумма</th>
                    <th scope="col" className="py-2 pr-3 text-right font-medium">Комиссия</th>
                    <th scope="col" className="py-2 pr-3 text-right font-medium">Итого</th>
                    <th scope="col" className="py-2 pr-3 font-medium">Статус</th>
                    <th scope="col" className="py-2 pr-3 font-medium">Создан</th>
                    <th scope="col" className="py-2 font-medium" />
                  </tr>
                </thead>
                <tbody>
                  {items.map((item) => (
                    <tr
                      key={item.paymentId}
                      className={item.paymentId === selectedId ? 'bg-brand-50' : 'border-b border-ink-100'}
                    >
                      <td className="py-2 pr-3">
                        <span className="block font-medium text-ink-900">{item.paymentNumber}</span>
                        <span className="block font-mono text-xs text-ink-400">
                          {shortId(item.paymentId, 10)}
                        </span>
                      </td>
                      <td className="py-2 pr-3 whitespace-nowrap">{paymentTypeLabel(item.type)}</td>
                      <td className="max-w-[240px] py-2 pr-3">
                        <span className="block truncate text-ink-600" title={item.description ?? undefined}>
                          {item.description ?? '—'}
                        </span>
                      </td>
                      <td className="py-2 pr-3">
                        <span className="font-mono text-xs text-ink-700">
                          {item.merchantId ? shortId(item.merchantId, 10) : '—'}
                        </span>
                        {/* Заказ показываем текстом: раздел «Заказы» ищет по номеру в своей
                            форме, и ссылка с параметром вела бы в пустую форму. */}
                        {item.orderId ? (
                          <span
                            className="block font-mono text-xs text-ink-500"
                            title={`Заказ ${item.orderId}`}
                          >
                            заказ {shortId(item.orderId, 10)}
                          </span>
                        ) : null}
                      </td>
                      <td className="tnum py-2 pr-3 text-right whitespace-nowrap">
                        {formatMoney(item.amountMinor, item.currency)}
                      </td>
                      <td className="tnum py-2 pr-3 text-right whitespace-nowrap">
                        {formatMoney(item.feeMinor, item.currency)}
                      </td>
                      <td className="tnum py-2 pr-3 text-right whitespace-nowrap">
                        {formatMoney(item.totalMinor, item.currency)}
                      </td>
                      <td className="py-2 pr-3">
                        <StatusBadge status={item.status} />
                      </td>
                      <td className="py-2 pr-3 whitespace-nowrap text-xs text-ink-600">
                        {formatDateTime(item.createdAt)}
                      </td>
                      <td className="py-2 text-right">
                        <Button
                          variant="secondary"
                          size="sm"
                          aria-pressed={item.paymentId === selectedId}
                          onClick={() =>
                            setSelectedId(item.paymentId === selectedId ? null : item.paymentId)
                          }
                        >
                          {item.paymentId === selectedId ? 'Скрыть' : 'Детали'}
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
            title={payment ? `Платёж № ${payment.paymentNumber}` : 'Деталь платежа'}
            subtitle={`ID ${shortId(selectedId, 12)}`}
            action={
              <div className="flex items-center gap-2">
                {payment ? <StatusBadge status={payment.status} /> : null}
                <Button variant="ghost" size="sm" onClick={() => setSelectedId(null)}>
                  Закрыть
                </Button>
              </div>
            }
          />
          <CardBody>
            {detailQuery.isPending ? <SkeletonRows count={5} /> : null}

            {detailQuery.isError ? (
              <ErrorAlert
                error={detailQuery.error}
                title="Не удалось загрузить платёж"
                onRetry={() => void detailQuery.refetch()}
              />
            ) : null}

            {payment ? (
              <div className="grid gap-4 xl:grid-cols-3">
                <div className="space-y-4 xl:col-span-2">
                  <div>
                    <h3 className="text-sm font-semibold text-ink-900">Детали платежа</h3>
                    <dl className="mt-2">
                      <DetailRow label="Номер">{payment.paymentNumber}</DetailRow>
                      <DetailRow label="ID платежа">
                        <span className="inline-flex items-center gap-1">
                          <span className="font-mono text-xs">{payment.paymentId}</span>
                          <CopyButton value={payment.paymentId} />
                        </span>
                      </DetailRow>
                      <DetailRow label="Тип">{paymentTypeLabel(payment.type)}</DetailRow>
                      <DetailRow label="Сумма">
                        <span className="tnum">{formatMoney(payment.amountMinor, payment.currency)}</span>
                      </DetailRow>
                      <DetailRow label="Комиссия">
                        <span className="tnum">{formatMoney(payment.feeMinor, payment.currency)}</span>
                      </DetailRow>
                      <DetailRow label="Итого (amount + fee)">
                        <span className="tnum">{formatMoney(payment.totalMinor, payment.currency)}</span>
                      </DetailRow>
                      <DetailRow label="Валюта">{payment.currency}</DetailRow>
                      <DetailRow label="Назначение">{payment.description ?? '—'}</DetailRow>
                      <DetailRow label="Мерчант">
                        {payment.merchantId ? (
                          <span className="inline-flex items-center gap-1">
                            <span className="font-mono text-xs">{payment.merchantId}</span>
                            <CopyButton value={payment.merchantId} />
                          </span>
                        ) : (
                          <span className="text-ink-500">не мерчантский платёж</span>
                        )}
                      </DetailRow>
                      <DetailRow label="Счёт списания">
                        <span className="font-mono text-xs">{payment.sourceAccountId ?? '—'}</span>
                      </DetailRow>
                      <DetailRow label="Счёт зачисления">
                        <span className="font-mono text-xs">{payment.targetAccountId ?? '—'}</span>
                      </DetailRow>
                      <DetailRow label="Создан">{formatDateTime(payment.createdAt)}</DetailRow>
                      <DetailRow label="Завершён">{formatDateTime(payment.completedAt)}</DetailRow>
                    </dl>

                    {payment.failureReason || payment.failureCode ? (
                      <div className="mt-3">
                        <Alert
                          tone="danger"
                          title={`Платёж не выполнен${payment.failureCode ? ` (${payment.failureCode})` : ''}`}
                        >
                          {payment.failureReason ?? 'Сервис не прислал текст причины.'}
                        </Alert>
                      </div>
                    ) : null}
                  </div>

                  <div className="border-t border-ink-100 pt-4">
                    <h3 className="text-sm font-semibold text-ink-900">Возврат средств</h3>
                    <p className="mt-2 text-sm text-ink-600">
                      {canWrite ? (
                        <>
                          Форма возврата — в блоке «Возврат средств» выше; при выборе платежа она подставляет
                          доступный остаток.
                        </>
                      ) : (
                        <>
                          Возврат средств доступен только роли {roleLabel('ADMIN')}. У роли {roleLabel(role)} раздел
                          работает в режиме чтения, поэтому формы возврата здесь нет.
                        </>
                      )}
                    </p>
                    {refundable(payment) ? null : (
                      <p className="mt-1 text-sm text-ink-600">
                        Этот платёж нельзя вернуть: возврат возможен для завершённого платежа и невозможен для самого
                        возврата. Текущее состояние: <StatusBadge status={payment.status} />
                      </p>
                    )}
                  </div>
                </div>

                <div className="space-y-4">
                  <div>
                    <h3 className="text-sm font-semibold text-ink-900">История переходов</h3>
                    <div className="mt-2">
                      <Timeline entries={transitionsOf(payment, timelineEntries)} />
                    </div>
                  </div>

                  <div className="border-t border-ink-100 pt-4">
                    <h3 className="text-sm font-semibold text-ink-900">
                      Возвраты
                      {refundsQuery.isSuccess ? ` · ${refunds.length}` : ''}
                    </h3>

                    {refundsQuery.isPending ? (
                      <div className="mt-2">
                        <SkeletonText lines={2} />
                      </div>
                    ) : null}

                    {refundsQuery.isError ? (
                      <div className="mt-2">
                        <ErrorAlert
                          error={refundsQuery.error}
                          title="История возвратов недоступна"
                          onRetry={() => void refundsQuery.refetch()}
                        />
                      </div>
                    ) : null}

                    {refundsQuery.isSuccess && refunds.length === 0 ? (
                      <p className="mt-2 text-sm text-ink-500">По этому платежу возвратов нет.</p>
                    ) : null}

                    {refunds.length > 0 ? (
                      <ul className="mt-2 divide-y divide-ink-100">
                        {refunds.map((refund) => (
                          <li key={refund.refundId} className="py-2">
                            <div className="flex items-center justify-between gap-2">
                              <span className="tnum font-medium text-ink-900">
                                {formatMoney(refund.amountMinor, refund.currency)}
                              </span>
                              <Badge tone={statusTone(refund.status)}>
                                {REFUND_STATUS_LABELS[refund.status] ?? statusLabel(refund.status)}
                              </Badge>
                            </div>
                            <p className="mt-0.5 text-xs text-ink-500">
                              {formatDateTime(refund.createdAt)}
                            </p>
                            {refund.reason ? (
                              <p className="mt-0.5 text-xs text-ink-600">{refund.reason}</p>
                            ) : null}
                            <p className="mt-0.5 font-mono text-xs text-ink-400">
                              {shortId(refund.refundId, 12)}
                            </p>
                          </li>
                        ))}
                      </ul>
                    ) : null}

                    {refundsQuery.isSuccess && refundedMinor > 0 ? (
                      <p className="mt-2 text-xs text-ink-500">
                        Возвращено (без учёта отклонённых): {formatMoney(refundedMinor, payment.currency)}.
                      </p>
                    ) : null}
                  </div>
                </div>
              </div>
            ) : null}
          </CardBody>
        </Card>
      ) : null}
    </div>
  );
}
