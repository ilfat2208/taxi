import type { ReactNode } from 'react';
import { cx } from '../../lib/cx';

/** "Nothing here yet" panel: every list needs one instead of a blank screen. */
export function EmptyState({
  title,
  description,
  action,
  icon,
  className,
}: {
  title: string;
  description?: ReactNode;
  action?: ReactNode;
  icon?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cx(
        'flex flex-col items-center justify-center gap-2 rounded-card border border-dashed border-ink-200 bg-white px-6 py-10 text-center',
        className,
      )}
    >
      {icon ? <div className="text-3xl text-ink-300">{icon}</div> : null}
      <p className="text-base font-semibold text-ink-800">{title}</p>
      {description ? <p className="max-w-prose text-sm text-ink-500">{description}</p> : null}
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  );
}
