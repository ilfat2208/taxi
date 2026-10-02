import { describe, expect, it } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider, createMemoryRouter } from 'react-router-dom';
import { appRoutes } from '../routes';
import { AuthProvider } from '../auth/AuthContext';
import {
  bodyOf,
  createTestQueryClient,
  jsonResponse,
  problemResponse,
  seedSession,
  stubFetch,
} from '../test/utils';

/**
 * `/taxi/:tripId` — one ride.
 *
 * The cases below are the ones that make this screen honest: no ETA is invented, a
 * cancellation always carries a reason, and a receipt that the service did not send
 * is reported as unavailable instead of being filled with zeros.
 */

interface TripOverrides {
  status?: string;
  ratingStars?: number | null;
  receipt?: unknown;
  driverName?: string | null;
  vehiclePlate?: string | null;
  cancelReason?: string | null;
}

function tripPayload(overrides: TripOverrides = {}) {
  const {
    status = 'SEARCHING',
    ratingStars = null,
    receipt = null,
    driverName = null,
    vehiclePlate = null,
    cancelReason = null,
  } = overrides;
  return {
    tripId: 'trip-1',
    tripNumber: 'T-101',
    status,
    tariff: 'ECONOMY',
    pickup: { lat: 42.3155, lon: 69.5867, address: 'пр. Тауке хана, 60' },
    dropoff: { lat: 42.3, lon: 69.6, address: 'пр. Республики, 12' },
    distanceM: 6400,
    durationS: 1080,
    priceMinor: 132_600,
    commissionMinor: 15_912,
    driverNetMinor: 116_688,
    currency: 'KZT',
    driverName,
    vehiclePlate,
    cancelReason,
    ratingStars,
    requestedAt: '2026-10-02T10:07:00+05:00',
    timeline: [
      { status: 'SEARCHING', at: '2026-10-02T10:07:00+05:00', actor: 'RIDER' },
      { status, at: '2026-10-02T10:08:00+05:00', actor: 'SYSTEM' },
    ],
    receipt,
  };
}

/**
 * The receipt as trip-service answers it (`ReceiptResponse`): flat, with the ledger
 * movement behind the ride and no payment order in the wallet phase.
 */
const RECEIPT = {
  tripId: 'trip-1',
  tripNumber: 'T-101',
  status: 'COMPLETED',
  completedAt: '2026-10-02T10:40:00+05:00',
  tariff: 'ECONOMY',
  distanceM: 6400,
  durationS: 1080,
  breakdown: { baseMinor: 45_000, distanceMinor: 76_800, timeMinor: 10_800 },
  surgeBp: 0,
  priceMinor: 132_600,
  commissionBp: 1200,
  commissionMinor: 15_912,
  driverNetMinor: 116_688,
  currency: 'KZT',
  driverId: 'drv-1',
  driverDisplayName: 'Айдар Сериков',
  holdId: 'hold-1',
  paymentId: null,
  transactionId: '01M4TR7K9QW2LEDGER',
};

interface Options {
  trip?: unknown;
  receipt?: unknown;
  receiptProblem?: boolean;
  cancelProblem?: boolean;
  rateProblem?: number;
}

