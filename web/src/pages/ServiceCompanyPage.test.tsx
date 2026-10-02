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
  deferred,
  headerOf,
  jsonResponse,
  problemResponse,
  seedSession,
  stubFetch,
  type MockResponse,
} from '../test/utils';

/**
 * `/services/:companyId` — booking a visit through QTime.
 *
 * The important behaviours: a window the service marked unavailable is visible but
 * not selectable, the booking is sent once per intent with an `Idempotency-Key`, and
 * a day without free windows says so instead of drawing an empty grid.
 */

const COMPANY = {
  companyId: 'c-1',
  name: 'Салон «Лотос»',
  category: 'Красота',
  city: 'Шымкент',
  address: 'ул. Байтурсынова, 12',
  ratingBp: 480,
  reviewsCount: 312,
  specialistsCount: 1,
  servicesCount: 1,
  minPriceMinor: 450_000,
  specialists: [
    {
      specialistId: 's-1',
      name: 'Айгуль',
      specialization: 'мастер маникюра',
      ratingBp: 490,
      experienceYears: 6,
    },
  ],
  services: [
    {
      serviceId: 'sv-1',
      name: 'Маникюр с покрытием',
      durationMinutes: 90,
      priceMinor: 450_000,
      currency: 'KZT',
    },
  ],
};

const BOOKING = {
  bookingId: 'b-1',
  code: 'QT-778812',
  status: 'CONFIRMED',
  startsAt: '2026-10-02T15:30:00+05:00',
  endsAt: '2026-10-02T17:00:00+05:00',
  companyId: 'c-1',
  companyName: 'Салон «Лотос»',
  companyAddress: 'ул. Байтурсынова, 12',
  specialistName: 'Айгуль',
  serviceName: 'Маникюр с покрытием',
  durationMinutes: 90,
  priceMinor: 450_000,
  currency: 'KZT',
};

/** Slots are generated for whatever day the screen asks about. */
function slotsFor(url: string, available: boolean) {
  const date = /date=([\d-]+)/.exec(url)?.[1] ?? '2026-10-02';
  if (!available) {
    return { date, specialistId: 's-1', serviceId: 'sv-1', durationMinutes: 90, timezone: 'Asia/Almaty', slots: [] };
  }
  return {
    date,
    specialistId: 's-1',
    serviceId: 'sv-1',
    durationMinutes: 90,
    timezone: 'Asia/Almaty',
    slots: [
      // The service writes the reason for a person; the cell shows its wording.
      { startsAt: `${date}T10:00:00+05:00`, endsAt: `${date}T11:30:00+05:00`, available: false, reason: 'перерыв' },
      { startsAt: `${date}T11:30:00+05:00`, endsAt: `${date}T13:00:00+05:00`, available: false, reason: null },
      { startsAt: `${date}T13:00:00+05:00`, endsAt: `${date}T14:30:00+05:00`, available: true, reason: null },
      { startsAt: `${date}T15:30:00+05:00`, endsAt: `${date}T17:00:00+05:00`, available: true, reason: null },
    ],
  };
}

interface Options {
  available?: boolean;
  bookingPending?: ReturnType<typeof deferred<MockResponse>>;
  bookingProblem?: boolean;
}

function companyApi(options: Options = {}) {
  const { available = true, bookingPending, bookingProblem } = options;
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
    if (url.includes('/v1/qtime/specialists/s-1/slots')) {
      return jsonResponse(slotsFor(url, available));
    }
    if (url.includes('/v1/qtime/bookings') && init?.method === 'POST') {
      if (bookingPending) {
        return bookingPending.promise;
      }
      if (bookingProblem) {
        return problemResponse(
          { code: 'SLOT_TAKEN', title: 'Окно занято', status: 409, detail: 'окно уже забронировано' },
          409,
        );
      }
      return jsonResponse(BOOKING, 201);
    }
    if (url.includes('/v1/qtime/companies/c-1')) {
      return jsonResponse(COMPANY);
    }
    return problemResponse({ code: 'NOT_FOUND', title: 'Not found', status: 404 }, 404);
  });
}

function renderApp() {
  const router = createMemoryRouter(appRoutes, { initialEntries: ['/services/c-1'] });
  return render(
    <QueryClientProvider client={createTestQueryClient()}>
      <AuthProvider>
        <RouterProvider router={router} />
      </AuthProvider>
    </QueryClientProvider>,
  );
}

function cardByHeader(title: string): HTMLElement {
  const header = screen.getByText(title);
  const section = header.closest('section');
  if (!section) {
    throw new Error(`Карточка «${title}» не найдена`);
  }
  return section;
}

function bookingPosts(fetchMock: ReturnType<typeof stubFetch>) {
  return fetchMock.mock.calls.filter(
    ([url, init]) => String(url).includes('/v1/qtime/bookings') && init?.method === 'POST',
  );
}

/** Picks the specialist, the service and the 15:30 window. */
async function chooseEverything(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByRole('button', { name: /Айгуль/ }));
  await user.click(await screen.findByRole('button', { name: /Маникюр с покрытием/ }));
  const slot = await screen.findByRole('button', { name: '15:30' });
  await user.click(slot);
}

