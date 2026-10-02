import type { Tone } from './format';
import type { Trip, TripStatus, TripTariff } from '../api/types';

/**
 * Taxi vocabulary.
 *
 * Kept apart from `lib/format.ts` on purpose: `COMPLETED` on a payment means
 * "выполнен", while on a trip it means "поездка завершена", and overloading the
 * shared status map would make one of the two screens lie.
 */

/** Statuses in which the ride is still moving forward and worth polling. */
export const TRIP_ACTIVE_STATUSES: TripStatus[] = [
  'SEARCHING',
  'ASSIGNED',
  'ARRIVED',
  'IN_PROGRESS',
];

/** Statuses in which the service still accepts `POST /trips/{id}/cancel`. */
export const TRIP_CANCELLABLE_STATUSES: TripStatus[] = ['SEARCHING', 'ASSIGNED', 'ARRIVED'];

/** Statuses that will not change again. */
export const TRIP_TERMINAL_STATUSES: TripStatus[] = [
  'COMPLETED',
  'CANCELLED_BY_RIDER',
  'CANCELLED_BY_DRIVER',
  'NO_DRIVERS_FOUND',
];

const TRIP_STATUS_LABELS: Record<string, string> = {
  SEARCHING: 'Ищем водителя',
  ASSIGNED: 'Водитель назначен',
  ARRIVED: 'Водитель на месте',
  IN_PROGRESS: 'В поездке',
  COMPLETED: 'Поездка завершена',
  CANCELLED_BY_RIDER: 'Отменена вами',
  CANCELLED_BY_DRIVER: 'Отменена водителем',
  NO_DRIVERS_FOUND: 'Свободных машин рядом нет',
};

export function tripStatusLabel(status: string | null | undefined): string {
  if (!status) {
    return '—';
  }
  return TRIP_STATUS_LABELS[status] ?? status;
}

export function tripStatusTone(status: string | null | undefined): Tone {
  switch (status) {
    case 'COMPLETED':
      return 'success';
    case 'ARRIVED':
    case 'ASSIGNED':
      return 'brand';
    case 'IN_PROGRESS':
      return 'info';
    case 'SEARCHING':
      return 'warning';
    case 'CANCELLED_BY_RIDER':
    case 'CANCELLED_BY_DRIVER':
      return 'neutral';
    case 'NO_DRIVERS_FOUND':
      return 'danger';
    default:
      return 'neutral';
  }
}

/**
 * Stage explanation shown instead of an ETA.
 *
 * The trip contract carries no arrival estimate, and the mock-ups' "подача 3 мин"
 * comes from a screen that was designed before the API existed. Rather than
 * inventing a countdown, each status gets a sentence about what is actually
 * known, and the screen says plainly that minutes are not available yet.
 */
export function tripStageHint(status: string | null | undefined): string | null {
  switch (status) {
    case 'SEARCHING':
      return 'Заявка ушла водителям рядом. Точное время подачи сервис пока не присылает — как только водитель примет заявку, здесь появится его карточка.';
    case 'ASSIGNED':
      return 'Водитель принял заявку и подъезжает к точке А. Минут до подачи в ответе сервиса нет, поэтому приблизительные мы не показываем.';
    case 'ARRIVED':
      return 'Водитель ждёт вас у точки А. Бесплатное ожидание считает сервис, а не приложение.';
    case 'IN_PROGRESS':
      return 'Машина едет к точке Б. Сумму по факту считает сервис — в чеке после завершения может быть другая цифра.';
    case 'COMPLETED':
      return null;
    case 'CANCELLED_BY_RIDER':
      return 'Поездка отменена вами. Если деньги были зарезервированы, сервис снимает резерв сам.';
    case 'CANCELLED_BY_DRIVER':
      return 'Поездку отменил водитель. Заявку можно оформить заново.';
    case 'NO_DRIVERS_FOUND':
      return 'Свободных машин рядом не нашлось. Деньги не списаны и не зарезервированы — заявку можно оформить заново.';
    default:
      return null;
  }
}

export interface TariffOption {
  value: TripTariff;
  label: string;
  description: string;
}

/** The two tariffs of the quote contract, in the order the design shows them. */
export const TARIFF_OPTIONS: TariffOption[] = [
  { value: 'ECONOMY', label: 'Эконом', description: 'Базовый класс' },
  { value: 'COMFORT', label: 'Комфорт', description: 'Класс выше' },
];

export function tariffLabel(tariff: string | null | undefined): string {
  switch (tariff) {
    case 'ECONOMY':
      return 'Эконом';
    case 'COMFORT':
      return 'Комфорт';
    default:
      return tariff ?? '—';
  }
}

/** Who caused a timeline step; unknown actors are shown as the service sent them. */
export function actorLabel(actor: string | null | undefined): string | null {
  if (!actor) {
    return null;
  }
  switch (actor) {
    case 'RIDER':
      return 'пассажир';
    case 'DRIVER':
      return 'водитель';
    case 'SYSTEM':
      return 'сервис';
    default:
      return actor;
  }
}

/** `12%` from the fare and the commission, or `null` when either is missing. */
export function commissionShare(trip: Pick<Trip, 'commissionMinor' | 'priceMinor'>): string | null {
  const { commissionMinor, priceMinor } = trip;
  if (commissionMinor === null || priceMinor === null || priceMinor <= 0) {
    return null;
  }
  return `${Math.round((commissionMinor / priceMinor) * 100)}%`;
}

/**
 * Commission as a percentage from basis points: `1200` -> `"12%"`.
 *
 * Preferred over dividing the two amounts: basis points are what the pricing table
 * set, and dividing rounded money can show 11,999% as "12%".
 */
export function commissionBpLabel(bp: number | null | undefined): string | null {
  if (typeof bp !== 'number' || !Number.isFinite(bp) || bp < 0) {
    return null;
  }
  const percent = bp / 100;
  return `${Number.isInteger(percent) ? percent : percent.toFixed(1).replace('.', ',')}%`;
}

/**
 * Surge multiplier from basis points: `1500` -> `"×1,15"`.
 *
 * `null` (no badge at all) for zero: a "×1,00" chip on every normal ride would be
 * noise, and the field means "no surge" when it is absent or zero.
 */
export function surgeLabel(surgeBp: number | null | undefined): string | null {
  if (typeof surgeBp !== 'number' || !Number.isFinite(surgeBp) || surgeBp <= 0) {
    return null;
  }
  return `×${(1 + surgeBp / 10_000).toFixed(2).replace('.', ',')}`;
}
