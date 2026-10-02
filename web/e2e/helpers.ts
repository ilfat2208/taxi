import { expect, type APIRequestContext, type Page } from '@playwright/test';

/**
 * Shared helpers for the browser specs.
 *
 * Two rules the specs must respect, and which these helpers enforce:
 *
 *  1. *The session is stored the way the app stores it.* `writeSession` in
 *     `src/auth/session.ts` puts a JSON `Session` under
 *     `taxi.session` in `localStorage`, with an absolute `expiresAt`.
 *     Seeding exactly that shape lets a spec start already signed in without
 *     re-driving the login form, and without inventing a private back door.
 *  2. *Tests are independent.* Every Playwright test gets a fresh browser
 *     context (fresh `localStorage`, fresh cart badge), and every helper that
 *     mutates backend state receives a phone number it owns — never "whatever
 *     the previous test left behind".
 */

/** localStorage key from `src/auth/session.ts` (`SESSION_STORAGE_KEY`). */
export const SESSION_STORAGE_KEY = 'taxi.session';

/** The development identity provider accepts any `+7XXXXXXXXXX` with this code. */
export const DEMO_CODE = '0000';

/** Pre-filled by the login screen (`DEMO_PHONE` in `src/lib/phone.ts`). */
export const DEMO_PHONE = '+77001234567';

/** Seeded demo account: same phone, any 4-digit code. */
export const DEMO_USER = { phone: DEMO_PHONE, displayName: 'Aisha' };

/** A phone nobody uses as a transfer source: a safe P2P recipient. */
export const TRANSFER_RECIPIENT = '+77005550199';

/** The money path whose request count the transfer spec asserts on. */
export const TRANSFER_PATH = '/v1/payments/transfers';

const API_PREFIX = '/api';

export interface Session {
  accessToken: string;
  tokenType: string;
  userId: string;
  roles: string[];
  displayName: string | null;
  phone: string | null;
  issuedAt: number;
  expiresAt: number;
}

export interface TokenResponse {
  accessToken: string;
  tokenType?: string;
  expiresIn?: number;
  userId?: string;
  roles?: string[];
}

interface RawAccount {
  id: string;
  ownerPhone?: string;
  displayName?: string;
  currency?: string;
  status?: string;
  balanceMinor?: number;
  heldMinor?: number;
  availableMinor?: number;
}

interface RawProduct {
  id: string;
  title: string;
}

interface RawProductPage {
  items: RawProduct[];
  totalElements: number;
  totalPages: number;
}

interface RawCart {
  itemCount?: number;
  items?: { productId: string; quantity: number }[];
}

/* --------------------------------------------------------------- requests */

/**
 * `request` resolves relative URLs against `use.baseURL`, but that base is the
 * Vite dev server: `/api/...` goes through the same proxy the browser uses, so
 * the specs exercise the real gateway.
 */
export function apiUrl(path: string): string {
  return `${API_PREFIX}${path}`;
}

/** Direct login against the dev identity provider; returns the raw token payload. */
export async function requestToken(
  request: APIRequestContext,
  phone: string,
  displayName: string,
  roles: string[] = ['CUSTOMER'],
): Promise<TokenResponse> {
  const response = await request.post(apiUrl('/v1/auth/token'), {
    data: { phone, code: DEMO_CODE, displayName, roles },
  });
  expect(response.status(), `POST /v1/auth/token for ${phone}`).toBe(200);
  return (await response.json()) as TokenResponse;
}

export function sessionFromToken(
  token: TokenResponse,
  phone: string,
  displayName: string | null,
): Session {
  const issuedAt = Date.now();
  return {
    accessToken: token.accessToken,
    tokenType: token.tokenType ?? 'Bearer',
    userId: token.userId ?? '',
    roles: token.roles ?? [],
    displayName,
    phone,
    issuedAt,
    expiresAt: issuedAt + (token.expiresIn ?? 3600) * 1000,
  };
}

/* ---------------------------------------------------------------- session */

/**
 * Puts a valid session in `localStorage` before the app boots, so the guarded
 * routes render immediately. Returns the session that was written.
 */
export async function seedSession(page: Page, session: Session): Promise<Session> {
  await page.addInitScript(
    ([key, value]) => {
      window.localStorage.setItem(key, value);
    },
    [SESSION_STORAGE_KEY, JSON.stringify(session)] as const,
  );
  return session;
}

/** Log in through the API and seed the resulting session. */
export async function loginAs(
  page: Page,
  request: APIRequestContext,
  user: { phone: string; displayName: string; roles?: string[] },
): Promise<Session> {
  const token = await requestToken(request, user.phone, user.displayName, user.roles);
  return seedSession(page, sessionFromToken(token, user.phone, user.displayName));
}

/** Sign in as the seeded demo customer (ADMIN, so the demo top-up is available). */
export async function loginAsDemoUser(page: Page, request: APIRequestContext): Promise<Session> {
  return loginAs(page, request, {
    phone: DEMO_USER.phone,
    displayName: DEMO_USER.displayName,
    roles: ['CUSTOMER', 'ADMIN'],
  });
}

/** The session the app itself stored, read back from the browser. */
export async function readStoredSession(page: Page): Promise<Session | null> {
  const raw = await page.evaluate((key) => window.localStorage.getItem(key), SESSION_STORAGE_KEY);
  return raw === null ? null : (JSON.parse(raw) as Session);
}

/* --------------------------------------------------------------- accounts */

