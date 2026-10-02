import { Link } from 'react-router-dom';
import { formatMoney } from '../../api/money';
import type { Payment } from '../../api/types';
import { formatDateTime, paymentTypeLabel, shortId } from '../../lib/format';
import { StatusBadge } from '../ui/Badge';
import { Card } from '../ui/Card';

/** One payment row: what it was, how much, where it stands. */
export function PaymentRow({ payment }: { payment: Payment }) {
  return (
    <Card as="li" className="transition-shadow hover:shadow-md">
      <Link to={`/payments/${payment.paymentId}`} className="flex items-center gap-3 p-4">
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-ink-900">
            {payment.description || paymentTypeLabel(payment.type)}
          </p>
          <p className="mt-0.5 text-xs text-ink-500">
            № {payment.paymentNumber} · {formatDateTime(payment.createdAt)}
          </p>
          <p className="mt-0.5 text-xs text-ink-400">ID {shortId(payment.paymentId, 12)}</p>
        </div>

        <div className="shrink-0 text-right">
          <p className="tnum text-sm font-semibold text-ink-900">
            {formatMoney(payment.amountMinor, payment.currency)}
          </p>
          <div className="mt-1 flex justify-end">
            <StatusBadge status={payment.status} />
          </div>
        </div>
      </Link>
    </Card>
  );
}
