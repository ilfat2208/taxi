/**
 * Shymkent scheduling helpers.
 *
 * The pilot city runs on the `Asia/Almaty` zone (UTC+5, no DST) — the field name
 * of the zone is a leftover of the country's zone naming, the city is Shymkent.
 * QTime answers with ISO-8601 instants plus the zone it scheduled in, and those
 * two facts decide how this module is written:
 *
 *  - times are always formatted *in the schedule's zone*, never in the browser's,
 *    so a rider travelling abroad still sees the window the salon agreed to;
 *  - the date filter of `/slots` is a calendar day of that same zone, so "today"
 *    is computed with `Intl`, not with the local clock.
 *
 * Everything here is pure and testable: no `Date.now()` is read unless a caller
 * passes a `now` explicitly.
 */

/** IANA zone of the pilot city (see `docs/orta.md`). */
export const CITY_TIME_ZONE = 'Asia/Almaty';

/**
 * Caption printed next to every time the UI shows. The city name is used, not the
 * zone's: the design mock-ups speak about Shymkent, and a caption has no room for
 * a parenthesis about how the zone is named internally.
 */
export const CITY_TIME_LABEL = 'время Шымкента';

/** How far ahead the booking screen offers days. */
export const BOOKING_DAYS_AHEAD = 14;

const timeFormat = new Intl.DateTimeFormat('ru-KZ', {
  timeZone: CITY_TIME_ZONE,
  hour: '2-digit',
  minute: '2-digit',
});

const dateFormat = new Intl.DateTimeFormat('ru-KZ', {
  timeZone: CITY_TIME_ZONE,
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
});

const dayMonthFormat = new Intl.DateTimeFormat('ru-KZ', {
  timeZone: CITY_TIME_ZONE,
  day: 'numeric',
  month: 'long',
});

const weekdayFormat = new Intl.DateTimeFormat('ru-KZ', {
  timeZone: CITY_TIME_ZONE,
  weekday: 'short',
});