function toAccountList(raw: unknown): RawAccount[] {
  if (Array.isArray(raw)) {
    return raw as RawAccount[];
  }
  const record = (raw ?? {}) as Record<string, unknown>;
  const nested = record.items ?? record.accounts ?? record.content;
  return Array.isArray(nested) ? (nested as RawAccount[]) : [];
}

export async function listAccounts(
  request: APIRequestContext,
  token: string,
): Promise<RawAccount[]> {
  const response = await request.get(apiUrl('/v1/accounts'), {
    headers: { Authorization: `Bearer ${token}` },
  });
  expect(response.status(), 'GET /v1/accounts').toBe(200);
  return toAccountList(await response.json());
}

/** Opens a KZT current account for the caller (409-safe: reuses an existing one). */
export async function ensureKztAccount(
  request: APIRequestContext,
  token: string,
): Promise<RawAccount> {
  const headers = { Authorization: `Bearer ${token}` };
  const existing = (await listAccounts(request, token)).find(
    (account) => account.currency === 'KZT' && account.status !== 'CLOSED',
  );
  if (existing) {
    return existing;
  }
  const created = await request.post(apiUrl('/v1/accounts'), {
    headers,
    data: { currency: 'KZT', type: 'CUSTOMER' },
  });
  expect(created.status(), 'POST /v1/accounts').toBe(201);
  return (await created.json()) as RawAccount;
}

/**
 * Makes sure the account can fund a transfer by topping it up through the demo
 * operator endpoint (ADMIN role). Idempotent enough for a re-runnable suite: the
 * top-up is only sent when the available balance is below `minimumMinor`.
 */
export async function ensureBalance(
  request: APIRequestContext,
  token: string,
  account: RawAccount,
  minimumMinor: number,
): Promise<number> {
  let available = account.availableMinor ?? account.balanceMinor ?? 0;
  if (available >= minimumMinor) {
    return available;
  }
  const topUp = await request.post(apiUrl(`/v1/accounts/${account.id}/top-up`), {
    headers: {
      Authorization: `Bearer ${token}`,
      'Idempotency-Key': `e2e-topup-${account.id}-${Date.now()}`,
    },
    data: { amountMinor: minimumMinor, reason: 'e2e playwright top-up' },
  });
  expect(topUp.status(), 'POST /v1/accounts/{id}/top-up').toBeLessThan(300);
  const refreshed = (await listAccounts(request, token)).find(
    (candidate) => candidate.id === account.id,
  );
  available = refreshed?.availableMinor ?? refreshed?.balanceMinor ?? 0;
  expect(available, 'balance after top-up').toBeGreaterThanOrEqual(minimumMinor);
  return available;
}

/* ------------------------------------------------------------------- cart */

export async function readCart(request: APIRequestContext, token: string): Promise<RawCart> {
  const response = await request.get(apiUrl('/v1/cart'), {
    headers: { Authorization: `Bearer ${token}` },
  });
  expect(response.status(), 'GET /v1/cart').toBe(200);
  return (await response.json()) as RawCart;
}

/** Empty cart for the token owner, so a cart assertion starts from zero. */
export async function clearCart(request: APIRequestContext, token: string): Promise<void> {
  const response = await request.delete(apiUrl('/v1/cart'), {
    headers: { Authorization: `Bearer ${token}` },
  });
  expect(response.status(), 'DELETE /v1/cart').toBeLessThan(300);
}

/* ------------------------------------------------------------------ money */

/** `"20 992,50 ₸"` -> `2099250`, i.e. the minor-unit integer the API speaks. */
export function moneyTextToMinor(text: string): number {
  return Number(text.replace(/\D/g, ''));
}

/** The "Доступно" figure of the first account card on the dashboard. */
export function availableBalance(page: Page) {
  return page.locator('main p:has-text("Доступно") + p').first();
}

export async function readAvailableMinor(page: Page): Promise<number> {
  const balance = availableBalance(page);
  await expect(balance).toBeVisible();
  return moneyTextToMinor(await balance.innerText());
}

/** Number of product tiles currently rendered in the catalog grid. */
export function productCards(page: Page) {
  return page.locator('article:has(a[aria-label^="Открыть товар"])');
}

/* --------------------------------------------------------------- catalog */

/**
 * Ground truth straight from the gateway. The specs compare the rendered grid
 * with the API instead of hard-coding "12 products", so they keep working when
 * another test run (or a merchant console demo) publishes more products.
 */
export async function fetchCatalog(
  request: APIRequestContext,
  params: { query?: string; category?: string; size?: number } = {},
): Promise<RawProductPage> {
  const response = await request.get(apiUrl('/v1/catalog/products'), {
    params: {
      query: params.query ?? '',
      category: params.category ?? '',
      page: 0,
      size: params.size ?? 12,
      sort: 'relevance',
    },
  });
  expect(response.status(), 'GET /v1/catalog/products').toBe(200);
  return (await response.json()) as RawProductPage;
}

export async function fetchCategories(request: APIRequestContext): Promise<string[]> {
  const response = await request.get(apiUrl('/v1/catalog/categories'));
  expect(response.status(), 'GET /v1/catalog/categories').toBe(200);
  const raw: unknown = await response.json();
  const source = Array.isArray(raw)
    ? raw
    : (((raw ?? {}) as Record<string, unknown>).items ??
      ((raw ?? {}) as Record<string, unknown>).categories ??
      []);
  return (source as unknown[]).map((entry) =>
    typeof entry === 'string' ? entry : String((entry as Record<string, unknown>).name ?? ''),
  );
}
