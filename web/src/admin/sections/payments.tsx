/**
 * Раздел «Платежи и возвраты» админ-панели.
 *
 * Экран собран как рабочее место оператора: тулбар с числом найденного, плитки и две
 * диаграммы по загруженной странице, рейл статусов слева от таблицы и карточка платежа
 * справа, а возврат средств — отдельной панелью. Блоки взяты из общего набора
 * `src/admin/kit.tsx`, поэтому раздел выглядит так же, как остальные разделы админки.
 *
 * Что здесь принципиально:
 *
 *  - KPI считаются по уже загруженной странице и подписаны именно так: клиент не
 *    имеет права складывать всю базу, которой он не видел;
 *  - суммы по валютам не смешиваются: на одной странице могут лежать KZT и USD, и
 *    одно «итого» из них было бы неправдой, поэтому каждая валюта — своей строкой;
 *  - диаграммы построены без библиотек (общие `BarList` и `Donut` из набора) и тоже
 *    описывают загруженную страницу, а не базу;
 *  - возврат — изменяющее действие: при `canWrite === false` формы нет вообще,
 *    вместо неё строка о том, что возврат доступен роли ADMIN;
 *  - остаток к возврату ограничен суммой платежа минус уже прошедшие возвраты,
 *    чтобы не отправлять заведомо отклоняемый запрос;
 *  - выгрузка CSV берёт ровно те строки, что лежат на экране: «примерных» данных
 *    в разделе нет ни в плитках, ни в файле.
 *
 * Что здесь есть и чего нет по вине контракта:
 *
 *  - `PaymentResponse.orderId` показан и в таблице, и в карточке: по нему оператор идёт
 *    в раздел «Заказы»;
 *  - `RefundResponse` не содержит `completedAt`: в истории возвратов стоят `createdAt`
 *    и `updatedAt`, а не выдуманная дата завершения;
 *  - `ownerUserId` сервис присылает в `PaymentResponse`, но клиентский тип `Payment` его
 *    не сохраняет (`src/api/**` этому разделу не подчиняется), поэтому владелец берётся
 *    у счёта списания: `GET /api/v1/accounts/{id}`. Подставить сюда идентификатор счёта
 *    или мерчанта было бы подменой;
 *  - статусный фильтр у платежей серверный (`?status=`), поэтому числа в рейле — по
 *    загруженной странице, и когда фильтр включён, у остальных статусов числа нет вовсе:
 *    ноль рядом с «Ошибка» читался бы как «ошибок нет».
 */
