/**
 * API-слой раздела «Магазины, товары и сток» админ-панели.
 *
 * Пути и поля взяты из реального контроллера
 * `services/catalog-service/src/main/java/kz/taxi/catalog/api/SupportCatalogController.java`
 * (`@RequestMapping("/api/v1/support")`) и его DTO
 * (`SupportMerchantResponse`, `SupportProductResponse`, `SupportStockResponse`,
 * `SupportReservationResponse`). Все пять эндпоинтов — GET: поддержка читает чужие
 * данные, но ничего в них не меняет, и это зафиксировано на уровне класса
 * (`@PreAuthorize("hasAnyRole('SUPPORT','ADMIN')")`, каждый вызов аудируется).
 *
 * Список магазинов и список всех товаров сервис не отдаёт: поддержка ищет точечно
 * по идентификатору. Единственный список в этом API — товары конкретного магазина
 * (`/support/merchants/{id}/products`), он и используется.
 */
import { apiRequest } from '../../api/client';
import { normalizeMerchant, normalizePage, normalizeProduct } from '../../api/endpoints';
import type { Merchant, Page, Product } from '../../api/types';

/* ------------------------------------------------------------------ хелперы */

/**
 * Мини-хелперы нормализации.
 *
 * Точно такие же живут приватно в `src/api/endpoints.ts`; оттуда их не экспортируют,
 * а список файлов, которые разрешено менять в этой задаче, третий общий модуль не
 * включает. Поэтому они объявлены один раз здесь и переиспользуются в соседнем
 * `supportOrders.ts`, чтобы не разъезжаться в правилах (`null` вместо нуля и т. п.).
 */
export function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};
}

export function textOf(value: unknown, fallback = ''): string {
  if (typeof value === 'string') {
    return value;
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(value);
  }
  return fallback;
}

export function optionalTextOf(value: unknown): string | null {
  if (typeof value === 'string') {
    return value;
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(value);
  }
  return null;
}

export function numberOf(value: unknown, fallback = 0): number {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return fallback;
}

