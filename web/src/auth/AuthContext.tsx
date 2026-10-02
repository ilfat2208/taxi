import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { setUnauthorizedHandler } from '../api/client';
import { fetchProfile, login as loginRequest } from '../api/endpoints';
import type { Role } from '../api/types';
import { clearSession, isExpired, millisecondsUntilExpiry, readSession, writeSession, type Session } from './session';

/**
 * Authentication state for the whole app.
 *
 * The provider is deliberately router-agnostic: it owns the session and the
 * "someone got a 401" reaction, while redirecting is left to `<RequireAuth>`,
 * which reacts to `isAuthenticated` becoming false. That keeps the login flow
 * testable without a browser history.
 */
export interface LoginInput {
  phone: string;
  code: string;
  displayName?: string;
  roles?: Role[];
}

export interface AuthContextValue {
  session: Session | null;
  isAuthenticated: boolean;
  roles: Role[];
  hasRole: (role: Role) => boolean;
  /** Exchanges phone + SMS code for a session; throws `ApiError` on failure. */
  login: (input: LoginInput) => Promise<Session>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

function initialSession(): Session | null {
  const stored = readSession();
  if (!stored) {
    return null;
  }
  if (isExpired(stored)) {
    // Never hand an expired token to the UI: the first request would 401.
    clearSession();
    return null;
  }
  return stored;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(initialSession);
  const queryClient = useQueryClient();

  const logout = useCallback(() => {
    clearSession();
    setSession(null);
    queryClient.clear();
  }, [queryClient]);

  // A 401 anywhere (expired/revoked token) drops the session once, centrally.
  useEffect(() => {
    setUnauthorizedHandler(() => {
      logout();
    });
    return () => setUnauthorizedHandler(null);
  }, [logout]);

  // Log out *before* the first 401 rather than after it.
  useEffect(() => {
    if (!session) {
      return;
    }
    const delay = millisecondsUntilExpiry(session);
    if (delay <= 0) {
      logout();
      return;
    }
    const timer = window.setTimeout(logout, Math.min(delay, 2_147_483_647));
    return () => window.clearTimeout(timer);
  }, [session, logout]);

  const login = useCallback(
    async ({ phone, code, displayName, roles }: LoginInput): Promise<Session> => {
      const token = await loginRequest({ phone, code, displayName, roles });
      let next = writeSession({ token, displayName: displayName ?? null, phone });

      // Best effort: `/auth/me` is the authoritative profile, but a failure here
      // must not undo a token we already hold.
      try {
        const profile = await fetchProfile();
        next = writeSession({
          token: { ...token, roles: profile.roles?.length ? profile.roles : token.roles },
          displayName: profile.displayName ?? displayName ?? null,
          phone: profile.phone ?? phone,
        });
      } catch {
        /* keep the token-derived session */
      }

      setSession(next);
      return next;
    },
    [],
  );

  const value = useMemo<AuthContextValue>(() => {
    const roles = session?.roles ?? [];
    return {
      session,
      isAuthenticated: session !== null,
      roles,
      hasRole: (role: Role) => roles.includes(role),
      login,
      logout,
    };
  }, [session, login, logout]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used inside <AuthProvider>');
  }
  return context;
}
