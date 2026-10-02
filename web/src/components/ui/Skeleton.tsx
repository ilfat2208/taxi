import { cx } from '../../lib/cx';

/** Shimmering placeholder; `aria-hidden` so screen readers skip the noise. */
export function Skeleton({ className }: { className?: string }) {
  return <span aria-hidden="true" className={cx('block animate-pulse rounded-md bg-ink-200', className)} />;
}

export function SkeletonText({ lines = 3, className }: { lines?: number; className?: string }) {
  return (
    <span className={cx('block space-y-2', className)}>
      {Array.from({ length: lines }, (_, index) => (
        <Skeleton key={index} className={cx('h-3', index === lines - 1 ? 'w-2/3' : 'w-full')} />
      ))}
    </span>
  );
}

/** Row of placeholder cards for the catalog grid. */
export function SkeletonCards({ count = 6, className }: { count?: number; className?: string }) {
  return (
    <div
      role="status"
      aria-label="Загружаем товары"
      className={cx('grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4', className)}
    >
      {Array.from({ length: count }, (_, index) => (
        <div key={index} className="rounded-card border border-ink-200 bg-white p-3">
          <Skeleton className="mb-3 h-28 w-full rounded-xl" />
          <Skeleton className="mb-2 h-3 w-4/5" />
          <Skeleton className="h-4 w-1/2" />
        </div>
      ))}
    </div>
  );
}

/** Placeholder rows for lists and tables. */
export function SkeletonRows({ count = 5, className }: { count?: number; className?: string }) {
  return (
    <div role="status" aria-label="Загружаем список" className={cx('space-y-2', className)}>
      {Array.from({ length: count }, (_, index) => (
        <div key={index} className="flex items-center justify-between gap-4 rounded-xl border border-ink-100 p-3">
          <Skeleton className="h-4 w-1/3" />
          <Skeleton className="h-4 w-20" />
        </div>
      ))}
    </div>
  );
}
