import { useQuery } from '@tanstack/react-query';
import { fetchProfile } from '../api/endpoints';
import { queryKeys } from '../lib/queryKeys';
import { useAuth } from '../auth/AuthContext';

/**
 * Authoritative profile for the current token (`GET /auth/me`).
 *
 * The session already carries the roles from the token response; this gives the
 * UI the server's own view (display name, phone) and, when the gateway exposes
 * it, the merchant id used by the merchant console.
 */
export function useProfile() {
  const { isAuthenticated } = useAuth();
  return useQuery({
    queryKey: queryKeys.profile(),
    queryFn: fetchProfile,
    enabled: isAuthenticated,
    staleTime: 5 * 60_000,
    retry: 0,
  });
}
