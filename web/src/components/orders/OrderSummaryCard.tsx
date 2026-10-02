import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { formatMoney } from '../../api/money';
import type { Order } from '../../api/types';
import { formatDateTime } from '../../lib/format';
import { buttonClass } from '../ui/Button';
import { Card, CardBody, CardFooter, CardHeader, DetailRow } from '../ui/Card';
import { StatusBadge } from '../ui/Badge';
import { Timeline, type TimelineEntry } from '../ui/Timeline';
import { ORDER_POLL_INTERVAL_MS, POLLED_ORDER_STATUSES } from '../../hooks/useOrders';

/** Status history in the shape the shared timeline expects. */
export function orderTimelineEntries(order: Order): TimelineEntry[] {
  return order.statusHistory.map((entry, index) => ({
    key: `${entry.toStatus ?? entry.status ?? 'status'}-${entry.createdAt ?? index}`,
    status: entry.toStatus ?? entry.status ?? 'UNKNOWN',
    time: entry.createdAt ?? entry.changedAt ?? entry.occurredAt ?? null,
    note: entry.comment ?? entry.reason ?? null,
  }));
}

/**
 * Order summary used both on the order page and right after checkout.
 *
 * `compact` keeps the checkout confirmation short (status + number + total), while
 * the full variant renders items and the state timeline.
 */
export function OrderSummaryCard({
  order,
  compact = false,
  note,
  children,
}: {
  order: Order;
  compact?: boolean;
  note?: string;
  children?: ReactNode;
}) {
  const isPending = POLLED_ORDER_STATUSES.includes(order.status);

  return (
    <Card>
      <CardHeader
        title={`Заказ № ${order.orderNumber}`}
        subtitle={
          <>
            {formatDateTime(order.createdAt)}
            {isPending ? ` · статус обновляется каждые ${ORDER_POLL_INTERVAL_MS / 1000} с` : ''}
          </>
        }
        action={<StatusBadge status={order.status} />}
      />

      <CardBody className="space-y-3">
        {note ? <p className="text-sm text-ink-600">{note}</p> : null}

        <div>
          <DetailRow label="Сумма товаров">
            <span className="tnum">{formatMoney(order.itemsTotalMinor, order.currency)}</span>
          </DetailRow>
          <DetailRow label="Доставка">
            <span className="tnum">{formatMoney(order.deliveryMinor, order.currency)}</span>
          </DetailRow>
          <DetailRow label="Итого">
            <span className="tnum text-base">{formatMoney(order.totalMinor, order.currency)}</span>
          </DetailRow>
        </div>

        <div className="text-sm">
          <p className="text-ink-500">Адрес доставки</p>
          <p className="text-ink-900">{order.deliveryAddress || '—'}</p>
          <p className="mt-1 text-ink-500">Контактный телефон: {order.contactPhone || '—'}</p>
          {order.comment ? <p className="mt-1 text-ink-600">Комментарий: {order.comment}</p> : null}
        </div>

        {order.failureReason ? (
          <p className="rounded-xl bg-brand-50 p-3 text-sm text-brand-800">
            Причина ошибки: {order.failureReason}
          </p>
        ) : null}

        {!compact && order.items.length > 0 ? (
          <ul className="divide-y divide-ink-100">
            {order.items.map((item, index) => (
              <li key={item.orderItemId ?? item.id ?? `${item.productId}-${index}`} className="flex items-center justify-between gap-3 py-2 text-sm">
                <span className="min-w-0">
                  <span className="block truncate text-ink-900">{item.title}</span>
                  <span className="block text-xs text-ink-500">
                    {item.quantity} × {formatMoney(item.priceMinor, item.currency ?? order.currency)}
                  </span>
                </span>
                <span className="tnum shrink-0 text-ink-900">
                  {formatMoney(item.totalMinor ?? 0, item.currency ?? order.currency)}
                </span>
              </li>
            ))}
          </ul>
        ) : null}

        {!compact ? <Timeline entries={orderTimelineEntries(order)} /> : null}
      </CardBody>

      <CardFooter>
        <Link to={`/orders/${order.orderId}`} className={buttonClass({ variant: 'secondary', size: 'sm' })}>
          Открыть заказ
        </Link>
        {children}
      </CardFooter>
    </Card>
  );
}
