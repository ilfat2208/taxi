import { useMemo } from 'react';
import type { Role } from '../api/types';
import { useAuth } from './AuthContext';
import { rolesFromToken } from './jwt';

/**
 * Who may open the dispatcher console.
 *
 * Mirrors the server-side rule (`Roles.DISPATCHER` plus the two operator roles):
 * support answers "where is my driver" questions, admins act on everything, and
 * only the dispatcher does it as a job. The list also gates the navigation item.
 */
export const DISPATCH_ROLES: Role[] = ['DISPATCHER', 'ADMIN', 'SUPPORT'];

export function hasDispatchRole(roles: readonly Role[]): boolean {
  return roles.some((role) => DISPATCH_ROLES.includes(role));
}

/**
 * Roles of the current user, merged from both sources: the stored session and the
 * access token itself. A token minted elsewhere still lights up the console, while
 * a session whose role list is stale cannot hide an entitlement the token grants.
 */
export function useEffectiveRoles(): Role[] {
  const { session, roles } = useAuth();
  const accessToken = session?.accessToken ?? null;

  return useMemo(() => {
    const fromToken = rolesFromToken(accessToken);
    if (fromToken.length === 0) {
      return roles;
    }
    return Array.from(new Set([...roles, ...fromToken]));
  }, [accessToken, roles]);
}
