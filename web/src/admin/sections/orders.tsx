/**
 * Раздел админ-панели «Заказы».
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
 *  - `GET /api/v1/orders?page&size&status` — общий список (`fetchOrders`).
 *
 * Ни одной мутации у support-эндпоинтов нет: отмена заказа живёт в `OrderController`
 * и через support-контроллер недоступна, поэтому кнопок изменения в разделе нет.
 */
import { useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { fetchOrders } from '../../api/endpoints';
import { isApiError } from '../../api/errors';
import { formatMoney } from '../../api/money';
import type { Order } from '../../api/types';
import { Alert, ErrorAlert } from '../../components/ui/Alerts';
import { Badge, StatusBadge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { Card, CardBody, CardHeader, DetailRow } from '../../components/ui/Card';
import { CopyButton } from '../../components/ui/CopyButton';
import { EmptyState } from '../../components/ui/EmptyState';
import { SelectField, TextField, type SelectOption } from '../../components/ui/Field';
import { Pagination } from '../../components/ui/Pagination';
import { SkeletonRows } from '../../components/ui/Skeleton';
import { Timeline, type TimelineEntry } from '../../components/ui/Timeline';
import { useDebouncedValue } from '../../hooks/useDebouncedValue';
import { formatDateTime, roleLabel, statusLabel } from '../../lib/format';
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
const STATUS_OPTIONS: SelectOption[] = [
  'DRAFT',
  'PENDING_PAYMENT',
  'PAID',
  'CONFIRMED',
  'CANCELLED',
  'FAILED',
].map((value) => ({ value, label: statusLabel(value) }));

type OrderSearchMode = 'number' | 'id';

const ORDER_MODE_OPTIONS: SelectOption[] = [
  { value: 'number', label: 'По номеру заказа' },
  { value: 'id', label: 'По идентификатору заказа' },
];

function isNotFound(error: unknown): boolean {
  return isApiError(error) && error.isNotFound;
}

/**
 * Путь эндпоинта внутри текста: моноширинно и без обратных кавычек, которые
 * иначе попадали бы на экран как есть.
 */
function Endpoint({ children }: { children: ReactNode }) {
  return <code className="font-mono text-xs">{children}</code>;
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

function statusFilterValue(status: string): string | undefined {
  return status === '' ? undefined : status;
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
    <div className="overflow-x-auto">
      <table className="w-full min-w-[44rem] border-collapse text-sm">
        <caption className="sr-only">Позиции заказа</caption>
        <thead>
          <tr className="border-b border-ink-200 text-left text-xs text-ink-500">
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
              <tr key={item.orderItemId ?? item.id ?? `${item.productId}-${index}`} className="border-b border-ink-100">
                <td className="py-2 pr-3 text-ink-900">{item.title}</td>
                <td className="py-2 pr-3 font-mono text-xs text-ink-600">{item.productId}</td>
                <td className="py-2 pr-3 font-mono text-xs text-ink-600">{item.merchantId ?? '—'}</td>
                <td className="tnum py-2 pr-3 text-ink-900">{item.quantity}</td>
                <td className="tnum py-2 pr-3 text-ink-700">{formatMoney(item.priceMinor, currency)}</td>
                <td className="tnum py-2 text-ink-900">{formatMoney(item.totalMinor ?? 0, currency)}</td>
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
      <p className="text-sm text-ink-500">
        В ответе заказа нет ни одной оплаты: он ещё не дошёл до шага оплаты.
      </p>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[40rem] border-collapse text-sm">
        <caption className="sr-only">Оплаты заказа по мерчантам</caption>
        <thead>
          <tr className="border-b border-ink-200 text-left text-xs text-ink-500">
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
            <tr key={payment.paymentId ?? `${payment.merchantId ?? 'merchant'}-${index}`} className="border-b border-ink-100">
              <td className="py-2 pr-3 font-mono text-xs text-ink-600">{payment.merchantId ?? '—'}</td>
              <td className="py-2 pr-3 font-mono text-xs text-ink-600">{payment.paymentId ?? 'ещё не создана'}</td>
              <td className="py-2 pr-3">
                {payment.status ? <StatusBadge status={payment.status} /> : <span className="text-ink-500">—</span>}
              </td>
              <td className="tnum py-2 pr-3 text-ink-700">{formatMoney(payment.amountMinor, payment.currency)}</td>
              <td className="tnum py-2 pr-3 text-ink-700">{formatMoney(payment.feeMinor, payment.currency)}</td>
              <td className="tnum py-2 text-ink-900">{formatMoney(payment.totalMinor, payment.currency)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function OrderCard({ order }: { order: SupportOrder }) {
  return (
    <Card>
      <CardHeader
        title={`Заказ № ${order.orderNumber}`}
        subtitle={`Создан ${formatDateTime(order.createdAt)} · обновлён ${formatDateTime(order.updatedAt)}`}
        action={<StatusBadge status={order.status} />}
      />
      <CardBody className="space-y-4">
        {order.failureReason ? (
          <Alert tone="danger" title="Заказ с ошибкой">
            {order.failureReason}
          </Alert>
        ) : null}

        <div className="flex flex-wrap items-center gap-2">
          {order.sagaState ? <Badge tone="info">{`сага: ${order.sagaState}`}</Badge> : null}
          {order.paymentStatus ? <Badge tone="neutral">{`оплата: ${statusLabel(order.paymentStatus)}`}</Badge> : null}
          <Badge tone="neutral">{`позиций: ${order.itemCount}`}</Badge>
        </div>

        <dl>
          <DetailRow label="Идентификатор">
            <span className="inline-flex items-center gap-1 font-mono text-xs">
              {order.orderId}
              <CopyButton value={order.orderId} />
            </span>
          </DetailRow>
          <DetailRow label="Адрес доставки">{order.deliveryAddress || '—'}</DetailRow>
          <DetailRow label="Телефон">{order.contactPhone || '—'}</DetailRow>
          <DetailRow label="Комментарий">{order.comment ?? '—'}</DetailRow>
          <DetailRow label="Оплачен">{formatDateTime(order.paidAt)}</DetailRow>
        </dl>

        <div className="rounded-card border border-ink-200 p-4">
          <p className="mb-2 text-sm font-semibold text-ink-900">Суммы</p>
          <dl>
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
            <p className="text-sm text-ink-500">Сервис не вернул ни одной позиции по этому заказу.</p>
          ) : (
            <ItemsTable order={order} />
          )}
        </div>

        <div>
          <p className="mb-2 text-sm font-semibold text-ink-900">Оплаты по мерчантам</p>
          <OrderPaymentsTable order={order} />
        </div>
      </CardBody>
    </Card>
  );
}

/* ------------------------------------------------------------- история */

function HistoryCard({ orderId }: { orderId: string }) {
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
    <Card>
      <CardHeader
        title="История переходов"
        subtitle={
          <>
            <Endpoint>GET /api/v1/support/orders/{'{id}'}/history</Endpoint> — от старых к новым, с автором
            и причиной
          </>
        }
      />
      <CardBody>
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
      </CardBody>
    </Card>
  );
}

/* -------------------------------------------------------------- оплата */

function PaymentCard({ orderId }: { orderId: string }) {
  const query = useQuery({
    queryKey: ['admin', 'orders', orderId, 'payment'],
    queryFn: () => fetchPaymentByOrder(orderId),
    retry: 0,
  });

  const payment: SupportPayment | undefined = query.data;

  return (
    <Card>
      <CardHeader
        title="Платёж по заказу"
        subtitle={
          <>
            <Endpoint>GET /api/v1/payments/by-order/{'{orderId}'}</Endpoint> — рассчитанная оплата заказа;
            404 означает, что заказ не платили
          </>
        }
        action={payment ? <StatusBadge status={payment.status} /> : null}
      />
      <CardBody>
        {query.isPending ? <SkeletonRows count={3} /> : null}

        {query.isError ? (
          isNotFound(query.error) ? (
            <EmptyState
              title="Заказ никогда не был оплачен"
              description="payment-service ответил 404 PAYMENT_NOT_FOUND: по этому заказу нет ни одной рассчитанной оплаты. Если оплата ожидалась, сравните это с историей переходов выше."
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
            <dl>
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
              <Alert className="mt-3" tone="danger" title={`Оплата не прошла${payment.failureCode ? ` (${payment.failureCode})` : ''}`}>
                {payment.failureReason}
              </Alert>
            ) : null}
          </>
        ) : null}
      </CardBody>
    </Card>
  );
}

/* ------------------------------------------------------ резервы стока */

function OrderReservationsCard({ orderId }: { orderId: string }) {
  const query = useQuery({
    queryKey: ['admin', 'orders', orderId, 'reservations'],
    queryFn: () => fetchSupportReservations(orderId),
    retry: 0,
  });

  const reservations: SupportReservation[] = query.data ?? [];

  return (
    <Card>
      <CardHeader
        title="Резервы стока по заказу"
        subtitle={
          <>
            <Endpoint>GET /api/v1/support/reservations/{'{orderId}'}</Endpoint> — что каталог держит под
            этот заказ
          </>
        }
      />
      <CardBody>
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
          <div className="overflow-x-auto">
            <table className="w-full min-w-[36rem] border-collapse text-sm">
              <thead>
                <tr className="border-b border-ink-200 text-left text-xs text-ink-500">
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
                    <td className="tnum py-2 pr-3 text-ink-700">{formatDateTime(reservation.createdAt)}</td>
                    <td className="tnum py-2 text-ink-700">{formatDateTime(reservation.expiresAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </CardBody>
    </Card>
  );
}

/* ------------------------------------------------------ список заказов */

function SummaryRows({
  items,
  totalMinorOf,
  onOpen,
  emptyTitle,
  emptyDescription,
}: {
  items: SupportOrderSummary[];
  totalMinorOf: (item: SupportOrderSummary) => string;
  onOpen: (orderId: string) => void;
  emptyTitle: string;
  emptyDescription: string;
}) {
  if (items.length === 0) {
    return <EmptyState title={emptyTitle} description={emptyDescription} />;
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[46rem] border-collapse text-sm">
        <thead>
          <tr className="border-b border-ink-200 text-left text-xs text-ink-500">
            <th scope="col" className="py-2 pr-3 font-medium">Номер</th>
            <th scope="col" className="py-2 pr-3 font-medium">Создан</th>
            <th scope="col" className="py-2 pr-3 font-medium">Статус</th>
            <th scope="col" className="py-2 pr-3 font-medium">Позиций</th>
            <th scope="col" className="py-2 pr-3 font-medium">Итого</th>
            <th scope="col" className="py-2 font-medium">Карточка</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item) => (
            <tr key={item.orderId} className="border-b border-ink-100">
              <td className="py-2 pr-3">
                <span className="block text-ink-900">{item.orderNumber}</span>
                <span className="font-mono text-xs text-ink-500">{item.orderId}</span>
              </td>
              <td className="tnum py-2 pr-3 text-ink-700">{formatDateTime(item.createdAt)}</td>
              <td className="py-2 pr-3">
                <StatusBadge status={item.status} />
                {item.failureReason ? (
                  <span className="mt-1 block text-xs text-brand-700">{item.failureReason}</span>
                ) : null}
              </td>
              <td className="tnum py-2 pr-3 text-ink-700">{item.itemCount ?? '—'}</td>
              <td className="tnum py-2 pr-3 text-ink-900">{totalMinorOf(item)}</td>
              <td className="py-2">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => onOpen(item.orderId)}
                  aria-label={`Открыть заказ ${item.orderNumber}`}
                >
                  Открыть
                </Button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Заказы вызывающего пользователя (`OrderController.list` → `GET /api/v1/orders`). */
function RecentOrdersCard({ onOpen }: { onOpen: (orderId: string) => void }) {
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(0);

  const query = useQuery({
    queryKey: ['admin', 'orders', 'list', { status, page }],
    queryFn: () => fetchOrders({ page, size: PAGE_SIZE, status: statusFilterValue(status) }),
    placeholderData: (previous) => previous,
  });

  const data = query.data;
  // В строке списка `GET /api/v1/orders` нет ни позиций, ни счётчика: ставить туда «0»
  // значило бы утверждать, что в заказе нет товаров. Поэтому «—», а не ноль.
  const rows: SupportOrderSummary[] = (data?.items ?? []).map((order: Order) => ({
    orderId: order.orderId,
    orderNumber: order.orderNumber,
    status: order.status,
    currency: order.currency,
    totalMinor: order.totalMinor,
    itemCount: null,
    failureReason: order.failureReason ?? null,
    createdAt: order.createdAt,
    paidAt: null,
  }));

  return (
    <Card>
      <CardHeader
        title="Последние заказы (общий список)"
        subtitle={
          <>
            <Endpoint>GET /api/v1/orders</Endpoint> с пагинацией и фильтром по статусу
          </>
        }
        action={
          <div className="w-48">
            <SelectField
              id="admin-orders-status"
              label="Статус"
              value={status}
              placeholder="Все статусы"
              options={STATUS_OPTIONS}
              onChange={(event) => {
                setStatus(event.target.value);
                setPage(0);
              }}
            />
          </div>
        }
      />
      <CardBody className="space-y-3">
        <Alert tone="warning" title="Это не заказы всей платформы">
          <Endpoint>GET /api/v1/orders</Endpoint> отдаёт заказы того, кто его вызвал (
          <Endpoint>OrderController.list</Endpoint> → <Endpoint>orderQueryService.listOrders(callerUserId, …)</Endpoint>
          ). У оператора в этом списке будут только его собственные заказы — чаще всего пусто. Заказы
          платформы отдаёт support-ручка ниже. Ещё отличие: в строке этого списка нет ни позиций, ни их
          числа, поэтому в колонке «Позиций» стоит «—», а не ноль.
        </Alert>

        {query.isPending ? <SkeletonRows count={4} /> : null}

        {query.isError ? (
          <RequestError
            label="Не удалось загрузить заказы"
            error={query.error}
            onRetry={() => void query.refetch()}
          />
        ) : null}

        {data ? (
          <>
            <SummaryRows
              items={rows}
              totalMinorOf={(item) => formatMoney(item.totalMinor, item.currency)}
              onOpen={onOpen}
              emptyTitle={status === '' ? 'Заказов нет' : 'Заказов с таким статусом нет'}
              emptyDescription="Сервис вернул пустую страницу. Для оператора это ожидаемо: ручка показывает его собственные заказы."
            />
            <Pagination
              page={data.page}
              totalPages={data.totalPages}
              hasNext={data.hasNext}
              totalElements={data.totalElements}
              isFetching={query.isFetching}
              onPageChange={setPage}
            />
          </>
        ) : null}
      </CardBody>
    </Card>
  );
}

/** Заказы платформы по пользователю и статусу (`SupportOrderController.list`). */
function SupportOrdersCard({ onOpen }: { onOpen: (orderId: string) => void }) {
  const [userId, setUserId] = useState('');
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(0);

  // Идентификатор пользователя набирают руками: без задержки каждая буква слала бы
  // отдельный запрос в аудируемую ручку, и в списке мигали бы чужие заказы.
  const debouncedUserId = useDebouncedValue(userId, 350);

  const query = useQuery({
    queryKey: ['admin', 'orders', 'support-list', { userId: debouncedUserId.trim(), status, page }],
    queryFn: () =>
      fetchSupportOrders({
        userId: debouncedUserId.trim(),
        status: statusFilterValue(status),
        page,
        size: PAGE_SIZE,
      }),
    placeholderData: (previous) => previous,
  });

  const data = query.data;

  return (
    <Card>
      <CardHeader
        title="Заказы платформы"
        subtitle={
          <>
            <Endpoint>GET /api/v1/support/orders</Endpoint> — фильтры по пользователю и статусу; без
            фильтров это постраничный обход всех заказов, и он аудируется
          </>
        }
      />
      <CardBody className="space-y-3">
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          <TextField
            id="admin-orders-user"
            label="Пользователь (userId)"
            placeholder="U-1001"
            hint="Пустое поле — без фильтра по пользователю."
            value={userId}
            onChange={(event) => {
              setUserId(event.target.value);
              setPage(0);
            }}
          />
          <SelectField
            id="admin-orders-support-status"
            label="Статус"
            value={status}
            placeholder="Все статусы"
            options={STATUS_OPTIONS}
            onChange={(event) => {
              setStatus(event.target.value);
              setPage(0);
            }}
          />
        </div>

        {query.isPending ? <SkeletonRows count={4} /> : null}

        {query.isError ? (
          <RequestError
            label="Не удалось загрузить заказы платформы"
            error={query.error}
            onRetry={() => void query.refetch()}
          />
        ) : null}

        {data ? (
          <>
            <SummaryRows
              items={data.items}
              totalMinorOf={(item) => formatMoney(item.totalMinor, item.currency)}
              onOpen={onOpen}
              emptyTitle="Заказов не найдено"
              emptyDescription={
                userId.trim() === ''
                  ? 'Сервис вернул пустую страницу: заказов с такими фильтрами нет.'
                  : `У пользователя «${userId.trim()}» заказов с такими фильтрами нет.`
              }
            />
            <Pagination
              page={data.page}
              totalPages={data.totalPages}
              hasNext={data.hasNext}
              totalElements={data.totalElements}
              isFetching={query.isFetching}
              onPageChange={setPage}
            />
          </>
        ) : null}
      </CardBody>
    </Card>
  );
}

/* -------------------------------------------------------------- раздел */

export default function OrdersSection({ role, canWrite }: AdminSectionProps) {
  // `section` не читаем: заголовок, описание и список эндпоинтов рисует оболочка.
  const [mode, setMode] = useState<OrderSearchMode>('number');
  const search = useIdSearch();

  const orderQuery = useQuery({
    queryKey: ['admin', 'orders', 'order', mode, search.submitted ?? 'none'],
    queryFn: () =>
      mode === 'id'
        ? fetchSupportOrder(search.submitted as string)
        : fetchSupportOrderByNumber(search.submitted as string),
    enabled: search.submitted !== null,
    retry: 0,
  });

  const loading = search.submitted !== null && orderQuery.isPending;
  const order = orderQuery.data;
  const openOrder = (orderId: string) => {
    setMode('id');
    search.setValue(orderId);
    search.submit(orderId);
  };

  return (
    <div className="space-y-4">
      <Alert tone="info" title="Раздел ничего не меняет">
        Все эндпоинты раздела — GET, изменяющих операций у support-API заказов нет: отмена заказа живёт в{' '}
        <Endpoint>OrderController</Endpoint> и через support-контроллер недоступна. Кнопок изменения здесь
        не будет ни у ADMIN, ни у SUPPORT
        {canWrite ? ' (роль ADMIN тоже ничего здесь не меняет)' : ''}. Вы вошли как {roleLabel(role)}.
      </Alert>

      <Card>
        <CardHeader
          title="Найти заказ"
          subtitle="Номер клиент называет по телефону; идентификатор берётся из списка ниже"
        />
        <CardBody className="space-y-4">
          <form
            className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] sm:items-end"
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
            <Button type="submit">Найти заказ</Button>
          </form>

          {search.submitted === null ? (
            <p className="text-sm text-ink-500">
              Введите номер или идентификатор заказа. Оба чтения аудируются в order-service: кто и чей
              заказ открыл.
            </p>
          ) : null}

          {loading ? <SkeletonRows count={4} /> : null}

          {orderQuery.isError && !loading ? (
            isNotFound(orderQuery.error) ? (
              <EmptyState
                title="Заказ не найден"
                description={`order-service ответил 404 ORDER_NOT_FOUND по запросу «${search.submitted}». Проверьте номер: он приходит из чека или из списка ниже.`}
              />
            ) : (
              <RequestError
                label="Не удалось получить заказ"
                error={orderQuery.error}
                onRetry={() => void orderQuery.refetch()}
              />
            )
          ) : null}
        </CardBody>
      </Card>

      {order ? (
        <>
          <OrderCard order={order} />
          <HistoryCard orderId={order.orderId} />
          <PaymentCard orderId={order.orderId} />
          <OrderReservationsCard orderId={order.orderId} />
        </>
      ) : null}

      <RecentOrdersCard onOpen={openOrder} />
      <SupportOrdersCard onOpen={openOrder} />

      <Card>
        <CardHeader title="Чего в API нет" subtitle="Чтобы не искать в интерфейсе то, чего сервис не отдаёт." />
        <CardBody className="space-y-2 text-sm text-ink-600">
          <p>
            <strong className="text-ink-800">Список всех оплат заказа по REST недоступен.</strong>{' '}
            <Endpoint>GET /api/v1/payments/by-order/{'{orderId}'}</Endpoint> отдаёт одну рассчитанную
            оплату; <Endpoint>byOrderAll</Endpoint> (все оплаты-по-мерчантам) остался внутренним. Полный
            список оплат виден только внутри самого заказа — в блоке «Оплаты по мерчантам».
          </p>
          <p>
            <strong className="text-ink-800">Мутаций нет вообще.</strong> Ни отмены, ни возврата, ни
            повторной оплаты из support-API заказов не сделать: возврат — операция раздела «Платежи и
            возвраты» (и только для ADMIN).
          </p>
          <p>
            <strong className="text-ink-800">
              Статусы — только шесть из <Endpoint>OrderStatus</Endpoint>
            </strong>{' '}
            (DRAFT, PENDING_PAYMENT, PAID, CONFIRMED, CANCELLED, FAILED). Статусов доставки (
            <Endpoint>SHIPPED</Endpoint>, <Endpoint>DELIVERED</Endpoint>) в order-service нет, поэтому в
            фильтре их нет: сервис ответил бы 400.
          </p>
        </CardBody>
      </Card>
    </div>
  );
}
