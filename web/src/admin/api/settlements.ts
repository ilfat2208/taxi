/**
 * API-слой раздела «Расчёты с мерчантами».
 *
 * Параметры и поля взяты из самого сервиса, а не из догадок —
 * `services/payment-service/.../api/SettlementController.java` и
 * `api/dto/SettlementDtos.java`:
 *
 *  - `GET  /api/v1/settlements?merchantId&page&size` — фильтра по статусу в
 *    контроллере нет (есть только `merchantId`, `page`, `size`), поэтому его нет
 *    и здесь: несуществующий параметр выглядел бы как работающий фильтр;
 *  - `GET  /api/v1/settlements/{id}` — `SettlementDetailResponse`,
 *    то есть расчёт плюс `paymentIds` (сервис отдаёт только идентификаторы
 *    покрывающих платежей, не сами платежи);
 *  - `POST /api/v1/settlements/run` — тело не принимается, `Idempotency-Key` не
 *    требуется: контроллер объявляет эндпоинт без `@RequestBody` и без
 *    `IdempotencyGuard`, а повторный прогон безопасен на стороне сервиса (ключ
 *    расчёта — «мерчант + валюта + конец периода», см. `MerchantSettlement`).
 *
 * Деньги — как и везде в клиенте — целые минорные единицы; арифметику делает
 * `api/money.ts`, здесь только разбор ответа.
 */
import { apiRequest } from '../../api/client';
import { normalizePage } from '../../api/endpoints';
import type { Page } from '../../api/types';

/* ------------------------------------------------------------ типы ответов */

/** `SettlementStatus` сервиса: долг записан, выплачен или выплата не прошла. */
export type SettlementStatus = 'PENDING' | 'PAID' | 'FAILED' | string;

/**
 * Один расчёт (`SettlementDtos.SettlementResponse`).
 *
 * Денежные тождества сервиса соблюдаются в БД, поэтому их можно показывать рядом:
 * `customerPaidMinor = grossMinor + commissionMinor`, `netMinor = grossMinor`.
 */
export interface Settlement {
  settlementId: string;
  settlementNumber: string;
  merchantId: string;
  ownerUserId: string;
  status: SettlementStatus;
  currency: string;
  /** Стоимость проданных товаров — то, что получает мерчант. */
  grossMinor: number;
  /** Комиссия платформы, удержанная на checkout. */
  commissionMinor: number;
  /** Сколько заплатил покупатель: товары + комиссия. */
  customerPaidMinor: number;
  /** К выплате мерчанту (`netMinor == grossMinor`). */
  netMinor: number;
  paymentCount: number;
  /** `null`, пока мерчант не указал счёт для выплат. */
  payoutAccountId: string | null;
  periodStart: string;
  periodEnd: string;
  createdAt: string;
  paidAt: string | null;
  failureReason: string | null;
}

/** Деталь расчёта: сам расчёт и идентификаторы покрытых платежей. */
export interface SettlementDetail {
  settlement: Settlement;
  /** Только id: суммы по платежам сервис в этом ответе не отдаёт. */
  paymentIds: string[];
}

/** Итог принудительного прогона (`POST /settlements/run`). */
export interface SettlementRunResult {
  /** Сколько расчётов посчитано этим прогоном. */
  computed: number;
  paid: number;
  failed: number;
  /** Выплата не ушла, потому что у мерчанта нет счёта: долг остался. */
  awaitingPayoutAccount: number;
  nothingToSettle: number;
}

export interface SettlementQuery {
  /** Оператор может ограничить выборку одним мерчантом; иначе — все расчёты. */
  merchantId?: string;
  /** Нумерация страниц с нуля, как у Spring `Pageable`. */
  page?: number;
  size?: number;
}

/* ------------------------------------------------------------- нормализация */

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

/**
 * Число из ответа. `null` не превращается в ноль автоматически: «сервис не прислал
 * сумму» и «сумма ноль» — разные вещи, поэтому отсутствующее поле остаётся `null`
 * и вызывающий код решает, что показать.
 */
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

function num(value: unknown, fallback = 0): number {
  return optionalNum(value) ?? fallback;
}

export function normalizeSettlement(raw: unknown): Settlement {
  const settlement = asRecord(raw);
  const settlementId = str(settlement.settlementId ?? settlement.id);
  return {
    settlementId,
    settlementNumber: str(settlement.settlementNumber ?? settlement.number, settlementId),
    merchantId: str(settlement.merchantId),
    ownerUserId: str(settlement.ownerUserId),
    status: str(settlement.status, 'UNKNOWN'),
    currency: str(settlement.currency, 'KZT'),
    grossMinor: num(settlement.grossMinor, 0),
    commissionMinor: num(settlement.commissionMinor, 0),
    customerPaidMinor: num(settlement.customerPaidMinor, 0),
    netMinor: num(settlement.netMinor, 0),
    paymentCount: num(settlement.paymentCount, 0),
    payoutAccountId: optionalStr(settlement.payoutAccountId),
    periodStart: str(settlement.periodStart),
    periodEnd: str(settlement.periodEnd),
    createdAt: str(settlement.createdAt),
    paidAt: optionalStr(settlement.paidAt),
    failureReason: optionalStr(settlement.failureReason),
  };
}

/** Ответ детали — `{settlement, paymentIds}`; плоский расчёт тоже принимается. */
export function normalizeSettlementDetail(raw: unknown): SettlementDetail {
  const container = asRecord(raw);
  const source = container.settlement !== undefined ? container.settlement : container;
  return {
    settlement: normalizeSettlement(source),
    paymentIds: arr(container.paymentIds ?? asRecord(source).paymentIds)
      .map((entry) => str(entry))
      .filter((id) => id !== ''),
  };
}

export function normalizeSettlementRun(raw: unknown): SettlementRunResult {
  const result = asRecord(raw);
  return {
    computed: num(result.computed, 0),
    paid: num(result.paid, 0),
    failed: num(result.failed, 0),
    awaitingPayoutAccount: num(result.awaitingPayoutAccount, 0),
    nothingToSettle: num(result.nothingToSettle, 0),
  };
}

/* ------------------------------------------------------------------ запросы */

/**
 * Список расчётов. Оператор (ADMIN/SUPPORT) видит все; `merchantId` сужает до
 * одного мерчанта. Ответ — тот же `PageResponse`, что и у платежей.
 */
export function fetchSettlements(query: SettlementQuery = {}): Promise<Page<Settlement>> {
  const merchantId = query.merchantId?.trim();
  return apiRequest<unknown>('/v1/settlements', {
    query: {
      merchantId: merchantId === undefined || merchantId === '' ? undefined : merchantId,
      page: query.page ?? 0,
      size: query.size ?? 20,
    },
  }).then((raw) => normalizePage(raw, normalizeSettlement));
}

export function fetchSettlement(settlementId: string): Promise<SettlementDetail> {
  return apiRequest<unknown>(`/v1/settlements/${encodeURIComponent(settlementId)}`).then(
    normalizeSettlementDetail,
  );
}

/**
 * Принудительный прогон расчётов: посчитать долги и выплатить то, что можно.
 *
 * Ни тела, ни `Idempotency-Key`: эндпоинт их не принимает, а идемпотентность
 * держится на ключе расчёта внутри сервиса.
 */
export function runSettlements(): Promise<SettlementRunResult> {
  return apiRequest<unknown>('/v1/settlements/run', { method: 'POST' }).then(
    normalizeSettlementRun,
  );
}
