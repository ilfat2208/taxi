import { describe, expect, it } from 'vitest';
import {
  BOOKING_DAYS_AHEAD,
  addDays,
  cityDate,
  cityDateTime,
  cityDayKey,
  cityTime,
  formatDurationMinutes,
  formatFiveStarBp,
  formatRatingBp,
  slotLabel,
  upcomingDays,
} from './cityTime';

/**
 * City-time helpers.
 *
 * Every assertion is written against the *city's* zone, never the runner's, so the
 * suite behaves the same on a laptop in Shymkent and on a CI box in UTC.
 */
describe('city time helpers', () => {
  it('reads instants in the city zone, whatever the runner sits in', () => {
    // 10:07 UTC is 15:07 in Shymkent (UTC+5, no DST).
    expect(cityTime('2026-10-02T10:07:00Z')).toBe('15:07');
    expect(cityTime('2026-10-02T10:07:00+05:00')).toBe('10:07');
    expect(cityDate('2026-10-02T10:07:00Z')).toBe('02.10.2026');
    expect(cityDateTime('2026-10-02T10:07:00+05:00')).toBe('02.10.2026, 10:07');
    expect(cityTime('')).toBe('—');
    expect(cityTime('не дата')).toBe('—');
  });

  it('computes the calendar day in the city zone, not in UTC', () => {
    // 20:00 UTC is already the next day in Shymkent: a slot list must not slip back.
    expect(cityDayKey(new Date('2026-10-02T20:00:00Z'))).toBe('2026-10-03');
    expect(cityDayKey(new Date('2026-10-02T10:00:00Z'))).toBe('2026-10-02');
    expect(cityDayKey('')).toBe('');
  });

  it('adds days across month and year boundaries', () => {
    expect(addDays('2026-10-02', 1)).toBe('2026-10-03');
    expect(addDays('2026-10-31', 1)).toBe('2026-11-01');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
    expect(addDays('', 1)).toBe('');
    expect(addDays('not-a-date', 1)).toBe('');
  });

  it('offers 14 days ahead, today first', () => {
    const days = upcomingDays(BOOKING_DAYS_AHEAD, new Date('2026-10-02T06:00:00Z'));
    expect(days).toHaveLength(14);
    expect(days[0]?.key).toBe('2026-10-02');
    expect(days[0]?.isToday).toBe(true);
    expect(days[1]?.isToday).toBe(false);
    expect(days[13]?.key).toBe('2026-10-15');
    // A label is a real Russian day/month pair, not a raw ISO string.
    expect(days[0]?.label).toMatch(/\d+\s+\p{L}+/u);
    expect(upcomingDays(0)).toHaveLength(0);
  });

  it('formats durations and ratings, and says nothing when the field is missing', () => {
    expect(formatDurationMinutes(45)).toBe('45 мин');
    expect(formatDurationMinutes(90)).toBe('1 ч 30 мин');
    expect(formatDurationMinutes(120)).toBe('2 ч');
    expect(formatDurationMinutes(null)).toBeNull();
    expect(formatDurationMinutes(0)).toBeNull();

    expect(formatRatingBp(480)).toBe('4,8');
    expect(formatRatingBp(500)).toBe('5,0');
    // No rating in the payload means no stars at all, not "0,0".
    expect(formatRatingBp(null)).toBeNull();
    expect(formatRatingBp(0)).toBeNull();
  });

  it('formats the QTime scale separately: 50 000 is five stars there, not 500', () => {
    // У QTime и водителей `rating_bp` ограничен 0…50000, у каталога — 0…500. Один и тот же
    // «480» означает разные вещи, и на карточке компании это была бы «★ 480,0».
    expect(formatFiveStarBp(48000)).toBe('4,8');
    expect(formatFiveStarBp(49000)).toBe('4,9');
    expect(formatFiveStarBp(50000)).toBe('5,0');
    expect(formatFiveStarBp(null)).toBeNull();
    expect(formatFiveStarBp(0)).toBeNull();
  });

  it('labels a slot with its time and day', () => {
    expect(slotLabel('2026-10-02T15:30:00+05:00')).toBe('15:30 · 2 октября');
    expect(slotLabel(null)).toBe('—');
  });
});
