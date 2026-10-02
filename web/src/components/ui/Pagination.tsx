import { cx } from '../../lib/cx';
import { Button } from './Button';

export interface PaginationProps {
  /** Zero-based page index, as the API uses it. */
  page: number;
  totalPages: number;
  hasNext: boolean;
  totalElements?: number;
  isFetching?: boolean;
  onPageChange: (page: number) => void;
  className?: string;
}

/** Windowed page numbers: first, last, current ±1 with ellipses. */
function pageWindow(page: number, totalPages: number): (number | 'gap')[] {
  const pages = new Set<number>([0, totalPages - 1, page, page - 1, page + 1]);
  const visible = [...pages].filter((value) => value >= 0 && value < totalPages).sort((a, b) => a - b);
  const result: (number | 'gap')[] = [];
  let previous: number | null = null;
  for (const value of visible) {
    if (previous !== null && value - previous > 1) {
      result.push('gap');
    }
    result.push(value);
    previous = value;
  }
  return result;
}

export function Pagination({
  page,
  totalPages,
  hasNext,
  totalElements,
  isFetching = false,
  onPageChange,
  className,
}: PaginationProps) {
  if (totalPages <= 1) {
    return null;
  }

  return (
    <nav
      aria-label="Постраничная навигация"
      className={cx('flex flex-wrap items-center justify-between gap-3 pt-4', className)}
    >
      <p className="text-xs text-ink-500" aria-live="polite">
        Страница {page + 1} из {totalPages}
        {typeof totalElements === 'number' ? ` · всего ${totalElements}` : ''}
        {isFetching ? ' · обновляем…' : ''}
      </p>

      <div className="flex items-center gap-1">
        <Button
          variant="secondary"
          size="sm"
          onClick={() => onPageChange(page - 1)}
          disabled={page <= 0}
          aria-label="Предыдущая страница"
        >
          Назад
        </Button>

        {pageWindow(page, totalPages).map((entry, index) =>
          entry === 'gap' ? (
            <span key={`gap-${index}`} className="px-1 text-ink-400" aria-hidden="true">
              …
            </span>
          ) : (
            <button
              key={entry}
              type="button"
              onClick={() => onPageChange(entry)}
              aria-current={entry === page ? 'page' : undefined}
              aria-label={`Страница ${entry + 1}`}
              className={cx(
                'h-9 min-w-9 rounded-full px-2 text-sm font-medium',
                entry === page ? 'bg-brand-500 text-white' : 'text-ink-600 hover:bg-ink-100',
              )}
            >
              {entry + 1}
            </button>
          ),
        )}

        <Button
          variant="secondary"
          size="sm"
          onClick={() => onPageChange(page + 1)}
          disabled={!hasNext}
          aria-label="Следующая страница"
        >
          Вперёд
        </Button>
      </div>
    </nav>
  );
}
