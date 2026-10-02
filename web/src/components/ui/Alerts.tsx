import type { ReactNode } from 'react';
import { NetworkError, humanMessage, isApiError } from '../../api/errors';
import { cx } from '../../lib/cx';
import { Button } from './Button';
import { CopyButton } from './CopyButton';

/** Correlation id of a failure, wherever the layer put it. */
export function correlationIdOf(error: unknown): string | null {
  if (isApiError(error)) {
    return error.correlationId;
  }
  if (error instanceof NetworkError) {
    return error.correlationId;
  }
  return null;
}

export function Alert({
  tone = 'info',
  title,
  children,
  className,
}: {
  tone?: 'info' | 'success' | 'warning' | 'danger';
  title?: ReactNode;
  children?: ReactNode;
  className?: string;
}) {
  const tones = {
    info: 'border-info-500/30 bg-info-50 text-info-700',
    success: 'border-success-500/30 bg-success-50 text-success-700',
    warning: 'border-warning-500/30 bg-warning-50 text-warning-700',
    danger: 'border-brand-300 bg-brand-50 text-brand-800',
  } as const;

  return (
    <div role={tone === 'danger' ? 'alert' : 'status'} className={cx('rounded-card border p-4', tones[tone], className)}>
      {title ? <p className="font-medium">{title}</p> : null}
      {children ? <div className={cx('text-sm', title ? 'mt-1' : undefined)}>{children}</div> : null}
    </div>
  );
}

/**
 * The single place a failed request is rendered.
 *
 * It always shows the human message, the machine `code`, the per-field errors and
 * — crucially for support — the `correlationId` the user can quote, with a copy
 * button so nobody has to retype an ULID.
 */
export function ErrorAlert({
  error,
  title,
  onRetry,
  retryLabel = 'Повторить',
  className,
}: {
  error: unknown;
  title?: string;
  onRetry?: () => void;
  retryLabel?: string;
  className?: string;
}) {
  const correlationId = correlationIdOf(error);
  const code = isApiError(error) ? error.code : undefined;
  const fieldErrors = isApiError(error) ? error.fieldErrors : [];
  const detail = isApiError(error) ? error.detail : undefined;

  return (
    <div role="alert" className={cx('rounded-card border border-brand-300 bg-brand-50 p-4 text-brand-900', className)}>
      <p className="font-semibold">{title ?? humanMessage(error)}</p>
      {detail && detail !== (title ?? humanMessage(error)) ? (
        <p className="mt-1 text-sm text-brand-800">{detail}</p>
      ) : null}

      {fieldErrors.length > 0 ? (
        <ul className="mt-2 list-disc space-y-1 pl-5 text-sm">
          {fieldErrors.map((fieldError) => (
            <li key={`${fieldError.field}-${fieldError.message}`}>
              {fieldError.field ? `${fieldError.field}: ` : ''}
              {fieldError.message}
            </li>
          ))}
        </ul>
      ) : null}

      <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-brand-700">
        {code ? <span>Код: {code}</span> : null}
        {correlationId ? (
          <span className="inline-flex items-center gap-1">
            Correlation ID: <code className="rounded bg-white/70 px-1 py-0.5">{correlationId}</code>
            <CopyButton value={correlationId} />
          </span>
        ) : null}
        {!code && !correlationId ? <span>{humanMessage(error)}</span> : null}
      </div>

      {onRetry ? (
        <div className="mt-3">
          <Button variant="secondary" size="sm" onClick={onRetry}>
            {retryLabel}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
