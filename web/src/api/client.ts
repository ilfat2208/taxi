import { getAccessToken } from '../auth/session';
import { ApiError, NetworkError, toApiError } from './errors';

/**
 * The single fetch wrapper for the whole app.
 *
 * Responsibilities (kept in one place on purpose):
 *  1. `Authorization: Bearer <token>` from the stored session;
 *  2. a fresh `X-Correlation-Id` per request, echoed into console + error UI;
 *  3. `Idempotency-Key` for the money path, supplied by the caller so the same
 *     key can be reused across retries of one user action;
 *  4. RFC 7807 -> typed `ApiError`;
 *  5. 401 -> clear the session and hand control to the auth layer.
 */

export const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL ?? '/api').replace(/\/+$/, '');

export const CORRELATION_HEADER = 'X-Correlation-Id';
export const IDEMPOTENCY_HEADER = 'Idempotency-Key';

export type HttpMethod = 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';

export type QueryValue = string | number | boolean | null | undefined;

export interface ApiRequestOptions {
  method?: HttpMethod;
  body?: unknown;
  query?: Record<string, QueryValue>;
  signal?: AbortSignal;
  /** Attach the bearer token (default true). Set false for the login call. */
  auth?: boolean;
  /** Sent as `Idempotency-Key`; only mutating money/order calls need it. */
  idempotencyKey?: string;
  /** Reuse an existing correlation id instead of generating a new one. */
  correlationId?: string;
  headers?: Record<string, string>;
}

export interface ApiResponse<T> {
  data: T;
  status: number;
  correlationId: string | null;
}

let unauthorizedHandler: ((error: ApiError) => void) | null = null;

/** Registered by `AuthProvider`: clears the session and redirects to /login. */
export function setUnauthorizedHandler(handler: ((error: ApiError) => void) | null): void {
  unauthorizedHandler = handler;
}

/** RFC 4122 v4 UUID; falls back when `crypto.randomUUID` is unavailable. */
export function uuid(): string {
  const cryptoApi: Crypto | undefined = globalThis.crypto;
  if (cryptoApi && typeof cryptoApi.randomUUID === 'function') {
    return cryptoApi.randomUUID();
  }
  if (cryptoApi && typeof cryptoApi.getRandomValues === 'function') {
    const bytes = cryptoApi.getRandomValues(new Uint8Array(16));
    bytes[6] = (bytes[6]! & 0x0f) | 0x40;
    bytes[8] = (bytes[8]! & 0x3f) | 0x80;
    const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  }
  return `fallback-${Date.now().toString(16)}-${Math.random().toString(16).slice(2, 10)}`;
}

/** Fresh key for one user submit; reuse it for retries of that same submit. */
export function newIdempotencyKey(): string {
  return uuid();
}

export function newCorrelationId(): string {
  return uuid();
}

export function buildUrl(path: string, query?: Record<string, QueryValue>): string {
  const base = `${API_BASE_URL}${path.startsWith('/') ? path : `/${path}`}`;
  if (!query) {
    return base;
  }
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null || value === '') {
      continue;
    }
    search.set(key, String(value));
  }
  const queryString = search.toString();
  return queryString === '' ? base : `${base}?${queryString}`;
}

function isAbort(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError';
}

export async function apiRequestWithMeta<T>(
  path: string,
  options: ApiRequestOptions = {},
): Promise<ApiResponse<T>> {
  const { method = 'GET', body, query, signal, auth = true, idempotencyKey, headers = {} } = options;
  const correlationId = options.correlationId ?? newCorrelationId();

  const requestHeaders: Record<string, string> = {
    Accept: 'application/json',
    [CORRELATION_HEADER]: correlationId,
    ...headers,
  };

  if (auth) {
    const token = getAccessToken();
    if (token) {
      requestHeaders.Authorization = `Bearer ${token}`;
    }
  }
  if (idempotencyKey) {
    requestHeaders[IDEMPOTENCY_HEADER] = idempotencyKey;
  }
  if (body !== undefined) {
    requestHeaders['Content-Type'] = 'application/json';
  }

  const url = buildUrl(path, query);
  let response: Response;
  try {
    response = await fetch(url, {
      method,
      headers: requestHeaders,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal,
      credentials: 'same-origin',
    });
  } catch (error) {
    if (isAbort(error)) {
      throw new NetworkError('Запрос отменён', { correlationId, aborted: true });
    }
    const networkError = new NetworkError('Не удалось связаться с сервером', { correlationId });
    logFailure(method, url, correlationId, networkError.message);
    throw networkError;
  }

  const responseCorrelationId = response.headers.get(CORRELATION_HEADER) ?? correlationId;

  if (!response.ok) {
    const rawBody = await safeText(response);
    const apiError = toApiError(response.status, rawBody, responseCorrelationId);
    logFailure(method, url, apiError.correlationId ?? correlationId, `${apiError.status} ${apiError.code}: ${apiError.detail}`);
    if (apiError.status === 401 && auth) {
      unauthorizedHandler?.(apiError);
    }
    throw apiError;
  }

  const data = await parseSuccessBody<T>(response);
  return { data, status: response.status, correlationId: responseCorrelationId };
}

export async function apiRequest<T>(path: string, options: ApiRequestOptions = {}): Promise<T> {
  const { data } = await apiRequestWithMeta<T>(path, options);
  return data;
}

async function safeText(response: Response): Promise<string> {
  try {
    return await response.text();
  } catch {
    return '';
  }
}

async function parseSuccessBody<T>(response: Response): Promise<T> {
  if (response.status === 204 || response.status === 205) {
    return undefined as T;
  }
  const text = await safeText(response);
  if (text === '') {
    return undefined as T;
  }
  try {
    return JSON.parse(text) as T;
  } catch {
    // A non-JSON 2xx body would break a typed client silently; make it loud.
    throw new ApiError({
      status: response.status,
      code: 'INVALID_RESPONSE',
      title: 'Некорректный ответ сервера',
      detail: 'Сервер вернул не JSON — проверьте адрес API и прокси',
      correlationId: response.headers.get(CORRELATION_HEADER),
    });
  }
}

function logFailure(method: HttpMethod, url: string, correlationId: string | null, message: string): void {
  // Console only: the correlation id is also rendered next to the error message.
  console.error(`[api] ${method} ${url} failed (correlationId=${correlationId ?? 'n/a'}): ${message}`);
}

/** Retry predicate for TanStack Query: transient failures only. */
export function isRetryableError(failureCount: number, error: unknown): boolean {
  if (failureCount >= 2) {
    return false;
  }
  if (error instanceof ApiError) {
    return error.retryable;
  }
  if (error instanceof NetworkError) {
    return error.retryable;
  }
  return false;
}
