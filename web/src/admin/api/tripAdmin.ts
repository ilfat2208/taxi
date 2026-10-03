/**
 * Админский API-слой разделов «Поездки» и «Записи QTime».
 *
 * Общие хелперы переиспользуются как есть: список поездок, деталь поездки и чек идут
 * через `fetchTrips` / `fetchTrip` / `fetchTripReceipt`, список записей — через
 * `fetchBookings`, нормализация — через `normalizeTrip` и `normalizeQtimeBooking`.
 * Здесь лежит только то, чего в общем слое нет и быть не могло:
 *
 *  - `assignTripDriver` — ручное назначение водителя. Клиент такого действия не
 *    делает, поэтому вызова в `src/api/endpoints.ts` нет;
 *  - `cancelTripAsOperator` — отмена поездки оператором. Общий `cancelTrip` шлёт
 *    только `{ reason }`, а DTO принимает ещё `cancelledBy` (RIDER|DRIVER), от
 *    которого зависит итоговый статус: `TripStatus.CANCELLED_BY_RIDER` против
 *    `CANCELLED_BY_DRIVER`;
 *  - `normalizeAdminBooking` / `fetchAdminBooking` / `cancelAdminBooking` — деталь
 *    записи и отмена с необязательным `Idempotency-Key`. Общий
 *    `normalizeQtimeBooking` выбрасывает `clientComment`, `cancelReason`, `createdAt`
 *    и идентификаторы мастера и услуги, а общий `cancelBooking` не умеет слать ключ.
 *
 * Тела запросов и поля ответов сверены с реальными контроллерами и DTO:
 *  - `kz.taxi.trip.api.TripController` (`/api/v1/trips/**`, тела — `TripDtos`);
 *  - `kz.taxi.qtime.api.BookingController` (`/api/v1/qtime/bookings`, тела — `QtimeDtos`);
 *  - кто что может: `kz.taxi.trip.application.TripAccess`, `kz.taxi.qtime.application.QtimeAccess`.
 *
 * Пути — без префикса `/api`: он уже внутри `API_BASE_URL` (см. `src/api/client.ts`).
 */
import { apiRequest } from '../../api/client';
import { normalizeQtimeBooking, normalizeTrip } from '../../api/endpoints';
import type { QtimeBooking, Trip } from '../../api/types';

/* ------------------------------------------------------------------- поездки */

/**
 * Тело `POST /api/v1/trips/{tripId}/assign`.
 *
 * Ровно `TripDtos.AssignDriverRequest` из trip-service: `driverId` обязателен
 * (`@NotBlank`), `driverName` (≤128) и `vehiclePlate` (≤16) — необязательные подсказки
 * диспетчерской консоли. Поля `vehicleId` в контракте нет: привязка машины к водителю
 * живёт в driver-service, поездка знает только `driverId` и необязательный номер.
 */
export interface AssignDriverBody {
  driverId: string;
  /** Не придёт — сервис подставит имя, которое только что отдал driver-service. */
  driverName?: string;
  vehiclePlate?: string;
}

/**
 * Ручное назначение водителя (`POST /api/v1/trips/{tripId}/assign`).
 *
 * `Idempotency-Key` не отправляется намеренно: контроллер этот эндпоинт в
 * `IdempotencyGuard` не оборачивает, а сага сама отвечает на повтор тем же водителем
 * прежней поездкой — «A repeat with the same driver is a no-op and does not reserve
 * twice» (`TripSagaService.assign`). Ключ здесь был бы реквизитом, который сервис не
 * читает.
 *
 * Кого сервис не пустит: `TripAccess.requireAssigner` требует DISPATCHER или ADMIN,
 * статус поездки должен быть `SEARCHING` (`TripSagaService.assign`), иначе — 409
 * `TRIP_NOT_ASSIGNABLE`; занятый водитель — `DRIVER_NOT_AVAILABLE`.
 */
export function assignTripDriver(tripId: string, body: AssignDriverBody): Promise<Trip> {
  const payload: AssignDriverBody = { driverId: body.driverId.trim() };
  const driverName = body.driverName?.trim();
  const vehiclePlate = body.vehiclePlate?.trim();
  if (driverName) {
    payload.driverName = driverName;
  }
  if (vehiclePlate) {
    payload.vehiclePlate = vehiclePlate;
  }

  return apiRequest<unknown>(`/v1/trips/${encodeURIComponent(tripId)}/assign`, {
    method: 'POST',
    body: payload,
  }).then(normalizeTrip);
}

/** Чья сторона отменяет — значения, которые принимает `TripSagaService` (`cancelledBy`). */
export type TripCanceller = 'RIDER' | 'DRIVER';

export interface CancelTripBody {
  /** Обязательна для оператора: без неё сервис отвечает `CANCEL_REASON_REQUIRED`. */
  reason: string;
  cancelledBy?: TripCanceller;
}

/**
 * Отмена поездки оператором (`POST /api/v1/trips/{tripId}/cancel`).
 *
 * Тело — `TripDtos.CancelTripRequest`: `reason` (≤512) и `cancelledBy`
 * (`RIDER`|`DRIVER`, имеет смысл только для оператора). Причина для не-владельца
 * обязательна (`TripAccess.requireCancellationReason`), а итоговый статус выбирает
 * `TripSagaService.operatorCancellationStatus`: `RIDER` — «пассажир передумал»,
 * `DRIVER` — «водитель подвёл»; это разные числа в отчётах.
 *
 * `Idempotency-Key` не отправляется: контроллер отмену ключом не оборачивает, а
 * повторная отмена уже отменённой поездки сама по себе безвредна — сага только
 * доводит до конца освобождение резерва.
 */
