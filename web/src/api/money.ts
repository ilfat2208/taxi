/**
 * Money helpers.
 *
 * The API speaks minor units (tiyn/cents) as integers, so every conversion here
 * is done with BigInt: no float arithmetic ever touches an amount, not even for
 * grouping digits. Formatting is ru-KZ ("1 234 567,89 ₸").
 */

export const GROUPING_LOCALE = 'ru-KZ';

/** Every currency in this platform has two minor digits (`Currency.scale()`). */
export const MINOR_DIGITS = 2;
const MINOR_FACTOR = 10n ** BigInt(MINOR_DIGITS);

const FALLBACK_SYMBOLS: Record<string, string> = {
  KZT: '₸',
  USD: '$',
  EUR: '€',
  RUB: '₽',
};

export const GROUP_SEPARATOR_PATTERN = /[\s\u00a0\u202f]/g;

function toBigInt(value: number | bigint): bigint {
  if (typeof value === 'bigint') {
    return value;
  }
  if (!Number.isFinite(value)) {
    return 0n;
  }
  return BigInt(Math.round(value));
}

/** Currency symbol resolved through Intl so it stays locale-correct. */
export function currencySymbol(currency: string = 'KZT'): string {
  try {
    const parts = new Intl.NumberFormat(GROUPING_LOCALE, {
      style: 'currency',
      currency,
      currencyDisplay: 'narrowSymbol',
    }).formatToParts(0);
    const symbol = parts.find((part) => part.type === 'currency')?.value;
    if (symbol) {
      return symbol;
    }
  } catch {
    /* unknown currency code — fall through */
  }
  return FALLBACK_SYMBOLS[currency] ?? currency;
}

export interface FormatMoneyOptions {
  /** Append the currency symbol (default true). */
  withSymbol?: boolean;
  /** Drop the ",00" fraction when it is zero (nicer in dense lists). */
  trimZeroFraction?: boolean;
  /** Always render the sign, e.g. "+1 500,00 ₸" for incoming transactions. */
  signed?: boolean;
}

/** `150000` -> `"1 500,00 ₸"`. */
export function formatMoney(
  minor: number | bigint,
  currency: string = 'KZT',
  options: FormatMoneyOptions = {},
): string {
  const { withSymbol = true, trimZeroFraction = false, signed = false } = options;
  const value = toBigInt(minor);
  const negative = value < 0n;
  const absolute = negative ? -value : value;

  const intPart = absolute / MINOR_FACTOR;
  const fracPart = absolute % MINOR_FACTOR;

  const grouped = new Intl.NumberFormat(GROUPING_LOCALE, {
    useGrouping: true,
    maximumFractionDigits: 0,
  }).format(intPart);

  const fraction = fracPart.toString().padStart(MINOR_DIGITS, '0');
  const showFraction = !(trimZeroFraction && fracPart === 0n);
  const sign = negative ? '−' : signed ? '+' : '';
  const number = showFraction ? `${sign}${grouped},${fraction}` : `${sign}${grouped}`;

  return withSymbol ? `${number}\u00a0${currencySymbol(currency)}` : number;
}

/** `150000` -> `"1 500,00"` with an explicit sign for ledger rows. */
export function formatSignedMoney(minor: number | bigint, currency: string = 'KZT'): string {
  return formatMoney(minor, currency, { signed: true });
}

/** `150000` -> `"1500.00"` — machine-readable, for inputs and copy/paste. */
export function toMajorString(minor: number | bigint): string {
  const value = toBigInt(minor);
  const negative = value < 0n;
  const absolute = negative ? -value : value;
  const fraction = (absolute % MINOR_FACTOR).toString().padStart(MINOR_DIGITS, '0');
  return `${negative ? '-' : ''}${absolute / MINOR_FACTOR}.${fraction}`;
}

export type ParsedAmount =
  | { ok: true; minor: number }
  | { ok: false; message: string };

