import { describe, expect, it } from 'vitest';
import {
  formatAmountTyping,
  formatMoney,
  multiplyMinor,
  parseAmountInput,
  sumMinor,
  toMajorString,
} from './money';

/**
 * Money is the one place where a rounding bug is a real bug, so these tests pin
 * the parsing/formatting contract and the exact-integer arithmetic.
 */
describe('money helpers', () => {
  it('formats minor units with ru-KZ grouping and the tenge symbol', () => {
    expect(formatMoney(150_000)).toMatch(/^1\s500,00\s*₸$/u);
    expect(formatMoney(123_456_789)).toMatch(/^1\s234\s567,89\s*₸$/u);
    expect(formatMoney(-500)).toMatch(/^−5,00\s*₸$/u);
    expect(formatMoney(150_000, 'KZT', { trimZeroFraction: true })).toMatch(/^1\s500\s*₸$/u);
    expect(toMajorString(150_050)).toBe('1500.50');
  });

  it('parses human input into minor units without rounding, and enforces the bound', () => {
    expect(parseAmountInput('1 500,50')).toEqual({ ok: true, minor: 150_050 });
    expect(parseAmountInput('1500.5')).toEqual({ ok: true, minor: 150_050 });
    expect(parseAmountInput('1500')).toEqual({ ok: true, minor: 150_000 });

    // Nothing is silently rounded: 3 fraction digits, text and zero are refused.
    expect(parseAmountInput('10,005')).toMatchObject({ ok: false });
    expect(parseAmountInput('abc')).toMatchObject({ ok: false });
    expect(parseAmountInput('0')).toMatchObject({
      ok: false,
      message: 'Сумма должна быть больше нуля',
    });

    // The available balance is passed in as a bound, with the caller's wording.
    expect(
      parseAmountInput('5000', {
        maxMinor: 350_000,
        maxMessage: 'Недостаточно средств на выбранном счёте',
      }),
    ).toEqual({ ok: false, message: 'Недостаточно средств на выбранном счёте' });
    expect(parseAmountInput('3500', { maxMinor: 350_000 })).toEqual({ ok: true, minor: 350_000 });
  });

  it('formats an amount while it is being typed and stays parsable', () => {
    expect(formatAmountTyping('1')).toBe('1');
    expect(formatAmountTyping('1500')).toMatch(/^1\s500$/u);
    expect(formatAmountTyping('1 500,5')).toMatch(/^1\s500,5$/u);
    expect(formatAmountTyping('007')).toBe('7');
    expect(formatAmountTyping('12,3456')).toMatch(/^12,34$/u);
    expect(formatAmountTyping('12xx5')).toMatch(/^125$/u);

    // Round trip: what the user sees is exactly what the API receives.
    expect(parseAmountInput(formatAmountTyping('150050'))).toEqual({ ok: true, minor: 15_005_000 });
  });

  it('multiplies and sums exactly (no float drift on line totals)', () => {
    expect(multiplyMinor(3_333, 3)).toBe(9_999);
    expect(multiplyMinor(1_999, 3)).toBe(5_997);
    expect(sumMinor([10, 20, 30])).toBe(60);
    expect(sumMinor([])).toBe(0);
    // Ten additions of 0.01 KZT: exact in minor units, lossy in floats.
    expect(sumMinor(Array.from({ length: 10 }, () => 1))).toBe(10);
  });
});
