import { describe, expect, it } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
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
 * `/services/bookings` — my QTime bookings.
 *
 * Cancelling is the interesting part: the reason is required, so an empty field must
 * stop the request on the client instead of cancelling a visit anonymously.
 */

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

const CANCELED_BOOKING = { ...BOOKING, status: 'CANCELLED' };

/** The stub keeps its own state: a cancelled booking comes back cancelled. */
function bookingsApi(initialItems: unknown[] = [BOOKING]) {
  let items = initialItems;
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
    if (url.includes('/cancel') && init?.method === 'POST') {
      items = [CANCELED_BOOKING];
      return jsonResponse(CANCELED_BOOKING);
    }
    if (url.includes('/v1/qtime/bookings')) {
      return jsonResponse({ items, totalElements: items.length, page: 0, size: 10 });
    }
    return problemResponse({ code: 'NOT_FOUND', title: 'Not found', status: 404 }, 404);
  });
}

function renderApp() {
  const router = createMemoryRouter(appRoutes, { initialEntries: ['/services/bookings'] });
  return render(
    <QueryClientProvider client={createTestQueryClient()}>
      <AuthProvider>
        <RouterProvider router={router} />
      </AuthProvider>
    </QueryClientProvider>,
  );
}

function cancelPosts(fetchMock: ReturnType<typeof stubFetch>) {
  return fetchMock.mock.calls.filter(
    ([url, init]) => String(url).includes('/cancel') && init?.method === 'POST',
  );
}

describe('my bookings', () => {
  it('lists the bookings with date, people, price and status', async () => {
    seedSession();
    bookingsApi();
    renderApp();

    expect(await screen.findByRole('heading', { level: 1, name: 'Мои записи' })).toBeInTheDocument();
    expect(await screen.findByText(/02.10.2026, 15:30/)).toBeInTheDocument();
    expect(screen.getByText(/Салон «Лотос» · Айгуль · Маникюр с покрытием/)).toBeInTheDocument();
    expect(screen.getByText('4 500,00 ₸')).toBeInTheDocument();
    // Once on the row badge, once as a filter option.
    expect(screen.getAllByText('Подтверждён').length).toBeGreaterThan(0);
    expect(screen.getByText('QT-778812')).toBeInTheDocument();
    // The conditions of a cancellation are the company's, and the contract has none.
    expect(screen.getByText(/Сроки бесплатной отмены задаёт компания/)).toBeInTheDocument();
  });

  it('requires a reason before cancelling and then sends it', async () => {
    seedSession();
    const fetchMock = bookingsApi();
    const user = userEvent.setup();
    renderApp();

    await screen.findByText('QT-778812');
    await user.click(screen.getByRole('button', { name: 'Отменить' }));

    // Empty reason: nothing is sent.
    await user.click(screen.getByRole('button', { name: 'Подтвердить отмену' }));
    expect(await screen.findByText('Укажите причину отмены')).toBeInTheDocument();
    expect(cancelPosts(fetchMock)).toHaveLength(0);

    // Closing the form leaves the booking untouched.
    await user.click(screen.getByRole('button', { name: 'Не отменять' }));
    expect(screen.queryByLabelText(/Причина отмены/)).toBeNull();
    expect(cancelPosts(fetchMock)).toHaveLength(0);

    await user.click(screen.getByRole('button', { name: 'Отменить' }));
    await user.type(screen.getByLabelText(/Причина отмены/), 'не смогу прийти');
    await user.click(screen.getByRole('button', { name: 'Подтвердить отмену' }));

    await waitFor(() => expect(cancelPosts(fetchMock)).toHaveLength(1));
    expect(bodyOf(cancelPosts(fetchMock)[0]?.[1])).toEqual({ reason: 'не смогу прийти' });
    await waitFor(() => expect(screen.getAllByText('Отменён').length).toBeGreaterThan(0));
  });

  it('explains an empty history', async () => {
    seedSession();
    bookingsApi([]);
    renderApp();

    expect(await screen.findByText('Записей пока нет')).toBeInTheDocument();
    expect(screen.getByText(/Выберите компанию и свободное окно/)).toBeInTheDocument();
  });
});