import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { UseQueryResult } from '@tanstack/react-query';
import type { SVGProps } from 'react';
import { fetchAccount, fetchPayment, fetchPayments, fetchRefunds, refundPayment } from '../../api/endpoints';
import type { PaymentQuery } from '../../api/endpoints';
import { fieldErrorOf, humanMessage } from '../../api/errors';
import { formatMoney, parseAmountInput, sumMinor, toMajorString } from '../../api/money';
import type { Account, Payment, PaymentDetail, Refund, RefundRequest } from '../../api/types';
import { PaymentsIcon, PulseIcon, ShieldIcon, TransferIcon, WalletIcon } from '../../components/layout/icons';
import { AmountField } from '../../components/ui/AmountField';
import { Alert, ErrorAlert } from '../../components/ui/Alerts';
import { Badge, StatusBadge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { DetailRow } from '../../components/ui/Card';
import { CopyButton } from '../../components/ui/CopyButton';
import { EmptyState } from '../../components/ui/EmptyState';
import { CheckboxField, SelectField, TextField } from '../../components/ui/Field';
import { Pagination } from '../../components/ui/Pagination';
import { SkeletonRows, SkeletonText } from '../../components/ui/Skeleton';
import { Timeline, type TimelineEntry } from '../../components/ui/Timeline';
import { BarList, Chip, Donut, KpiTile, Panel, StatusRail, Toolbar } from '../kit';
import { cx } from '../../lib/cx';
import { useIdempotencyKey, transferSignature } from '../../lib/idempotency';
import {
  formatDateTime,
  paymentTypeLabel,
  roleLabel,
  shortId,
  statusLabel,
  statusTone,
} from '../../lib/format';
import type { AdminSectionProps } from '../sections';

/* ------------------------------------------------------------------ константы */

const DEFAULT_PAGE_SIZE = 20;

const PAGE_SIZE_OPTIONS = [10, 20, 50, 100].map((value) => ({
  value: String(value),
  label: `${value} строк`,
}));

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

/** Неуспешные состояния: платёж не дошёл и денег не двигал. */
const FAILED_STATUSES = ['FAILED', 'CANCELLED'];

/** Состояния, которые означают возврат денег клиенту. */
const REFUNDED_STATUSES = ['REFUNDED', 'PARTIALLY_REFUNDED'];

/**
 * Статусы возврата (`RefundStatus` сервиса).
 *
 * `statusLabel` из `lib/format` их не знает и вернул бы английский enum, поэтому
 * словарь живёт рядом с историей возвратов: `INITIATED` — строка возврата создана,
 * деньги ещё могут быть в пути.
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
  owner: (accountId: string) => ['admin', 'payments', 'owner-account', accountId] as const,
};

/* ------------------------------------------------------------------ деньги */

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

/**
 * Средний чек по каждой валюте отдельно.
 *
 * Деление — целочисленное (BigInt), поэтому в среднем не появляется дробных тиынов,
 * а валюты снова не смешиваются: среднее по KZT и USD одним числом смысла не имеет.
 */
export function averagesByCurrency(sums: readonly CurrencySum[]): CurrencySum[] {
  return sums
    .filter((entry) => entry.count > 0)
    .map((entry) => ({
      currency: entry.currency,
      count: entry.count,
      totalMinor: Number(BigInt(Math.round(entry.totalMinor)) / BigInt(entry.count)),
    }));
}

/** Сколько строк страницы в каждом статусе: клиентский счёт по загруженным данным. */
export function countByStatus(items: readonly Payment[]): Array<{ status: string; count: number }> {
  const counts = new Map<string, number>();
  for (const item of items) {
    counts.set(item.status, (counts.get(item.status) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([status, count]) => ({ status, count }))
    .sort((left, right) => right.count - left.count || left.status.localeCompare(right.status));
}

/**
 * Деньги по валютам одной строкой — для подписи рядом с полосой диаграммы, где
 * многострочная вёрстка не помещается. Суммы по-прежнему не складываются.
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
 * Выгрузка делает ровно то, что видно на экране, и ничего больше: колонки — из
 * загруженной страницы, суммы — в минорных единицах, как их отдал сервис, чтобы файл
 * можно было сверить с API, а не с вёрсткой.
 */
export function paymentsCsv(items: readonly Payment[]): string {
  const header = [
    'paymentId',
    'paymentNumber',
    'type',
    'status',
    'orderId',
    'merchantId',
    'currency',
    'amountMinor',
    'feeMinor',
    'totalMinor',
    'createdAt',
  ];
  const quote = (value: string) => `"${value.replace(/"/g, '""')}"`;
  const rows = items.map((item) =>
    [
      item.paymentId,
      item.paymentNumber,
      item.type,
      item.status,
      item.orderId ?? '',
      item.merchantId ?? '',
      String(item.currency),
      String(item.amountMinor),
      String(item.feeMinor),
      String(item.totalMinor),
      item.createdAt,
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
 * Деньги разных валют в плитке.
 *
 * Каждая валюта — своей строкой: одна сумма из KZT и USD была бы числом, которого нет
 * в реальности. `whitespace-normal` нужен потому, что значение плитки по умолчанию
 * обрезается в одну строку, а обрезанная сумма — это неправда.
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

/**
 * Выгрузка загруженных строк в CSV.
 *
 * Это единственное действие в тулбаре, которое что-то отдаёт наружу, и оно честно
 * ограничено экраном: в файл попадают строки текущей страницы, а не «вся база»,
 * которой клиент не видел.
 */
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

/** Строка «идентификатор + копировать»: ULID не переписывают руками. */
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

/* ------------------------------------------------------------------ расчёты */

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

/* --------------------------------------------------------- карточка платежа */

/**
 * Тело карточки платежа: сетка полей, переходы статусов и таблица возвратов.
 *
 * Заголовок с номером и статусом рисует панель, поэтому здесь только данные. Поля идут
 * сеткой в две колонки: в узкой колонке карточки это единственный способ не растягивать
 * её на три экрана.
 */
function PaymentDetailBody({
  paymentId,
  detail,
  refunds,
  owner,
  canWrite,
}: {
  paymentId: string;
  detail: UseQueryResult<PaymentDetail>;
  refunds: UseQueryResult<Refund[]>;
  owner: UseQueryResult<Account>;
  canWrite: boolean;
}) {
  const payment = detail.data?.payment;
  const refundList = refunds.data ?? [];
  const refundedMinor = refundedMinorOf(refundList);

  const timelineEntries: TimelineEntry[] = (detail.data?.transitions ?? []).map((transition, index) => ({
    key: `${transition.id ?? transition.toStatus}-${index}`,
    status: transition.toStatus,
    time: transition.createdAt ?? transition.occurredAt ?? null,
    note: transition.reason ?? transition.comment ?? null,
  }));

  if (detail.isPending) {
    return <SkeletonRows count={5} />;
  }

  if (detail.isError) {
    return (
      <ErrorAlert error={detail.error} title="Не удалось загрузить платёж" onRetry={() => void detail.refetch()} />
    );
  }

  if (!payment) {
    return (
      <EmptyState
        title="Сервис не вернул платёж"
        description={`В ответе на ${shortId(paymentId, 12)} нет объекта платежа: показать поля нечего, и придумывать их нельзя. Обновите страницу или откройте платёж заново.`}
      />
    );
  }

  return (
    <div className="space-y-4">
      {/* Одна колонка: панель карточки узкая, а в две колонки ULID рвётся по символу. */}
      <dl className="divide-y divide-ink-100">
        <DetailRow label="Номер">{payment.paymentNumber}</DetailRow>
        <DetailRow label="ID платежа">
          <IdValue value={payment.paymentId} label="—" />
        </DetailRow>
        <DetailRow label="Тип">{paymentTypeLabel(payment.type)}</DetailRow>
        <DetailRow label="Назначение">
          <span className="break-words">{payment.description ?? '—'}</span>
        </DetailRow>
        <DetailRow label="Владелец (ownerUserId)">
          {payment.ownerUserId ? (
            <IdValue value={payment.ownerUserId} label="—" />
          ) : !payment.sourceAccountId ? (
            <span className="text-ink-500">счёт списания не указан</span>
          ) : owner.isPending ? (
            <span className="text-ink-400">определяем по счёту…</span>
          ) : owner.data?.ownerUserId ? (
            <IdValue value={owner.data.ownerUserId} label="—" />
          ) : (
            <span className="text-ink-500">не определён — счёт {shortId(payment.sourceAccountId, 10)}</span>
          )}
        </DetailRow>
        <DetailRow label="Заказ">
          <IdValue value={payment.orderId} label="к заказу не привязан" />
        </DetailRow>
        <DetailRow label="Мерчант">
          <IdValue value={payment.merchantId} label="не мерчантский платёж" />
        </DetailRow>
        <DetailRow label="Счёт списания">
          <span className="font-mono text-xs break-all">{payment.sourceAccountId ?? '—'}</span>
        </DetailRow>
        <DetailRow label="Счёт зачисления">
          <span className="font-mono text-xs break-all">{payment.targetAccountId ?? '—'}</span>
        </DetailRow>
        <DetailRow label="Сумма получателю">
          <span className="tnum">{formatMoney(payment.amountMinor, payment.currency)}</span>
        </DetailRow>
        <DetailRow label="Комиссия платформы">
          <span className="tnum">{formatMoney(payment.feeMinor, payment.currency)}</span>
        </DetailRow>
        <DetailRow label="Итого с плательщика">
          <span className="tnum">{formatMoney(payment.totalMinor, payment.currency)}</span>
        </DetailRow>
        <DetailRow label="Валюта">{payment.currency}</DetailRow>
        <DetailRow label="Код отказа">
          <span className="font-mono text-xs">{payment.failureCode ?? '—'}</span>
        </DetailRow>
        <DetailRow label="Создан">{formatDateTime(payment.createdAt)}</DetailRow>
        <DetailRow label="Завершён">{formatDateTime(payment.completedAt)}</DetailRow>
      </dl>

      <p className="text-xs leading-snug text-ink-500">
        «Итого с плательщика» — это сервисное <code className="font-mono">totalMinor</code> (amount + fee). Владелец взят
        у счёта списания: сервис присылает <code className="font-mono">ownerUserId</code> и в самом платеже, но клиентский
        тип <code className="font-mono">Payment</code> его не сохраняет — подставлять чужой идентификатор было бы
        неправдой.
      </p>

      {payment.failureReason || payment.failureCode ? (
        <Alert tone="danger" title={`Платёж не выполнен${payment.failureCode ? ` (${payment.failureCode})` : ''}`}>
          {payment.failureReason ?? 'Сервис не прислал текст причины.'}
        </Alert>
      ) : null}

      <div className="border-t border-ink-100 pt-3">
        <h3 className="text-sm font-semibold text-ink-900">Переходы статусов</h3>
        <div className="mt-2">
          <Timeline entries={transitionsOf(payment, timelineEntries)} />
        </div>
      </div>

      <div className="border-t border-ink-100 pt-3">
        <h3 className="text-sm font-semibold text-ink-900">
          Возвраты{refunds.isSuccess ? ` · ${refundList.length}` : ''}
        </h3>

        {refunds.isPending ? (
          <div className="mt-2">
            <SkeletonText lines={2} />
          </div>
        ) : null}

        {refunds.isError ? (
          <div className="mt-2">
            <ErrorAlert
              error={refunds.error}
              title="История возвратов недоступна"
              onRetry={() => void refunds.refetch()}
            />
          </div>
        ) : null}

        {refunds.isSuccess && refundList.length === 0 ? (
          <div className="mt-2">
            <EmptyState title="По этому платежу возвратов нет" description="GET /payments/{id}/refunds вернул пустой список." />
          </div>
        ) : null}

        {refundList.length > 0 ? (
          <>
            <div className="relative overflow-x-auto mt-2">
              <table className="w-full min-w-[30rem] text-left text-sm">
                <caption className="sr-only">
                  Возвраты по платежу: идентификатор, сумма, статус, причина и время
                </caption>
                <thead>
                  <tr className="border-b border-ink-200 text-xs text-ink-500">
                    <th scope="col" className="py-1.5 pr-3 font-medium">Возврат</th>
                    <th scope="col" className="py-1.5 pr-3 text-right font-medium">Сумма</th>
                    <th scope="col" className="py-1.5 pr-3 font-medium">Статус</th>
                    <th scope="col" className="py-1.5 pr-3 font-medium">Причина</th>
                    <th scope="col" className="py-1.5 pr-3 font-medium">Создан</th>
                    <th scope="col" className="py-1.5 font-medium">Изменён</th>
                  </tr>
                </thead>
                <tbody>
                  {refundList.map((refund) => (
                    <tr key={refund.refundId} className="border-b border-ink-100 align-top">
                      <td className="py-1.5 pr-3">
                        <span className="flex items-center gap-1 font-mono text-xs text-ink-600">
                          {shortId(refund.refundId, 12)}
                          <CopyButton value={refund.refundId} />
                        </span>
                      </td>
                      <td className="tnum py-1.5 pr-3 text-right whitespace-nowrap">
                        {formatMoney(refund.amountMinor, refund.currency)}
                      </td>
                      <td className="py-1.5 pr-3">
                        <Badge tone={statusTone(refund.status)}>
                          {REFUND_STATUS_LABELS[refund.status] ?? statusLabel(refund.status)}
                        </Badge>
                      </td>
                      <td className="max-w-[10rem] py-1.5 pr-3">
                        <span className="block truncate text-xs text-ink-600" title={refund.reason ?? undefined}>
                          {refund.reason ?? '—'}
                        </span>
                      </td>
                      <td className="py-1.5 pr-3 text-xs whitespace-nowrap text-ink-600">
                        {formatDateTime(refund.createdAt)}
                      </td>
                      <td className="py-1.5 text-xs whitespace-nowrap text-ink-600">
                        {formatDateTime(refund.updatedAt)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="mt-2 text-xs text-ink-500">
              Отдельной даты завершения у возврата нет: сервис присылает{' '}
              <code className="font-mono">createdAt</code> и <code className="font-mono">updatedAt</code>, они и
              показаны. Возвращено без учёта отклонённых: {formatMoney(refundedMinor, payment.currency)}.
            </p>
          </>
        ) : null}
      </div>

      <div className="border-t border-ink-100 pt-3">
        <h3 className="text-sm font-semibold text-ink-900">Возврат средств</h3>
        <p className="mt-1 text-sm text-ink-600">
          {canWrite ? (
            <>
              Форма возврата — в панели «Возврат средств» ниже: при выбранном платеже она подставляет доступный
              остаток ({formatMoney(Math.max(0, payment.amountMinor - refundedMinor), payment.currency)}).
            </>
          ) : (
            <>
              Возврат средств доступен роли {roleLabel('ADMIN')}. У роли {roleLabel('SUPPORT')} админка работает в режиме
              чтения, поэтому формы возврата здесь нет.
            </>
          )}
        </p>
        {refundable(payment) ? null : (
          <p className="mt-1 text-sm text-ink-600">
            Этот платёж нельзя вернуть: возврат возможен для завершённого платежа и невозможен для самого возврата.
            Текущее состояние: <StatusBadge status={payment.status} />
          </p>
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------- возврат денег */

/**
 * Возврат средств: выбор платежа, сумма, причина.
 *
 * Форма собрана отдельной панелью, а не только внутри карточки платежа, по двум
 * причинам: возврат — единственное изменяющее действие раздела, и его нельзя прятать за
 * выбором строки; а сумма к возврату известна только после ответа сервиса, поэтому до
 * выбора платежа форма честно говорит, чего ей не хватает, вместо того чтобы
 * подставлять ноль.
 *
 * Ключи запросов те же, что у карточки платежа: react-query отдаёт один ответ на
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
      <div className="grid gap-3 lg:grid-cols-12">
        <div className="lg:col-span-5">
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

        <div className="lg:col-span-3">
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
        </div>

        <div className="lg:col-span-4">
          <TextField
            id="admin-refund-reason"
            label="Причина возврата"
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            error={errors.reason ?? fieldErrorOf(refundMutation.error, 'reason')}
            required
          />
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <Button
          type="submit"
          data-admin-write="возврат средств"
          loading={refundMutation.isPending}
          disabled={refundMutation.isPending}
        >
          Вернуть деньги
        </Button>

        {selectedId && detailQuery.isPending ? <SkeletonText lines={1} /> : null}

        {selectedId && payment && refundsLoaded ? (
          <p className="text-xs text-ink-500">
            К возврату доступно: {formatMoney(refundableMinor, payment.currency)}
            {refundedMinor > 0 ? ` · уже возвращено ${formatMoney(refundedMinor, payment.currency)}` : ''}
          </p>
        ) : null}
      </div>

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

      {refundMutation.isError ? <ErrorAlert error={refundMutation.error} title="Возврат не выполнен" /> : null}
      {refundMutation.isSuccess ? (
        <Alert tone="success" title="Возврат создан">
          История возвратов, деталь платежа и список обновлены данными сервиса.
        </Alert>
      ) : null}
    </form>
  );
}

/* ------------------------------------------------------------------- раздел */

export default function PaymentsSection({ role, canWrite }: AdminSectionProps) {
  const [status, setStatus] = useState('');
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);
  const [page, setPage] = useState(0);
  const [onlyRefunds, setOnlyRefunds] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const filters: PaymentQuery = { page, size: pageSize, status: status === '' ? undefined : status };

  const listQuery = useQuery({
    queryKey: paymentKeys.list(filters),
    queryFn: () => fetchPayments(filters),
    placeholderData: (previous) => previous,
    staleTime: 10_000,
  });

  /** Пока данных нет, KPI не показывают ноль: это выглядело бы как настоящий итог. */
  const loaded = listQuery.data !== undefined;
  const items = listQuery.data?.items ?? [];

  /** Клиентский отбор «только с возвратом»: применяется к загруженной странице. */
  const visibleItems = useMemo(
    () => (onlyRefunds ? items.filter((item) => REFUNDED_STATUSES.includes(item.status)) : items),
    [items, onlyRefunds],
  );

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

  /**
   * Владелец платежа: теперь он есть в самом платеже (`ownerUserId` в `PaymentResponse`).
   * Запрос к счёту остаётся запасным путём — для платежей, где поле не пришло, и чтобы
   * показать имя владельца из счёта, если оно у счёта заполнено.
   */
  const ownerFromPayment = detailQuery.data?.payment.ownerUserId ?? null;
  const ownerAccountId = detailQuery.data?.payment.sourceAccountId ?? null;
  const ownerQuery = useQuery({
    queryKey: paymentKeys.owner(ownerAccountId ?? 'none'),
    queryFn: () => fetchAccount(ownerAccountId as string),
    enabled: Boolean(ownerAccountId) && !ownerFromPayment,
    retry: 0,
    staleTime: 60_000,
  });

  const statusCounts = useMemo(() => countByStatus(visibleItems), [visibleItems]);
  const countMap = useMemo(
    () => new Map(statusCounts.map((entry) => [entry.status, entry.count])),
    [statusCounts],
  );

  /** Статусы для рейла: известные словарю плюс всё, что реально пришло в данных. */
  const railItems = useMemo(() => {
    const extra = statusCounts.map((entry) => entry.status).filter((value) => !STATUS_OPTIONS.includes(value));
    return [...STATUS_OPTIONS, ...extra].map((value) => ({
      value,
      label: statusLabel(value),
      // При серверном фильтре страница содержит только выбранный статус: у остальных
      // пунктов числа нет, а не ноль.
      count: status !== '' && value !== status ? undefined : (countMap.get(value) ?? 0),
    }));
  }, [statusCounts, status, countMap]);

  const failedItems = useMemo(
    () => visibleItems.filter((item) => FAILED_STATUSES.includes(item.status)),
    [visibleItems],
  );
  const inFlightCount = useMemo(
    () => visibleItems.filter((item) => IN_FLIGHT_STATUSES.includes(item.status)).length,
    [visibleItems],
  );
  const refundedItems = useMemo(
    () => visibleItems.filter((item) => REFUNDED_STATUSES.includes(item.status)),
    [visibleItems],
  );

  const pageSums = sumsByCurrency(visibleItems, (item) => item.currency, (item) => item.totalMinor);
  const refundSums = sumsByCurrency(refundedItems, (item) => item.currency, (item) => item.amountMinor);
  const failedShare = visibleItems.length > 0 ? Math.round((failedItems.length / visibleItems.length) * 100) : null;

  /** Полосы: по строке на статус; полоса — число платежей, суммы подписаны рядом. */
  const barItems = useMemo(
    () =>
      statusCounts.map((entry) => {
        const inStatus = visibleItems.filter((item) => item.status === entry.status);
        return {
          key: entry.status,
          label: statusLabel(entry.status),
          value: entry.count,
          hint: moneyHint(sumsByCurrency(inStatus, (item) => item.currency, (item) => item.totalMinor)),
          tone: statusTone(entry.status),
        };
      }),
    [statusCounts, visibleItems],
  );

  const segments = statusCounts.map((entry) => ({
    key: entry.status,
    label: statusLabel(entry.status),
    value: entry.count,
    tone: statusTone(entry.status),
  }));

  const csv = paymentsCsv(visibleItems);

  return (
    <div className="space-y-4">
      {/* Тулбар: что за список, сколько найдено и что с ним можно сделать. */}
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
            <CopyCsvButton csv={csv} rows={visibleItems.length} />
          </>
        }
      >
        <h2 className="text-lg font-semibold text-ink-900">Платежи</h2>
        <Badge tone="brand">{listQuery.data ? `Найдено: ${listQuery.data.totalElements}` : 'считаем…'}</Badge>
        {listQuery.isFetching ? <span className="text-xs text-ink-500">обновляем…</span> : null}
      </Toolbar>

      {filtersOpen ? (
        <div className="mb-4 flex flex-wrap items-end gap-x-4 gap-y-3 rounded-card border border-ink-200 bg-white px-4 py-3 shadow-sm">
          <div className="w-44">
            <SelectField
              id="admin-payments-status"
              label="Статус"
              value={status}
              options={STATUS_OPTIONS.map((value) => ({ value, label: statusLabel(value) }))}
              placeholder="Все статусы"
              hint="Серверный фильтр: GET /api/v1/payments?status=… То же значение выставляет рейл ниже."
              onChange={(event) => {
                setStatus(event.target.value);
                setPage(0);
              }}
            />
          </div>

          <div className="w-36">
            <SelectField
              id="admin-payments-size"
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

          <div className="pb-1">
            <CheckboxField
              id="admin-payments-only-refunds"
              label="Только с возвратом"
              hint="Клиентский отбор по загруженной странице: REFUNDED и PARTIALLY_REFUNDED"
              checked={onlyRefunds}
              onChange={(event) => setOnlyRefunds(event.target.checked)}
            />
          </div>

          <p className="pb-2 text-xs text-ink-500 lg:ml-auto">
            На странице {items.length}
            {onlyRefunds ? `, после отбора ${visibleItems.length}` : ''} из {listQuery.data?.totalElements ?? '—'}{' '}
            найденных сервисом
          </p>
        </div>
      ) : null}

      {/* Плитки: серверный счёт, суммы и доли загруженной страницы. */}
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <KpiTile
          label="Платежей по фильтру"
          icon={<PaymentsIcon className="h-5 w-5" />}
          tone="brand"
          loading={!loaded}
          value={listQuery.data ? listQuery.data.totalElements : undefined}
          caption={`Счёт сервиса по фильтру${status === '' ? '' : ` «${statusLabel(status)}»`}; на странице ${items.length}, в работе ${inFlightCount}`}
        />

        <KpiTile
          label="Сумма на странице"
          icon={<WalletIcon className="h-5 w-5" />}
          tone="info"
          loading={!loaded}
          value={<MoneyValue sums={pageSums} />}
          caption={`amount + fee по ${visibleItems.length} платежам загруженной страницы; валюты не складываются`}
        />

        <KpiTile
          label="Доля неуспешных"
          icon={<ShieldIcon className="h-5 w-5" />}
          tone="warning"
          loading={!loaded}
          value={failedShare === null ? '—' : `${failedShare} %`}
          caption={`FAILED и CANCELLED на странице: ${failedItems.length} из ${visibleItems.length}`}
        />

        <KpiTile
          label="Возвраты на странице"
          icon={<TransferIcon className="h-5 w-5" />}
          tone="success"
          loading={!loaded}
          value={refundedItems.length}
          caption={`REFUNDED и PARTIALLY_REFUNDED страницы, на сумму ${moneyHint(refundSums, '0')}`}
        />

        <KpiTile
          label="Средний чек"
          icon={<PulseIcon className="h-5 w-5" />}
          tone="neutral"
          loading={!loaded}
          value={<MoneyValue sums={averagesByCurrency(pageSums)} />}
          caption="Клиентский расчёт: сумма страницы ÷ число платежей, по каждой валюте отдельно"
        />

        {/* Диаграммы: без библиотек, по той же загруженной странице. */}
        <Panel
          className="sm:col-span-1 xl:col-span-3"
          title="Распределение по статусам"
          subtitle={`По загруженной странице: ${visibleItems.length} платежей. Агрегатов по статусам сервис не отдаёт — числа считает клиент.`}
          action={<Chip tone="neutral">по текущей странице</Chip>}
        >
          {!loaded ? <SkeletonText lines={4} /> : null}

          {loaded && visibleItems.length === 0 ? (
            <EmptyState
              title="Нечего показывать: на странице нет платежей"
              description="Диаграммы строятся из загруженных строк. Снимите фильтр, выберите другой статус в рейле или откройте соседнюю страницу."
            />
          ) : null}

          {visibleItems.length > 0 ? (
            <div className="grid gap-6 xl:grid-cols-2">
              <div className="min-w-0">
                <h3 className="text-sm font-semibold text-ink-900">Платежи и суммы по статусам</h3>
                <div className="mt-2">
                  <BarList items={barItems} />
                </div>
                <p className="mt-2 text-xs leading-snug text-ink-500">
                  Полоса — число платежей в статусе; суммы (amount + fee) подписаны рядом и не складываются между валютами.
                </p>
              </div>

              <div className="min-w-0">
                <h3 className="text-sm font-semibold text-ink-900">Доли статусов</h3>
                <div className="mt-2">
                  <Donut segments={segments} centerValue={visibleItems.length} centerLabel="платежей" />
                </div>
                <p className="mt-2 text-xs leading-snug text-ink-500">
                  Кольцо считает строки, а не деньги: в центре — число платежей загруженной страницы.
                </p>
              </div>
            </div>
          ) : null}
        </Panel>
      </div>

      {/* Рейл, таблица и карточка платежа: две колонки на широком экране. */}
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,26rem)]">
        <Panel
          title="Список платежей"
          subtitle={
            listQuery.data
              ? `Найдено сервисом: ${listQuery.data.totalElements} · показано ${visibleItems.length} строк текущей страницы`
              : 'Загружаем страницу платежей'
          }
          action={<p className="text-xs text-ink-500">Клик по строке открывает карточку справа</p>}
        >
          <div className="grid gap-4 xl:grid-cols-[9rem_minmax(0,1fr)]">
            <div className="min-w-0">
              <StatusRail
                items={railItems}
                active={status}
                allCount={listQuery.data?.totalElements ?? items.length}
                ariaLabel="Статусы платежей"
                onSelect={(value) => {
                  setStatus(value);
                  setPage(0);
                }}
              />
              <p className="mt-2 text-xs leading-snug text-ink-500">
                {status === ''
                  ? 'Числа в пилюлях — по загруженной странице. Пункт фильтрует выборку на сервере (?status=).'
                  : `Фильтр «${statusLabel(status)}» уходит в сервис, поэтому у остальных пунктов числа нет: страница содержит только этот статус.`}
              </p>
            </div>

            <div className="min-w-0">
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

              {items.length > 0 && visibleItems.length === 0 ? (
                <EmptyState
                  title="На этой странице нет платежей с возвратом"
                  description="Отбор «только с возвратом» работает по загруженной странице: строки со статусом REFUNDED или PARTIALLY_REFUNDED сюда не попали. Снимите отбор или откройте соседнюю страницу."
                />
              ) : null}

              {visibleItems.length > 0 ? (
                <div className="relative overflow-x-auto max-h-[32rem] overflow-y-auto">
                  <table className="w-full min-w-[64rem] text-left text-sm">
                    <caption className="sr-only">
                      Платежи текущей страницы: номер, тип, назначение, мерчант, заказ, суммы, статус и время создания
                    </caption>
                    <thead>
                      <tr className="text-xs text-ink-500 uppercase">
                        <th scope="col" className="sticky top-0 z-10 border-b border-ink-200 bg-white py-2 pr-3 font-medium">
                          Платёж
                        </th>
                        <th scope="col" className="sticky top-0 z-10 border-b border-ink-200 bg-white py-2 pr-3 font-medium">
                          Тип
                        </th>
                        <th scope="col" className="sticky top-0 z-10 border-b border-ink-200 bg-white py-2 pr-3 font-medium">
                          Назначение
                        </th>
                        <th scope="col" className="sticky top-0 z-10 border-b border-ink-200 bg-white py-2 pr-3 font-medium">
                          Мерчант
                        </th>
                        <th scope="col" className="sticky top-0 z-10 border-b border-ink-200 bg-white py-2 pr-3 font-medium">
                          Заказ
                        </th>
                        <th scope="col" className="sticky top-0 z-10 border-b border-ink-200 bg-white py-2 pr-3 text-right font-medium">
                          Сумма
                        </th>
                        <th scope="col" className="sticky top-0 z-10 border-b border-ink-200 bg-white py-2 pr-3 text-right font-medium">
                          Комиссия
                        </th>
                        <th scope="col" className="sticky top-0 z-10 border-b border-ink-200 bg-white py-2 pr-3 text-right font-medium">
                          Итого
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
                      {visibleItems.map((item, index) => {
                        const isSelected = item.paymentId === selectedId;
                        return (
                          <tr
                            key={item.paymentId}
                            onClick={() => setSelectedId(isSelected ? null : item.paymentId)}
                            className={cx(
                              'cursor-pointer border-b border-ink-100 align-top',
                              isSelected ? 'bg-brand-50' : index % 2 === 1 ? 'bg-ink-50/60' : 'bg-white',
                            )}
                          >
                            <td className="py-2 pr-3">
                              <span className="block font-medium text-ink-900">{item.paymentNumber}</span>
                              <span className="block font-mono text-xs text-ink-400">
                                {shortId(item.paymentId, 10)}
                              </span>
                            </td>
                            <td className="py-2 pr-3 whitespace-nowrap">{paymentTypeLabel(item.type)}</td>
                            <td className="max-w-[180px] py-2 pr-3">
                              <span className="block truncate text-ink-600" title={item.description ?? undefined}>
                                {item.description ?? '—'}
                              </span>
                            </td>
                            <td className="py-2 pr-3">
                              <span className="font-mono text-xs text-ink-700">
                                {item.merchantId ? shortId(item.merchantId, 10) : '—'}
                              </span>
                            </td>
                            <td className="py-2 pr-3">
                              {/* Заказ показываем текстом: раздел «Заказы» ищет по номеру в своей
                                  форме, и ссылка с параметром вела бы в пустую форму. */}
                              {item.orderId ? (
                                <span className="font-mono text-xs text-ink-600" title={`Заказ ${item.orderId}`}>
                                  {shortId(item.orderId, 10)}
                                </span>
                              ) : (
                                <span className="text-ink-400">—</span>
                              )}
                            </td>
                            <td className="tnum py-2 pr-3 text-right whitespace-nowrap">
                              {formatMoney(item.amountMinor, item.currency)}
                            </td>
                            <td className="tnum py-2 pr-3 text-right whitespace-nowrap">
                              {formatMoney(item.feeMinor, item.currency)}
                            </td>
                            <td className="tnum py-2 pr-3 text-right font-medium whitespace-nowrap">
                              {formatMoney(item.totalMinor, item.currency)}
                            </td>
                            <td className="py-2 pr-3">
                              <StatusBadge status={item.status} />
                            </td>
                            <td className="py-2 pr-3 text-xs whitespace-nowrap text-ink-600">
                              {formatDateTime(item.createdAt)}
                            </td>
                            <td className="py-2 text-right">
                              <Button
                                variant="secondary"
                                size="sm"
                                aria-pressed={isSelected}
                                onClick={(event) => {
                                  // Клик по кнопке не должен срабатывать дважды вместе с кликом по строке.
                                  event.stopPropagation();
                                  setSelectedId(isSelected ? null : item.paymentId);
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
                {detailQuery.data ? `Платёж № ${detailQuery.data.payment.paymentNumber}` : 'Карточка платежа'}
                {detailQuery.data ? <StatusBadge status={detailQuery.data.payment.status} /> : null}
              </span>
            ) : (
              'Карточка платежа'
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
            <PaymentDetailBody
              paymentId={selectedId}
              detail={detailQuery}
              refunds={refundsQuery}
              owner={ownerQuery}
              canWrite={canWrite}
            />
          ) : (
            <EmptyState
              title="Платёж не выбран"
              description="Выберите строку в списке: здесь появятся поля платежа, переходы статусов и история возвратов. Клик по строке и кнопка «Детали» делают одно и то же."
            />
          )}
        </Panel>
      </div>

      {/* Единственное изменяющее действие раздела — своей панелью, а не спрятанное в карточке. */}
      <Panel
        title="Возврат средств"
        subtitle="Одно возвращённое намерение — один Idempotency-Key: повторная отправка того же возврата не двигает деньги дважды."
      >
        {canWrite ? (
          <RefundPanel payments={visibleItems} selectedId={selectedId} onSelect={setSelectedId} />
        ) : (
          <p className="text-sm text-ink-600">
            Возврат средств доступен только роли {roleLabel('ADMIN')}: сервис проверяет право на операцию, а у роли{' '}
            {roleLabel(role)} в этом разделе только чтение. Формы возврата здесь нет — платежи, детали и история
            возвратов доступны полностью.
          </p>
        )}
      </Panel>
    </div>
  );
}
