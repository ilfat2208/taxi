import { describe, expect, it } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider, createMemoryRouter } from 'react-router-dom';
import { appRoutes } from '../routes';
import { AuthProvider } from '../auth/AuthContext';
import {
  createTestQueryClient,
  jsonResponse,
  problemResponse,
  seedSession,
  stubFetch,
  type MockResponse,
} from '../test/utils';

/**
 * `/services` — the QTime catalogue.
 *
 * The list is a public read: it must be reachable and useful without a session, and
 * a company without a price list must not show "от 0 ₸".
 */

function company(overrides: Record<string, unknown> = {}) {
  return {
    companyId: 'c-1',
    name: 'Салон «Лотос»',
    category: 'Красота',
    city: 'Шымкент',
    address: 'ул. Байтурсынова, 12',
    lat: 42.315,
    lon: 69.59,
    ratingBp: 480,
    reviewsCount: 312,
    specialistsCount: 6,
    servicesCount: 14,
    minPriceMinor: 450_000,
    ...overrides,
  };
}

function cartStub(url: string): MockResponse | undefined {
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
  return undefined;
}

function servicesApi(items: unknown[], problem?: { code: string; message: string }) {
  return stubFetch((url) => {
    const cart = cartStub(url);
    if (cart) {
      return cart;
    }
    if (url.includes('/v1/qtime/companies')) {
      if (problem) {
        return problemResponse(
          { code: problem.code, title: 'Сервис недоступен', status: 503, detail: problem.message },
          503,
          'corr-qtime-1',
        );
      }
      return jsonResponse({
        items,
        totalElements: items.length,
        page: 0,
        size: 12,
      });
    }
    return problemResponse({ code: 'NOT_FOUND', title: 'Not found', status: 404 }, 404);
  });
}

function renderApp(route = '/services') {
  const router = createMemoryRouter(appRoutes, { initialEntries: [route] });
  return render(
    <QueryClientProvider client={createTestQueryClient()}>
      <AuthProvider>
        <RouterProvider router={router} />
      </AuthProvider>
    </QueryClientProvider>,
  );
}

describe('services catalogue', () => {
  it('lists companies with rating, counters and a price from the payload', async () => {
    seedSession();
    servicesApi([
      company(),
      company({
        companyId: 'c-2',
        name: 'Студия «Nail Bar»',
        category: 'Красота',
        city: 'Шымкент',
        ratingBp: 460,
        reviewsCount: 188,
        specialistsCount: 3,
        servicesCount: 9,
        minPriceMinor: 400_000,
      }),
      company({
        companyId: 'c-3',
        name: 'СТО «Мотор»',
        category: 'Авто',
        city: 'Алматы',
        // No rating and no price list: neither may be invented on the card.
        ratingBp: null,
        reviewsCount: null,
        minPriceMinor: null,
      }),
    ]);
    renderApp();

    expect(await screen.findByRole('heading', { level: 1, name: 'Услуги' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Мои записи' })).toHaveAttribute('href', '/services/bookings');

    expect(await screen.findByText('Салон «Лотос»')).toBeInTheDocument();
    expect(screen.getByText('Студия «Nail Bar»')).toBeInTheDocument();
    expect(screen.getByText('СТО «Мотор»')).toBeInTheDocument();

    expect(screen.getByText('★ 4,8 · отзывов: 312')).toBeInTheDocument();
    expect(screen.getByText('от 4 500 ₸')).toBeInTheDocument();
    expect(screen.getByText('от 4 000 ₸')).toBeInTheDocument();
    // The third card shows neither a rating nor a price.
    expect(screen.queryByText('★ 0,0')).toBeNull();
    expect(screen.queryByText('от 0 ₸')).toBeNull();

    // A card links to the company screen.
    expect(screen.getByRole('link', { name: /Салон «Лотос»/ })).toHaveAttribute(
      'href',
      '/services/c-1',
    );
  });

  it('filters by search, category and city through the query string', async () => {
    seedSession();
    const fetchMock = servicesApi([company(), company({ companyId: 'c-3', name: 'СТО «Мотор»', category: 'Авто', city: 'Алматы' })]);
    const user = userEvent.setup();
    renderApp();

    await screen.findByText('Салон «Лотос»');

    await user.type(screen.getByLabelText(/Поиск/), 'маникюр');
    // The search box is debounced: the request carries the settled value.
    await waitFor(() => {
      const searched = fetchMock.mock.calls.some(([url]) =>
        String(url).includes('query=%D0%BC%D0%B0%D0%BD%D0%B8%D0%BA%D1%8E%D1%80'),
      );
      expect(searched).toBe(true);
    });

    // The category options come from the loaded companies, so they can be picked.
    await user.selectOptions(screen.getByLabelText(/Категория/), 'Авто');
    await waitFor(() => {
      const filtered = fetchMock.mock.calls.some(([url]) => String(url).includes('category=%D0%90%D0%B2%D1%82%D0%BE'));
      expect(filtered).toBe(true);
    });

    await user.selectOptions(screen.getByLabelText(/Город/), 'Алматы');
    await waitFor(() => {
      const cityFiltered = fetchMock.mock.calls.some(([url]) =>
        String(url).includes('city=%D0%90%D0%BB%D0%BC%D0%B0%D1%82%D1%8B'),
      );
      expect(cityFiltered).toBe(true);
    });
  });

  it('explains an empty result instead of showing a blank list', async () => {
    seedSession();
    servicesApi([]);
    renderApp();

    expect(await screen.findByText('Компании не найдены')).toBeInTheDocument();
    expect(screen.getByText(/QTime ещё не подключил ни одной компании/)).toBeInTheDocument();
  });

  it('renders a failure with its correlation id', async () => {
    seedSession();
    servicesApi([], { code: 'SERVICE_UNAVAILABLE', message: 'qtime-service недоступен' });
    renderApp();

    expect(await screen.findByText('Не удалось загрузить компании')).toBeInTheDocument();
    expect(screen.getByText('qtime-service недоступен')).toBeInTheDocument();
    expect(screen.getByText(/Correlation ID/)).toBeInTheDocument();
    expect(screen.getByText(/corr-qtime-1/)).toBeInTheDocument();
  });
});
