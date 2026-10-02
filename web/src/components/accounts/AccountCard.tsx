import type { ReactNode } from 'react';
import { formatMoney } from '../../api/money';
import type { Account } from '../../api/types';
import { cx } from '../../lib/cx';
import { accountTypeLabel, formatDate } from '../../lib/format';
import { Badge } from '../ui/Badge';
import { Card } from '../ui/Card';
import { WalletIcon } from '../layout/icons';

/** Balance card: total, reserved and available, in one glance. */
export function AccountCard({
  account,
  children,
  className,
}: {
  account: Account;
  children?: ReactNode;
  className?: string;
}) {
  return (
    <Card as="article" className={cx('overflow-hidden', className)}>
      <div className="flex items-start justify-between gap-3 p-4">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium text-ink-900">
            {account.displayName || accountTypeLabel(account.type)}
          </p>
          <p className="mt-0.5 flex items-center gap-2 text-xs text-ink-500">
            <WalletIcon className="h-3.5 w-3.5" />
            {accountTypeLabel(account.type)} · {account.currency} · открыт {formatDate(account.createdAt)}
          </p>
        </div>
        {account.status !== 'ACTIVE' ? <Badge tone="warning">{account.status}</Badge> : null}
      </div>

      <div className="bg-ink-50 px-4 py-3">
        <p className="text-xs uppercase tracking-wide text-ink-500">Доступно</p>
        <p className="tnum text-2xl font-semibold text-ink-900">
          {formatMoney(account.availableMinor, account.currency)}
        </p>
        <dl className="mt-2 grid grid-cols-2 gap-2 text-xs text-ink-600">
          <div>
            <dt>Баланс</dt>
            <dd className="tnum font-medium text-ink-800">
              {formatMoney(account.balanceMinor, account.currency)}
            </dd>
          </div>
          <div>
            <dt>Зарезервировано</dt>
            <dd className="tnum font-medium text-ink-800">
              {formatMoney(account.heldMinor, account.currency)}
            </dd>
          </div>
        </dl>
      </div>

      {children ? <div className="border-t border-ink-100 p-4">{children}</div> : null}
    </Card>
  );
}
