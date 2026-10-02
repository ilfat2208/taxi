import type { Problem, ProblemFieldError } from './types';

export interface FieldError {
  field: string;
  message: string;
}

export interface ApiErrorInit {
  status: number;
  code: string;
  title: string;
  detail: string;
  instance?: string | null;
  correlationId?: string | null;
  fieldErrors?: FieldError[];
  problem?: Problem | null;
}

/**
 * A failed HTTP call, normalized from RFC 7807 `problem+json`.
 *
 * Everything the UI needs to explain the failure lives here: a machine `code`
 * (for message mapping), the human `detail` from the server, per-field
 * `errors` (to attach to inputs) and the `correlationId` a user can quote to
 * support.
 */
export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly title: string;
  readonly detail: string;
  readonly instance: string | null;
  readonly correlationId: string | null;
  readonly fieldErrors: FieldError[];
  readonly problem: Problem | null;

  constructor(init: ApiErrorInit) {
    super(init.detail || init.title || `HTTP ${init.status}`);
    this.name = 'ApiError';
    this.status = init.status;
    this.code = init.code;
    this.title = init.title;
    this.detail = init.detail;
    this.instance = init.instance ?? null;
    this.correlationId = init.correlationId ?? null;
    this.fieldErrors = init.fieldErrors ?? [];
    this.problem = init.problem ?? null;
  }

  get isUnauthorized(): boolean {
    return this.status === 401;
  }

  get isForbidden(): boolean {
    return this.status === 403;
  }

  get isNotFound(): boolean {
    return this.status === 404;
  }

  /** Transport-level or server-side failures worth retrying with the same key. */
  get retryable(): boolean {
    return this.status >= 500 || this.status === 408 || this.status === 429;
  }

  /** Message attached to a specific form field, if the server sent one. */
  fieldError(field: string): string | undefined {
    return this.fieldErrors.find((error) => error.field === field)?.message;
  }
}

/** The request never reached a server (offline, DNS, proxy down, aborted). */
export class NetworkError extends Error {
  readonly correlationId: string | null;
  readonly aborted: boolean;

  constructor(message: string, options: { correlationId?: string | null; aborted?: boolean } = {}) {
    super(message);
    this.name = 'NetworkError';
    this.correlationId = options.correlationId ?? null;
    this.aborted = options.aborted ?? false;
  }

  get retryable(): boolean {
    return !this.aborted;
  }
}

export function isApiError(error: unknown): error is ApiError {
  return error instanceof ApiError;
}

export function isNetworkError(error: unknown): error is NetworkError {
  return error instanceof NetworkError;
}

function normalizeFieldErrors(errors: ProblemFieldError[] | undefined): FieldError[] {
  if (!Array.isArray(errors)) {
    return [];
  }
  return errors
    .map((entry) => ({
      field: String(entry?.field ?? ''),
      message: String(entry?.message ?? ''),
    }))
    .filter((entry) => entry.message !== '');
}

function isProblemLike(value: unknown): value is Problem {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.code === 'string' ||
    typeof candidate.detail === 'string' ||
    typeof candidate.title === 'string' ||
    typeof candidate.status === 'number' ||
    typeof candidate.errors === 'object'
  );
}

/**
 * Builds an `ApiError` from a raw response, tolerating three cases:
 * a well-formed problem+json, a JSON body that is not a problem, and a body
 * that is not JSON at all (HTML error page from a proxy, empty 502 body, ...).
 */
export function toApiError(
  status: number,
  rawBody: string,
  correlationId: string | null,
): ApiError {
  let parsed: unknown;
  try {
    parsed = rawBody === '' ? null : JSON.parse(rawBody);
  } catch {
    parsed = null;
  }

  if (isProblemLike(parsed)) {
    const problem = parsed as Problem;
    const detail = typeof problem.detail === 'string' ? problem.detail : '';
    const title = typeof problem.title === 'string' ? problem.title : '';
    return new ApiError({
      status: typeof problem.status === 'number' ? problem.status : status,
      code: typeof problem.code === 'string' ? problem.code : defaultCodeForStatus(status),
      title: title || statusText(status),
      detail: detail || title || statusText(status),
      instance: problem.instance ?? null,
      correlationId: problem.correlationId ?? correlationId,
      fieldErrors: normalizeFieldErrors(problem.errors),
      problem,
    });
  }

  const fallback = rawBody.trim().slice(0, 300);
  return new ApiError({
    status,
    code: defaultCodeForStatus(status),
    title: statusText(status),
    detail: fallback !== '' && !fallback.startsWith('<') ? fallback : statusText(status),
    correlationId,
    problem: null,
  });
}

export function defaultCodeForStatus(status: number): string {
  switch (status) {
    case 400:
      return 'BAD_REQUEST';
    case 401:
      return 'UNAUTHORIZED';
    case 403:
      return 'FORBIDDEN';
    case 404:
      return 'NOT_FOUND';
    case 409:
      return 'CONFLICT';
    case 412:
      return 'PRECONDITION_FAILED';
    case 422:
      return 'VALIDATION_FAILED';
    case 429:
      return 'RATE_LIMITED';
    case 503:
      return 'SERVICE_UNAVAILABLE';
    default:
      return status >= 500 ? 'INTERNAL_ERROR' : 'BAD_REQUEST';
  }
}

