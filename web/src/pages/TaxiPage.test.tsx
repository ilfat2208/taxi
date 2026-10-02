import { describe, expect, it } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider, createMemoryRouter } from 'react-router-dom';
import { appRoutes } from '../routes';
import { AuthProvider } from '../auth/AuthContext';
import {
  bodyOf,
  createTestQueryClient,
  deferred,
  headerOf,
  jsonResponse,
  problemResponse,
  seedSession,
  stubFetch,
  type MockResponse,
} from '../test/utils';

/**
 * `/taxi` — ordering a ride.
 *
 * The page runs against a stubbed `fetch`, so the test asserts on the contract the
 * screen really consumes: two quotes (one per tariff), the `Idempotency-Key` on the
 * order, and the navigation to `/taxi/:tripId` that follows a `202`.
 */

const QUOTE_EXPIRES_AT = '2026-10-02T10:12:00+05:00';

function quotePayload(tariff: string, priceMinor: number) {
  return {
    quoteId: `quote-${tariff.toLowerCase()}`,
    tariff,
    distanceM: 6400,
    durationS: 1080,
    priceMinor,
    currency: 'KZT',
    commissionMinor: Math.round(priceMinor * 0.12),
    driverNetMinor: priceMinor - Math.round(priceMinor * 0.12),
    surgeBp: 0,
    breakdown: {
      baseMinor: 45_000,
      distanceMinor: 76_800,
      timeMinor: 63_000,
    },
    expiresAt: QUOTE_EXPIRES_AT,
  };
}

const COMPLETED_TRIP = {
  tripId: 'trip-old',
  tripNumber: 'T-100',
  status: 'COMPLETED',
  tariff: 'ECONOMY',
  pickup: { lat: 42.3155, lon: 69.5867, address: 'пр. Тауке хана, 60' },
  dropoff: { lat: 42.3, lon: 69.6, address: 'пр. Республики, 12' },
  currency: 'KZT',
  priceMinor: 132_600,
  timeline: [],
  requestedAt: '2026-10-01T10:00:00+05:00',
};

interface Options {
  trips?: unknown[];
  tripsTotal?: number;
  createTripProblem?: boolean;
  createTripPending?: ReturnType<typeof deferred<MockResponse>>;
}

function taxiApi(options: Options = {}) {
  const { trips = [COMPLETED_TRIP], tripsTotal = trips.length, createTripProblem, createTripPending } = options;
  return stubFetch((url, init) => {
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
    if (url.includes('/v1/trips/quote')) {
      const body = bodyOf<{ tariff: string }>(init);
      return jsonResponse(
        body.tariff === 'COMFORT' ? quotePayload('COMFORT', 184_800) : quotePayload('ECONOMY', 132_600),
      );
    }
    if (url.includes('/v1/trips') && init?.method === 'POST') {
      if (createTripPending) {
        return createTripPending.promise;
      }
      if (createTripProblem) {
        return problemResponse(
          { code: 'SERVICE_UNAVAILABLE', title: 'Недоступно', status: 503, detail: 'trip-service не отвечает' },
          503,
          'corr-trip-1',
        );
      }
      return jsonResponse(
        {
          tripId: 'trip-1',
          tripNumber: 'T-101',
          status: 'SEARCHING',
          priceMinor: 132_600,
          currency: 'KZT',
          requestedAt: '2026-10-02T10:07:00+05:00',
        },
        202,
      );
    }
    if (url.includes('/v1/trips/trip-1')) {
      return jsonResponse({
        tripId: 'trip-1',
        tripNumber: 'T-101',
        status: 'COMPLETED',
        tariff: 'ECONOMY',
        pickup: { lat: 42.3155, lon: 69.5867, address: 'пр. Тауке хана, 60' },
        dropoff: { lat: 42.3, lon: 69.6, address: 'пр. Республики, 12' },
        currency: 'KZT',
        priceMinor: 132_600,
        timeline: [],
        completedAt: '2026-10-02T10:40:00+05:00',
      });
    }
    if (url.includes('/v1/trips')) {
      return jsonResponse({
        items: trips,
        page: 0,
        size: 5,
        totalElements: tripsTotal,
        totalPages: 1,
        hasNext: false,
      });
    }
    return problemResponse({ code: 'NOT_FOUND', title: 'Not found', status: 404 }, 404);
  });
}

