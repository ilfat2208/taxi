import { describe, expect, it } from 'vitest';
import { IDEMPOTENCY_HEADER } from '../../api/client';
import { isApiError } from '../../api/errors';
import { bodyOf, headerOf, jsonResponse, problemResponse, stubFetch } from '../../test/utils';
import {
  assignTripDriver,
  cancelAdminBooking,
  cancelTripAsOperator,
  fetchAdminBooking,
  normalizeAdminBooking,
  toCsv,
} from './tripAdmin';

/**
 * Админский API-слой разделов «Поездки» и «Записи QTime».
 *
 * Образцы ответов скопированы из DTO сервисов (`TripDtos.TripResponse`,
 * `QtimeDtos.BookingResponse`) — так же, как в `src/api/endpoints.test.ts`. Проверяется
 * главное: тела запросов совпадают с тем, что принимают контроллеры, лишних заголовков нет,
 * а нормализатор не превращает отсутствующее поле в пустую строку или ноль.
 */

const TRIP_VIEW = {
  tripId: 'trip-1',
  tripNumber: 'T-101',
  status: 'ASSIGNED',
  riderUserId: 'U-RIDER-1',
  driverId: 'D-9',
  driverName: 'Айдар Сериков',
  vehiclePlate: '123ABC02',
  tariff: 'ECONOMY',
  pickup: { lat: 42.317, lon: 69.586, address: 'Абая 150' },
  dropoff: { lat: 42.341, lon: 69.601, address: 'Байтурсынова 12' },
  distanceM: 6400,
  durationS: 1080,
  priceMinor: 132_600,
  commissionBp: 1200,
  commissionMinor: 15_912,
  driverNetMinor: 116_688,
  currency: 'KZT',
  holdId: 'hold-1',
  holdStatus: 'ACTIVE',
  cancelReason: null,
  ratingStars: null,
  ratingComment: null,
  requestedAt: '2026-10-02T10:00:00Z',
  assignedAt: '2026-10-02T10:01:00Z',
  arrivedAt: null,
  startedAt: null,
  completedAt: null,
  cancelledAt: null,
  timeline: [
    { status: 'SEARCHING', at: '2026-10-02T10:00:00Z', actor: 'RIDER' },
    { status: 'ASSIGNED', at: '2026-10-02T10:01:00Z', actor: 'DISPATCHER' },
  ],
  receipt: null,
};

/** Ровно то, что собирает `QtimeMapper.toBooking` (`QtimeDtos.BookingResponse`). */
const BOOKING_RESPONSE = {
  bookingId: 'b-1',
  code: 'QT-778812',
  status: 'CONFIRMED',
  startsAt: '2026-10-02T15:30:00+05:00',
  endsAt: '2026-10-02T17:00:00+05:00',
  companyId: 'c-1',
  companyName: 'Салон «Лотос»',
  companyAddress: 'ул. Байтурсынова, 12',
  specialistId: 'sp-1',
  specialistName: 'Айгуль',
  serviceId: 'sv-1',
  serviceName: 'Маникюр с покрытием',
  durationMinutes: 90,
  priceMinor: 450_000,
  currency: 'KZT',
  clientComment: 'Прошу без лака',
  cancelReason: null,
  createdAt: '2026-10-01T09:00:00Z',
};

