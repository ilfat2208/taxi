import { describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider, createMemoryRouter } from 'react-router-dom';
import * as L from 'leaflet';
import { appRoutes } from '../routes';
import { AuthProvider } from '../auth/AuthContext';
import { SESSION_STORAGE_KEY, clearSession, readSession } from '../auth/session';
import type { Problem } from '../api/types';
import {
  bodyOf,
  createTestQueryClient,
  jsonResponse,
  problemResponse,
  seedSession,
  stubFetch,
  tokenResponse,
  type MockResponse,
} from '../test/utils';

/**
 * Dispatcher console (`/dispatch`, phase Ф1).
 *
 * The map is exercised for real — a stub would not catch "the markers are drawn but
 * the click handler points at the wrong driver". What is stubbed is `fetch`, so the
 * tests assert on the contract the console actually consumes.
 */

/** An unsigned token whose payload carries the roles — the shape `jwt.ts` reads. */
function jwtWithRoles(roles: string[]): string {
  const payload = btoa(JSON.stringify({ sub: 'U-TEST', roles }))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
  return `header.${payload}.signature`;
}

const FRESH_DRIVER = {
  driverId: 'DRV-1',
  displayName: 'Айбек Сериков',
  phone: '+77011112233',
  status: 'ONLINE',
  lat: 43.2401,
  lon: 76.8912,
  headingDeg: 45,
  speedKph: 32.5,
  ageSeconds: 3,
  stale: false,
};

const STALE_DRIVER = {
  driverId: 'DRV-2',
  displayName: 'Данияр Оспанов',
  phone: '+77055556677',
  status: 'BUSY',
  lat: 43.2331,
  lon: 76.9012,
  headingDeg: 180,
  speedKph: 0,
  ageSeconds: 240,
  stale: true,
};

const GENERATED_AT = '2024-09-01T10:00:00Z';

function driversPayload(drivers: unknown[]) {
  return {
    generatedAt: GENERATED_AT,
    staleAfterSeconds: 30,
    onDuty: drivers.length,
    withPosition: drivers.length,
    drivers,
  };
}

function nearestPayload() {
  return {
    generatedAt: GENERATED_AT,
    radiusM: 3000,
    candidates: [
      { driverId: 'DRV-1', displayName: 'Айбек Сериков', distanceM: 0, lat: 43.2401, lon: 76.8912, ageSeconds: 3 },
      { driverId: 'DRV-2', displayName: 'Данияр Оспанов', distanceM: 820, lat: 43.2331, lon: 76.9012, ageSeconds: 240 },
    ],
  };
}

interface ApiOptions {
  drivers?: unknown[];
  driversProblem?: Problem;
  token?: string;
}

