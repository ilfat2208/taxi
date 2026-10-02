import { describe, expect, it } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { LoginPage } from '../pages/LoginPage';
import { AuthProvider } from './AuthContext';
import { readSession } from './session';
import { bodyOf, createTestQueryClient, jsonResponse, problemResponse, stubFetch } from '../test/utils';

/** Login screen wired to the real providers, with `fetch` stubbed at the edge. */
function renderLogin() {
  return render(
    <QueryClientProvider client={createTestQueryClient()}>
      <AuthProvider>
        <MemoryRouter initialEntries={['/login']}>
          <Routes>
            <Route path="/login" element={<LoginPage />} />
            <Route path="/" element={<p>Дашборд загружен</p>} />
          </Routes>
        </MemoryRouter>
      </AuthProvider>
    </QueryClientProvider>,
  );
}

describe('login flow (development identity provider)', () => {
  it('exchanges the demo code for a session, requests roles and redirects', async () => {
    const fetchMock = stubFetch((url) => {
      if (url.includes('/v1/auth/token')) {
        return jsonResponse({
          accessToken: 'jwt-1',
          tokenType: 'Bearer',
          expiresIn: 1800,
          userId: 'U-1',
          roles: ['CUSTOMER', 'ADMIN'],
        });
      }
      if (url.includes('/v1/auth/me')) {
        return jsonResponse({
          userId: 'U-1',
          phone: '+77001234567',
          displayName: 'Демо-пользователь',
          roles: ['CUSTOMER', 'ADMIN'],
        });
      }
      return problemResponse({ code: 'NOT_FOUND', title: 'Not Found', status: 404 }, 404);
    });

    const user = userEvent.setup();
    renderLogin();

    // The demo phone is pre-filled so the stack is one click away.
    expect(screen.getByLabelText(/Номер телефона/)).toHaveValue('+7 700 123 45 67');

    await user.click(screen.getByRole('button', { name: 'Ввести 0000' }));
    await user.click(screen.getByLabelText(/Запросить роль ADMIN/));
    await user.click(screen.getByRole('button', { name: 'Войти' }));

    await screen.findByText('Дашборд загружен');

    const tokenCall = fetchMock.mock.calls.find(([input]) => String(input).includes('/v1/auth/token'));
    expect(tokenCall).toBeDefined();
    expect(bodyOf<{ phone: string; code: string; roles: string[] }>(tokenCall?.[1])).toEqual({
      phone: '+77001234567',
      code: '0000',
      roles: ['CUSTOMER', 'ADMIN'],
    });

    const session = readSession();
    expect(session?.accessToken).toBe('jwt-1');
    expect(session?.roles).toEqual(['CUSTOMER', 'ADMIN']);
    expect(session?.displayName).toBe('Демо-пользователь');
    expect(session?.expiresAt).toBeGreaterThan(Date.now());
  });

  it('shows the RFC 7807 failure and keeps the user on the form for a wrong code', async () => {
    stubFetch((url) => {
      if (url.includes('/v1/auth/token')) {
        return problemResponse(
          {
            type: 'https://docs.taxi.local/errors/UNAUTHORIZED',
            title: 'Unauthorized',
            status: 401,
            detail: 'invalid confirmation code',
            code: 'UNAUTHORIZED',
            instance: '/api/v1/auth/token',
          },
          401,
          'corr-login-1',
        );
      }
      return jsonResponse({}, 404);
    });

    const user = userEvent.setup();
    renderLogin();

    await user.click(screen.getByRole('button', { name: 'Ввести 0000' }));
    await user.type(screen.getByLabelText(/Код из SMS/), '1234');
    await user.click(screen.getByRole('button', { name: 'Войти' }));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Неверный код подтверждения');
    expect(alert).toHaveTextContent('Код: UNAUTHORIZED');
    expect(alert).toHaveTextContent('corr-login-1');

    expect(readSession()).toBeNull();
    expect(screen.queryByText('Дашборд загружен')).not.toBeInTheDocument();
    // Still on the form, with the submit button ready for another attempt.
    await waitFor(() => expect(screen.getByRole('button', { name: 'Войти' })).toBeEnabled());
  });
});
