import { formatMoney } from '../../api/money';
import type { Account } from '../../api/types';
import { cx } from '../../lib/cx';
import { accountTypeLabel } from '../../lib/format';

/**
 * Account chooser as a radio group of cards.
 *
 * Radios (not buttons) because the choice is exclusive and belongs to a form: the
 * keyboard, the screen reader and the browser's own submit behaviour all work for
 * free, and each option shows its available balance so the user cannot pick a
 * source account blindly.
 */
export function AccountPicker({
  accounts,
  value,
  onChange,
  name,
  label = 'Счёт списания',
  error,
  disabled = false,
}: {
  accounts: Account[];
  value: string;
  onChange: (accountId: string) => void;
  name: string;
  label?: string;
  error?: string;
  disabled?: boolean;
}) {
  return (
    <fieldset className="space-y-2" aria-invalid={error ? true : undefined}>
      <legend className="text-sm font-medium text-ink-700">{label}</legend>

      <div className="grid gap-2 sm:grid-cols-2">
        {accounts.map((account) => {
          const checked = account.id === value;
          return (
            <label
              key={account.id}
              className={cx(
                'flex cursor-pointer items-start gap-3 rounded-xl border p-3 transition-colors',
                checked ? 'border-brand-400 bg-brand-50' : 'border-ink-200 bg-white hover:border-ink-300',
                disabled && 'cursor-not-allowed opacity-60',
              )}
            >
              <input
                type="radio"
                name={name}
                value={account.id}
                checked={checked}
                disabled={disabled}
                onChange={() => onChange(account.id)}
                className="mt-0.5 h-4 w-4 accent-brand-500"
              />
              <span className="min-w-0">
                <span className="block truncate text-sm font-medium text-ink-900">
                  {account.displayName || accountTypeLabel(account.type)}
                </span>
                <span className="tnum block text-xs text-ink-500">
                  Доступно {formatMoney(account.availableMinor, account.currency)}
                </span>
              </span>
            </label>
          );
        })}
      </div>

      {error ? (
        <p role="alert" className="text-xs font-medium text-brand-600">
          {error}
        </p>
      ) : null}
    </fieldset>
  );
}