export interface ParseAmountOptions {
  /** Treat zero as an error (default true). */
  requirePositive?: boolean;
  /** Optional upper bound in minor units. */
  maxMinor?: number;
  /** Message shown when the amount exceeds `maxMinor`. */
  maxMessage?: string;
  /** Allow a zero amount (used by "pay everything" style inputs). */
  label?: string;
}

/**
 * Parses human input ("1 500,50", "1500.5", "1500") into minor units.
 * Rejects anything that is not a plain non-negative decimal with <= 2 fraction
 * digits, so nothing is silently rounded.
 */
export function parseAmountInput(raw: string, options: ParseAmountOptions = {}): ParsedAmount {
  const { requirePositive = true, maxMinor, maxMessage, label = 'сумму' } = options;
  const normalized = raw.replace(GROUP_SEPARATOR_PATTERN, '').replace(',', '.').trim();

  if (normalized === '') {
    return { ok: false, message: `Укажите ${label}` };
  }
  if (!/^\d+(\.\d{0,2})?$/.test(normalized)) {
    return { ok: false, message: 'Только цифры, не более двух знаков после запятой' };
  }

  const [intPart = '0', fracPart = ''] = normalized.split('.');
  const minor = BigInt(intPart) * MINOR_FACTOR + BigInt((fracPart + '00').slice(0, MINOR_DIGITS));

  if (requirePositive && minor === 0n) {
    return { ok: false, message: 'Сумма должна быть больше нуля' };
  }
  if (minor > BigInt(Number.MAX_SAFE_INTEGER)) {
    return { ok: false, message: 'Слишком большая сумма' };
  }
  if (maxMinor !== undefined && minor > BigInt(maxMinor)) {
    return { ok: false, message: maxMessage ?? `Максимум ${formatMoney(maxMinor)}` };
  }

  return { ok: true, minor: Number(minor) };
}

/**
 * Formats a *partially typed* amount so the field reads like a receipt while the
 * user types: group separators are inserted on the fly and everything that is not
 * a digit or a decimal comma is dropped. The result is always re-parsable by
 * `parseAmountInput`, including the intermediate states ("", "1 ", "1 500,").
 */
export function formatAmountTyping(raw: string): string {
  const cleaned = raw.replace(/[^\d.,]/g, '').replace(/\./g, ',');
  const commaIndex = cleaned.indexOf(',');
  const intRaw = commaIndex === -1 ? cleaned : cleaned.slice(0, commaIndex);
  const fracRaw =
    commaIndex === -1 ? null : cleaned.slice(commaIndex + 1).replace(/,/g, '').slice(0, MINOR_DIGITS);

  // Keep at most one leading zero, and never build a BigInt out of 20+ digits.
  const digitsOnly = intRaw.replace(/\D/g, '').slice(0, 15);
  const withoutLeadingZeros = digitsOnly.replace(/^0+/, '');
  const intDigits = withoutLeadingZeros === '' ? (digitsOnly === '' ? '' : '0') : withoutLeadingZeros;
  const grouped =
    intDigits === ''
      ? ''
      : new Intl.NumberFormat(GROUPING_LOCALE, {
          useGrouping: true,
          maximumFractionDigits: 0,
        }).format(BigInt(intDigits));

  if (fracRaw === null) {
    return grouped;
  }
  return `${grouped === '' ? '0' : grouped},${fracRaw}`;
}

/** Exact integer multiplication — used for line totals (`price * quantity`). */
export function multiplyMinor(unitPriceMinor: number, quantity: number): number {
  return Number(toBigInt(unitPriceMinor) * BigInt(Math.trunc(quantity)));
}

/** Exact integer sum — never `reduce` over floats for money. */
export function sumMinor(values: Iterable<number>): number {
  let total = 0n;
  for (const value of values) {
    total += toBigInt(value);
  }
  return Number(total);
}

export function isZeroMinor(minor: number | bigint): boolean {
  return toBigInt(minor) === 0n;
}

/** True when the amount fits in a JSON number without losing precision. */
export function isSafeMinor(minor: number): boolean {
  return Number.isSafeInteger(minor);
}
