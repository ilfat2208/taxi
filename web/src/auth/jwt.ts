import type { Role } from '../api/types';
import { isRole } from './session';

/**
 * Reads the claims of an access token — without verifying it.
 *
 * Verification is the server's job; the client only needs the payload to answer
 * "does this token carry the DISPATCHER role?". That matters because a token can
 * arrive from somewhere other than the login screen (another tab, a dev script, a
 * QR hand-off), and the console must trust the token itself rather than a stale
 * copy of the session's role list.
 */

/** base64url -> UTF-8 string, tolerating missing padding. */
function decodeBase64Url(segment: string): string | null {
  if (typeof atob !== 'function') {
    return null;
  }
  const base64 = segment.replace(/-/g, '+').replace(/_/g, '/');
  const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, '=');
  try {
    const binary = atob(padded);
    const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
    return new TextDecoder().decode(bytes);
  } catch {
    return null;
  }
}

/** Payload of a JWT, or `null` for anything that is not a three-part token. */
export function decodeJwtPayload(token: string | null | undefined): Record<string, unknown> | null {
  if (!token) {
    return null;
  }
  const segment = token.split('.')[1];
  if (!segment) {
    return null;
  }
  const json = decodeBase64Url(segment);
  if (json === null) {
    return null;
  }
  try {
    const parsed: unknown = JSON.parse(json);
    return typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/**
 * Known roles carried by the token.
 *
 * Both spellings seen in the wild are accepted: `roles` (this platform's
 * `JwtIssuer`) and `authorities` (Spring Security's default claim name), so the
 * console still works behind an OIDC provider that mints the other shape.
 */
export function rolesFromToken(token: string | null | undefined): Role[] {
  const payload = decodeJwtPayload(token);
  if (!payload) {
    return [];
  }
  const claim = payload.roles ?? payload.authorities ?? payload.scope;
  const values = Array.isArray(claim)
    ? claim
    : typeof claim === 'string'
      ? claim.split(/[\s,]+/)
      : [];
  const roles: Role[] = [];
  for (const value of values) {
    // Spring's authorities are prefixed (`ROLE_DISPATCHER`); normalize before matching.
    const bare = typeof value === 'string' ? value.replace(/^ROLE_/i, '') : value;
    if (isRole(bare) && !roles.includes(bare)) {
      roles.push(bare);
    }
  }
  return roles;
}
