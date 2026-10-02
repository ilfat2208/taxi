import { currencySymbol, formatAmountTyping, formatMoney, multiplyMinor } from '../../api/money';
import { cx } from '../../lib/cx';
import { inputClass } from './Field';

export interface AmountFieldProps {
  id: string;
  label: string;
  /** Raw, partially typed text (already formatted with group separators). */
  value: string;
  onValueChange: (value: string) => void;
  currency?: string;
  hint?: string;
  error?: string;
  disabled?: boolean;
  autoFocus?: boolean;
  /** Quick-pick amounts in *major* units (1 000, 5 000 …). */
  suggestions?: number[];
}

/**
 * Amount input in minor-unit world.
 *
 * The user types a human amount ("1 500,50") and the value is reformatted on every
 * keystroke — grouping the integer part, keeping at most two decimals. The page
 * parses it with `parseAmountInput`, so no float ever touches the amount.
 */
export function AmountField({
  id,
  label,
  value,
  onValueChange,
  currency = 'KZT',
  hint,
  error,
  disabled = false,
  autoFocus = false,
  suggestions = [],
}: AmountFieldProps) {
  const describedBy = [hint && !error ? `${id}-hint` : null, error ? `${id}-error` : null]
    .filter(Boolean)
    .join(' ');

  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="block text-sm font-medium text-ink-700">
        {label}
        <span className="ml-0.5 text-brand-600" aria-hidden="true">
          *
        </span>
      </label>

      <div className="relative">
        <input
          id={id}
          value={value}
          onChange={(event) => onValueChange(formatAmountTyping(event.target.value))}
          inputMode="decimal"
          autoComplete="off"
          autoFocus={autoFocus}
          disabled={disabled}
          placeholder="0"
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy === '' ? undefined : describedBy}
          className={inputClass(Boolean(error), 'tnum pr-12 text-lg font-semibold')}
        />
        <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-sm text-ink-400">
          {currencySymbol(currency)}
        </span>
      </div>

      {suggestions.length > 0 ? (
        <div className="flex flex-wrap gap-1.5 pt-0.5">
          {suggestions.map((amount) => (
            <button
              key={amount}
              type="button"
              disabled={disabled}
              onClick={() => onValueChange(formatAmountTyping(String(amount)))}
              className={cx(
                'rounded-full bg-ink-100 px-3 py-1 text-xs font-medium text-ink-700 hover:bg-ink-200',
                'disabled:cursor-not-allowed disabled:opacity-60',
              )}
            >
              {formatMoney(multiplyMinor(amount, 100), currency, { trimZeroFraction: true })}
            </button>
          ))}
        </div>
      ) : null}

      {hint && !error ? (
        <p id={`${id}-hint`} className="text-xs text-ink-500">
          {hint}
        </p>
      ) : null}
      {error ? (
        <p id={`${id}-error`} role="alert" className="text-xs font-medium text-brand-600">
          {error}
        </p>
      ) : null}
    </div>
  );
}
