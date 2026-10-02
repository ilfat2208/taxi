/**
 * Kazakhstani phone numbers as the product uses them: `+7` plus ten digits.
 *
 * Login pre-fills a demo number, the transfer form formats the recipient as the
 * user types, and both need the same normalization before the value reaches the
 * API (the gateway accepts `^\+?[0-9]{10,15}$`).
 */

export const PHONE_COUNTRY_CODE = '7';
export const PHONE_DIGITS = 11;

/** Pre-filled on the login screen so the demo stack is one click away. */
export const DEMO_PHONE = '+77001234567';
export const DEMO_CODE = '0000';

/**
 * Prefix an empty phone field starts with.
 *
 * A KZ number is always `+7` plus ten digits, so the field shows the country code
 * and the user types the rest — the mask never has to guess whether a leading `7`
 * was the country code or the first digit of the national number.
 */
export const PHONE_PREFIX = '+7 ';

/** Everything that is not a digit, dropped. */
export function digitsOf(value: string): string {
  return value.replace(/\D+/g, '');
}

/**
 * National digits of a KZ number: a leading `8` is rewritten to `7` (people still
 * dial `8 700 ...`) and a bare national number gets the country code prepended.
 */
export function nationalDigits(value: string): string {
  let digits = digitsOf(value);
  if (digits.startsWith('8')) {
    digits = PHONE_COUNTRY_CODE + digits.slice(1);
  } else if (digits !== '' && !digits.startsWith(PHONE_COUNTRY_CODE)) {
    digits = PHONE_COUNTRY_CODE + digits;
  }
  return digits.slice(0, PHONE_DIGITS);
}

/** Progressive mask for a controlled input: `+7 700 123 45 67`. */
export function formatPhoneInput(value: string): string {
  const digits = nationalDigits(value);
  const national = digits.startsWith(PHONE_COUNTRY_CODE) ? digits.slice(1) : digits;
  const groups = [national.slice(0, 3), national.slice(3, 6), national.slice(6, 8), national.slice(8, 10)];
  const parts = groups.filter((group) => group !== '');
  return parts.length === 0 ? '+7' : `+7 ${parts.join(' ')}`;
}

/** `+7 700 123 45 67` -> `+77001234567`; only valid KZ numbers survive. */
export function normalizePhone(value: string): string | null {
  const digits = nationalDigits(value);
  if (digits.length !== PHONE_DIGITS || !digits.startsWith(PHONE_COUNTRY_CODE)) {
    return null;
  }
  return `+${digits}`;
}

export function isValidPhone(value: string): boolean {
  return normalizePhone(value) !== null;
}

/** `+77001234567` -> `+7 700 *** 45 67` for receipts and headers. */
export function maskPhone(value: string): string {
  const digits = digitsOf(value);
  if (digits.length < 7) {
    return value;
  }
  const national = digits.slice(-10);
  return `+7 ${national.slice(0, 3)} *** ${national.slice(6, 8)} ${national.slice(8, 10)}`;
}
