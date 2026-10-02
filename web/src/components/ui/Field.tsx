import type {
  InputHTMLAttributes,
  ReactNode,
  SelectHTMLAttributes,
  TextareaHTMLAttributes,
} from 'react';
import { cx } from '../../lib/cx';

/**
 * Form primitives with the accessibility wiring built in.
 *
 * Every control gets: a real `<label for>`, `aria-invalid` when it holds a bad
 * value, and `aria-describedby` pointing at both the hint and the error text —
 * so the message is announced with the field instead of being a stray paragraph.
 */

export function inputClass(invalid = false, className?: string): string {
  return cx(
    'w-full rounded-xl border bg-white px-3 py-2.5 text-sm text-ink-900 placeholder:text-ink-400',
    'disabled:bg-ink-100 disabled:text-ink-500',
    invalid ? 'border-brand-400 focus:border-brand-500' : 'border-ink-200 focus:border-brand-400',
    className,
  );
}

interface FieldChrome {
  id: string;
  label: string;
  hint?: string | undefined;
  error?: string | undefined;
  required?: boolean;
}

function describedBy({ id, hint, error }: FieldChrome): string | undefined {
  const ids = [hint ? `${id}-hint` : null, error ? `${id}-error` : null].filter(Boolean);
  return ids.length > 0 ? ids.join(' ') : undefined;
}

function FieldShell({ id, label, hint, error, required, children }: FieldChrome & { children: ReactNode }) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="block text-sm font-medium text-ink-700">
        {label}
        {required ? (
          <span className="ml-0.5 text-brand-600" aria-hidden="true">
            *
          </span>
        ) : null}
      </label>
      {children}
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

export type TextFieldProps = FieldChrome & Omit<InputHTMLAttributes<HTMLInputElement>, 'id'>;

export function TextField({ id, label, hint, error, required, className, ...rest }: TextFieldProps) {
  return (
    <FieldShell id={id} label={label} hint={hint} error={error} required={required}>
      <input
        {...rest}
        id={id}
        required={required}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy({ id, label, hint, error })}
        className={inputClass(Boolean(error), className)}
      />
    </FieldShell>
  );
}

export type TextAreaFieldProps = FieldChrome & Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, 'id'>;

export function TextAreaField({ id, label, hint, error, required, className, ...rest }: TextAreaFieldProps) {
  return (
    <FieldShell id={id} label={label} hint={hint} error={error} required={required}>
      <textarea
        {...rest}
        id={id}
        required={required}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy({ id, label, hint, error })}
        className={inputClass(Boolean(error), cx('min-h-24 resize-y', className))}
      />
    </FieldShell>
  );
}

export interface SelectOption {
  value: string;
  label: string;
}

export type SelectFieldProps = FieldChrome &
  Omit<SelectHTMLAttributes<HTMLSelectElement>, 'id' | 'children'> & {
    options: SelectOption[];
    placeholder?: string;
  };

export function SelectField({
  id,
  label,
  hint,
  error,
  required,
  options,
  placeholder,
  className,
  ...rest
}: SelectFieldProps) {
  return (
    <FieldShell id={id} label={label} hint={hint} error={error} required={required}>
      <select
        {...rest}
        id={id}
        required={required}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy({ id, label, hint, error })}
        className={inputClass(Boolean(error), cx('pr-8', className))}
      >
        {placeholder ? <option value="">{placeholder}</option> : null}
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </FieldShell>
  );
}

export type CheckboxFieldProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'id' | 'type'> & {
  id: string;
  label: string;
  hint?: string;
  error?: string;
};

export function CheckboxField({ id, label, hint, error, className, ...rest }: CheckboxFieldProps) {
  return (
    <div className="space-y-1">
      <div className="flex items-start gap-3">
        <input
          {...rest}
          id={id}
          type="checkbox"
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy({ id, label, hint, error })}
          className={cx('mt-0.5 h-4 w-4 shrink-0 accent-brand-500', className)}
        />
        <label htmlFor={id} className="text-sm text-ink-700">
          {label}
        </label>
      </div>
      {hint && !error ? (
        <p id={`${id}-hint`} className="pl-7 text-xs text-ink-500">
          {hint}
        </p>
      ) : null}
      {error ? (
        <p id={`${id}-error`} role="alert" className="pl-7 text-xs font-medium text-brand-600">
          {error}
        </p>
      ) : null}
    </div>
  );
}
