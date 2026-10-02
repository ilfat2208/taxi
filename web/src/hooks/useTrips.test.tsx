import type { ReactNode } from 'react';
import { act, renderHook } from '@testing-library/react';
import { QueryClientProvider, type QueryClient } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useTrip, routeSignature } from './useTrips';
import {
  createTestQueryClient,
  jsonResponse,
  problemResponse,
  seedSession,
  stubFetch,
} from '../test/utils';

/** The list/detail keys and the polling rule are the interesting part of the hooks. */

function wrapperFor(client: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  };
}

function tripPayload(status: string) {
  return {
    tripId: 'trip-1',
    tripNumber: 'T-1',
    status,
    tariff: 'ECONOMY',
    pickup: { lat: 42.3155, lon: 69.5867, address: 'пр. Тауке хана, 60' },
    dropoff: { lat: 42.3, lon: 69.6, address: 'пр. Республики, 12' },
    currency: 'KZT',
    timeline: [],
  };
}

afterEach(() => {
  vi.useRealTimers();
});

describe('routeSignature', () => {
  it('keys a quote by the points and ignores the typed address', () => {
    const first = routeSignature(
      { lat: 42.3155, lon: 69.5867, address: 'пр. Тауке хана, 60' },
      { lat: 42.3, lon: 69.6, address: 'пр. Республики, 12' },
    );
    const renamed = routeSignature(
      { lat: 42.3155, lon: 69.5867, address: 'площадь Ордабасы' },
      { lat: 42.3, lon: 69.6, address: 'центр' },
    );
    expect(renamed).toBe(first);

    const moved = routeSignature(
      { lat: 42.32, lon: 69.5867, address: 'пр. Тауке хана, 60' },
      { lat: 42.3, lon: 69.6, address: 'пр. Республики, 12' },
    );
    expect(moved).not.toBe(first);
  });

  it('reports "no route" while a point is missing or broken', () => {
    expect(routeSignature(null, null)).toBe('none');
    expect(
      routeSignature(
        { lat: 42.3155, lon: 69.5867, address: 'A' },
        null,
      ),
    ).toBe('none');
    expect(
      routeSignature(
        { lat: Number.NaN, lon: 69.5867, address: 'A' },
        { lat: 42.3, lon: 69.6, address: 'B' },
      ),
    ).toBe('none');
  });
});

describe('useTrip polling', () => {
  it('refreshes an active trip every 2 seconds and stops once it is finished', async () => {
    seedSession();
    vi.useFakeTimers();

    let status = 'SEARCHING';
    const fetchMock = stubFetch((url) => {
      if (url.includes('/v1/trips/trip-1')) {
        return jsonResponse(tripPayload(status));
      }
      return problemResponse({ code: 'NOT_FOUND', title: 'Not found', status: 404 }, 404);
    });
    const tripCalls = () =>
      fetchMock.mock.calls.filter(([url]) => String(url).includes('/v1/trips/trip-1'));

    const client = createTestQueryClient();
    const { result } = renderHook(() => useTrip('trip-1'), { wrapper: wrapperFor(client) });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(result.current.data?.status).toBe('SEARCHING');
    expect(tripCalls()).toHaveLength(1);

    // Still searching: the next two-second tick asks the service again.
    status = 'ASSIGNED';
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2100);
    });
    expect(result.current.data?.status).toBe('ASSIGNED');
    expect(tripCalls()).toHaveLength(2);

    // Terminal status: polling must stop on its own, not run forever.
    status = 'COMPLETED';
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2100);
    });
    expect(result.current.data?.status).toBe('COMPLETED');
    const callsWhenFinished = tripCalls().length;

    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000);
    });
    expect(tripCalls()).toHaveLength(callsWhenFinished);
  });

  it('does not poll at all when polling is switched off', async () => {
    seedSession();
    vi.useFakeTimers();

    const fetchMock = stubFetch((url) =>
      url.includes('/v1/trips/trip-1')
        ? jsonResponse(tripPayload('SEARCHING'))
        : problemResponse({ code: 'NOT_FOUND', title: 'Not found', status: 404 }, 404),
    );

    const client = createTestQueryClient();
    renderHook(() => useTrip('trip-1', { poll: false }), { wrapper: wrapperFor(client) });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });

    const calls = fetchMock.mock.calls.filter(([url]) => String(url).includes('/v1/trips/trip-1'));
    expect(calls).toHaveLength(1);
  });
});
