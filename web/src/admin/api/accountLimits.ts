/**
 * Лимиты счёта — операторский эндпоинт account-service.
 *
 * Пути и поля взяты из реального кода сервиса, а не из догадок:
 *  - `AccountController` (`@RequestMapping("/api/v1/accounts")`) — `GET /{accountId}/limits`
 *    и `PUT /{accountId}/limits`;
 *  - `AccountDtos.SetLimitRequest{window, outgoingLimitMinor}` — тело запроса;
 *    валюты в нём НЕТ намеренно, сервис берёт её из счёта;
 *  - `AccountDtos.LimitsResponse{accountId, currency, limits[], velocity}` — ответ,
 *    где `LimitView{window, configured, outgoingLimitMinor, usedMinor, remainingMinor,
 *    windowStart, windowEnd, updatedAt}`, а `VelocityView{enabled, maxOperations,
 *    window, operationsInWindow}`;
 *  - `LimitWindow` — ровно `DAILY` и `MONTHLY`, границы окон календарные по UTC.
 *
 * Что важно и что типы не расскажут:
 *  - и чтение, и запись доступны только роли ADMIN: `AccountLimitService`
 *    вызывает `requireOperator`, а тот проверяет `isAdmin()`. SUPPORT получает 403,
 *    поэтому интерфейс не должен делать вид, что лимиты ему доступны;
 *  - `configured = false` означает «лимит не задан», то есть без ограничения, и
 *    суммы приходят как `null`. Показать здесь ноль значило бы соврать: «нет лимита»
 *    и «лимит ноль» — разные вещи, и второе сервис вообще запрещает (`@Positive`);
 *  - скоростной контроль (антифрод) приходит только на чтение: `PUT` умеет менять
 *    лишь окно и сумму лимита. Формы для `velocity` поэтому нет.
 */
import { apiRequest } from '../../api/client';

/** Окна, которые поддерживает сервис (`LimitWindow`). */
export const LIMIT_WINDOWS = ['DAILY', 'MONTHLY'] as const;

export type LimitWindow = (typeof LIMIT_WINDOWS)[number];

export function isLimitWindow(value: string): value is LimitWindow {
  return (LIMIT_WINDOWS as readonly string[]).includes(value);
}

/** Одно окно: потолок, уже израсходованное в нём и границы окна. */
export interface AccountLimitWindow {
  window: string;
  /** false — лимита нет, счёт не ограничен; суммы в этом случае `null`, а не 0. */
  configured: boolean;
  outgoingLimitMinor: number | null;
  usedMinor: number | null;
  remainingMinor: number | null;
  /** Начало окна (календарные сутки/месяц по UTC) — когда счётчик сбросился. */
  windowStart: string | null;
  /** Начало следующего окна — когда счётчик сбросится. */
  windowEnd: string | null;
  updatedAt: string | null;
}

/** Скоростной контроль: сколько исходящих операций разрешено за короткое окно. */
export interface AccountVelocityControl {
  enabled: boolean;
  maxOperations: number | null;
  window: string | null;
  /** Сколько операций уже сделано в текущем окне. */
  operationsInWindow: number | null;
}

export interface AccountLimits {
  accountId: string;
  /** Валюта счёта: лимит выражен в её минорных единицах. */
  currency: string;
  limits: AccountLimitWindow[];
  /** `null`, если сервис не прислал блок скорости — тогда UI о нём не говорит. */
  velocity: AccountVelocityControl | null;
}

export interface SetAccountLimitRequest {
  window: LimitWindow;
  /** Строго больше нуля: ноль сервис отвергает (`@Positive outgoingLimitMinor`). */
  outgoingLimitMinor: number;
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};
}

function arr(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function str(value: unknown, fallback = ''): string {
  if (typeof value === 'string') {
    return value;
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(value);
  }
  return fallback;
}

function optionalStr(value: unknown): string | null {
  if (typeof value === 'string') {
    return value;
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(value);
  }
  return null;
}

/** Как `num` в остальном клиенте, но `null` вместо нуля для отсутствующего поля. */
function optionalNum(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return null;
}

function normalizeLimitWindow(raw: unknown): AccountLimitWindow {
  const record = asRecord(raw);
  const outgoingLimitMinor = optionalNum(record.outgoingLimitMinor);
  const configured =
    typeof record.configured === 'boolean' ? record.configured : outgoingLimitMinor !== null;
  return {
    window: str(record.window, 'DAILY'),
    configured,
    outgoingLimitMinor,
    usedMinor: optionalNum(record.usedMinor),
    remainingMinor: optionalNum(record.remainingMinor),
    windowStart: optionalStr(record.windowStart),
    windowEnd: optionalStr(record.windowEnd),
    updatedAt: optionalStr(record.updatedAt),
  };
}

function normalizeVelocity(raw: unknown): AccountVelocityControl {
  const record = asRecord(raw);
  return {
    enabled: record.enabled === true,
    maxOperations: optionalNum(record.maxOperations),
    window: optionalStr(record.window),
    operationsInWindow: optionalNum(record.operationsInWindow),
  };
}

export function normalizeAccountLimits(raw: unknown): AccountLimits {
  const record = asRecord(raw);
  const velocity = record.velocity;
  return {
    accountId: str(record.accountId),
    // Валюта нужна, чтобы отформатировать лимит; без неё разумный минимум — тенге.
    currency: str(record.currency, 'KZT'),
    limits: arr(record.limits).map(normalizeLimitWindow),
    velocity: velocity === undefined || velocity === null ? null : normalizeVelocity(velocity),
  };
}

export function fetchAccountLimits(accountId: string): Promise<AccountLimits> {
  return apiRequest<unknown>(`/v1/accounts/${encodeURIComponent(accountId)}/limits`).then(
    normalizeAccountLimits,
  );
}

/**
 * Устанавливает лимит одного окна и возвращает снимок, прочитанный сервисом
 * заново тем же кодом, что и путь исполнения платежа.
 *
 * `Idempotency-Key` не нужен и намеренно не отправляется: запрос декларативный,
 * повтор не двигает деньги и не создаёт второго эффекта (см. комментарий у
 * `AccountController.setLimit`).
 */
export function setAccountLimit(
  accountId: string,
  body: SetAccountLimitRequest,
): Promise<AccountLimits> {
  return apiRequest<unknown>(`/v1/accounts/${encodeURIComponent(accountId)}/limits`, {
    method: 'PUT',
    body,
  }).then(normalizeAccountLimits);
}