export function statusText(status: number): string {
  switch (status) {
    case 400:
      return 'Некорректный запрос';
    case 401:
      return 'Требуется вход';
    case 403:
      return 'Доступ запрещён';
    case 404:
      return 'Не найдено';
    case 409:
      return 'Конфликт состояния';
    case 412:
      return 'Условие не выполнено';
    case 422:
      return 'Ошибка валидации';
    case 429:
      return 'Слишком много запросов';
    case 500:
      return 'Внутренняя ошибка сервиса';
    case 502:
      return 'Шлюз недоступен';
    case 503:
      return 'Сервис недоступен';
    case 504:
      return 'Сервис не ответил вовремя';
    default:
      return `Ошибка ${status}`;
  }
}

/** Platform `ErrorCode` values -> human text (see docs/development.md §3). */
const CODE_MESSAGES: Record<string, string> = {
  VALIDATION_FAILED: 'Проверьте заполненные поля',
  BAD_REQUEST: 'Запрос составлен неверно',
  UNAUTHORIZED: 'Сессия истекла — войдите заново',
  FORBIDDEN: 'Недостаточно прав для этой операции',
  NOT_FOUND: 'Запись не найдена',
  CONFLICT: 'Операция уже выполняется, повторите через секунду',
  IDEMPOTENCY_CONFLICT: 'Этот запрос уже отправлялся с другими данными',
  IDEMPOTENCY_KEY_REQUIRED: 'Повторите действие — не хватает ключа идемпотентности',
  PRECONDITION_FAILED: 'Операция невозможна в текущем состоянии',
  RATE_LIMITED: 'Слишком много запросов, подождите немного',
  SERVICE_UNAVAILABLE: 'Сервис временно недоступен, попробуйте позже',
  INTERNAL_ERROR: 'Внутренняя ошибка сервиса — мы уже смотрим логи',
  INSUFFICIENT_FUNDS: 'Недостаточно средств на счёте',
  INSUFFICIENT_BALANCE: 'Недостаточно средств на счёте',
  ACCOUNT_NOT_FOUND: 'Счёт не найден',
  ACCOUNT_BLOCKED: 'Счёт заблокирован',
  CURRENCY_MISMATCH: 'Валюта перевода не совпадает с валютой счёта',
  SAME_ACCOUNT_TRANSFER: 'Нельзя перевести средства на тот же счёт',
  PAYMENT_NOT_FOUND: 'Платёж не найден',
  PAYMENT_NOT_REFUNDABLE: 'Этот платёж нельзя вернуть',
  PRODUCT_NOT_FOUND: 'Товар не найден',
  PRODUCT_OUT_OF_STOCK: 'Товара не хватает на складе',
  CART_EMPTY: 'Корзина пуста',
  ORDER_NOT_FOUND: 'Заказ не найден',
  ORDER_NOT_CANCELLABLE: 'Заказ уже нельзя отменить',
};

/**
 * Turns any thrown value into a message a customer can understand.
 * Server `detail` wins when it carries domain wording, the mapped `code` text is
 * the fallback.
 */
export function humanMessage(error: unknown, fallback = 'Что-то пошло не так'): string {
  if (isNetworkError(error)) {
    return error.aborted
      ? 'Запрос отменён'
      : 'Нет связи с сервером. Проверьте, что стек запущен на http://localhost:8080';
  }
  if (isApiError(error)) {
    const mapped = CODE_MESSAGES[error.code];
    if (mapped) {
      return mapped;
    }
    const fuzzy = fuzzyCodeMessage(error.code);
    if (fuzzy) {
      return fuzzy;
    }
    return error.detail || error.title || fallback;
  }
  if (error instanceof Error && error.message !== '') {
    return error.message;
  }
  return fallback;
}

function fuzzyCodeMessage(code: string): string | undefined {
  const upper = code.toUpperCase();
  if (upper.includes('INSUFFICIENT')) {
    return CODE_MESSAGES.INSUFFICIENT_FUNDS;
  }
  if (upper.includes('NOT_FOUND')) {
    return CODE_MESSAGES.NOT_FOUND;
  }
  if (upper.includes('IDEMPOTENCY')) {
    return CODE_MESSAGES.IDEMPOTENCY_CONFLICT;
  }
  if (upper.includes('OUT_OF_STOCK')) {
    return CODE_MESSAGES.PRODUCT_OUT_OF_STOCK;
  }
  return undefined;
}

/** Field error for an input, falling back to the server's `errors[]` match. */
export function fieldErrorOf(error: unknown, field: string): string | undefined {
  if (!isApiError(error)) {
    return undefined;
  }
  const direct = error.fieldError(field);
  if (direct) {
    return direct;
  }
  const lower = field.toLowerCase();
  return error.fieldErrors.find((entry) => entry.field.toLowerCase() === lower)?.message;
}