describe('assignTripDriver', () => {
  it('шлёт тело AssignDriverRequest и читает ответ как поездку', async () => {
    const fetchMock = stubFetch(() => jsonResponse(TRIP_VIEW));

    const trip = await assignTripDriver('trip-1', {
      driverId: 'D-9',
      driverName: 'Айдар Сериков',
      vehiclePlate: '123ABC02',
    });

    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(String(url)).toBe('/api/v1/trips/trip-1/assign');
    expect(init?.method).toBe('POST');
    expect(bodyOf(init)).toEqual({
      driverId: 'D-9',
      driverName: 'Айдар Сериков',
      vehiclePlate: '123ABC02',
    });
    // Контроллер назначение ключом идемпотентности не оборачивает — заголовка быть не должно.
    expect(headerOf(init, IDEMPOTENCY_HEADER)).toBeUndefined();

    expect(trip.tripId).toBe('trip-1');
    expect(trip.status).toBe('ASSIGNED');
    expect(trip.driverName).toBe('Айдар Сериков');
    expect(trip.timeline).toHaveLength(2);
  });

  it('не отправляет пустые необязательные поля и обрезает пробелы', async () => {
    const fetchMock = stubFetch(() => jsonResponse(TRIP_VIEW));

    await assignTripDriver('trip-1', { driverId: ' D-9 ', driverName: '   ', vehiclePlate: '' });

    const [, init] = fetchMock.mock.calls[0] ?? [];
    expect(bodyOf(init)).toEqual({ driverId: 'D-9' });
  });

  it('отдаёт отказ сервиса как ApiError с кодом', async () => {
    stubFetch(() =>
      problemResponse(
        {
          status: 409,
          code: 'TRIP_NOT_ASSIGNABLE',
          title: 'Конфликт состояния',
          detail: 'у поездки уже есть водитель',
        },
        409,
      ),
    );

    await expect(assignTripDriver('trip-1', { driverId: 'D-9' })).rejects.toSatisfy(
      (error: unknown) => isApiError(error) && error.code === 'TRIP_NOT_ASSIGNABLE',
    );
  });
});

describe('cancelTripAsOperator', () => {
  it('шлёт причину и сторону отмены (cancelledBy)', async () => {
    const fetchMock = stubFetch(() =>
      jsonResponse({ ...TRIP_VIEW, status: 'CANCELLED_BY_DRIVER', cancelReason: 'водитель не выехал' }),
    );

    const trip = await cancelTripAsOperator('trip-1', {
      reason: 'водитель не выехал',
      cancelledBy: 'DRIVER',
    });

    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(String(url)).toBe('/api/v1/trips/trip-1/cancel');
    expect(init?.method).toBe('POST');
    expect(bodyOf(init)).toEqual({ reason: 'водитель не выехал', cancelledBy: 'DRIVER' });
    expect(trip.status).toBe('CANCELLED_BY_DRIVER');
    expect(trip.cancelReason).toBe('водитель не выехал');
  });

  it('без cancelledBy оставляет поле за сервером', async () => {
    const fetchMock = stubFetch(() => jsonResponse({ ...TRIP_VIEW, status: 'CANCELLED_BY_RIDER' }));

    await cancelTripAsOperator('trip-1', { reason: 'пассажир передумал' });

    const [, init] = fetchMock.mock.calls[0] ?? [];
    expect(bodyOf(init)).toEqual({ reason: 'пассажир передумал' });
  });
});

describe('нормализация записи QTime для админки', () => {
  it('читает все поля BookingResponse, включая те, что выбрасывает общий нормализатор', () => {
    const booking = normalizeAdminBooking(BOOKING_RESPONSE);

    expect(booking.bookingId).toBe('b-1');
    expect(booking.code).toBe('QT-778812');
    expect(booking.status).toBe('CONFIRMED');
    expect(booking.priceMinor).toBe(450_000);
    expect(booking.currency).toBe('KZT');
    expect(booking.specialistId).toBe('sp-1');
    expect(booking.serviceId).toBe('sv-1');
    expect(booking.clientComment).toBe('Прошу без лака');
    expect(booking.createdAt).toBe('2026-10-01T09:00:00Z');
    expect(booking.cancelReason).toBeNull();
  });

  it('разбирает конверт {booking: {...}} и оставляет отсутствующее отсутствующим', () => {
    const booking = normalizeAdminBooking({
      booking: { bookingId: 'b-2', status: 'NO_SHOW', startsAt: '2026-10-03T10:00:00Z' },
    });

    expect(booking.bookingId).toBe('b-2');
    expect(booking.status).toBe('NO_SHOW');
    // Мусор на входе не должен превращаться в пустые строки: экран различает «не пришло» и «пусто».
    expect(booking.clientComment).toBeNull();
    expect(booking.cancelReason).toBeNull();
    expect(booking.createdAt).toBeNull();
    expect(booking.specialistId).toBeNull();
    expect(booking.serviceId).toBeNull();
    expect(booking.priceMinor).toBeNull();
    expect(booking.companyName).toBeNull();
  });

  it('терпит не объект на входе', () => {
    const booking = normalizeAdminBooking(null);
    expect(booking.bookingId).toBe('');
    expect(booking.createdAt).toBeNull();
  });
});