describe('company booking screen', () => {
  it('shows specialists, services and the free windows of the chosen day', async () => {
    seedSession();
    companyApi();
    renderApp();

    expect(await screen.findByRole('heading', { level: 1, name: 'Салон «Лотос»' })).toBeInTheDocument();
    expect(screen.getByText('★ 4,8')).toBeInTheDocument();
    expect(screen.getByText(/Шымкент · ул. Байтурсынова, 12/)).toBeInTheDocument();

    // The catalogue of the company.
    expect(await screen.findByRole('button', { name: /Айгуль/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Маникюр с покрытием/ })).toBeInTheDocument();
    expect(screen.getByText('4 500,00 ₸')).toBeInTheDocument();

    // No specialist or service chosen yet: the grid explains the dependency.
    expect(screen.getByText('Выберите специалиста и услугу')).toBeInTheDocument();

    await userEvent.setup().click(screen.getByRole('button', { name: /Маникюр с покрытием/ }));

    // 14 bookable days, «сегодня» first.
    expect(screen.getByText(/14 дней вперёд/)).toBeInTheDocument();
    expect(screen.getByText('сегодня')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /^(сегодня|пн|вт|ср|чт|пт|сб|вс)/ }).length).toBeGreaterThanOrEqual(14);
  });

  it('offers free windows and refuses to select a busy one', async () => {
    seedSession();
    const fetchMock = companyApi();
    const user = userEvent.setup();
    renderApp();

    await user.click(await screen.findByRole('button', { name: /Айгуль/ }));
    await user.click(screen.getByRole('button', { name: /Маникюр с покрытием/ }));

    const busy = await screen.findByRole('button', { name: /10:00/ });
    expect(busy).toBeDisabled();
    // The wording is the service's own («перерыв»), not a hardcoded guess.
    expect(within(busy).getByText('перерыв')).toBeInTheDocument();
    // Without a reason the cell falls back to «занято».
    const taken = screen.getByRole('button', { name: /11:30/ });
    expect(taken).toBeDisabled();
    expect(within(taken).getByText('занято')).toBeInTheDocument();
    const free = screen.getByRole('button', { name: '13:00' });
    expect(free).toBeEnabled();

    // The request really carried the pair and a date.
    const slotsCall = fetchMock.mock.calls.find(([url]) =>
      String(url).includes('/v1/qtime/specialists/s-1/slots'),
    );
    const slotsUrl = String(slotsCall?.[0]);
    expect(slotsUrl).toContain('serviceId=sv-1');
    expect(slotsUrl).toMatch(/date=\d{4}-\d{2}-\d{2}/);

    // Clicking the busy window changes nothing: the confirmation stays empty.
    await user.click(busy);
    expect(screen.queryByRole('button', { name: /Записаться · / })).toBeNull();

    // A free one fills the confirmation with what the service returned.
    await user.click(free);
    const confirmation = cardByHeader('Подтверждение записи');
    expect(within(confirmation).getByText('Айгуль')).toBeInTheDocument();
    expect(within(confirmation).getByText('Маникюр с покрытием')).toBeInTheDocument();
    expect(within(confirmation).getByText(/13:00/)).toBeInTheDocument();
    expect(within(confirmation).getByText('1 ч 30 мин')).toBeInTheDocument();
    expect(within(confirmation).getByText('4 500,00 ₸')).toBeInTheDocument();
  });

  it('says a day has no free windows instead of drawing an empty grid', async () => {
    seedSession();
    companyApi({ available: false });
    const user = userEvent.setup();
    renderApp();

    await user.click(await screen.findByRole('button', { name: /Айгуль/ }));
    await user.click(screen.getByRole('button', { name: /Маникюр с покрытием/ }));

    expect(await screen.findByText('Нет свободных окон на эту дату')).toBeInTheDocument();
  });

  it('books once with an Idempotency-Key and shows the code', async () => {
    seedSession();
    const fetchMock = companyApi();
    const user = userEvent.setup();
    renderApp();

    await chooseEverything(user);

    const book = await screen.findByRole('button', { name: /Записаться · / });
    await user.click(book);

    expect(await screen.findByText('Запись создана')).toBeInTheDocument();
    expect(screen.getByText(/QT-778812/)).toBeInTheDocument();

    const posts = bookingPosts(fetchMock);
    expect(posts).toHaveLength(1);
    expect(headerOf(posts[0]?.[1], 'Idempotency-Key')).toBeTruthy();
    expect(bodyOf(posts[0]?.[1])).toMatchObject({
      specialistId: 's-1',
      serviceId: 'sv-1',
    });
    expect(bodyOf<{ startsAt: string }>(posts[0]?.[1]).startsAt).toMatch(/T15:30:00\+05:00$/);
  });

  it('cannot book twice from a double click', async () => {
    seedSession();
    const pending = deferred<MockResponse>();
    const fetchMock = companyApi({ bookingPending: pending });
    const user = userEvent.setup();
    renderApp();

    await chooseEverything(user);

    const book = await screen.findByRole('button', { name: /Записаться · / });
    await user.click(book);
    await waitFor(() => expect(book).toBeDisabled());
    await user.click(book);
    await user.click(book);

    expect(bookingPosts(fetchMock)).toHaveLength(1);

    pending.resolve(jsonResponse(BOOKING, 201));
    expect(await screen.findByText('Запись создана')).toBeInTheDocument();
    expect(bookingPosts(fetchMock)).toHaveLength(1);
  });

  it('explains a window taken by somebody else', async () => {
    seedSession();
    const fetchMock = companyApi({ bookingProblem: true });
    const user = userEvent.setup();
    renderApp();

    await chooseEverything(user);
    await user.click(await screen.findByRole('button', { name: /Записаться · / }));

    expect(await screen.findByText('Это окно уже заняли')).toBeInTheDocument();
    expect(bookingPosts(fetchMock)).toHaveLength(1);
  });
});