export function cancelTripAsOperator(tripId: string, body: CancelTripBody): Promise<Trip> {
  const payload: CancelTripBody = { reason: body.reason.trim() };
  if (body.cancelledBy) {
    payload.cancelledBy = body.cancelledBy;
  }

  return apiRequest<unknown>(`/v1/trips/${encodeURIComponent(tripId)}/cancel`, {
    method: 'POST',
    body: payload,
  }).then(normalizeTrip);
}

/* ------------------------------------------------------------- записи QTime */

/**
 * Запись QTime с полями, которые нужны админке, а в общем типе отсутствуют.
 *
 * `normalizeQtimeBooking` оставляет только то, что читает клиентский экран «мои
 * записи»: без `clientComment`, `cancelReason`, `createdAt` и идентификаторов мастера
 * и услуги. Админке они нужны — комментарий клиента это единственный след клиента в
 * ответе (см. ниже), `cancelReason` объясняет отмену, `createdAt` показывает, когда
 * запись вообще появилась. Сам разбор остальных полей остаётся общим.
 */
export interface AdminBooking extends QtimeBooking {
  /** Идентификатор мастера (в общем типе только имя). */
  specialistId: string | null;
  /** Идентификатор услуги (в общем типе только название). */
  serviceId: string | null;
  /** Комментарий клиента при записи — писал человек, показываем как есть. */
  clientComment: string | null;
  /** Причина отмены, если запись отменена. */
  cancelReason: string | null;
  createdAt: string | null;
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};
}

/** Строка или `null`: числа приводим к строке, всё остальное считаем отсутствующим. */
function optionalText(value: unknown): string | null {
  if (typeof value === 'string') {
    return value;
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(value);
  }
  return null;
}

/** `{...}` и `{booking: {...}}` — оба варианта конверта уже встречались за шлюзом. */
function bookingSource(raw: unknown): Record<string, unknown> {
  const container = asRecord(raw);
  const nested = asRecord(container.booking);
  return Object.keys(nested).length > 0 ? nested : container;
}

/**
 * Разбор ответа QTime для админки: общий нормализатор плюс четыре поля, которые он
 * выбрасывает. Отсутствующее поле остаётся `null`, а не пустой строкой: «не пришло» и
 * «пусто» на экране должны различаться.
 */
export function normalizeAdminBooking(raw: unknown): AdminBooking {
  const booking = bookingSource(raw);
  return {
    ...normalizeQtimeBooking(raw),
    specialistId: optionalText(booking.specialistId),
    serviceId: optionalText(booking.serviceId),
    clientComment: optionalText(booking.clientComment),
    cancelReason: optionalText(booking.cancelReason),
    createdAt: optionalText(booking.createdAt),
  };
}

/**
 * Одна запись по идентификатору (`GET /api/v1/qtime/bookings/{bookingId}`).
 *
 * Общего хелпера для этого эндпоинта в `src/api/endpoints.ts` нет (клиент деталь
 * записи не открывает), поэтому вызов живёт здесь. Доступ: владелец, SUPPORT или
 * ADMIN (`QtimeAccess.requireAccess`), иначе 403.
 */
export function fetchAdminBooking(bookingId: string): Promise<AdminBooking> {
  return apiRequest<unknown>(`/v1/qtime/bookings/${encodeURIComponent(bookingId)}`).then(
    normalizeAdminBooking,
  );
}

/**
 * Отмена записи админкой (`POST /api/v1/qtime/bookings/{bookingId}/cancel`).
 *
 * `Idempotency-Key` здесь осмыслен и поэтому отправляется: контроллер читает его как
 * необязательный (`IdempotencyContext.optional()`) и в javadoc прямо объясняет зачем —
 * повтор успешной отмены без ключа получил бы `409 BOOKING_NOT_CANCELLABLE`, то есть
 * клиент, у которого всё получилось, увидел бы отказ. Общий `cancelBooking` ключ не
 * принимает, поэтому вызов собирается здесь.
 *
 * Тело — `QtimeDtos.CancelBookingRequest`: только `reason` (≤255), необязательный по
 * контракту. Результат зависит от роли вызывающего: ADMIN отменяет как компания и
 * получает `CANCELLED_BY_COMPANY`, все остальные — `CANCELLED_BY_CLIENT`
 * (`QtimeAccess.isCompanySide`).
 *
 * Отменить можно только `CONFIRMED`: остальные статусы терминальные
 * (`BookingStatus`), и попытка даёт 409 `BOOKING_NOT_CANCELLABLE`.
 */
export function cancelAdminBooking(
  bookingId: string,
  body: { reason: string },
  idempotencyKey?: string,
): Promise<AdminBooking> {
  return apiRequest<unknown>(`/v1/qtime/bookings/${encodeURIComponent(bookingId)}/cancel`, {
    method: 'POST',
    body: { reason: body.reason.trim() },
    idempotencyKey,
  }).then(normalizeAdminBooking);
}