/** Как {@link numberOf}, но отсутствующее поле остаётся `null`, а не нулём. */
export function optionalNumberOf(value: unknown): number | null {
  if (value === undefined || value === null) {
    return null;
  }
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

export function boolOf(value: unknown): boolean {
  return value === true;
}

/** Ответ-массив либо конверт `{items: [...]}` — оба варианта приходят через шлюз. */
export function listOf(value: unknown, key = 'items'): unknown[] {
  if (Array.isArray(value)) {
    return value;
  }
  const nested = asRecord(value)[key];
  return Array.isArray(nested) ? nested : [];
}

/* -------------------------------------------------------------------- типы */

/**
 * Магазин глазами поддержки: больше публичной карточки — ownerUserId, контакты и
 * счёт выплат. Именно поэтому чтение аудируется.
 */
export interface SupportMerchant extends Merchant {
  payoutAccountId: string | null;
  productCount: number | null;
}

/**
 * Товар глазами поддержки.
 *
 * `sellable` — можно ли продавать этот статус (черновик и архив — нет),
 * `buyable` — `sellable && available > 0`, а `unavailableReason` называет ровно одну
 * причину отказа, чтобы оператору не приходилось складывать два факта самому.
 */
export interface SupportProduct extends Product {
  sellable: boolean;
  archived: boolean;
  buyable: boolean;
  unavailableReason: string | null;
}

/** Резерв стока: `ACTIVE` держит единицы, `COMMITTED` их уже списал, `RELEASED`/`EXPIRED` вернул. */
export interface SupportReservation {
  id: string;
  orderId: string;
  productId: string;
  quantity: number;
  status: string;
  expiresAt: string | null;
  createdAt: string | null;
}

/** Остатки одного товара вместе с резервами, которые объясняют счётчики. */
export interface SupportStock {
  productId: string;
  merchantId: string;
  productStatus: string;
  sellable: boolean;
  onHand: number;
  reserved: number;
  available: number;
  updatedAt: string | null;
  holds: SupportReservation[];
}

export interface SupportMerchantProductsQuery {
  /** Вернуть и снятые с продажи товары (`?includeArchived=true`). */
  includeArchived?: boolean;
  page?: number;
  size?: number;
}

/* ------------------------------------------------------------ нормализация */

export function normalizeSupportMerchant(raw: unknown): SupportMerchant {
  // Контракт плоский (`SupportMerchantResponse`), но `{merchant: {...}}` тоже
  // встречается за шлюзом — `normalizeMerchant` из `api/endpoints` умеет оба.
  const record = asRecord(asRecord(raw).merchant ?? raw);
  return {
    ...normalizeMerchant(raw),
    payoutAccountId: optionalTextOf(record.payoutAccountId),
    productCount: optionalNumberOf(record.productCount),
  };
}

export function normalizeSupportProduct(raw: unknown): SupportProduct {
  const record = asRecord(raw);
  return {
    ...normalizeProduct(raw),
    sellable: boolOf(record.sellable),
    archived: boolOf(record.archived),
    buyable: boolOf(record.buyable),
    unavailableReason: optionalTextOf(record.unavailableReason),
  };
}

export function normalizeSupportReservation(raw: unknown): SupportReservation {
  const record = asRecord(raw);
  return {
    id: textOf(record.id ?? record.reservationId),
    orderId: textOf(record.orderId),
    productId: textOf(record.productId),
    quantity: numberOf(record.quantity, 0),
    status: textOf(record.status, 'UNKNOWN'),
    expiresAt: optionalTextOf(record.expiresAt),
    createdAt: optionalTextOf(record.createdAt),
  };
}

export function normalizeSupportStock(raw: unknown): SupportStock {
  const record = asRecord(raw);
  return {
    productId: textOf(record.productId),
    merchantId: textOf(record.merchantId),
    productStatus: textOf(record.productStatus, 'UNKNOWN'),
    sellable: boolOf(record.sellable),
    onHand: numberOf(record.onHand, 0),
    reserved: numberOf(record.reserved, 0),
    available: numberOf(record.available, 0),
    updatedAt: optionalTextOf(record.updatedAt),
    holds: listOf(record.holds).map(normalizeSupportReservation),
  };
}

/* -------------------------------------------------------------- запросы */

/**
 * Магазин по идентификатору (`SupportCatalogController.merchantById`).
 * 404 `MERCHANT_NOT_FOUND`, если такого магазина нет.
 */
export function fetchSupportMerchant(merchantId: string): Promise<SupportMerchant> {
  return apiRequest<unknown>(`/v1/support/merchants/${encodeURIComponent(merchantId)}`).then(
    normalizeSupportMerchant,
  );
}

/**
 * Магазин по идентификатору владельца (`SupportCatalogController.merchantByOwner`).
 * Разговор с клиентом начинается с человека, а не с магазина.
 */
export function fetchSupportMerchantByOwner(ownerUserId: string): Promise<SupportMerchant> {
  return apiRequest<unknown>(
    `/v1/support/merchants/by-owner/${encodeURIComponent(ownerUserId)}`,
  ).then(normalizeSupportMerchant);
}

/**
 * Товары одного магазина, черновики включены (`SupportCatalogController.products`).
 * Архивные добавляются флагом `includeArchived=true`; сервер сортирует по названию.
 */
export function fetchSupportMerchantProducts(
  merchantId: string,
  query: SupportMerchantProductsQuery = {},
): Promise<Page<SupportProduct>> {
  return apiRequest<unknown>(`/v1/support/merchants/${encodeURIComponent(merchantId)}/products`, {
    query: {
      includeArchived: query.includeArchived ?? false,
      page: query.page ?? 0,
      size: query.size ?? 10,
    },
  }).then((raw) => normalizePage(raw, normalizeSupportProduct));
}

/**
 * Один товар (`SupportCatalogController.product`).
 * 404 `PRODUCT_NOT_FOUND`; архивный товар возвращается, а не прячется.
 */
export function fetchSupportProduct(productId: string): Promise<SupportProduct> {
  return apiRequest<unknown>(`/v1/support/products/${encodeURIComponent(productId)}`).then(
    normalizeSupportProduct,
  );
}

/**
 * Остатки товара и последние резервы, которые их держат
 * (`SupportCatalogController.stock`).
 */
export function fetchSupportStock(productId: string): Promise<SupportStock> {
  return apiRequest<unknown>(`/v1/support/products/${encodeURIComponent(productId)}/stock`).then(
    normalizeSupportStock,
  );
}

/**
 * Все резервы стока одного заказа (`SupportCatalogController.reservations`).
 *
 * Пустого ответа у этого эндпоинта нет: если каталог никогда не резервировал сток
 * по этому заказу, приходит 404 `RESERVATION_NOT_FOUND` — и это другое утверждение,
 * чем «резервов нет».
 */
export function fetchSupportReservations(orderId: string): Promise<SupportReservation[]> {
  return apiRequest<unknown>(`/v1/support/reservations/${encodeURIComponent(orderId)}`).then((raw) =>
    listOf(raw).map(normalizeSupportReservation),
  );
}
