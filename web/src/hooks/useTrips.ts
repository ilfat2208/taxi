import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  cancelTrip,
  createTrip,
  fetchTrip,
  fetchTripReceipt,
  fetchTrips,
  rateTrip,
  requestTripQuote,
} from '../api/endpoints';
import type { CreateTripRequest, TripPoint, TripQuery, TripTariff } from '../api/types';
import { queryKeys } from '../lib/queryKeys';
import { TRIP_ACTIVE_STATUSES } from '../lib/trips';

/**
 * Taxi server state.
 *
 * Two rhythms live here. A quote is asked for *once per route* — the price of a
 * fixed point pair does not move every two seconds, and re-asking would burn
 * requests on an identical answer; the request is driven by the debounced points
 * in the page. A trip in flight is polled every two seconds, exactly like the
 * dispatcher console: the status is what changes while a rider waits.
 */
export const TRIP_REFETCH_INTERVAL_MS = 2000;

/** Poll ceiling for one trip (~5 min), so nothing polls forever if a ride sticks. */
export const TRIP_POLL_LIMIT = 150;

/** One decimal place is plenty for "the same route"; see `routeSignature`. */
function round5(value: number): string {
  return value.toFixed(5);
}

/**
 * Cache key of a quote: rounded coordinates only.
 *
 * The typed address is deliberately excluded — it cannot change the price (there
 * is no geocoder to re-geocode it with), and including it would fire a fresh
 * request for every keystroke in the address field.
 */
export function routeSignature(pickup: TripPoint | null, dropoff: TripPoint | null): string {
  if (!pickup || !dropoff) {
    return 'none';
  }
  if (
    !Number.isFinite(pickup.lat) ||
    !Number.isFinite(pickup.lon) ||
    !Number.isFinite(dropoff.lat) ||
    !Number.isFinite(dropoff.lon)
  ) {
    return 'none';
  }
  return `${round5(pickup.lat)},${round5(pickup.lon)}|${round5(dropoff.lat)},${round5(dropoff.lon)}`;
}

/** Price for one tariff on one route; disabled until both points exist. */
export function useTripQuote(
  pickup: TripPoint | null,
  dropoff: TripPoint | null,
  tariff: TripTariff,
) {
  const route = routeSignature(pickup, dropoff);
  const ready = route !== 'none';
  return useQuery({
    queryKey: queryKeys.tripQuote(route, tariff),
    queryFn: () => {
      if (!pickup || !dropoff) {
        throw new Error('Точки маршрута не заданы');
      }
      return requestTripQuote({ pickup, dropoff, tariff });
    },
    enabled: ready,
    // A quote has its own `expiresAt`; two minutes of cache keeps the page from
    // re-quoting while the rider types an address, without hiding a stale price.
    staleTime: 2 * 60_000,
    retry: 1,
  });
}

export interface TripQuotes {
  economy: ReturnType<typeof useTripQuote>;
  comfort: ReturnType<typeof useTripQuote>;
  /** True while the two quotes are being fetched for a fixed route. */
  isLoading: boolean;
  /** First failure of either tariff, so the panel can explain it once. */
  error: unknown;
  isError: boolean;
  /** Re-asks both tariffs (new quotes, new ids, new expiry). */
  refetch: () => void;
}

/**
 * Both tariff prices for one route.
 *
 * The contract quotes *one* tariff per call, so showing two prices honestly means
 * two calls — a made-up "Комфорт +40%" would be invented data.
 */
export function useTripQuotes(pickup: TripPoint | null, dropoff: TripPoint | null): TripQuotes {
  const economy = useTripQuote(pickup, dropoff, 'ECONOMY');
  const comfort = useTripQuote(pickup, dropoff, 'COMFORT');
  return {
    economy,
    comfort,
    isLoading: economy.isPending || comfort.isPending,
    error: economy.error ?? comfort.error,
    isError: economy.isError || comfort.isError,
    refetch: () => {
      void economy.refetch();
      void comfort.refetch();
    },
  };
}

/**
 * One trip, polled while it is still moving.
 *
 * Polling stops by itself on a terminal status and after {@link TRIP_POLL_LIMIT}
 * attempts, so a stuck `SEARCHING` trip cannot keep the tab busy forever.
 */
export function useTrip(tripId: string | undefined, options: { poll?: boolean } = {}) {
  const poll = options.poll ?? true;
  return useQuery({
    queryKey: queryKeys.trip(tripId ?? 'none'),
    queryFn: () => fetchTrip(tripId as string),
    enabled: Boolean(tripId),
    retry: 0,
    refetchInterval: (query) => {
      if (!poll) {
        return false;
      }
      const status = query.state.data?.status;
      if (!status || !TRIP_ACTIVE_STATUSES.includes(status)) {
        return false;
      }
      return query.state.dataUpdateCount >= TRIP_POLL_LIMIT ? false : TRIP_REFETCH_INTERVAL_MS;
    },
  });
}

/** Ride history. */
export function useTrips(query: TripQuery) {
  return useQuery({
    queryKey: queryKeys.trips(query),
    queryFn: () => fetchTrips(query),
    staleTime: 10_000,
    placeholderData: (previous) => previous,
  });
}

/**
 * Receipt of a completed ride, when the trip view did not embed one.
 *
 * `retry: 0`: an endpoint that is not deployed yet answers 404/501, and retrying
 * will not make it appear. The caller renders "чек недоступен" rather than an
 * amount it does not have.
 */
export function useTripReceipt(tripId: string | undefined, enabled: boolean) {
  return useQuery({
    queryKey: queryKeys.tripReceipt(tripId ?? 'none'),
    queryFn: () => fetchTripReceipt(tripId as string),
    enabled: Boolean(tripId) && enabled,
    retry: 0,
    staleTime: 60_000,
  });
}

export function useCreateTrip() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ body, idempotencyKey }: { body: CreateTripRequest; idempotencyKey: string }) =>
      createTrip(body, idempotencyKey),
    retry: 0,
    onSuccess: (accepted) => {
      void queryClient.invalidateQueries({ queryKey: ['trips', 'list'] });
      return accepted;
    },
  });
}

export function useCancelTrip() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ tripId, reason }: { tripId: string; reason: string }) =>
      cancelTrip(tripId, { reason }),
    retry: 0,
    onSuccess: (trip) => {
      queryClient.setQueryData(queryKeys.trip(trip.tripId), trip);
      void queryClient.invalidateQueries({ queryKey: ['trips', 'list'] });
    },
  });
}

export function useRateTrip() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      tripId,
      stars,
      comment,
    }: {
      tripId: string;
      stars: number;
      comment?: string;
    }) => rateTrip(tripId, comment && comment.trim() !== '' ? { stars, comment } : { stars }),
    retry: 0,
    onSuccess: (trip) => {
      queryClient.setQueryData(queryKeys.trip(trip.tripId), trip);
      void queryClient.invalidateQueries({ queryKey: ['trips', 'list'] });
    },
  });
}
