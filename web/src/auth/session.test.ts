import { describe, expect, it } from 'vitest';
import {
  EXPIRY_SKEW_MS,
  SESSION_STORAGE_KEY,
  clearSession,
  getAccessToken,
  isExpired,
  millisecondsUntilExpiry,
  readSession,
  writeSession,
} from './session';
import { tokenResponse } from '../test/utils';

/**
 * The session lives in localStorage with an absolute expiry, so the UI can log out
 * *before* the first 401 instead of reacting to it.
 */
describe('session storage', () => {
  it('round-trips a token, filters unknown roles and computes the expiry', () => {
    const now = 1_700_000_000_000;
    const session = writeSession({
      token: tokenResponse({ roles: ['CUSTOMER', 'ADMIN', 'SUPERUSER'] as never, expiresIn: 3600 }),
      phone: '+77001234567',
      displayName: 'Айша',
      now,
    });

    expect(session.expiresAt).toBe(now + 3_600_000);
    expect(session.roles).toEqual(['CUSTOMER', 'ADMIN']);

    const stored = readSession();
    expect(stored).not.toBeNull();
    expect(stored?.accessToken).toBe('test-token');
    expect(stored?.displayName).toBe('Айша');
    expect(stored?.phone).toBe('+77001234567');
    expect(millisecondsUntilExpiry(session, now)).toBe(3_600_000);
  });

  it('treats a token as expired slightly early, clears it on logout and ignores junk', () => {
    const now = 1_700_000_000_000;
    const session = writeSession({ token: tokenResponse({ expiresIn: 60 }), now });

    expect(isExpired(session, now)).toBe(false);
    expect(getAccessToken(now)).toBe('test-token');

    // Inside the skew window the token is already considered unusable.
    expect(isExpired(session, now + 60_000 - EXPIRY_SKEW_MS + 1)).toBe(true);
    expect(getAccessToken(now + 60_000)).toBeNull();

    clearSession();
    expect(readSession()).toBeNull();
    expect(window.localStorage.getItem(SESSION_STORAGE_KEY)).toBeNull();

    // Corrupted or partial storage must never crash the app.
    window.localStorage.setItem(SESSION_STORAGE_KEY, 'not-json');
    expect(readSession()).toBeNull();
    window.localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify({ tokenType: 'Bearer' }));
    expect(readSession()).toBeNull();
  });
});