/** Every endpoint the shell + the console touch, in one place. */
function dispatchApi(options: ApiOptions = {}) {
  const { drivers = [FRESH_DRIVER, STALE_DRIVER], driversProblem, token } = options;
  return stubFetch((url): MockResponse => {
    if (url.includes('/v1/auth/token')) {
      return jsonResponse(
        tokenResponse({ accessToken: token ?? jwtWithRoles(['DISPATCHER', 'CUSTOMER']), roles: ['DISPATCHER'] }),
      );
    }
    if (url.includes('/v1/auth/me')) {
      return jsonResponse({
        userId: 'U-TEST',
        phone: '+77001234567',
        displayName: 'Диспетчер',
        roles: ['DISPATCHER'],
      });
    }
    if (url.includes('/v1/dispatch/drivers')) {
      return driversProblem
        ? problemResponse(driversProblem, driversProblem.status ?? 500)
        : jsonResponse(driversPayload(drivers));
    }
    if (url.includes('/v1/dispatch/nearest')) {
      return jsonResponse(nearestPayload());
    }
    if (url.includes('/transactions')) {
      return jsonResponse({ items: [], page: 0, size: 8, totalElements: 0, totalPages: 0, hasNext: false });
    }
    if (url.includes('/v1/accounts')) {
      return jsonResponse([]);
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

/** Boots the real router, so the route entry and the navigation item are covered too. */
function renderApp(route = '/dispatch') {
  const router = createMemoryRouter(appRoutes, { initialEntries: [route] });
  return render(
    <QueryClientProvider client={createTestQueryClient()}>
      <AuthProvider>
        <RouterProvider router={router} />
      </AuthProvider>
    </QueryClientProvider>,
  );
}

describe('dispatcher console', () => {
  it('requires the dispatcher role and mints a dev token through the session layer', async () => {
    clearSession();
    // A customer: authenticated, but the token carries no dispatcher role.
    seedSession({ accessToken: jwtWithRoles(['CUSTOMER']), roles: ['CUSTOMER'] });
    const fetchMock = dispatchApi();

    renderApp();

    // The navigation item stays hidden — the console is not advertised to customers.
    await screen.findByRole('heading', { name: 'Диспетчерская' });
    expect(screen.queryByRole('link', { name: 'Диспетчерская' })).toBeNull();

    const button = screen.getByRole('button', { name: 'Получить токен диспетчера' });
    // No polling while the caller has no access: nothing hit /dispatch before the click.
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes('/v1/dispatch/'))).toBe(false);

    fireEvent.click(button);
    expect(await screen.findByTestId('dispatch-map')).toBeInTheDocument();

    const tokenCall = fetchMock.mock.calls.find(([url]) => String(url).includes('/v1/auth/token'));
    expect(tokenCall).toBeDefined();
    expect(bodyOf<{ phone: string; code: string; displayName: string; roles: string[] }>(tokenCall?.[1])).toEqual({
      phone: '+77001234567',
      code: '0000',
      displayName: 'Диспетчер',
      roles: ['DISPATCHER'],
    });

    // The session is written by `auth/session.ts`, not by the page.
    const stored = readSession();
    expect(window.localStorage.getItem(SESSION_STORAGE_KEY)).not.toBeNull();
    expect(stored?.roles).toContain('DISPATCHER');
    expect(await screen.findByRole('link', { name: 'Диспетчерская' })).toBeInTheDocument();
  });

  it('draws one marker per driver, distinguishes stale positions and selects on click', async () => {
    // The role lives in the JWT only: the console must trust the token itself.
    seedSession({ accessToken: jwtWithRoles(['DISPATCHER']), roles: ['CUSTOMER'] });
    dispatchApi();

    const { container } = renderApp();

    // Fleet counters come from the payload, not from counting markers client-side.
    expect(await screen.findByText('На линии')).toBeInTheDocument();
    expect(await screen.findByTestId('dispatch-map')).toBeInTheDocument();
    await waitFor(() => expect(container.querySelectorAll('.taxi-driver-marker')).toHaveLength(2));

    // Fresh and stale drivers are visually different: brand blue vs grey.
    const markers = Array.from(container.querySelectorAll<HTMLElement>('.taxi-driver-marker'));
    const bodies = markers.map((marker) => marker.innerHTML);
    expect(new Set(bodies).size).toBe(2);
    expect(bodies.some((html) => html.includes('#1f5fa9'))).toBe(true);
    expect(bodies.some((html) => html.includes('#94a3b8'))).toBe(true);

    const freshMarker = markers.find((marker) => marker.getAttribute('title') === 'Айбек Сериков');
    expect(freshMarker).toBeDefined();
    fireEvent.click(freshMarker as HTMLElement);

    expect(await screen.findByRole('heading', { name: 'Айбек Сериков' })).toBeInTheDocument();
    expect(screen.getByText('+77011112233')).toBeInTheDocument();
    expect(screen.getByText('33 км/ч')).toBeInTheDocument();
    expect(screen.getByText('3 с назад')).toBeInTheDocument();

    // The shortlist is the `/dispatch/nearest` answer, the driver himself first.
    expect(await screen.findByText('Ближайшие водители')).toBeInTheDocument();
    expect(await screen.findByText('выбранный')).toBeInTheDocument();
    expect(await screen.findByText(/820 м/)).toBeInTheDocument();

    // The stale driver is flagged rather than trusted.
    const staleMarker = Array.from(container.querySelectorAll<HTMLElement>('.taxi-driver-marker')).find(
      (marker) => marker.getAttribute('title') === 'Данияр Оспанов',
    );
    fireEvent.click(staleMarker as HTMLElement);
    expect(await screen.findByRole('heading', { name: 'Данияр Оспанов' })).toBeInTheDocument();
    expect(screen.getByText('Позиция устарела')).toBeInTheDocument();
    expect(screen.getByText('4 мин назад')).toBeInTheDocument();
  });

  it('explains an empty fleet instead of showing a blank map', async () => {
    seedSession({ accessToken: jwtWithRoles(['DISPATCHER']) });
    dispatchApi({ drivers: [] });

    renderApp();

    expect(await screen.findByText('Нет водителей на линии')).toBeInTheDocument();
    expect(screen.queryByText('Выберите водителя')).toBeNull();
  });

  it('renders the server error with its correlation id and removes the map on unmount', async () => {
    seedSession({ accessToken: jwtWithRoles(['DISPATCHER']) });
    dispatchApi({
      driversProblem: {
        code: 'SERVICE_UNAVAILABLE',
        title: 'Сервис недоступен',
        detail: 'dispatch-service недоступен',
        status: 503,
      },
    });

    const { container } = renderApp();

    expect(await screen.findByText('Не удалось загрузить карту водителей')).toBeInTheDocument();
    expect(screen.getByText('dispatch-service недоступен')).toBeInTheDocument();
    expect(screen.getByText(/Correlation ID/)).toBeInTheDocument();

    // Nothing to draw yet, and no half-initialised Leaflet instance left behind.
    expect(container.querySelector('.leaflet-container')).toBeNull();

    cleanup();
    expect(document.querySelector('.leaflet-container')).toBeNull();
  });

  it('destroys the Leaflet instance when the page goes away', async () => {
    seedSession({ accessToken: jwtWithRoles(['DISPATCHER']) });
    dispatchApi();
    const removeSpy = vi.spyOn(L.Map.prototype, 'remove');

    renderApp();
    await screen.findByTestId('dispatch-map');
    expect(removeSpy).not.toHaveBeenCalled();

    cleanup();
    // The effect cleanup really releases the map: without it, a remount (StrictMode,
    // back/forward, route change) would throw "container is already initialized".
    expect(removeSpy).toHaveBeenCalledTimes(1);
    expect(document.querySelector('.leaflet-container')).toBeNull();
  });
});
