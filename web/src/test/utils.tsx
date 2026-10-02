import type { ReactElement } from 'react';
import { render, type RenderResult } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { vi } from 'vitest';
import type { Account, Problem, TokenResponse } from '../api/types';
import { AuthProvider } from '../auth/AuthContext';
import { writeSession } from '../auth/session';

/**
 * Test doubles shared by the suite.
 *
 * `fetch` is stubbed with a minimal `Response`-shaped object instead of a real
 * `Response`, because the client only ever touches `ok`, `status`, `headers` and
 * `text()` — this keeps the tests independent of the undici/jsdom pairing.
 */
export interface MockResponse {
  ok: boolean;
  status: number;
  headers: Headers;
  text: () => Promise<string>;
}

export function jsonResponse(
  body: unknown,
  status = 200,
  headers: Record<string, string> = {},
): MockResponse {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers(headers),
    text: async () => JSON.stringify(body),
  };
}

export function problemResponse(problem: Problem, status = 400, correlationId = 'corr-test-1'): MockResponse {
  return jsonResponse({ ...problem, correlationId }, status, { 'X-Correlation-Id': correlationId });
}

export interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason?: unknown) => void;
}

/** A promise the test resolves by hand (used to hold a mutation in flight). */
export function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

export type FetchHandler = (url: string, init?: RequestInit) => MockResponse | Promise<MockResponse>;

/** Installs a `fetch` stub and returns the spy (auto-restored by the setup file). */
export function stubFetch(handler: FetchHandler) {
  const mock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    return handler(url, init);
  });
  vi.stubGlobal('fetch', mock);
  return mock;
}

/** Reads a request header from the plain object the API client builds. */
export function headerOf(init: RequestInit | undefined, name: string): string | undefined {
  const headers = init?.headers as Record<string, string> | undefined;
  return headers?.[name];
}

export function bodyOf<T>(init: RequestInit | undefined): T {
  return JSON.parse(String(init?.body ?? '{}')) as T;
}

export function tokenResponse(overrides: Partial<TokenResponse> = {}): TokenResponse {
  return {
    accessToken: 'test-token',
    tokenType: 'Bearer',
    expiresIn: 3600,
    userId: 'U-TEST',
    roles: ['CUSTOMER'],
    ...overrides,
  };
}

/** Puts a valid session in localStorage so authenticated queries are enabled. */
export function seedSession(overrides: Partial<TokenResponse> = {}) {
  const token = tokenResponse(overrides);
  return writeSession({ token, phone: '+77001234567', displayName: 'Тестовый пользователь' });
}

export const kztAccount: Account = {
  id: 'acc-kzt-1',
  ownerUserId: 'U-TEST',
  ownerPhone: '+77001234567',
  displayName: 'Текущий счёт',
  type: 'CUSTOMER',
  currency: 'KZT',
  status: 'ACTIVE',
  balanceMinor: 500_000,
  heldMinor: 150_000,
  availableMinor: 350_000,
  createdAt: '2024-09-01T10:00:00Z',
};

export function createTestQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0, staleTime: 0 },
      mutations: { retry: false },
    },
  });
}

export interface RenderOptions {
  route?: string;
  queryClient?: QueryClient;
}

export function renderWithProviders(ui: ReactElement, options: RenderOptions = {}): RenderResult {
  const { route = '/', queryClient = createTestQueryClient() } = options;
  return render(
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <MemoryRouter initialEntries={[route]}>{ui}</MemoryRouter>
      </AuthProvider>
    </QueryClientProvider>,
  );
}