function renderApp(route = '/taxi') {
  const router = createMemoryRouter(appRoutes, { initialEntries: [route] });
  return render(
    <QueryClientProvider client={createTestQueryClient()}>
      <AuthProvider>
        <RouterProvider router={router} />
      </AuthProvider>
    </QueryClientProvider>,
  );
}

function orderPosts(fetchMock: ReturnType<typeof stubFetch>) {
  return fetchMock.mock.calls.filter(
    ([url, init]) => String(url).endsWith('/v1/trips') && init?.method === 'POST',
  );
}

/** Two demo addresses: point А, then point Б (the picker switches by itself). */
async function pickRoute(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByRole('button', { name: 'пр. Тауке хана, 60' }));
  await user.click(await screen.findByRole('button', { name: 'пр. Республики, 12' }));
}

describe('taxi order screen', () => {
  it('is reachable from the navigation and prices both tariffs from real quotes', async () => {
    seedSession();
    const fetchMock = taxiApi();
    const user = userEvent.setup();
    renderApp();

    // The route exists and the sidebar advertises it (sidebar + tab bar).
    expect(await screen.findByRole('heading', { level: 1, name: 'Такси' })).toBeInTheDocument();
    expect(screen.getAllByRole('link', { name: 'Такси' }).length).toBeGreaterThan(0);

    // The Leaflet map is mounted for the route (the container exists, tiles aside).
    expect(await screen.findByTestId('taxi-map')).toBeInTheDocument();

    // Nothing is quoted before both points exist.
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes('/v1/trips/quote'))).toBe(false);

    await pickRoute(user);

    // One quote per tariff — the contract prices a single tariff per call.
    await waitFor(() => {
      const quoteCalls = fetchMock.mock.calls.filter(([url]) => String(url).includes('/v1/trips/quote'));
      expect(quoteCalls).toHaveLength(2);
    });
    const tariffs = fetchMock.mock.calls
      .filter(([url]) => String(url).includes('/v1/trips/quote'))
      .map(([, init]) => bodyOf<{ tariff: string }>(init).tariff)
      .sort();
    expect(tariffs).toEqual(['COMFORT', 'ECONOMY']);

    // Both cards show the server price, formatted from minor units. The query is
    // scoped to the tariff group: the history below shows the same kind of number.
    const tariffsGroup = await screen.findByRole('radiogroup', { name: 'Тариф' });
    expect(await screen.findByRole('radio', { name: /Эконом/ })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: /Комфорт/ })).toBeInTheDocument();
    expect(within(tariffsGroup).getByText(/1\s326,00\s*₸/u)).toBeInTheDocument();
    expect(within(tariffsGroup).getByText(/1\s848,00\s*₸/u)).toBeInTheDocument();

    // The map draws both chosen points and the straight connector.
    await waitFor(() => expect(document.querySelectorAll('.taxi-point-marker')).toHaveLength(2));
    expect(document.querySelectorAll('.taxi-point-a')).toHaveLength(1);
    expect(document.querySelectorAll('.taxi-point-b')).toHaveLength(1);
  });

  it('shows the history and its empty state instead of a blank block', async () => {
    seedSession();
    taxiApi({ trips: [] });
    renderApp();

    expect(await screen.findByText('Мои поездки')).toBeInTheDocument();
    expect(await screen.findByText('Поездок пока нет')).toBeInTheDocument();
  });

  it('lists the last rides with status, price and a link to the trip', async () => {
    seedSession();
    taxiApi();
    renderApp();

    const link = await screen.findByRole('link', { name: /№ T-100/ });
    expect(link).toHaveAttribute('href', '/taxi/trip-old');
    expect(screen.getByText('Поездка завершена')).toBeInTheDocument();
    expect(screen.getByText(/1\s326,00\s*₸/u)).toBeInTheDocument();
  });

  it('orders once with an Idempotency-Key and opens the trip screen', async () => {
    seedSession();
    const fetchMock = taxiApi();
    const user = userEvent.setup();
    renderApp();

    await pickRoute(user);
    const order = await screen.findByRole('button', { name: /Заказать поездку · / });
    await waitFor(() => expect(order).toBeEnabled());

    await user.click(order);

    // The trip screen of the created ride (h1 is the page header, the card has h2).
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Поездка № T-101' }),
    ).toBeInTheDocument();

    const posts = orderPosts(fetchMock);
    expect(posts).toHaveLength(1);
    const key = headerOf(posts[0]?.[1], 'Idempotency-Key');
    expect(key).toBeTruthy();

    const body = bodyOf<{ quoteId: string; comment?: string }>(posts[0]?.[1]);
    const quoteCalls = fetchMock.mock.calls.filter(([url]) => String(url).includes('/v1/trips/quote'));
    const economyCall = quoteCalls.find(
      ([, init]) => bodyOf<{ tariff: string }>(init).tariff === 'ECONOMY',
    );
    const economyQuote = JSON.parse(String(economyCall?.[1]?.body ?? '{}')) as { pickup: unknown };
    expect(economyQuote.pickup).toEqual({
      lat: 42.3155,
      lon: 69.5867,
      address: 'пр. Тауке хана, 60',
    });
    // The order refers to the quote the rider was shown, not to a re-price.
    expect(body.quoteId).toBe('quote-economy');
  });

  it('cannot order twice from a double click', async () => {
    seedSession();
    const pending = deferred<MockResponse>();
    const fetchMock = taxiApi({ createTripPending: pending });
    const user = userEvent.setup();
    renderApp();

    await pickRoute(user);
    const order = await screen.findByRole('button', { name: /Заказать поездку · / });
    await waitFor(() => expect(order).toBeEnabled());

    await user.click(order);
    await waitFor(() => expect(order).toBeDisabled());
    expect(order).toHaveAttribute('aria-busy', 'true');

    await user.click(order);
    await user.click(order);
    expect(orderPosts(fetchMock)).toHaveLength(1);

    pending.resolve(
      jsonResponse(
        {
          tripId: 'trip-1',
          tripNumber: 'T-101',
          status: 'SEARCHING',
          priceMinor: 132_600,
          currency: 'KZT',
          requestedAt: '2026-10-02T10:07:00+05:00',
        },
        202,
      ),
    );
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Поездка № T-101' }),
    ).toBeInTheDocument();
    expect(orderPosts(fetchMock)).toHaveLength(1);
  });

  it('reuses the key when the rider retries the same order', async () => {
    seedSession();
    const fetchMock = taxiApi({ createTripProblem: true });
    const user = userEvent.setup();
    renderApp();

    await pickRoute(user);
    const order = await screen.findByRole('button', { name: /Заказать поездку · / });
    await waitFor(() => expect(order).toBeEnabled());
    await user.click(order);

    expect(await screen.findByText('Не удалось создать поездку')).toBeInTheDocument();
    expect(await screen.findByText(/corr-trip-1/)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Повторить отправку' }));
    await waitFor(() => expect(orderPosts(fetchMock)).toHaveLength(2));

    const [first, second] = orderPosts(fetchMock);
    expect(headerOf(first?.[1], 'Idempotency-Key')).toBeTruthy();
    expect(headerOf(second?.[1], 'Idempotency-Key')).toBe(headerOf(first?.[1], 'Idempotency-Key'));

    cleanup();
  });

  it('explains the city and the missing geocoder instead of pretending to search', async () => {
    seedSession();
    taxiApi();
    renderApp();

    // Both address fields carry the honest hint: two identical texts on purpose.
    expect(
      (await screen.findAllByText(/Адрес подписывается вручную — геокодер появится позже/)).length,
    ).toBe(2);
    expect(
      screen.getByText(/геокодера и поиска адресов в\s+сервисе пока нет/),
    ).toBeInTheDocument();
    expect(screen.getByText(/Оплата — со счёта ORTA в тенге/)).toBeInTheDocument();
  });
});