describe('fetchAdminBooking', () => {
  it('запрашивает деталь записи по идентификатору', async () => {
    const fetchMock = stubFetch(() => jsonResponse(BOOKING_RESPONSE));

    const booking = await fetchAdminBooking('b-1');

    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(String(url)).toBe('/api/v1/qtime/bookings/b-1');
    expect(init?.method ?? 'GET').toBe('GET');
    expect(booking.companyName).toBe('Салон «Лотос»');
    expect(booking.specialistId).toBe('sp-1');
    expect(booking.clientComment).toBe('Прошу без лака');
  });

  it('кодирует идентификатор в пути', async () => {
    const fetchMock = stubFetch(() => jsonResponse(BOOKING_RESPONSE));

    await fetchAdminBooking('b/1 2');

    expect(String(fetchMock.mock.calls[0]?.[0])).toBe('/api/v1/qtime/bookings/b%2F1%202');
  });
});

describe('cancelAdminBooking', () => {
  it('шлёт причину и необязательный Idempotency-Key, читая ответ компании', async () => {
    const fetchMock = stubFetch(() =>
      jsonResponse({
        ...BOOKING_RESPONSE,
        status: 'CANCELLED_BY_COMPANY',
        cancelReason: 'мастер заболел',
      }),
    );

    const cancelled = await cancelAdminBooking(
      'b-1',
      { reason: ' мастер заболел ' },
      'idem-key-1',
    );

    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(String(url)).toBe('/api/v1/qtime/bookings/b-1/cancel');
    expect(init?.method).toBe('POST');
    expect(bodyOf(init)).toEqual({ reason: 'мастер заболел' });
    // Ключ необязателен, но осмыслен: повтор успешной отмены без него получил бы 409.
    expect(headerOf(init, IDEMPOTENCY_HEADER)).toBe('idem-key-1');
    expect(cancelled.status).toBe('CANCELLED_BY_COMPANY');
    expect(cancelled.cancelReason).toBe('мастер заболел');
  });

  it('без ключа заголовок не отправляется', async () => {
    const fetchMock = stubFetch(() => jsonResponse(BOOKING_RESPONSE));

    await cancelAdminBooking('b-1', { reason: 'перенос' });

    const [, init] = fetchMock.mock.calls[0] ?? [];
    expect(headerOf(init, IDEMPOTENCY_HEADER)).toBeUndefined();
  });

  it('показывает отказ BOOKING_NOT_CANCELLABLE как ApiError', async () => {
    stubFetch(() =>
      problemResponse(
        {
          status: 409,
          code: 'BOOKING_NOT_CANCELLABLE',
          title: 'Конфликт состояния',
          detail: 'booking b-1 is COMPLETED and can no longer be cancelled',
        },
        409,
      ),
    );

    await expect(cancelAdminBooking('b-1', { reason: 'поздно' })).rejects.toSatisfy(
      (error: unknown) => isApiError(error) && error.code === 'BOOKING_NOT_CANCELLABLE',
    );
  });
});

describe('экспорт загруженных строк в CSV', () => {
  it('собирает шапку и строки через точку с запятой', () => {
    const csv = toCsv(
      ['tripId', 'status', 'priceMinor'],
      [
        ['trip-1', 'COMPLETED', 132_600],
        ['trip-2', 'SEARCHING', null],
      ],
    );

    expect(csv).toBe(
      ['tripId;status;priceMinor', 'trip-1;COMPLETED;132600', 'trip-2;SEARCHING;'].join('\r\n'),
    );
  });

  it('экранирует кавычки и разделители по RFC 4180', () => {
    const csv = toCsv(['driverName'], [['Айдар "Терминал"'], ['Сериков; младший'], ['строка\nвторая']]);

    expect(csv.split('\r\n')).toEqual([
      'driverName',
      '"Айдар ""Терминал"""',
      '"Сериков; младший"',
      '"строка\nвторая"',
    ]);
  });

  it('не выдумывает данные: пустой список даёт только шапку', () => {
    expect(toCsv(['code', 'status'], [])).toBe('code;status');
  });
});