const DAY_KEY_FORMAT = new Intl.DateTimeFormat('en-CA', {
  timeZone: CITY_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

function parse(value: string | null | undefined): Date | null {
  if (!value) {
    return null;
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** `2026-10-02T10:07:00+05:00` -> `"10:07"` in the city's zone. */
export function cityTime(value: string | null | undefined, fallback = '—'): string {
  const date = parse(value);
  return date ? timeFormat.format(date) : fallback;
}

/** `2026-10-02T10:07:00+05:00` -> `"02.10.2026"` in the city's zone. */
export function cityDate(value: string | null | undefined, fallback = '—'): string {
  const date = parse(value);
  return date ? dateFormat.format(date) : fallback;
}

export function cityDateTime(value: string | null | undefined, fallback = '—'): string {
  const date = parse(value);
  return date ? `${dateFormat.format(date)}, ${timeFormat.format(date)}` : fallback;
}

/** Calendar day of an instant in the city's zone: `"2026-10-02"`. */
export function cityDayKey(value: string | Date | null | undefined = new Date()): string {
  const date = value instanceof Date ? value : parse(value ?? undefined);
  if (!date) {
    return '';
  }
  const parts = DAY_KEY_FORMAT.formatToParts(date);
  const year = parts.find((part) => part.type === 'year')?.value ?? '';
  const month = parts.find((part) => part.type === 'month')?.value ?? '';
  const day = parts.find((part) => part.type === 'day')?.value ?? '';
  return year === '' || month === '' || day === '' ? '' : `${year}-${month}-${day}`;
}

/** `"2026-10-02"` + 3 -> `"2026-10-05"`; the arithmetic is zone-free on purpose. */
export function addDays(dayKey: string, days: number): string {
  const [rawYear = '', rawMonth = '', rawDay = ''] = dayKey.split('-');
  // `Number('')` is 0, which would silently produce 1899-12-01 for an empty key.
  if (rawYear === '' || rawMonth === '' || rawDay === '') {
    return '';
  }
  const year = Number(rawYear);
  const month = Number(rawMonth);
  const day = Number(rawDay);
  if (
    !Number.isInteger(year) ||
    !Number.isInteger(month) ||
    !Number.isInteger(day) ||
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > 31
  ) {
    return '';
  }
  const base = new Date(Date.UTC(year, month - 1, day));
  base.setUTCDate(base.getUTCDate() + Math.trunc(days));
  return base.toISOString().slice(0, 10);
}

export interface BookingDay {
  /** `YYYY-MM-DD` for `?date=`. */
  key: string;
  /** `"пт"`. */
  weekday: string;
  /** `"2 октября"`. */
  label: string;
  isToday: boolean;
}

/** The next `count` days, starting with today in the city's zone. */
export function upcomingDays(count = BOOKING_DAYS_AHEAD, now: Date = new Date()): BookingDay[] {
  const today = cityDayKey(now);
  if (today === '') {
    return [];
  }
  const days: BookingDay[] = [];
  for (let offset = 0; offset < Math.max(0, count); offset += 1) {
    const key = addDays(today, offset);
    // Noon UTC of that calendar day, read back in the city's zone: the label can
    // never slip to the previous day, whatever offset the browser sits in.
    const noon = new Date(`${key}T12:00:00Z`);
    days.push({
      key,
      weekday: weekdayFormat.format(noon),
      label: dayMonthFormat.format(noon),
      isToday: offset === 0,
    });
  }
  return days;
}

/** `90` -> `"1 ч 30 мин"`, `45` -> `"45 мин"`, absent -> `null` (row is skipped). */
export function formatDurationMinutes(minutes: number | null | undefined): string | null {
  if (typeof minutes !== 'number' || !Number.isFinite(minutes) || minutes <= 0) {
    return null;
  }
  const total = Math.round(minutes);
  if (total < 60) {
    return `${total} мин`;
  }
  const hours = Math.floor(total / 60);
  const rest = total % 60;
  return rest === 0 ? `${hours} ч` : `${hours} ч ${rest} мин`;
}

/**
 * Рейтинг каталога в базисных пунктах -> `"4,8"`; `null` — «сервис не прислал оценку».
 *
 * Внимание: у каталога и у QTime РАЗНАЯ шкала, и это не опечатка клиента, а расхождение
 * сервисов. `catalog.merchant.rating_basis_points` ограничен `between 0 and 500`
 * (V1__init_catalog.sql:31), поэтому здесь деление на 100. У QTime и водителей
 * `rating_bp between 0 and 50000` (V1__init_qtime.sql:40, V1__init_driver.sql:26) —
 * для них есть `formatFiveStarBp`. Пока шкалы не сведены в сервисах, путать их нельзя:
 * цена ошибки — «★ 480,0» на карточке компании.
 */
export function formatRatingBp(basisPoints: number | null | undefined): string | null {
  if (typeof basisPoints !== 'number' || !Number.isFinite(basisPoints) || basisPoints <= 0) {
    return null;
  }
  return (basisPoints / 100).toFixed(1).replace('.', ',');
}

/** Рейтинг QTime и водителей (`rating_bp`, 50 000 = 5,00) -> `"4,8"`. */
export function formatFiveStarBp(basisPoints: number | null | undefined): string | null {
  if (typeof basisPoints !== 'number' || !Number.isFinite(basisPoints) || basisPoints <= 0) {
    return null;
  }
  return (basisPoints / 10_000).toFixed(1).replace('.', ',');
}

/** `"15:30 · 2 октября"` — the slot label used across the booking screens. */
export function slotLabel(startsAt: string | null | undefined): string {
  const date = parse(startsAt);
  if (!date) {
    return '—';
  }
  return `${timeFormat.format(date)} · ${dayMonthFormat.format(date)}`;
}
