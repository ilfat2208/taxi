import type { Role, TokenResponse } from '../api/types';

/**
 * Session persistence.
 *
 * The access token lives in localStorage (this is a browser-only SPA with no
 * cookie infrastructure), together with the absolute expiry derived from
 * `expiresIn` so the UI can log out *before* the first 401.
 */
export const SESSION_STORAGE_KEY = 'taxi.session';

/** Treat the token as expired slightly early to avoid a race with the server. */
export const EXPIRY_SKEW_MS = 15_000;

export interface Session {
  accessToken: string;
  tokenType: string;
  userId: string;
  roles: Role[];
  displayName: string | null;
  phone: string | null;
  issuedAt: number;
  expiresAt: number;
}

export interface SessionInput {
  token: TokenResponse;
  displayName?: string | null;
  phone?: string | null;
  now?: number;
}

function storage(): Storage | null {
  try {
    if (typeof window === 'undefined' || !window.localStorage) {
      return null;
    }
    return window.localStorage;
  } catch {
    return null;
  }
}

export function isRole(value: unknown): value is Role {
  return (
    value === 'CUSTOMER' ||
    value === 'MERCHANT' ||
    value === 'SUPPORT' ||
    value === 'ADMIN' ||
    value === 'DRIVER' ||
    value === 'DISPATCHER'
  );
}

function parseSession(raw: string): Session | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null) {
    return null;
  }
  const candidate = parsed as Record<string, unknown>;
  if (typeof candidate.accessToken !== 'string' || candidate.accessToken === '') {
    return null;
  }
  return {
    accessToken: candidate.accessToken,
    tokenType: typeof candidate.tokenType === 'string' ? candidate.tokenType : 'Bearer',
    userId: typeof candidate.userId === 'string' ? candidate.userId : '',
    roles: Array.isArray(candidate.roles) ? candidate.roles.filter(isRole) : [],
    displayName: typeof candidate.displayName === 'string' ? candidate.displayName : null,
    phone: typeof candidate.phone === 'string' ? candidate.phone : null,
    issuedAt: typeof candidate.issuedAt === 'number' ? candidate.issuedAt : 0,
    expiresAt: typeof candidate.expiresAt === 'number' ? candidate.expiresAt : 0,
  };
}

export function readSession(): Session | null {
  const store = storage();
  if (!store) {
    return null;
  }
  const raw = store.getItem(SESSION_STORAGE_KEY);
  return raw === null ? null : parseSession(raw);
}

export function writeSession({ token, displayName, phone, now = Date.now() }: SessionInput): Session {
  const session: Session = {
    accessToken: token.accessToken,
    tokenType: token.tokenType || 'Bearer',
    userId: token.userId,
    roles: (token.roles ?? []).filter(isRole),
    displayName: displayName ?? null,
    phone: phone ?? null,
    issuedAt: now,
    expiresAt: now + Math.max(0, token.expiresIn) * 1000,
  };
  storage()?.setItem(SESSION_STORAGE_KEY, JSON.stringify(session));
  return session;
}

export function clearSession(): void {
  storage()?.removeItem(SESSION_STORAGE_KEY);
}

export function isExpired(session: Session, now: number = Date.now()): boolean {
  return session.expiresAt > 0 && session.expiresAt - EXPIRY_SKEW_MS <= now;
}

/** Token for the Authorization header, or null when absent/expired. */
export function getAccessToken(now: number = Date.now()): string | null {
  const session = readSession();
  if (!session || isExpired(session, now)) {
    return null;
  }
  return session.accessToken;
}

export function millisecondsUntilExpiry(session: Session, now: number = Date.now()): number {
  return Math.max(0, session.expiresAt - now);
}
