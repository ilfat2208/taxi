/**
 * Раздел админ-панели «Заказы».
 *
 * Раздел собран как «список + деталь», как в обычной админке: слева рейл статусов с
 * серверными числами и таблица заказов с фильтрами, справа — деталь выбранного заказа
 * (позиции, суммы, оплаты, история переходов, платёж и резервы стока). Блоки берутся из
 * общего набора `admin/kit` (`KpiTile`, `Panel`, `StatusRail`, `Toolbar`), поэтому
 * раздел выглядит так же, как соседние разделы панели.
 *
 * Реальные эндпоинты и классы, откуда взяты пути и поля:
 *  - `GET /api/v1/support/orders/{orderId}` — `SupportOrderController.orderById`
 *    → `OrderDtos.OrderResponse` (позиции, суммы, `sagaState`, оплаты по мерчантам,
 *    `paymentStatus`, `paidAt`);
 *  - `GET /api/v1/support/orders/by-number/{orderNumber}` — `orderByNumber`;
 *  - `GET /api/v1/support/orders/{orderId}/history` — `history`
 *    → `List<OrderDtos.OrderHistoryResponse>` (переход, причина, автор);
 *  - `GET /api/v1/support/orders?userId&status&page&size` — `list`
 *    → `PageResponse<OrderDtos.OrderSummaryResponse>`;
 *  - `GET /api/v1/payments/by-order/{orderId}` —
 *    `PaymentController.byOrder` → `PaymentDtos.PaymentResponse`;
 *  - `GET /api/v1/support/reservations/{orderId}` — резервы стока
 *    (`SupportCatalogController.reservations`);
 *  - `GET /api/v1/orders?page&size&status` — общий список (`fetchOrders`), он отдаёт
 *    заказы вызывающего, поэтому вынесен в отдельный источник «Мои заказы».
 *
 * Ни одной мутации у support-эндпоинтов нет: отмена заказа живёт в `OrderController`
 * и через support-контроллер недоступна, поэтому кнопок изменения в разделе нет, а
 * `data-admin-write` в разметке не встречается вовсе. Кнопка «CSV» выгружает в буфер
 * обмена уже загруженные строки — это действие браузера, а не запись на сервере.
 *
 * Числа по статусам для рейла — серверные, но добываются отдельными короткими
 * запросами `?status=…&size=1` (берём `Page.totalElements`): группировки по статусам
 * у ручки нет, и каждый такой вызов аудируется. Об этом написано рядом с рейлом.
 */
import { useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { useQueries, useQuery } from '@tanstack/react-query';
import { fetchOrders } from '../../api/endpoints';
import { isApiError } from '../../api/errors';
import { formatMoney, sumMinor } from '../../api/money';
import type { Order } from '../../api/types';
import { Alert, ErrorAlert } from '../../components/ui/Alerts';
import { Badge, StatusBadge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { DetailRow } from '../../components/ui/Card';
import { CopyButton } from '../../components/ui/CopyButton';
import { EmptyState } from '../../components/ui/EmptyState';
import { SelectField, TextField, type SelectOption } from '../../components/ui/Field';
import { Pagination } from '../../components/ui/Pagination';
import { SkeletonRows } from '../../components/ui/Skeleton';
import { Timeline, type TimelineEntry } from '../../components/ui/Timeline';
import { useDebouncedValue } from '../../hooks/useDebouncedValue';
import { cx } from '../../lib/cx';
import { formatDateTime, roleLabel, statusLabel } from '../../lib/format';
import { KpiTile, Panel, StatusRail, Toolbar } from '../kit';
import type { AdminSectionProps } from '../sections';
import {
  fetchPaymentByOrder,
  fetchSupportOrder,
  fetchSupportOrderByNumber,
  fetchSupportOrderHistory,
  fetchSupportOrders,
  type SupportOrder,
  type SupportOrderSummary,
  type SupportPayment,
} from '../api/supportOrders';
import { fetchSupportReservations, type SupportReservation } from '../api/supportCatalog';

const PAGE_SIZE = 10;

/**
 * Статусы строго из `order-service` (`OrderStatus`: DRAFT, PENDING_PAYMENT, PAID,
 * CONFIRMED, CANCELLED, FAILED). Ни `SHIPPED`, ни `DELIVERED` в этом сервисе нет:
 * фильтр `?status=` принимает только их, и лишний вариант в списке давал бы 400.
 */
const ORDER_STATUSES = ['DRAFT', 'PENDING_PAYMENT', 'PAID', 'CONFIRMED', 'CANCELLED', 'FAILED'];

const STATUS_OPTIONS: SelectOption[] = ORDER_STATUSES.map((value) => ({ value, label: statusLabel(value) }));

/** Статусы, которые считаем «оплаченными», — вместе с `paidAt` из support-списка. */
const PAID_STATUSES = ['PAID', 'CONFIRMED'];

type OrderSearchMode = 'number' | 'id';
type ListSource = 'platform' | 'mine';

const ORDER_MODE_OPTIONS: SelectOption[] = [
  { value: 'number', label: 'По номеру заказа' },
  { value: 'id', label: 'По идентификатору заказа' },
];

function isNotFound(error: unknown): boolean {
  return isApiError(error) && error.isNotFound;
}

function statusFilterValue(status: string): string | undefined {
  return status === '' ? undefined : status;
}

/** Считаем строку оплаченной: статус из шести известных либо непустой `paidAt`. */
function isPaid(row: SupportOrderSummary): boolean {
  return PAID_STATUSES.includes(row.status) || row.paidAt !== null;
}

/**
 * Путь эндпоинта внутри текста: моноширинно и без обратных кавычек, которые
 * иначе попадали бы на экран как есть.
 */
function Endpoint({ children }: { children: ReactNode }) {
  return <code className="font-mono text-xs">{children}</code>;
}

/** Иконка плитки: набор блоков даёт цветной квадрат 40×40, сюда приходит только знак. */
function Icon({ children }: { children: ReactNode }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-5 w-5"
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

/**
 * Ошибка запроса: подпись говорит, что именно не получилось, а `ErrorAlert` — почему.
 *
 * Свой `title` в `ErrorAlert` не передаём намеренно: без него заголовком становится
 * `humanMessage(error)` — перевод кода сервиса, а не только его `detail`.
 */
function RequestError({
  label,
  error,
  onRetry,
}: {
  label: string;
  error: unknown;
  onRetry: () => void;
}) {
  return (
    <div className="space-y-2">
      <p className="text-sm font-medium text-ink-700">{label}</p>
      <ErrorAlert error={error} onRetry={onRetry} />
    </div>
  );
}

/**
 * Кнопка «CSV»: выгружает уже загруженные строки в буфер обмена.
 *
 * Это действие над данными в браузере, а не изменение на сервере: у ручек раздела
 * нет ни одной мутации. Поэтому пометки `data-admin-write` здесь нет и быть не должно.
 */
function CsvButton({ rows, name }: { rows: string[][]; name: string }) {
  const [state, setState] = useState<'idle' | 'ok' | 'fail'>('idle');

  useEffect(() => {
    if (state === 'idle') {
      return;
    }
    const timer = window.setTimeout(() => setState('idle'), 2_000);
    return () => window.clearTimeout(timer);
  }, [state]);

  const copy = async () => {
    const csv = rows
      .map((row) => row.map((cell) => `"${cell.replace(/"/g, '""')}"`).join(';'))
      .join('\r\n');
    try {
      await navigator.clipboard.writeText(csv);
      setState('ok');
    } catch {
      // Буфер обмена недоступен (небезопасный контекст, отказ в правах) — так и говорим.
      setState('fail');
    }
  };

  return (
    <Button
      variant="secondary"
      size="sm"
      // Одна строка — это только заголовок CSV: выгружать нечего.
      disabled={rows.length <= 1}
      title={`Скопировать CSV загруженных строк: ${name}`}
      onClick={() => void copy()}
    >
      <span aria-live="polite">
        {state === 'ok' ? 'CSV скопирован' : state === 'fail' ? 'CSV недоступен' : 'CSV'}
      </span>
    </Button>
  );
}

/** Переключатель источника списка: чипы вместо выпадающего списка — так виднее оба варианта. */
function SourceSwitch({ value, onChange }: { value: ListSource; onChange: (value: ListSource) => void }) {
  const options: Array<{ value: ListSource; label: string }> = [
    { value: 'platform', label: 'Заказы платформы' },
    { value: 'mine', label: 'Мои заказы' },
  ];

  return (
    <div role="group" aria-label="Источник списка" className="flex rounded-full bg-ink-100 p-0.5">
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          aria-pressed={value === option.value}
          onClick={() => onChange(option.value)}
          className={cx(
            'rounded-full px-3 py-1 text-xs font-medium transition-colors',
            value === option.value ? 'bg-white text-brand-700 shadow-sm' : 'text-ink-600 hover:text-ink-800',
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

/* ---------------------------------------------------------------- поиск */

interface IdSearch {
  value: string;
  setValue: (value: string) => void;
  submitted: string | null;
  submit: (id?: string) => void;
}

/**
 * Локальный поиск по кнопке: пустое поле не отправляет запрос вообще, а набор
 * символов не порождает по запросу на каждое нажатие. Такой же хук есть в разделе
 * каталога — общий модуль под него заводить нельзя (список разрешённых файлов), и
 * дублировать сюда UI-кит тоже нечего.
 */
function useIdSearch(initial = ''): IdSearch {
  const [value, setValue] = useState(initial);
  const [submitted, setSubmitted] = useState<string | null>(null);

  return {
    value,
    setValue,
    submitted,
    submit: (id?: string) => {
      const next = (id ?? value).trim();
      setSubmitted(next === '' ? null : next);
    },
  };
}

/* ------------------------------------------------------- карточка заказа */

function ItemsTable({ order }: { order: SupportOrder }) {
  return (
    <div className="relative overflow-x-auto">
      <table className="w-full min-w-[36rem] border-collapse text-sm">
        <caption className="sr-only">Позиции заказа</caption>
        <thead>
          <tr className="border-b border-ink-200 text-left text-xs text-ink-500 uppercase">
            <th scope="col" className="py-2 pr-3 font-medium">Позиция</th>
            <th scope="col" className="py-2 pr-3 font-medium">Товар</th>
            <th scope="col" className="py-2 pr-3 font-medium">Магазин</th>
            <th scope="col" className="py-2 pr-3 font-medium">Кол-во</th>
            <th scope="col" className="py-2 pr-3 font-medium">Цена</th>
            <th scope="col" className="py-2 font-medium">Сумма</th>
          </tr>
        </thead>
        <tbody>
          {order.items.map((item, index) => {
            const currency = item.currency ?? order.currency;
            return (
              <tr
                key={item.orderItemId ?? item.id ?? `${item.productId}-${index}`}
                className="border-b border-ink-100"
              >
                <td className="py-2 pr-3 text-ink-900">{item.title}</td>
                <td className="py-2 pr-3 font-mono text-xs text-ink-600">{item.productId}</td>
                <td className="py-2 pr-3 font-mono text-xs text-ink-600">{item.merchantId ?? '—'}</td>
                <td className="tnum py-2 pr-3 text-ink-900">{item.quantity}</td>
                <td className="tnum py-2 pr-3 whitespace-nowrap text-ink-700">
                  {formatMoney(item.priceMinor, currency)}
                </td>
                <td className="tnum py-2 whitespace-nowrap text-ink-900">
                  {formatMoney(item.totalMinor ?? 0, currency)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function OrderPaymentsTable({ order }: { order: SupportOrder }) {
  if (order.payments.length === 0) {
    return (
      <EmptyState
        title="Оплат по мерчантам нет"
        description="В ответе заказа нет ни одной оплаты: он ещё не дошёл до шага оплаты. Это не ошибка, а состояние чекаута."
      />
    );
  }

  return (
    <div className="relative overflow-x-auto">
      <table className="w-full min-w-[32rem] border-collapse text-sm">
        <caption className="sr-only">Оплаты заказа по мерчантам</caption>
        <thead>
          <tr className="border-b border-ink-200 text-left text-xs text-ink-500 uppercase">
            <th scope="col" className="py-2 pr-3 font-medium">Магазин</th>
            <th scope="col" className="py-2 pr-3 font-medium">Оплата</th>
            <th scope="col" className="py-2 pr-3 font-medium">Статус</th>
            <th scope="col" className="py-2 pr-3 font-medium">Сумма</th>
            <th scope="col" className="py-2 pr-3 font-medium">Комиссия</th>
            <th scope="col" className="py-2 font-medium">Списано</th>
          </tr>
        </thead>
        <tbody>
          {order.payments.map((payment, index) => (
            <tr
              key={payment.paymentId ?? `${payment.merchantId ?? 'merchant'}-${index}`}
              className="border-b border-ink-100"
            >
              <td className="py-2 pr-3 font-mono text-xs text-ink-600">{payment.merchantId ?? '—'}</td>
              <td className="py-2 pr-3 font-mono text-xs text-ink-600">
                {payment.paymentId ?? 'ещё не создана'}
              </td>
              <td className="py-2 pr-3">
                {payment.status ? (
                  <StatusBadge status={payment.status} />
                ) : (
                  <span className="text-ink-500">—</span>
                )}
              </td>
              <td className="tnum py-2 pr-3 whitespace-nowrap text-ink-700">
                {formatMoney(payment.amountMinor, payment.currency)}
              </td>
              <td className="tnum py-2 pr-3 whitespace-nowrap text-ink-700">
                {formatMoney(payment.feeMinor, payment.currency)}
              </td>
              <td className="tnum py-2 whitespace-nowrap text-ink-900">
                {formatMoney(payment.totalMinor, payment.currency)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Деталь заказа: всё, что сервис отдал про этот заказ, без второго экрана. */
function OrderCard({ order }: { order: SupportOrder }) {
  return (
    <div className="space-y-4">
      {order.failureReason ? (
        <Alert tone="danger" title="Заказ с ошибкой">
          {order.failureReason}
        </Alert>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        <StatusBadge status={order.status} />
        {order.sagaState ? <Badge tone="info">{`сага: ${order.sagaState}`}</Badge> : null}
        {order.paymentStatus ? <Badge tone="neutral">{`оплата: ${statusLabel(order.paymentStatus)}`}</Badge> : null}
        <Badge tone="neutral">{`позиций: ${order.itemCount}`}</Badge>
      </div>

      <dl className="grid gap-x-6 sm:grid-cols-2">
        <DetailRow label="Идентификатор">
          <span className="inline-flex items-center gap-1 font-mono text-xs">
            {order.orderId}
            <CopyButton value={order.orderId} />
          </span>
        </DetailRow>
        <DetailRow label="Номер">{order.orderNumber}</DetailRow>
        <DetailRow label="Состояние саги">{order.sagaState ?? '—'}</DetailRow>
        <DetailRow label="Статус оплаты">{statusLabel(order.paymentStatus)}</DetailRow>
        <DetailRow label="Момент оплаты">{formatDateTime(order.paidAt)}</DetailRow>
        <DetailRow label="Создан">{formatDateTime(order.createdAt)}</DetailRow>
        <DetailRow label="Обновлён">{formatDateTime(order.updatedAt)}</DetailRow>
        <DetailRow label="Завершён">{formatDateTime(order.completedAt)}</DetailRow>
        <DetailRow label="Адрес доставки">{order.deliveryAddress || '—'}</DetailRow>
        <DetailRow label="Телефон">{order.contactPhone || '—'}</DetailRow>
        <DetailRow label="Комментарий">{order.comment ?? '—'}</DetailRow>
        <DetailRow label="Счёт списания">
          <span className="font-mono text-xs">{order.sourceAccountId ?? '—'}</span>
        </DetailRow>
      </dl>

      <div className="rounded-card border border-ink-200 p-4">
        <p className="mb-2 text-sm font-semibold text-ink-900">Суммы</p>
        <dl className="grid gap-x-6 sm:grid-cols-3">
          <DetailRow label="Товары">
            <span className="tnum">{formatMoney(order.itemsTotalMinor, order.currency)}</span>
          </DetailRow>
          <DetailRow label="Доставка">
            <span className="tnum">{formatMoney(order.deliveryMinor, order.currency)}</span>
          </DetailRow>
          <DetailRow label="Итого">
            <span className="tnum text-base">{formatMoney(order.totalMinor, order.currency)}</span>
          </DetailRow>
        </dl>
      </div>

      <div>
        <p className="mb-2 text-sm font-semibold text-ink-900">Позиции</p>
        {order.items.length === 0 ? (
          <EmptyState
            title="Позиций нет"
            description="Сервис не вернул ни одной позиции по этому заказу."
          />
        ) : (
          <ItemsTable order={order} />
        )}
      </div>

      <div>
        <p className="mb-2 text-sm font-semibold text-ink-900">Оплаты по мерчантам</p>
        <OrderPaymentsTable order={order} />
      </div>
    </div>
  );
}

/* ------------------------------------------------------------- история */

function HistoryPanel({ orderId }: { orderId: string }) {
  const query = useQuery({
    queryKey: ['admin', 'orders', orderId, 'history'],
    queryFn: () => fetchSupportOrderHistory(orderId),
    retry: 0,
  });

  const entries = useMemo<TimelineEntry[]>(
    () =>
      (query.data ?? []).map((entry, index) => ({
        key: `${entry.toStatus}-${entry.createdAt ?? index}`,
        status: entry.toStatus,
        time: entry.createdAt,
        note: [
          entry.fromStatus ? `из «${statusLabel(entry.fromStatus)}»` : 'первый переход',
          entry.actor ? `кто: ${entry.actor}` : null,
          entry.reason,
        ]
          .filter(Boolean)
          .join(' · '),
      })),
    [query.data],
  );

  return (
    <Panel
      title="История переходов"
      subtitle={
        <>
          <Endpoint>GET /api/v1/support/orders/{'{id}'}/history</Endpoint> — от старых к новым, с автором и
          причиной
        </>
      }
    >
      {query.isPending ? <SkeletonRows count={3} /> : null}

      {query.isError ? (
        <RequestError
          label="Не удалось получить историю заказа"
          error={query.error}
          onRetry={() => void query.refetch()}
        />
      ) : null}

      {query.data && query.data.length === 0 ? (
        <EmptyState
          title="Переходов нет"
          description="Сервис вернул пустую историю: у заказа ещё не было ни одного перехода состояния."
        />
      ) : null}

      {entries.length > 0 ? <Timeline entries={entries} /> : null}
    </Panel>
  );
}

/* -------------------------------------------------------------- оплата */

function PaymentPanel({ orderId }: { orderId: string }) {
  const query = useQuery({
    queryKey: ['admin', 'orders', orderId, 'payment'],
    queryFn: () => fetchPaymentByOrder(orderId),
    retry: 0,
  });

  const payment: SupportPayment | undefined = query.data;

  return (
    <Panel
      title="Платёж по заказу"
      subtitle={
        <>
          <Endpoint>GET /api/v1/payments/by-order/{'{orderId}'}</Endpoint> — рассчитанная оплата заказа; 404
          означает, что заказ не платили
        </>
      }
      action={payment ? <StatusBadge status={payment.status} /> : null}
    >
      {query.isPending ? <SkeletonRows count={3} /> : null}

      {query.isError ? (
        isNotFound(query.error) ? (
          <EmptyState
            title="Заказ никогда не был оплачен"
            description="payment-service ответил 404 PAYMENT_NOT_FOUND: по этому заказу нет ни одной рассчитанной оплаты. Если оплата ожидалась, сравните это с историей переходов."
          />
        ) : (
          <RequestError
            label="Не удалось получить платёж"
            error={query.error}
            onRetry={() => void query.refetch()}
          />
        )
      ) : null}

      {payment ? (
        <>
          <dl className="grid gap-x-6 sm:grid-cols-2">
            <DetailRow label="Номер платежа">{payment.paymentNumber}</DetailRow>
            <DetailRow label="Идентификатор">
              <span className="inline-flex items-center gap-1 font-mono text-xs">
                {payment.paymentId}
                <CopyButton value={payment.paymentId} />
              </span>
            </DetailRow>
            <DetailRow label="Тип">{payment.type}</DetailRow>
            <DetailRow label="Заказ">
              <span className="font-mono text-xs">{payment.orderId ?? '—'}</span>
            </DetailRow>
            <DetailRow label="Владелец">
              <span className="font-mono text-xs">{payment.ownerUserId ?? '—'}</span>
            </DetailRow>
            <DetailRow label="Магазин">
              <span className="font-mono text-xs">{payment.merchantId ?? '—'}</span>
            </DetailRow>
            <DetailRow label="Сумма">
              <span className="tnum">{formatMoney(payment.amountMinor, payment.currency)}</span>
            </DetailRow>
            <DetailRow label="Комиссия">
              <span className="tnum">{formatMoney(payment.feeMinor, payment.currency)}</span>
            </DetailRow>
            <DetailRow label="Списано с плательщика">
              <span className="tnum text-base">{formatMoney(payment.totalMinor, payment.currency)}</span>
            </DetailRow>
            <DetailRow label="Создан">{formatDateTime(payment.createdAt)}</DetailRow>
            <DetailRow label="Завершён">{formatDateTime(payment.completedAt)}</DetailRow>
          </dl>

          {payment.failureReason ? (
            <Alert
              className="mt-3"
              tone="danger"
              title={`Оплата не прошла${payment.failureCode ? ` (${payment.failureCode})` : ''}`}
            >
              {payment.failureReason}
            </Alert>
          ) : null}
        </>
      ) : null}
    </Panel>
  );
}

/* ------------------------------------------------------ резервы стока */

function OrderReservationsPanel({ orderId }: { orderId: string }) {
  const query = useQuery({
    queryKey: ['admin', 'orders', orderId, 'reservations'],
    queryFn: () => fetchSupportReservations(orderId),
    retry: 0,
  });

  const reservations: SupportReservation[] = query.data ?? [];

  return (
    <Panel
      title="Резервы стока по заказу"
      subtitle={
        <>
          <Endpoint>GET /api/v1/support/reservations/{'{orderId}'}</Endpoint> — что каталог держит под этот
          заказ
        </>
      }
    >
      {query.isPending ? <SkeletonRows count={2} /> : null}

      {query.isError ? (
        isNotFound(query.error) ? (
          <EmptyState
            title="Каталог не резервировал сток по этому заказу"
            description="Сервис ответил 404 RESERVATION_NOT_FOUND. Это значит «каталог про такой заказ не знает», а не «резервов нет»."
          />
        ) : (
          <RequestError
            label="Не удалось получить резервы стока"
            error={query.error}
            onRetry={() => void query.refetch()}
          />
        )
      ) : null}

      {reservations.length > 0 ? (
        <div className="relative overflow-x-auto">
          <table className="w-full min-w-[32rem] border-collapse text-sm">
            <caption className="sr-only">Резервы стока по заказу</caption>
            <thead>
              <tr className="border-b border-ink-200 text-left text-xs text-ink-500 uppercase">
                <th scope="col" className="py-2 pr-3 font-medium">Товар</th>
                <th scope="col" className="py-2 pr-3 font-medium">Кол-во</th>
                <th scope="col" className="py-2 pr-3 font-medium">Статус</th>
                <th scope="col" className="py-2 pr-3 font-medium">Создан</th>
                <th scope="col" className="py-2 font-medium">Истекает</th>
              </tr>
            </thead>
            <tbody>
              {reservations.map((reservation) => (
                <tr key={reservation.id} className="border-b border-ink-100">
                  <td className="py-2 pr-3 font-mono text-xs text-ink-600">{reservation.productId}</td>
                  <td className="tnum py-2 pr-3 text-ink-900">{reservation.quantity}</td>
                  <td className="py-2 pr-3">
                    <StatusBadge status={reservation.status} />
                  </td>
                  <td className="tnum py-2 pr-3 whitespace-nowrap text-ink-700">
                    {formatDateTime(reservation.createdAt)}
                  </td>
                  <td className="tnum py-2 whitespace-nowrap text-ink-700">
                    {formatDateTime(reservation.expiresAt)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </Panel>
  );
}

/* ------------------------------------------------------ список заказов */

function SummaryTable({
  items,
  selectedId,
  onOpen,
}: {
  items: SupportOrderSummary[];
  selectedId: string | null;
  onOpen: (orderId: string) => void;
}) {
  return (
    <div className="relative overflow-x-auto">
      <table className="w-full min-w-[26rem] border-collapse text-sm">
        <caption className="sr-only">Заказы по текущему фильтру</caption>
        <thead>
          <tr className="border-b border-ink-200 text-left text-xs text-ink-500 uppercase">
            <th scope="col" className="py-2 pr-3 font-medium">Номер</th>
            <th scope="col" className="py-2 pr-3 font-medium">Статус</th>
            <th scope="col" className="py-2 pr-3 font-medium">Позиций</th>
            <th scope="col" className="py-2 pr-3 font-medium">Итого</th>
            <th scope="col" className="py-2 font-medium">
              <span className="sr-only">Действия</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {items.map((item) => {
            const selected = item.orderId === selectedId;
            return (
              <tr key={item.orderId} className={cx('border-b border-ink-100', selected && 'bg-brand-50')}>
                <td className="py-2 pr-3">
                  <span className="block text-ink-900">{item.orderNumber}</span>
                  <span className="tnum block text-xs text-ink-500">{formatDateTime(item.createdAt)}</span>
                  <span className="block font-mono text-xs text-ink-400">{item.orderId}</span>
                </td>
                <td className="py-2 pr-3">
                  <StatusBadge status={item.status} />
                  {item.paidAt ? (
                    <span className="tnum mt-1 block text-xs text-ink-500">
                      оплачен {formatDateTime(item.paidAt)}
                    </span>
                  ) : null}
                  {item.failureReason ? (
                    <span className="mt-1 block text-xs text-brand-700">{item.failureReason}</span>
                  ) : null}
                </td>
                <td className="tnum py-2 pr-3 text-ink-700">{item.itemCount ?? '—'}</td>
                <td className="tnum py-2 pr-3 whitespace-nowrap text-ink-900">
                  {formatMoney(item.totalMinor, item.currency)}
                </td>
                <td className="py-2">
                  <Button
                    variant={selected ? 'primary' : 'ghost'}
                    size="sm"
                    onClick={() => onOpen(item.orderId)}
                    aria-label={`Открыть заказ ${item.orderNumber}`}
                  >
                    {selected ? 'Открыт' : 'Открыть'}
                  </Button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/* ------------------------------------------------------------ сам раздел */

export default function OrdersSection({ role, canWrite }: AdminSectionProps) {
  // `section` не читаем: заголовок, описание и список эндпоинтов рисует оболочка.
  const [mode, setMode] = useState<OrderSearchMode>('number');
  const search = useIdSearch();

  const [source, setSource] = useState<ListSource>('platform');
  const [userId, setUserId] = useState('');
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(0);

  // Идентификатор пользователя набирают руками: без задержки каждая буква слала бы
  // отдельный запрос в аудируемую ручку, и в списке мигали бы чужие заказы.
  const debouncedUserId = useDebouncedValue(userId, 350);
  const trimmedUserId = debouncedUserId.trim();

  const platformQuery = useQuery({
    queryKey: ['admin', 'orders', 'support-list', { userId: trimmedUserId, status, page }],
    queryFn: () =>
      fetchSupportOrders({
        userId: trimmedUserId,
        status: statusFilterValue(status),
        page,
        size: PAGE_SIZE,
      }),
    placeholderData: (previous) => previous,
    enabled: source === 'platform',
  });

  const mineQuery = useQuery({
    queryKey: ['admin', 'orders', 'list', { status, page }],
    queryFn: () => fetchOrders({ page, size: PAGE_SIZE, status: statusFilterValue(status) }),
    placeholderData: (previous) => previous,
    enabled: source === 'mine',
  });

  /**
   * Числа для рейла статусов.
   *
   * Это шесть коротких запросов `?status=…&size=1`, у которых берётся
   * `Page.totalElements`: группировки по статусам у ручки нет, и «сколько заказов
   * в каждом статусе» сервис одним ответом не отдаёт. Каждый вызов аудируется, поэтому
   * запросы кэшируются на минуту.
   */
  const statusCountQueries = useQueries({
    queries: ORDER_STATUSES.map((value) => ({
      queryKey: ['admin', 'orders', 'status-count', { status: value, userId: trimmedUserId }],
      queryFn: () =>
        fetchSupportOrders({
          userId: trimmedUserId,
          status: value,
          page: 0,
          size: 1,
        }).then((page_) => page_.totalElements),
      enabled: source === 'platform',
      staleTime: 60_000,
      retry: 0,
    })),
  });

  const orderQuery = useQuery({
    queryKey: ['admin', 'orders', 'order', mode, search.submitted ?? 'none'],
    queryFn: () =>
      mode === 'id'
        ? fetchSupportOrder(search.submitted as string)
        : fetchSupportOrderByNumber(search.submitted as string),
    enabled: search.submitted !== null,
    retry: 0,
  });

  const order = orderQuery.data;
  const orderLoading = search.submitted !== null && orderQuery.isPending;

  const openOrder = (orderId: string) => {
    setMode('id');
    search.setValue(orderId);
    search.submit(orderId);
  };

  /**
   * Строки активного списка в одном формате.
   *
   * У общего `GET /api/v1/orders` в строке нет ни позиций, ни их числа, поэтому
   * `itemCount: null` — не ноль, а «сервис этого не сказал».
   */
  const rows: SupportOrderSummary[] = useMemo(() => {
    if (source === 'platform') {
      return platformQuery.data?.items ?? [];
    }
    return (mineQuery.data?.items ?? []).map((item: Order) => ({
      orderId: item.orderId,
      orderNumber: item.orderNumber,
      status: item.status,
      currency: item.currency,
      totalMinor: item.totalMinor,
      itemCount: null,
      failureReason: item.failureReason ?? null,
      createdAt: item.createdAt,
      paidAt: null,
    }));
  }, [source, platformQuery.data, mineQuery.data]);

  const activeQuery = source === 'platform' ? platformQuery : mineQuery;
  const activeLoading = activeQuery.isPending;
  const activeError = activeQuery.isError ? activeQuery.error : null;
  const serverTotal = activeQuery.data?.totalElements ?? null;

  const paidRows = rows.filter(isPaid);
  const unpaidRows = rows.filter((row) => !isPaid(row));
  const cancelledRows = rows.filter((row) => row.status === 'CANCELLED');
  const countedRows = rows.filter((row) => row.itemCount !== null);
  const withoutCount = rows.length - countedRows.length;
  const currency = rows[0]?.currency ?? 'KZT';
  const totalMinor = sumMinor(rows.map((row) => row.totalMinor));

  const refresh = () => {
    if (source === 'platform') {
      void platformQuery.refetch();
    } else {
      void mineQuery.refetch();
    }
  };

  const railItems = useMemo(
    () =>
      ORDER_STATUSES.map((value, index) => ({
        value,
        label: statusLabel(value),
        // Число появляется только тогда, когда сервер его действительно отдал.
        count: statusCountQueries[index]?.data,
      })),
    [statusCountQueries],
  );

  const csvRows = useMemo(
    () => [
      ['orderId', 'номер', 'статус', 'позиций', 'итого_minor', 'валюта', 'создан', 'оплачен'],
      ...rows.map((row) => [
        row.orderId,
        row.orderNumber,
        row.status,
        row.itemCount === null ? '' : String(row.itemCount),
        String(row.totalMinor),
        String(row.currency),
        row.createdAt,
        row.paidAt ?? '',
      ]),
    ],
    [rows],
  );

  return (
    <div className="space-y-4">
      <Alert tone="info" title="Раздел ничего не меняет">
        Все эндпоинты раздела — GET, изменяющих операций у support-API заказов нет: отмена заказа живёт в{' '}
        <Endpoint>OrderController</Endpoint> и через support-контроллер недоступна. Кнопок изменения здесь не
        будет ни у ADMIN, ни у SUPPORT
        {canWrite ? ' (роль ADMIN тоже ничего здесь не меняет)' : ''}. Вы вошли как {roleLabel(role)}.
      </Alert>

      <Toolbar
        right={
          <>
            <Button variant="secondary" size="sm" loading={activeQuery.isFetching} onClick={refresh}>
              Обновить
            </Button>
            <CsvButton rows={csvRows} name="заказы по текущему фильтру" />
          </>
        }
      >
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone="brand">{`заказов по фильтру: ${serverTotal ?? '—'}`}</Badge>
          <Badge tone={paidRows.length > 0 ? 'success' : 'neutral'}>{`оплачено на странице: ${paidRows.length}`}</Badge>
          <Badge tone={cancelledRows.length > 0 ? 'warning' : 'neutral'}>
            {`отменено на странице: ${cancelledRows.length}`}
          </Badge>
          <span className="text-xs text-ink-500">
            {source === 'platform'
              ? 'источник: /api/v1/support/orders (все заказы платформы)'
              : 'источник: /api/v1/orders (только заказы вызывающего)'}
          </span>
        </div>
      </Toolbar>

      {/* ------------------------------------------------------- плитки */}
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <KpiTile
          label="Заказов по фильтру"
          value={serverTotal ?? '—'}
          loading={activeLoading}
          tone="brand"
          icon={
            <Icon>
              <path d="M7 3h10a2 2 0 0 1 2 2v16l-3-2-2 2-2-2-2 2-3-2V5a2 2 0 0 1 2-2Z" />
              <path d="M9 8h6" />
              <path d="M9 12h6" />
            </Icon>
          }
          caption="счёт сервера: Page.totalElements для текущего фильтра"
        />
        <KpiTile
          label="Оплачено"
          value={rows.length === 0 ? '—' : paidRows.length}
          loading={activeLoading}
          tone="success"
          icon={
            <Icon>
              <circle cx="12" cy="12" r="8" />
              <path d="M9 12.5 11 15l4-5" />
            </Icon>
          }
          caption="по загруженной странице: статус PAID/CONFIRMED или непустой paidAt"
        />
        <KpiTile
          label="Не оплачено"
          value={rows.length === 0 ? '—' : unpaidRows.length}
          loading={activeLoading}
          tone={unpaidRows.length > 0 ? 'warning' : 'neutral'}
          icon={
            <Icon>
              <circle cx="12" cy="12" r="8" />
              <path d="M12 8v4.5" />
              <path d="M12 16h.01" />
            </Icon>
          }
          caption="остальные строки страницы: оплаты по ним сервис не подтвердил"
        />
        <KpiTile
          label="Сумма выборки"
          value={rows.length === 0 ? '—' : formatMoney(totalMinor, currency)}
          loading={activeLoading}
          tone="info"
          icon={
            <Icon>
              <rect x="3" y="6" width="18" height="13" rx="3" />
              <path d="M3 10h18" />
              <circle cx="16.5" cy="14.5" r="1" />
            </Icon>
          }
          caption={`сумма totalMinor по ${rows.length} строкам страницы`}
        />
        <KpiTile
          label="Отменённых"
          value={rows.length === 0 ? '—' : cancelledRows.length}
          loading={activeLoading}
          tone={cancelledRows.length > 0 ? 'warning' : 'neutral'}
          icon={
            <Icon>
              <circle cx="12" cy="12" r="8" />
              <path d="m9.5 9.5 5 5" />
              <path d="m14.5 9.5-5 5" />
            </Icon>
          }
          caption="статус CANCELLED по загруженной странице"
        />
        <KpiTile
          label="Позиций в выборке"
          value={rows.length === 0 ? '—' : sumMinor(countedRows.map((row) => row.itemCount ?? 0))}
          loading={activeLoading}
          tone="neutral"
          icon={
            <Icon>
              <path d="M4 6h16" />
              <path d="M4 12h16" />
              <path d="M4 18h10" />
            </Icon>
          }
          caption={
            withoutCount === 0
              ? 'сумма itemCount из строк support-списка'
              : `у ${withoutCount} строк счётчика нет: общий список позиций не отдаёт`
          }
        />
      </div>
      <p className="text-xs text-ink-500">
        «Заказов по фильтру» — серверный счёт; остальные числа посчитаны по загруженной странице (
        {rows.length} строк), а не по всей базе, и подписи говорят именно это.
      </p>

      {/* ---------------------------------------------- список и деталь */}
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)]">
        <Panel
          title="Заказы"
          subtitle={
            source === 'platform' ? (
              <>
                <Endpoint>GET /api/v1/support/orders</Endpoint> — фильтры по пользователю и статусу; без фильтров
                это постраничный обход всех заказов, и он аудируется
              </>
            ) : (
              <>
                <Endpoint>GET /api/v1/orders</Endpoint> — заказы вызывающего пользователя, фильтр только по
                статусу
              </>
            )
          }
          action={<SourceSwitch value={source} onChange={setSource} />}
          bodyClassName="space-y-3"
        >
          {source === 'platform' ? (
            <div className="grid gap-4 sm:grid-cols-[13rem_minmax(0,1fr)]">
              <div>
                <StatusRail
                  items={railItems}
                  active={status}
                  onSelect={(value) => {
                    setStatus(value);
                    setPage(0);
                  }}
                  allLabel="Все статусы"
                  allCount={serverTotal ?? undefined}
                  ariaLabel="Фильтр по статусу заказа"
                />
                <p className="mt-2 text-xs text-ink-500">
                  Числа серверные, но добыты шестью запросами <Endpoint>?status=…&amp;size=1</Endpoint>:
                  группировки по статусам у ручки нет. «—» значит, что ответ ещё не пришёл.
                </p>
              </div>

              <div className="space-y-3">
                <div className="w-full sm:w-72">
                  <TextField
                    id="admin-orders-user"
                    label="Пользователь (userId)"
                    placeholder="U-1001"
                    hint="Пустое поле — без фильтра по пользователю. Ввод задерживается на 350 мс: ручка аудируется."
                    value={userId}
                    onChange={(event) => {
                      setUserId(event.target.value);
                      setPage(0);
                    }}
                  />
                </div>
                <OrdersTableBody
                  rows={rows}
                  loading={activeLoading}
                  error={activeError}
                  onRetry={refresh}
                  selectedId={search.submitted}
                  onOpen={openOrder}
                  pagination={activeQuery.data}
                  isFetching={activeQuery.isFetching}
                  onPageChange={setPage}
                  emptyTitle={status === '' ? 'Заказов не найдено' : 'Заказов с таким статусом нет'}
                  emptyDescription={
                    userId.trim() === ''
                      ? 'Сервис вернул пустую страницу: заказов с такими фильтрами нет.'
                      : `У пользователя «${userId.trim()}» заказов с такими фильтрами нет.`
                  }
                />
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              <Alert tone="warning" title="Это не заказы всей платформы">
                <Endpoint>GET /api/v1/orders</Endpoint> отдаёт заказы того, кто его вызвал (
                <Endpoint>OrderController.list</Endpoint> →{' '}
                <Endpoint>orderQueryService.listOrders(callerUserId, …)</Endpoint>). У оператора в этом списке
                будут только его собственные заказы — чаще всего пусто. Заказы платформы отдаёт источник
                «Заказы платформы» выше. Ещё отличие: в строке этого списка нет ни позиций, ни их числа,
                поэтому в колонке «Позиций» стоит «—», а не ноль.
              </Alert>

              <div className="w-56">
                <SelectField
                  id="admin-orders-status"
                  label="Статус"
                  value={status}
                  placeholder="Все статусы"
                  options={STATUS_OPTIONS}
                  hint="Значения enum OrderStatus"
                  onChange={(event) => {
                    setStatus(event.target.value);
                    setPage(0);
                  }}
                />
              </div>

              <OrdersTableBody
                rows={rows}
                loading={activeLoading}
                error={activeError}
                onRetry={refresh}
                selectedId={search.submitted}
                onOpen={openOrder}
                pagination={activeQuery.data}
                isFetching={activeQuery.isFetching}
                onPageChange={setPage}
                emptyTitle={status === '' ? 'Заказов нет' : 'Заказов с таким статусом нет'}
                emptyDescription="Сервис вернул пустую страницу. Для оператора это ожидаемо: ручка показывает его собственные заказы."
              />
            </div>
          )}
        </Panel>

        <div className="space-y-4 xl:sticky xl:top-4 xl:self-start">
          <Panel
            title="Деталь заказа"
            subtitle="Номер клиент называет по телефону; идентификатор берётся из списка слева"
            bodyClassName="space-y-4"
          >
            <form
              className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]"
              onSubmit={(event) => {
                event.preventDefault();
                search.submit();
              }}
            >
              <SelectField
                id="admin-orders-mode"
                label="Что ищем"
                value={mode}
                options={ORDER_MODE_OPTIONS}
                onChange={(event) => {
                  setMode(event.target.value === 'id' ? 'id' : 'number');
                  search.setValue('');
                  search.submit('');
                }}
              />
              <TextField
                id="admin-orders-search"
                label={mode === 'id' ? 'Идентификатор заказа' : 'Номер заказа'}
                placeholder={mode === 'id' ? '01M3ORDER…' : 'ORD-100500'}
                hint="Запрос уходит по кнопке: пустое поле на сервер не ходит."
                value={search.value}
                onChange={(event) => search.setValue(event.target.value)}
              />
              <div className="sm:col-span-2">
                <Button type="submit" block>
                  Найти заказ
                </Button>
              </div>
            </form>

            {search.submitted === null ? (
              <EmptyState
                title="Заказ не выбран"
                description="Введите номер или идентификатор заказа либо откройте строку в списке слева. Оба чтения аудируются в order-service: кто и чей заказ открыл."
              />
            ) : null}

            {orderLoading ? <SkeletonRows count={4} /> : null}

            {orderQuery.isError && !orderLoading ? (
              isNotFound(orderQuery.error) ? (
                <EmptyState
                  title="Заказ не найден"
                  description={`order-service ответил 404 ORDER_NOT_FOUND по запросу «${search.submitted}». Проверьте номер: он приходит из чека или из списка слева.`}
                />
              ) : (
                <RequestError
                  label="Не удалось получить заказ"
                  error={orderQuery.error}
                  onRetry={() => void orderQuery.refetch()}
                />
              )
            ) : null}

            {order ? (
              <div className="space-y-4 rounded-card border border-ink-200 bg-ink-50/50 p-3">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <p className="text-base font-semibold text-ink-900">{`Заказ № ${order.orderNumber}`}</p>
                  <span className="tnum text-xs text-ink-500">
                    создан {formatDateTime(order.createdAt)} · обновлён {formatDateTime(order.updatedAt)}
                  </span>
                </div>
                <OrderCard order={order} />
              </div>
            ) : null}
          </Panel>

          {order ? <HistoryPanel orderId={order.orderId} /> : null}
          {order ? <PaymentPanel orderId={order.orderId} /> : null}
          {order ? <OrderReservationsPanel orderId={order.orderId} /> : null}
        </div>
      </div>

      <Panel title="Чего в API нет" subtitle="Чтобы не искать в интерфейсе то, чего сервис не отдаёт.">
        <div className="space-y-2 text-sm text-ink-600">
          <p>
            <strong className="text-ink-800">Список всех оплат заказа по REST недоступен.</strong>{' '}
            <Endpoint>GET /api/v1/payments/by-order/{'{orderId}'}</Endpoint> отдаёт одну рассчитанную оплату;{' '}
            <Endpoint>byOrderAll</Endpoint> (все оплаты-по-мерчантам) остался внутренним. Полный список оплат
            виден только внутри самого заказа — в блоке «Оплаты по мерчантам».
          </p>
          <p>
            <strong className="text-ink-800">Мутаций нет вообще.</strong> Ни отмены, ни возврата, ни повторной
            оплаты из support-API заказов не сделать: возврат — операция раздела «Платежи и возвраты» (и только
            для ADMIN).
          </p>
          <p>
            <strong className="text-ink-800">
              Статусы — только шесть из <Endpoint>OrderStatus</Endpoint>
            </strong>{' '}
            (DRAFT, PENDING_PAYMENT, PAID, CONFIRMED, CANCELLED, FAILED). Статусов доставки (
            <Endpoint>SHIPPED</Endpoint>, <Endpoint>DELIVERED</Endpoint>) в order-service нет, поэтому в фильтре
            и в рейле их нет: сервис ответил бы 400.
          </p>
          <p>
            <strong className="text-ink-800">`itemCount` есть не в каждой строке списка.</strong> У{' '}
            <Endpoint>/api/v1/support/orders</Endpoint> счётчик позиций приходит, у общего{' '}
            <Endpoint>/api/v1/orders</Endpoint> — нет, поэтому в плитке «Позиций в выборке» такие строки
            посчитаны отдельно, а в колонке «Позиций» стоит «—».
          </p>
        </div>
      </Panel>
    </div>
  );
}

/** Тело списка: загрузка, ошибка, пустое состояние, таблица и пагинация. */
function OrdersTableBody({
  rows,
  loading,
  error,
  onRetry,
  selectedId,
  onOpen,
  pagination,
  isFetching,
  onPageChange,
  emptyTitle,
  emptyDescription,
}: {
  rows: SupportOrderSummary[];
  loading: boolean;
  error: unknown;
  onRetry: () => void;
  selectedId: string | null;
  onOpen: (orderId: string) => void;
  pagination: { page: number; totalPages: number; hasNext: boolean; totalElements: number } | undefined;
  isFetching: boolean;
  onPageChange: (page: number) => void;
  emptyTitle: string;
  emptyDescription: string;
}) {
  return (
    <>
      {loading ? <SkeletonRows count={4} /> : null}

      {error !== null && !loading ? (
        <RequestError label="Не удалось загрузить заказы" error={error} onRetry={onRetry} />
      ) : null}

      {!loading && error === null && rows.length === 0 ? (
        <EmptyState title={emptyTitle} description={emptyDescription} />
      ) : null}

      {rows.length > 0 ? <SummaryTable items={rows} selectedId={selectedId} onOpen={onOpen} /> : null}

      {pagination ? (
        <Pagination
          page={pagination.page}
          totalPages={pagination.totalPages}
          hasNext={pagination.hasNext}
          totalElements={pagination.totalElements}
          isFetching={isFetching}
          onPageChange={onPageChange}
        />
      ) : null}
    </>
  );
}