function tripApi(options: Options = {}) {
  const { trip = tripPayload(), receipt = RECEIPT, receiptProblem, cancelProblem, rateProblem } = options;
  return stubFetch((url) => {
    if (url.includes('/v1/cart')) {
      return jsonResponse({
        items: [],
        itemCount: 0,
        itemsTotalMinor: 0,
        deliveryMinor: 0,
        totalMinor: 0,
        currency: 'KZT',
      });
    }
    if (url.includes('/v1/trips/trip-1/receipt')) {
      return receiptProblem
        ? problemResponse({ code: 'NOT_FOUND', title: 'Чек не найден', status: 404 }, 404, 'corr-receipt-1')
        : jsonResponse(receipt);
    }
    if (url.includes('/v1/trips/trip-1/cancel')) {
      if (cancelProblem) {
        return problemResponse(
          { code: 'CONFLICT', title: 'Нельзя отменить', status: 409, detail: 'поездка уже в пути' },
          409,
        );
      }
      return jsonResponse(tripPayload({ status: 'CANCELLED_BY_RIDER', cancelReason: 'планы изменились' }));
    }
    if (url.includes('/v1/trips/trip-1/rate')) {
      if (rateProblem) {
        return problemResponse(
          { code: 'RATING_ALREADY_EXISTS', title: 'Уже оценено', status: rateProblem, detail: 'оценка уже отправлена' },
          rateProblem,
        );
      }
      return jsonResponse(tripPayload({ status: 'COMPLETED', ratingStars: 5 }));
    }
    if (url.includes('/v1/trips/trip-1')) {
      return jsonResponse(trip);
    }
    if (url.includes('/v1/trips')) {
      return jsonResponse({ items: [], page: 0, size: 5, totalElements: 0, totalPages: 0, hasNext: false });
    }
    return problemResponse({ code: 'NOT_FOUND', title: 'Not found', status: 404 }, 404);
  });
}

function renderApp(tripId = 'trip-1') {
  const router = createMemoryRouter(appRoutes, { initialEntries: [`/taxi/${tripId}`] });
  return render(
    <QueryClientProvider client={createTestQueryClient()}>
      <AuthProvider>
        <RouterProvider router={router} />
      </AuthProvider>
    </QueryClientProvider>,
  );
}

function posts(fetchMock: ReturnType<typeof stubFetch>, fragment: string) {
  return fetchMock.mock.calls.filter(
    ([url, init]) => String(url).includes(fragment) && init?.method === 'POST',
  );
}

/** A status shows up in the badge, the detail rows and the timeline — all of them. */
function expectMentioned(text: string): void {
  expect(screen.getAllByText(text).length).toBeGreaterThan(0);
}

/** The receipt card, found by its header, so amounts can be asserted in isolation. */
function receiptSection(): HTMLElement {
  const header = screen.getByText('Чек поездки');
  const section = header.closest('section');
  if (!section) {
    throw new Error('Чек поездки должен быть карточкой');
  }
  return section;
}

