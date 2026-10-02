import { cx } from '../../lib/cx';

/** Inline spinner; `role="status"` so assistive tech announces the wait. */
export function Spinner({ className }: { className?: string }) {
  return (
    <span
      role="status"
      aria-label="Загрузка"
      className={cx(
        'inline-block h-5 w-5 animate-spin rounded-full border-2 border-current border-t-transparent',
        className,
      )}
    />
  );
}

/** Full-page loading state used while a route's first query is in flight. */
export function PageLoader({ label = 'Загружаем данные…' }: { label?: string }) {
  return (
    <div role="status" aria-live="polite" className="flex items-center justify-center gap-3 py-16 text-ink-500">
      <Spinner className="h-6 w-6" />
      <span className="text-sm">{label}</span>
    </div>
  );
}
