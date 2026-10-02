import { describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider, createMemoryRouter } from 'react-router-dom';
import { appRoutes } from './routes';
import { AuthProvider } from './auth/AuthContext';
import { clearSession } from './auth/session';
import {
  createTestQueryClient,
  jsonResponse,
  kztAccount,
  problemResponse,
  seedSession,
  stubFetch,
} from './test/utils';

/** Boots the real router (not a single page) against a stubbed API. */
function renderApp(route: string) {
  const router = createMemoryRouter(appRoutes, { initialEntries: [route] });
  return render(
    <QueryClientProvider client={createTestQueryClient()}>
      <AuthProvider>
        <RouterProvider router={router} />
      </AuthProvider>
    </QueryClientProvider>,
  );
}

function demoApi() {
  return stubFetch((url) => {
    if (url.includes('/transactions')) {
      return jsonResponse({ items: [], page: 0, size: 8, totalElements: 0, totalPages: 0, hasNext: false });
    }
    if (url.includes('/v1/accounts')) {
      return jsonResponse([kztAccount]);
    }
    if (url.includes('/v1/auth/me')) {
      return jsonResponse({
        userId: 'U-TEST',
        phone: '+77001234567',
        displayName: 'Тестовый пользователь',
        roles: ['CUSTOMER'],
      });
    }
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
    return problemResponse({ code: 'NOT_FOUND', title: 'Not found', status: 404 }, 404);
  });
}

/**
 * Wiring test for the route table and the protected-route wrapper: the shell, the
 * dashboard and the 404 page must all render through the real router — a broken
 * guard or a route typo is exactly what produces a blank screen in production.
 */
describe('application routes', () => {
  it('guards the app, renders the shell when authenticated and falls back to 404', async () => {
    // 1. No session: every protected path lands on the login screen.
    clearSession();
    demoApi();
    renderApp('/payments');
    expect(await screen.findByRole('heading', { name: 'ORTA' })).toBeInTheDocument();
    expect(screen.getByLabelText(/Номер телефона/)).toBeInTheDocument();
    cleanup();

    // 2. With a session: the dashboard renders inside the app shell.
    seedSession();
    demoApi();
    renderApp('/');
    expect(await screen.findByRole('heading', { name: /Здравствуйте/ })).toBeInTheDocument();
    expect(screen.getByRole('navigation', { name: 'Основная навигация' })).toBeInTheDocument();
    expect(await screen.findByText('Текущий счёт')).toBeInTheDocument();
    // Empty ledger -> an explicit empty state, never a blank panel.
    expect(await screen.findByText('Операций пока нет')).toBeInTheDocument();
    cleanup();

    // 3. An unknown path inside the app renders the 404 page, not a blank screen.
    seedSession();
    demoApi();
    renderApp('/does-not-exist');
    expect(await screen.findByText('Страница не найдена')).toBeInTheDocument();
    expect(screen.getByText('404')).toBeInTheDocument();
  });
});