describe('trip screen', () => {
  it('explains the search stage without inventing an arrival time', async () => {
    seedSession();
    tripApi();
    renderApp();

    expect(await screen.findByRole('heading', { level: 1, name: 'Поездка № T-101' })).toBeInTheDocument();
    expectMentioned('Ищем водителя');
    expect(screen.getByText(/Точное время подачи сервис пока не присылает/)).toBeInTheDocument();
    expect(screen.getByText('пр. Тауке хана, 60')).toBeInTheDocument();
    expect(screen.getByText('пр. Республики, 12')).toBeInTheDocument();
    expect(screen.getByText('6,4 км')).toBeInTheDocument();
    expect(screen.getByText('18 мин')).toBeInTheDocument();

    // The timeline is the service's own history.
    expect(screen.getByText('История переходов')).toBeInTheDocument();
    expect(screen.getByText('Кто: пассажир')).toBeInTheDocument();
    expect(screen.getByText('Кто: сервис')).toBeInTheDocument();

    // No countdown anywhere on the screen.
    expect(screen.queryByText(/через \d+ мин/)).toBeNull();

    // The route map is drawn from the points of the trip, without a car marker
    // (the service does not send the driver's position).
    expect(await screen.findByTestId('taxi-map')).toBeInTheDocument();
    expect(screen.getByText(/позицию машины сервис не присылает/)).toBeInTheDocument();
    await waitFor(() => expect(document.querySelectorAll('.taxi-point-marker')).toHaveLength(2));
  });

  it('requires a reason before cancelling, then sends it once', async () => {
    seedSession();
    const fetchMock = tripApi();
    const user = userEvent.setup();
    renderApp();

    await waitFor(() => expectMentioned('Ищем водителя'));

    // Empty reason: the request must not leave the client.
    await user.click(screen.getByRole('button', { name: 'Отменить поездку' }));
    expect(await screen.findByText('Укажите причину отмены')).toBeInTheDocument();
    expect(posts(fetchMock, '/cancel')).toHaveLength(0);

    await user.type(screen.getByLabelText(/Причина отмены/), '  планы изменились  ');
    await user.click(screen.getByRole('button', { name: 'Отменить поездку' }));

    await waitFor(() => expect(posts(fetchMock, '/cancel')).toHaveLength(1));
    expect(bodyOf(posts(fetchMock, '/cancel')[0]?.[1])).toEqual({ reason: 'планы изменились' });

    // The answer is a trip view, and the screen switches to it.
    await waitFor(() => expectMentioned('Отменена вами'));
    expect(screen.getByText('планы изменились')).toBeInTheDocument();
  });

  it('reports a failed cancellation with its correlation id', async () => {
    seedSession();
    const fetchMock = tripApi({ cancelProblem: true });
    const user = userEvent.setup();
    renderApp();

    await waitFor(() => expectMentioned('Ищем водителя'));
    await user.type(screen.getByLabelText(/Причина отмены/), 'не приехал');
    await user.click(screen.getByRole('button', { name: 'Отменить поездку' }));

    expect(await screen.findByText('Не удалось отменить поездку')).toBeInTheDocument();
    expect(await screen.findByText(/Correlation ID/)).toBeInTheDocument();
    expect(posts(fetchMock, '/cancel')).toHaveLength(1);
  });

  it('offers no cancel button while the ride is in progress, and says why', async () => {
    seedSession();
    tripApi({ trip: tripPayload({ status: 'IN_PROGRESS', driverName: 'Айдар', vehiclePlate: '727 ABC 02' }) });
    renderApp();

    expect(await screen.findByText('Отмена во время поездки из приложения недоступна')).toBeInTheDocument();
    expectMentioned('В поездке');
    expect(screen.getByText('Айдар')).toBeInTheDocument();
    expect(screen.getByText('727 ABC 02')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Отменить поездку' })).toBeNull();
    // The driver's position and phone are not in the contract, and we say so.
    expect(screen.getByText(/телефон в ответе сервиса не приходят/)).toBeInTheDocument();
  });

  it('shows the receipt of a finished ride, and refuses to invent one', async () => {
    seedSession();
    tripApi({
      trip: tripPayload({ status: 'COMPLETED', receipt: RECEIPT }),
    });
    renderApp();

    expect(await screen.findByText('Чек поездки')).toBeInTheDocument();
    const receipt = receiptSection();
    expect(within(receipt).getByText('1 326,00 ₸')).toBeInTheDocument();
    expect(within(receipt).getByText('159,12 ₸')).toBeInTheDocument();
    expect(within(receipt).getByText('1 166,88 ₸')).toBeInTheDocument();
    expect(within(receipt).getByText('450,00 ₸')).toBeInTheDocument();
    expect(within(receipt).getByText('768,00 ₸')).toBeInTheDocument();
    // The percentage comes from the basis points of the pricing table.
    expect(within(receipt).getByText('Комиссия платформы 12%')).toBeInTheDocument();
    expect(within(receipt).getByText('Айдар Сериков')).toBeInTheDocument();
    // A wallet ride has no payment order: the ledger movement is named instead.
    expect(within(receipt).getByText('Проводка по счёту')).toBeInTheDocument();
    expect(within(receipt).getByText('01M4TR7K…')).toBeInTheDocument();
    expect(within(receipt).getByText(/деньги двигает проводка по счёту/)).toBeInTheDocument();
    // Nothing is flagged when the fare split adds up.
    expect(screen.queryByText('Суммы в чеке не сходятся')).toBeNull();
  });

  it('loads the receipt separately when the trip view does not embed it', async () => {
    seedSession();
    const fetchMock = tripApi({ trip: tripPayload({ status: 'COMPLETED' }) });
    renderApp();

    // The breakdown of the separately fetched receipt proves it was rendered.
    await waitFor(() =>
      expect(within(receiptSection()).getByText('450,00 ₸')).toBeInTheDocument(),
    );
    expect(
      fetchMock.mock.calls.some(([url]) => String(url).includes('/v1/trips/trip-1/receipt')),
    ).toBe(true);
  });
  it('says the receipt is unavailable instead of printing zeros', async () => {
    seedSession();
    tripApi({ trip: tripPayload({ status: 'COMPLETED' }), receiptProblem: true });
    renderApp();

    expect(await screen.findByText('Чек недоступен')).toBeInTheDocument();
    expect(screen.getByText(/суммы здесь не показываем/)).toBeInTheDocument();
    expect(screen.getByText(/corr-receipt-1/)).toBeInTheDocument();
    // No placeholder arithmetic anywhere on the screen.
    expect(screen.queryByText('0,00 ₸')).toBeNull();
  });

  it('promises the receipt only for a finished ride', async () => {
    seedSession();
    tripApi({ trip: tripPayload({ status: 'ASSIGNED' }) });
    renderApp();

    expect(await screen.findByText('Чек появится после завершения поездки')).toBeInTheDocument();
    expect(screen.queryByText('Чек недоступен')).toBeNull();
  });

  it('rates the driver once and explains the 409 of a second attempt', async () => {
    seedSession();
    const fetchMock = tripApi({ trip: tripPayload({ status: 'COMPLETED', receipt: RECEIPT }) });
    const user = userEvent.setup();
    renderApp();

    await screen.findByText('Оцените водителя');

    // Submitting without stars is refused locally.
    await user.click(screen.getByRole('button', { name: 'Отправить оценку' }));
    expect(await screen.findByText('Поставьте оценку от 1 до 5 звёзд')).toBeInTheDocument();
    expect(posts(fetchMock, '/rate')).toHaveLength(0);

    await user.click(screen.getByRole('button', { name: 'Оценить на 5' }));
    await user.click(screen.getByRole('button', { name: 'Отправить оценку' }));

    await waitFor(() => expect(posts(fetchMock, '/rate')).toHaveLength(1));
    expect(bodyOf(posts(fetchMock, '/rate')[0]?.[1])).toEqual({ stars: 5 });
    expect(await screen.findByText('Спасибо, оценка отправлена')).toBeInTheDocument();
  });

  it('shows an existing rating instead of offering the form again', async () => {
    seedSession();
    tripApi({ trip: tripPayload({ status: 'COMPLETED', ratingStars: 4, receipt: RECEIPT }) });
    renderApp();

    expect(await screen.findByText('Вы оценили поездку на 4 из 5')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Отправить оценку' })).toBeNull();
  });

  it('explains a repeated rating the service refused with 409', async () => {
    seedSession();
    const fetchMock = tripApi({
      trip: tripPayload({ status: 'COMPLETED', receipt: RECEIPT }),
      rateProblem: 409,
    });
    const user = userEvent.setup();
    renderApp();

    await screen.findByText('Оцените водителя');
    await user.click(screen.getByRole('button', { name: 'Оценить на 3' }));
    await user.click(screen.getByRole('button', { name: 'Отправить оценку' }));

    expect(await screen.findByText('Оценка уже отправлена')).toBeInTheDocument();
    expect(posts(fetchMock, '/rate')).toHaveLength(1);
  });

  it('turns the "no drivers" outcome into an honest empty state', async () => {
    seedSession();
    tripApi({ trip: tripPayload({ status: 'NO_DRIVERS_FOUND' }) });
    renderApp();

    await waitFor(() => expectMentioned('Свободных машин рядом нет'));
    expect(screen.getByText(/не списаны и не зарезервированы/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Попробовать снова' })).toHaveAttribute('href', '/taxi');
  });
});
