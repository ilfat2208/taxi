import { useCallback, useEffect, useState } from 'react';
import { cx } from '../../lib/cx';

/**
 * Copies a value (a correlation id, a payment number) to the clipboard.
 *
 * `navigator.clipboard` is unavailable in insecure contexts and in jsdom, so the
 * button degrades to a no-op with a visible message instead of throwing.
 */
export function CopyButton({
  value,
  label = 'Копировать',
  copiedLabel = 'Скопировано',
  className,
}: {
  value: string;
  label?: string;
  copiedLabel?: string;
  className?: string;
}) {
  const [copied, setCopied] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!copied && !failed) {
      return;
    }
    const timer = window.setTimeout(() => {
      setCopied(false);
      setFailed(false);
    }, 2_000);
    return () => window.clearTimeout(timer);
  }, [copied, failed]);

  const copy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
    } catch {
      setFailed(true);
    }
  }, [value]);

  return (
    <button
      type="button"
      onClick={() => {
        void copy();
      }}
      className={cx(
        'rounded-full px-2 py-0.5 text-xs font-medium text-ink-500 underline decoration-dotted hover:text-brand-600',
        className,
      )}
    >
      <span aria-live="polite">{copied ? copiedLabel : failed ? 'Не удалось скопировать' : label}</span>
    </button>
  );
}
