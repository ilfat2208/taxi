import type { ReactNode } from 'react';
import { cx } from '../../lib/cx';
import { statusLabel, statusTone, type Tone } from '../../lib/format';

const TONE_CLASSES: Record<Tone, string> = {
  neutral: 'bg-ink-100 text-ink-700 ring-ink-200',
  success: 'bg-success-50 text-success-700 ring-emerald-200',
  warning: 'bg-warning-50 text-warning-700 ring-amber-200',
  danger: 'bg-brand-50 text-brand-700 ring-brand-200',
  info: 'bg-info-50 text-info-700 ring-blue-200',
  brand: 'bg-brand-500 text-white ring-brand-500',
};

export function Badge({
  children,
  tone = 'neutral',
  className,
}: {
  children: ReactNode;
  tone?: Tone;
  className?: string;
}) {
  return (
    <span
      className={cx(
        'inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium ring-1 ring-inset',
        TONE_CLASSES[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

/** Status chip with the ru-KZ label and the tone of the state machine. */
export function StatusBadge({ status, className }: { status: string | null | undefined; className?: string }) {
  return (
    <Badge tone={statusTone(status)} className={className}>
      {statusLabel(status)}
    </Badge>
  );
}
