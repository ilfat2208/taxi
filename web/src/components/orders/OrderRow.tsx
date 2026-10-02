import { Link } from 'react-router-dom';
import { formatMoney } from '../../api/money';
import type { Order } from '../../api/types';
import { formatDateTime, shortId } from '../../lib/format';
import { StatusBadge } from '../ui/Badge';
import { Card } from '../ui/Card';

/** One order row in the orders list. */
export function OrderRow({ order }: { order: Order }) {
  const itemsCount = order.items.reduce((count, item) => count + item.quantity, 0);

  return (
    <Card as="li" className="transition-shadow hover:shadow-md">
      <Link to={`/orders/${order.orderId}`} className="flex items-center gap-3 p-4">
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-ink-900">Заказ № {order.orderNumber}</p>
          <p className="mt-0.5 text-xs text-ink-500">
            {formatDateTime(order.createdAt)} · позиций: {itemsCount}
          </p>
          <p className="mt-0.5 truncate text-xs text-ink-400">
            {order.deliveryAddress || 'адрес не указан'} · ID {shortId(order.orderId, 12)}
          </p>
        </div>

        <div className="shrink-0 text-right">
          <p className="tnum text-sm font-semibold text-ink-900">
            {formatMoney(order.totalMinor, order.currency)}
          </p>
          <div className="mt-1 flex justify-end">
            <StatusBadge status={order.status} />
          </div>
        </div>
      </Link>
    </Card>
  );
}
