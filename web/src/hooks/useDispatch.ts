import { useQuery } from '@tanstack/react-query';
import { fetchDispatchDrivers, fetchNearestDrivers } from '../api/endpoints';
import type { DispatchCandidate } from '../api/types';
import { useAuth } from '../auth/AuthContext';
import { queryKeys } from '../lib/queryKeys';

/**
 * Fleet polling.
 *
 * The dispatcher screen is a control room, not a report: two seconds is the budget
 * the roadmap sets for "a driver appears on the map after going on duty", and it is
 * short enough that a manual assignment is made against a position that is still
 * true. Both queries share the interval and the `staleTime`, so a refetch driven by
 * focus or a manual "обновить" does not start a second request.
 *
 * Polling follows the app-wide policy and pauses in a hidden tab
 * (`refetchIntervalInBackground` stays at its `false` default, `refetchOnWindowFocus`
 * is off in the query client): the interval resumes on the next focus, so the map is
 * at most one tick behind when it is actually looked at.
 */
export const DISPATCH_REFETCH_INTERVAL_MS = 2000;

export const NEAREST_DEFAULT_RADIUS_M = 3000;
export const NEAREST_DEFAULT_LIMIT = 8;

/** Everyone on duty, with the age of each position (`GET /dispatch/drivers`). */
export function useDispatchDrivers() {
  const { isAuthenticated } = useAuth();
  return useQuery({
    queryKey: queryKeys.dispatchDrivers(),
    queryFn: fetchDispatchDrivers,
    enabled: isAuthenticated,
    refetchInterval: DISPATCH_REFETCH_INTERVAL_MS,
    staleTime: DISPATCH_REFETCH_INTERVAL_MS,
  });
}

export interface NearestDriversOptions {
  radiusM?: number;
  limit?: number;
}

/**
 * Drivers around the selected one.
 *
 * Disabled until someone is picked — the endpoint costs a geo query, and there is
 * nothing to rank without a point of reference. The coordinates are read from the
 * latest render through the closure, so the shortlist follows the driver while the
 * cache key stays stable (see `queryKeys.dispatchNearest`).
 */
export function useNearestDrivers(
  driver: Pick<DispatchCandidate, 'driverId' | 'lat' | 'lon'> | null,
  options: NearestDriversOptions = {},
) {
  const { isAuthenticated } = useAuth();
  const radiusM = options.radiusM ?? NEAREST_DEFAULT_RADIUS_M;
  const limit = options.limit ?? NEAREST_DEFAULT_LIMIT;

  return useQuery({
    queryKey: queryKeys.dispatchNearest(driver?.driverId ?? 'none', radiusM, limit),
    queryFn: async () => {
      if (!driver) {
        throw new Error('Водитель не выбран');
      }
      return fetchNearestDrivers({ lat: driver.lat, lon: driver.lon, radiusM, limit });
    },
    enabled: isAuthenticated && driver !== null,
    refetchInterval: DISPATCH_REFETCH_INTERVAL_MS,
    staleTime: DISPATCH_REFETCH_INTERVAL_MS,
  });
}
