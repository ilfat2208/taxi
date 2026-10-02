import { cx } from '../../lib/cx';
import { formatDateTime, statusLabel, statusTone, type Tone } from '../../lib/format';

export interface TimelineEntry {
  key: string;
  /** State reached at this point (`COMPLETED`, `PAID`, …). */
  status: string;
  time?: string | null;
  note?: string | null;
}

const DOT_CLASSES: Record<Tone, string> = {
  neutral: 'bg-ink-300',
  success: 'bg-emerald-500',
  warning: 'bg-amber-500',
  danger: 'bg-brand-500',
  info: 'bg-blue-500',
  brand: 'bg-brand-500',
};

/**
 * Ordered state timeline shared by payment and order details: the same component
 * renders both histories, so a reader learns the widget once.
 */
export function Timeline({ entries, className }: { entries: TimelineEntry[]; className?: string }) {
  if (entries.length === 0) {
    return <p className="text-sm text-ink-500">История состояний пока пуста.</p>;
  }

  return (
    <ol className={cx('space-y-0', className)}>
      {entries.map((entry, index) => {
        const tone = statusTone(entry.status);
        const isLast = index === entries.length - 1;
        return (
          <li key={entry.key} className="flex gap-3">
            <div className="flex flex-col items-center">
              <span className={cx('mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full', DOT_CLASSES[tone])} aria-hidden="true" />
              {!isLast ? <span className="w-px flex-1 bg-ink-200" aria-hidden="true" /> : null}
            </div>
            <div className={cx('min-w-0 pb-4', isLast && 'pb-0')}>
              <p className="text-sm font-medium text-ink-900">{statusLabel(entry.status)}</p>
              <p className="text-xs text-ink-500">{formatDateTime(entry.time)}</p>
              {entry.note ? <p className="mt-0.5 text-xs text-ink-600">{entry.note}</p> : null}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
