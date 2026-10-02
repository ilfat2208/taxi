import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { cx } from '../../lib/cx';

/** Page title block with an optional back link and trailing actions. */
export function PageHeader({
  title,
  subtitle,
  backTo,
  backLabel = 'Назад',
  actions,
  className,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  backTo?: string;
  backLabel?: string;
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cx('mb-4 flex flex-wrap items-end justify-between gap-3', className)}>
      <div className="min-w-0">
        {backTo ? (
          <Link to={backTo} className="mb-1 inline-block text-sm text-ink-500 hover:text-brand-600">
            ← {backLabel}
          </Link>
        ) : null}
        <h1 className="text-xl font-semibold text-ink-900 sm:text-2xl">{title}</h1>
        {subtitle ? <p className="mt-1 text-sm text-ink-500">{subtitle}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}
