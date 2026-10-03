import { apiRequest } from './client';
import { multiplyMinor, sumMinor } from './money';
import type {
  Account,
  AccountHold,
  AccountTransaction,
  AddCartItemRequest,
  BookingQuery,
  Cart,
  CartItem,
  Category,
  CreateAccountRequest,
  CreateBookingRequest,
  CreateMerchantRequest,
  CreateOrderRequest,
  CreateProductRequest,
  CreateTripRequest,
  DispatchCandidate,
  DispatchDriver,
  DispatchDriversResponse,
  DispatchNearestResponse,
  Merchant,
  MerchantSummary,
  NearestDriversQuery,
  Order,
  OrderItem,
  OrderPage,
  OrderStatusHistoryEntry,
  Page,
  Payment,
  PaymentDetail,
  PaymentTransition,
  Product,
  ProductPage,
  ProductQuery,
  Profile,
  QtimeBooking,
  QtimeCompany,
  QtimeCompanyDetail,
  QtimeCompanyQuery,
  QtimeService,
  QtimeSlots,
  QtimeSpecialist,
  Refund,
  RefundRequest,
  TokenResponse,
  TopUpRequest,
  TransactionPage,
  TransferRequest,
  Trip,
  TripAccepted,
  TripPage,
  TripPoint,
  TripQuery,
  TripQuote,
  TripQuoteRequest,
  TripReceipt,
  TripTimelineEntry,
  UpdateCartItemRequest,
  UpdateProductRequest,
} from './types';

/* ------------------------------------------------------------ normalizing */

/**
 * The backend is typed server-side, but the client still normalizes on the way
 * in: it absorbs optional/null fields, `content`-vs-`items` page envelopes and
 * numeric strings, and it derives totals from line items instead of trusting
 * (or floating) server arithmetic. Anything the contract leaves open is
 * documented next to the normalizer.
 */

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};
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

function num(value: unknown, fallback = 0): number {
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

/**
 * Like {@link num}, but `null` when the field is missing.
 *
 * The trip and QTime screens must not turn an absent field into a zero: a company
 * without a price list has no "от 0 ₸", and a driverless trip has no rating to
 * show. `null` keeps "не пришло" distinguishable from "ноль".
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

function optionalBool(value: unknown): boolean | null {
  return typeof value === 'boolean' ? value : null;
}

/** `driverName` is the contract; `driver: {name}` is tolerated behind the gateway. */
function driverNameOf(trip: Record<string, unknown>): string | null {
  const direct = optionalStr(trip.driverName);
  if (direct !== null) {
    return direct;
  }
  if (typeof trip.driver === 'string') {
    return trip.driver;
  }
  if (typeof trip.driver === 'object' && trip.driver !== null) {
    const driver = asRecord(trip.driver);
    return optionalStr(driver.name ?? driver.displayName);
  }
  return null;
}

function arr(value: unknown): unknown[] {
  if (Array.isArray(value)) {
    return value;
  }
  return [];
}

export function normalizePage<T>(raw: unknown, map: (item: unknown) => T): Page<T> {
  const record = asRecord(raw);
  const items = arr(record.items ?? record.content ?? record.data ?? raw).map(map);
  const size = num(record.size, items.length === 0 ? 20 : items.length);
  const page = num(record.page ?? record.number, 0);
  const totalElements = num(record.totalElements ?? record.total ?? items.length, items.length);
  const totalPages = num(
    record.totalPages,
    size > 0 ? Math.max(1, Math.ceil(totalElements / size)) : 1,
  );
  const hasNext = typeof record.hasNext === 'boolean' ? record.hasNext : page + 1 < totalPages;
  return { items, page, size, totalElements, totalPages, hasNext };
}

export function emptyCart(): Cart {
  return {
    items: [],
    itemCount: 0,
    itemsTotalMinor: 0,
    deliveryMinor: 0,
    totalMinor: 0,
    currency: 'KZT',
  };
}

export function normalizeCartItem(raw: unknown): CartItem {
  const item = asRecord(raw);
  const quantity = Math.max(0, num(item.quantity, 0));
  const priceMinor = num(item.priceMinor ?? item.unitPriceMinor, 0);
  return {
    itemId: str(item.itemId ?? item.id),
    productId: str(item.productId),
    title: str(item.title ?? item.productTitle, 'Товар'),
    priceMinor,
    currency: str(item.currency, 'KZT'),
    quantity,
    totalMinor: num(item.totalMinor ?? item.lineTotalMinor, multiplyMinor(priceMinor, quantity)),
    imageUrl: optionalStr(item.imageUrl),
    merchantId: optionalStr(item.merchantId),
    merchantName: optionalStr(item.merchantName),
    availableQuantity:
      item.availableQuantity === undefined || item.availableQuantity === null
        ? null
        : num(item.availableQuantity, 0),
  };
}

/** `/cart` may answer with totals, or only with items — both are handled. */
export function normalizeCart(raw: unknown): Cart {
  const record = asRecord(raw);
  const items = arr(record.items ?? record.cartItems).map(normalizeCartItem);
  const itemsTotalMinor = num(
    record.itemsTotalMinor ?? record.subtotalMinor,
    sumMinor(items.map((item) => item.totalMinor ?? multiplyMinor(item.priceMinor, item.quantity))),
  );
  const deliveryMinor = num(record.deliveryMinor ?? record.deliveryFeeMinor, 0);
  return {
    cartId: optionalStr(record.cartId ?? record.id) ?? undefined,
    items,
    itemCount: num(
      record.itemCount,
      items.reduce((count, item) => count + item.quantity, 0),
    ),
    itemsTotalMinor,
    deliveryMinor,
    totalMinor: num(record.totalMinor, itemsTotalMinor + deliveryMinor),
    currency: str(record.currency, items[0]?.currency ?? 'KZT'),
  };
}

export function normalizePayment(raw: unknown): Payment {
  const payment = asRecord(raw);
  const amountMinor = num(payment.amountMinor, 0);
  const feeMinor = num(payment.feeMinor, 0);
  const paymentId = str(payment.paymentId ?? payment.id);
  return {
    paymentId,
    paymentNumber: str(payment.paymentNumber ?? payment.number, paymentId),
    type: str(payment.type, 'TRANSFER'),
    status: str(payment.status, 'UNKNOWN'),
    amountMinor,
    feeMinor,
    totalMinor: num(payment.totalMinor, amountMinor + feeMinor),
    currency: str(payment.currency, 'KZT'),
    // ownerUserId в ответе есть, и без него админка выясняла владельца запросом счёта.
    ownerUserId: optionalStr(payment.ownerUserId),
    sourceAccountId: optionalStr(payment.sourceAccountId),
    targetAccountId: optionalStr(payment.targetAccountId),
    merchantId: optionalStr(payment.merchantId),
    // orderId is in PaymentResponse and was dropped here: without it a marketplace payment
    // could not be traced back to its order, which is the first thing an operator asks.
    orderId: optionalStr(payment.orderId),
    description: optionalStr(payment.description),
    failureCode: optionalStr(payment.failureCode),
    failureReason: optionalStr(payment.failureReason),
    createdAt: str(payment.createdAt),
    completedAt: optionalStr(payment.completedAt),
  };
}

function normalizeTransition(raw: unknown): PaymentTransition {
  const transition = asRecord(raw);
  return {
    id: optionalStr(transition.id) ?? undefined,
    fromStatus: optionalStr(transition.fromStatus),
    toStatus: str(transition.toStatus ?? transition.status, 'UNKNOWN'),
    status: optionalStr(transition.status) ?? undefined,
    reason: optionalStr(transition.reason ?? transition.comment),
    comment: optionalStr(transition.comment),
    createdAt: optionalStr(transition.createdAt ?? transition.occurredAt ?? transition.changedAt) ?? undefined,
    occurredAt: optionalStr(transition.occurredAt) ?? undefined,
  };
}

/**
 * `GET /payments/{id}` returns "payment + transition history"; the exact
 * envelope is not frozen, so both `{payment, transitions}` and a flat payment
 * with `history` are accepted.
 */
export function normalizePaymentDetail(raw: unknown): PaymentDetail {
  const container = asRecord(raw);
  const paymentRaw = container.payment !== undefined ? container.payment : container;
  const transitionsRaw =
    container.transitions ?? container.history ?? container.timeline ?? container.historyItems;
  return {
    payment: normalizePayment(paymentRaw),
    transitions: arr(transitionsRaw).map(normalizeTransition),
  };
}

function normalizeOrderItem(raw: unknown): OrderItem {
  const item = asRecord(raw);
  const quantity = Math.max(0, num(item.quantity, 0));
  const priceMinor = num(item.priceMinor ?? item.unitPriceMinor, 0);
  return {
    orderItemId: optionalStr(item.orderItemId ?? item.id) ?? undefined,
    id: optionalStr(item.id) ?? undefined,
    productId: str(item.productId),
    title: str(item.title ?? item.productTitle, 'Товар'),
    quantity,
    priceMinor,
    totalMinor: num(item.totalMinor ?? item.lineTotalMinor, multiplyMinor(priceMinor, quantity)),
    currency: optionalStr(item.currency) ?? undefined,
    merchantId: optionalStr(item.merchantId),
    merchantName: optionalStr(item.merchantName),
    imageUrl: optionalStr(item.imageUrl),
  };
}

function normalizeStatusHistory(raw: unknown): OrderStatusHistoryEntry {
  const entry = asRecord(raw);
  return {
    status: optionalStr(entry.status ?? entry.toStatus) ?? undefined,
    toStatus: optionalStr(entry.toStatus) ?? undefined,
    fromStatus: optionalStr(entry.fromStatus),
    comment: optionalStr(entry.comment),
    reason: optionalStr(entry.reason),
    createdAt: optionalStr(entry.createdAt ?? entry.changedAt ?? entry.occurredAt) ?? undefined,
    changedAt: optionalStr(entry.changedAt) ?? undefined,
    occurredAt: optionalStr(entry.occurredAt) ?? undefined,
  };
}

/** Same tolerance as payment details: `{order, items, statusHistory}` or flat. */
export function normalizeOrder(raw: unknown): Order {
  const container = asRecord(raw);
  const orderRaw = container.order !== undefined ? asRecord(container.order) : container;
  const items = arr(orderRaw.items ?? container.items).map(normalizeOrderItem);
  const itemsTotalMinor = num(
    orderRaw.itemsTotalMinor ?? orderRaw.subtotalMinor,
    sumMinor(items.map((item) => item.totalMinor ?? multiplyMinor(item.priceMinor, item.quantity))),
  );
  const deliveryMinor = num(orderRaw.deliveryMinor ?? orderRaw.deliveryFeeMinor, 0);
  const historyRaw =
    orderRaw.statusHistory ??
    orderRaw.history ??
    orderRaw.transitions ??
    container.statusHistory ??
    container.history;
  const orderId = str(orderRaw.orderId ?? orderRaw.id ?? container.orderId);
  return {
    orderId,
    orderNumber: str(orderRaw.orderNumber ?? orderRaw.number, orderId),
    status: str(orderRaw.status, 'UNKNOWN'),
    currency: str(orderRaw.currency, items[0]?.currency ?? 'KZT'),
    itemsTotalMinor,
    deliveryMinor,
    totalMinor: num(orderRaw.totalMinor, itemsTotalMinor + deliveryMinor),
    deliveryAddress: str(orderRaw.deliveryAddress),
    contactPhone: str(orderRaw.contactPhone),
    comment: optionalStr(orderRaw.comment),
    sourceAccountId: optionalStr(orderRaw.sourceAccountId),
    paymentId: optionalStr(orderRaw.paymentId),
    failureCode: optionalStr(orderRaw.failureCode),
    failureReason: optionalStr(orderRaw.failureReason),
    createdAt: str(orderRaw.createdAt),
    updatedAt: optionalStr(orderRaw.updatedAt),
    completedAt: optionalStr(orderRaw.completedAt),
    items,
    statusHistory: arr(historyRaw).map(normalizeStatusHistory),
  };
}

export function normalizeProduct(raw: unknown): Product {
  const product = asRecord(raw);
  const availableQuantity = num(product.availableQuantity ?? product.available, 0);
  return {
    id: str(product.id ?? product.productId),
    merchantId: str(product.merchantId),
    merchantName: str(product.merchantName, 'Магазин'),
    title: str(product.title, 'Товар'),
    description: optionalStr(product.description),
    category: optionalStr(product.category),
    brand: optionalStr(product.brand),
    priceMinor: num(product.priceMinor, 0),
    currency: str(product.currency, 'KZT'),
    imageUrl: optionalStr(product.imageUrl),
    status: str(product.status, 'ACTIVE'),
    availableQuantity,
    onHand: product.onHand === undefined || product.onHand === null ? undefined : num(product.onHand, 0),
    reserved:
      product.reserved === undefined || product.reserved === null ? undefined : num(product.reserved, 0),
    available: product.available === undefined || product.available === null ? undefined : num(product.available, 0),
    merchant:
      product.merchant === undefined || product.merchant === null
        ? null
        : normalizeMerchantSummary(product.merchant),
    sku: optionalStr(product.sku),
  };
}

export function normalizeMerchantSummary(raw: unknown): MerchantSummary {
  const merchant = asRecord(raw);
  return {
    id: str(merchant.id ?? merchant.merchantId),
    name: str(merchant.name ?? merchant.displayName, 'Магазин'),
    displayName: optionalStr(merchant.displayName),
    city: optionalStr(merchant.city),
    status: optionalStr(merchant.status),
    ratingBasisPoints:
      merchant.ratingBasisPoints === undefined || merchant.ratingBasisPoints === null
        ? undefined
        : num(merchant.ratingBasisPoints, 0),
  };
}

/** Merchant profile: `{...}` or `{merchant: {...}}` both seen behind the gateway. */
export function normalizeMerchant(raw: unknown): Merchant {
  const container = asRecord(raw);
  const source = container.merchant !== undefined ? container.merchant : container;
  const summary = normalizeMerchantSummary(source);
  const record = asRecord(source);
  return {
    ...summary,
    ownerUserId: optionalStr(record.ownerUserId),
    phone: optionalStr(record.phone),
    email: optionalStr(record.email),
    createdAt: optionalStr(record.createdAt),
  };
}

/** `GET /catalog/categories` may return objects, plain strings, or `{items}`. */
export function normalizeCategories(raw: unknown): Category[] {
  const source = Array.isArray(raw) ? raw : arr(asRecord(raw).items ?? asRecord(raw).categories);
  return source
    .map((entry) => {
      if (typeof entry === 'string') {
        return { name: entry, slug: entry };
      }
      const record = asRecord(entry);
      const name = str(record.name ?? record.title ?? record.slug);
      return {
        id: optionalStr(record.id) ?? undefined,
        name,
        slug: optionalStr(record.slug ?? record.code) ?? undefined,
        productCount:
          record.productCount === undefined || record.productCount === null
            ? undefined
            : num(record.productCount, 0),
      };
    })
    .filter((category) => category.name !== '');
}

/* ------------------------------------------------------------------- auth */

export interface LoginRequest {
  phone: string;
  code: string;
  displayName?: string;
  roles?: string[];
}

export function login(body: LoginRequest): Promise<TokenResponse> {
  // `auth: false`: a 401 here means "wrong code", not "session expired".
  return apiRequest<TokenResponse>('/v1/auth/token', { method: 'POST', body, auth: false });
}

export function fetchProfile(): Promise<Profile> {
  return apiRequest<Profile>('/v1/auth/me');
}

/* --------------------------------------------------------------- accounts */

export function fetchAccounts(): Promise<Account[]> {
  return apiRequest<unknown>('/v1/accounts').then((raw) => {
    const source = Array.isArray(raw) ? raw : arr(asRecord(raw).items ?? asRecord(raw).accounts);
    return source.map((entry) => {
      const account = asRecord(entry);
      const balanceMinor = num(account.balanceMinor, 0);
      const heldMinor = num(account.heldMinor, 0);
      return {
        id: str(account.id ?? account.accountId),
        ownerUserId: str(account.ownerUserId),
        ownerPhone: str(account.ownerPhone),
        displayName: str(account.displayName),
        type: str(account.type, 'CUSTOMER'),
        currency: str(account.currency, 'KZT'),
        status: str(account.status, 'ACTIVE'),
        balanceMinor,
        heldMinor,
        availableMinor: num(account.availableMinor, balanceMinor - heldMinor),
        createdAt: str(account.createdAt),
      } satisfies Account;
    });
  });
}

export function fetchAccount(accountId: string): Promise<Account> {
  return apiRequest<unknown>(`/v1/accounts/${encodeURIComponent(accountId)}`).then((raw) => {
    const account = asRecord(raw);
    const balanceMinor = num(account.balanceMinor, 0);
    const heldMinor = num(account.heldMinor, 0);
    return {
      id: str(account.id ?? account.accountId, accountId),
      ownerUserId: str(account.ownerUserId),
      ownerPhone: str(account.ownerPhone),
      displayName: str(account.displayName),
      type: str(account.type, 'CUSTOMER'),
      currency: str(account.currency, 'KZT'),
      status: str(account.status, 'ACTIVE'),
      balanceMinor,
      heldMinor,
      availableMinor: num(account.availableMinor, balanceMinor - heldMinor),
      createdAt: str(account.createdAt),
    } satisfies Account;
  });
}

export function createAccount(body: CreateAccountRequest): Promise<Account> {
  return apiRequest<Account>('/v1/accounts', { method: 'POST', body });
}

export interface PageQuery {
  page?: number;
  size?: number;
}

/**
 * `LedgerEntryResponse` calls the row id `transactionId`; the UI treats it as the
 * transaction id, so both spellings are accepted.
 */
export function normalizeTransaction(raw: unknown): AccountTransaction {
  const entry = asRecord(raw);
  return {
    id: str(entry.id ?? entry.transactionId),
    direction: str(entry.direction, 'DEBIT'),
    amountMinor: num(entry.amountMinor, 0),
    currency: str(entry.currency, 'KZT'),
    balanceAfterMinor: num(entry.balanceAfterMinor, 0),
    operation: str(entry.operation, 'PAYMENT'),
    referenceType: optionalStr(entry.referenceType),
    referenceId: optionalStr(entry.referenceId),
    description: optionalStr(entry.description),
    createdAt: str(entry.createdAt),
  };
}

export function fetchAccountTransactions(
  accountId: string,
  query: PageQuery = {},
): Promise<TransactionPage> {
  return apiRequest<unknown>(`/v1/accounts/${encodeURIComponent(accountId)}/transactions`, {
    query: { page: query.page ?? 0, size: query.size ?? 20 },
  }).then((raw) => normalizePage(raw, normalizeTransaction));
}

export function normalizeHold(raw: unknown): AccountHold {
  const hold = asRecord(raw);
  return {
    holdId: str(hold.holdId ?? hold.id),
    accountId: str(hold.accountId),
    amountMinor: num(hold.amountMinor, 0),
    currency: str(hold.currency, 'KZT'),
    status: str(hold.status, 'ACTIVE'),
    referenceType: optionalStr(hold.referenceType),
    referenceId: optionalStr(hold.referenceId),
    reason: optionalStr(hold.reason),
    expiresAt: optionalStr(hold.expiresAt),
    createdAt: optionalStr(hold.createdAt),
  };
}

/** Money reserved for in-flight payments — shown next to the balance. */
export function fetchAccountHolds(
  accountId: string,
  query: PageQuery & { status?: string } = {},
): Promise<Page<AccountHold>> {
  return apiRequest<unknown>(`/v1/accounts/${encodeURIComponent(accountId)}/holds`, {
    query: { status: query.status, page: query.page ?? 0, size: query.size ?? 20 },
  }).then((raw) => normalizePage(raw, normalizeHold));
}

export function topUpAccount(
  accountId: string,
  body: TopUpRequest,
  idempotencyKey: string,
): Promise<Account | undefined> {
  return apiRequest<Account | undefined>(`/v1/accounts/${encodeURIComponent(accountId)}/top-up`, {
    method: 'POST',
    body,
    idempotencyKey,
  });
}

/* --------------------------------------------------------------- payments */

export interface PaymentQuery extends PageQuery {
  status?: string;
}

export function fetchPayments(query: PaymentQuery = {}): Promise<Page<Payment>> {
  return apiRequest<unknown>('/v1/payments', {
    query: {
      page: query.page ?? 0,
      size: query.size ?? 10,
      status: query.status,
    },
  }).then((raw) => normalizePage(raw, normalizePayment));
}

export function fetchPayment(paymentId: string): Promise<PaymentDetail> {
  return apiRequest<unknown>(`/v1/payments/${encodeURIComponent(paymentId)}`).then(
    normalizePaymentDetail,
  );
}

/** The money path: one `Idempotency-Key` per user submit. */
export function createTransfer(body: TransferRequest, idempotencyKey: string): Promise<Payment> {
  return apiRequest<unknown>('/v1/payments/transfers', {
    method: 'POST',
    body,
    idempotencyKey,
  }).then((raw) => normalizePayment(asRecord(raw).payment !== undefined ? asRecord(raw).payment : raw));
}

/**
 * Refund a payment.
 *
 * <p>Returns a {@link Refund}, not a {@link Payment}: the service answers with
 * `RefundResponse{refundId, paymentId, amountMinor, currency, status, reason, createdAt,
 * updatedAt}`, and running that through `normalizePayment` produced a payment whose id was the
 * *refund* id — a wrong type that stayed invisible only while nobody read the result. The
 * payment itself is refetched by the caller, which is the honest way to show its new status.
 */
export function refundPayment(
  paymentId: string,
  body: RefundRequest,
  idempotencyKey: string,
): Promise<Refund> {
  return apiRequest<unknown>(`/v1/payments/${encodeURIComponent(paymentId)}/refund`, {
    method: 'POST',
    body,
    idempotencyKey,
  }).then(normalizeRefund);
}

export function normalizeRefund(raw: unknown): Refund {
  const refund = asRecord(raw);
  return {
    refundId: str(refund.refundId ?? refund.id),
    paymentId: str(refund.paymentId),
    amountMinor: num(refund.amountMinor, 0),
    currency: str(refund.currency, 'KZT'),
    status: str(refund.status, 'COMPLETED'),
    reason: optionalStr(refund.reason),
    createdAt: optionalStr(refund.createdAt),
    // The service sends updatedAt and nothing else: `completedAt` never arrived from it.
    completedAt: optionalStr(refund.completedAt ?? refund.updatedAt),
    updatedAt: optionalStr(refund.updatedAt),
  };
}

/** Refunds already recorded against a payment. */
export function fetchRefunds(paymentId: string): Promise<Refund[]> {
  return apiRequest<unknown>(`/v1/payments/${encodeURIComponent(paymentId)}/refunds`).then((raw) => {
    const source = Array.isArray(raw) ? raw : arr(asRecord(raw).items ?? asRecord(raw).refunds);
    return source.map(normalizeRefund);
  });
}

/* ---------------------------------------------------------------- catalog */

export function fetchProducts(query: ProductQuery = {}): Promise<ProductPage> {
  return apiRequest<unknown>('/v1/catalog/products', {
    query: {
      query: query.query,
      category: query.category,
      merchantId: query.merchantId,
      page: query.page ?? 0,
      size: query.size ?? 12,
      sort: query.sort,
    },
  }).then((raw) => normalizePage(raw, normalizeProduct));
}

export function fetchProduct(productId: string): Promise<Product> {
  return apiRequest<unknown>(`/v1/catalog/products/${encodeURIComponent(productId)}`).then((raw) =>
    normalizeProduct(asRecord(raw).product !== undefined ? asRecord(raw).product : raw),
  );
}

export function fetchCategories(): Promise<Category[]> {
  return apiRequest<unknown>('/v1/catalog/categories').then(normalizeCategories);
}

/**
 * Merchant console: publishing a product.
 * `sku` and `initialStock` are required by catalog-service; the rest mirrors the
 * product resource minus server-owned fields.
 */
export function createProduct(body: CreateProductRequest): Promise<Product> {
  return apiRequest<unknown>('/v1/catalog/products', { method: 'POST', body }).then((raw) =>
    normalizeProduct(asRecord(raw).product !== undefined ? asRecord(raw).product : raw),
  );
}

/** Partial update of an offer the caller owns (price, status, stock delta, ...). */
export function updateProduct(productId: string, body: UpdateProductRequest): Promise<Product> {
  return apiRequest<unknown>(`/v1/catalog/products/${encodeURIComponent(productId)}`, {
    method: 'PATCH',
    body,
  }).then((raw) => normalizeProduct(asRecord(raw).product !== undefined ? asRecord(raw).product : raw));
}

/* -------------------------------------------------------------- merchants */

export function fetchMerchant(merchantId: string): Promise<Merchant> {
  return apiRequest<unknown>(`/v1/merchants/${encodeURIComponent(merchantId)}`).then(normalizeMerchant);
}

/** Own profile; 404 (`MERCHANT_NOT_FOUND`) means the caller has no shop yet. */
export function fetchMyMerchant(): Promise<Merchant> {
  return apiRequest<unknown>('/v1/merchants/me').then(normalizeMerchant);
}

export function createMerchant(body: CreateMerchantRequest): Promise<Merchant> {
  return apiRequest<unknown>('/v1/merchants', { method: 'POST', body }).then(normalizeMerchant);
}

/* ------------------------------------------------------------------- cart */

export function fetchCart(): Promise<Cart> {
  return apiRequest<unknown>('/v1/cart').then(normalizeCart);
}

export function addCartItem(body: AddCartItemRequest): Promise<Cart> {
  return apiRequest<unknown>('/v1/cart/items', { method: 'POST', body }).then(normalizeCart);
}

export function updateCartItem(itemId: string, body: UpdateCartItemRequest): Promise<Cart> {
  return apiRequest<unknown>(`/v1/cart/items/${encodeURIComponent(itemId)}`, {
    method: 'PATCH',
    body,
  }).then(normalizeCart);
}

export function removeCartItem(itemId: string): Promise<Cart> {
  return apiRequest<unknown>(`/v1/cart/items/${encodeURIComponent(itemId)}`, {
    method: 'DELETE',
  }).then(normalizeCart);
}

export function clearCart(): Promise<void> {
  return apiRequest<void>('/v1/cart', { method: 'DELETE' });
}

/* ----------------------------------------------------------------- orders */

export function createOrder(body: CreateOrderRequest, idempotencyKey: string): Promise<Order> {
  return apiRequest<unknown>('/v1/orders', { method: 'POST', body, idempotencyKey }).then(
    normalizeOrder,
  );
}

export interface OrderQuery extends PageQuery {
  status?: string;
}

export function fetchOrders(query: OrderQuery = {}): Promise<OrderPage> {
  return apiRequest<unknown>('/v1/orders', {
    query: {
      page: query.page ?? 0,
      size: query.size ?? 10,
      status: query.status,
    },
  }).then((raw) => normalizePage(raw, normalizeOrder));
}

export function fetchOrder(orderId: string): Promise<Order> {
  return apiRequest<unknown>(`/v1/orders/${encodeURIComponent(orderId)}`).then(normalizeOrder);
}

export function cancelOrder(orderId: string): Promise<Order> {
  return apiRequest<unknown>(`/v1/orders/${encodeURIComponent(orderId)}/cancel`, {
    method: 'POST',
  }).then(normalizeOrder);
}

/* -------------------------------------------------------------- dispatch */

/**
 * A driver without a usable fix is dropped from the map, not drawn at (0, 0):
 * `Number.NaN` survives normalization so the page can filter instead of guessing.
 */
export function normalizeDispatchDriver(raw: unknown): DispatchDriver {
  const driver = asRecord(raw);
  return {
    driverId: str(driver.driverId ?? driver.id),
    displayName: str(driver.displayName ?? driver.name, 'Водитель'),
    phone: str(driver.phone),
    status: str(driver.status, 'UNKNOWN'),
    lat: num(driver.lat ?? driver.latitude, Number.NaN),
    lon: num(driver.lon ?? driver.lng ?? driver.longitude, Number.NaN),
    headingDeg: num(driver.headingDeg ?? driver.heading, 0),
    speedKph: num(driver.speedKph ?? driver.speed, 0),
    ageSeconds: num(driver.ageSeconds ?? driver.age, 0),
    stale: driver.stale === true,
  };
}

export function normalizeDispatchDrivers(raw: unknown): DispatchDriversResponse {
  const container = asRecord(raw);
  const drivers = arr(container.drivers ?? container.items).map(normalizeDispatchDriver);
  const withPosition = drivers.filter(
    (driver) => Number.isFinite(driver.lat) && Number.isFinite(driver.lon),
  ).length;
  return {
    generatedAt: str(container.generatedAt),
    // The documented contract is 30 s; the fallback keeps the legend honest if the
    // field is ever missing instead of claiming every position is fresh.
    staleAfterSeconds: num(container.staleAfterSeconds, 30),
    onDuty: num(container.onDuty, drivers.length),
    withPosition: num(container.withPosition, withPosition),
    drivers,
  };
}

function normalizeDispatchCandidate(raw: unknown): DispatchCandidate {
  const candidate = asRecord(raw);
  return {
    driverId: str(candidate.driverId ?? candidate.id),
    displayName: str(candidate.displayName ?? candidate.name, 'Водитель'),
    distanceM: num(candidate.distanceM ?? candidate.distance, 0),
    lat: num(candidate.lat ?? candidate.latitude, Number.NaN),
    lon: num(candidate.lon ?? candidate.lng ?? candidate.longitude, Number.NaN),
    ageSeconds: num(candidate.ageSeconds ?? candidate.age, 0),
  };
}

export function normalizeDispatchNearest(raw: unknown): DispatchNearestResponse {
  const container = asRecord(raw);
  return {
    generatedAt: str(container.generatedAt),
    radiusM: num(container.radiusM, 0),
    candidates: arr(container.candidates ?? container.items).map(normalizeDispatchCandidate),
  };
}

/** Live positions of everyone on duty (`GET /dispatch/drivers`). */
export function fetchDispatchDrivers(): Promise<DispatchDriversResponse> {
  return apiRequest<unknown>('/v1/dispatch/drivers').then(normalizeDispatchDrivers);
}

/** Drivers around a point, closest first — the manual-assignment shortlist. */
export function fetchNearestDrivers(query: NearestDriversQuery): Promise<DispatchNearestResponse> {
  return apiRequest<unknown>('/v1/dispatch/nearest', {
    query: {
      lat: query.lat,
      lon: query.lon,
      radiusM: query.radiusM ?? 3000,
      limit: query.limit ?? 10,
    },
  }).then(normalizeDispatchNearest);
}

/* ------------------------------------------------------------------- trips */

/** Coordinates are kept as `NaN` when absent, so the map can skip the pin. */
export function normalizeTripPoint(raw: unknown): TripPoint {
  const point = asRecord(raw);
  return {
    lat: num(point.lat ?? point.latitude, Number.NaN),
    lon: num(point.lon ?? point.lng ?? point.longitude, Number.NaN),
    address: str(point.address),
  };
}

function normalizeTripBreakdown(raw: unknown): TripQuote['breakdown'] {
  const breakdown = asRecord(raw);
  return {
    baseMinor: num(breakdown.baseMinor, 0),
    distanceMinor: num(breakdown.distanceMinor, 0),
    timeMinor: num(breakdown.timeMinor, 0),
  };
}

/**
 * Breakdown of a receipt is `null` when the service sent nothing usable.
 *
 * A quote always carries one, so `normalizeTripBreakdown` can assume it; a receipt
 * may not, and "0,00 ₸" for a fare component nobody sent would be a lie.
 */
function normalizeReceiptBreakdown(raw: unknown): TripReceipt['breakdown'] {
  if (raw === undefined || raw === null) {
    return null;
  }
  const breakdown = asRecord(raw);
  const parts = [breakdown.baseMinor, breakdown.distanceMinor, breakdown.timeMinor];
  if (parts.every((part) => optionalNum(part) === null)) {
    return null;
  }
  return {
    baseMinor: num(breakdown.baseMinor, 0),
    distanceMinor: num(breakdown.distanceMinor, 0),
    timeMinor: num(breakdown.timeMinor, 0),
  };
}

export function normalizeTripQuote(raw: unknown): TripQuote {
  const container = asRecord(raw);
  const quote = container.quote !== undefined ? asRecord(container.quote) : container;
  return {
    quoteId: str(quote.quoteId ?? quote.id),
    tariff: str(quote.tariff, 'ECONOMY'),
    distanceM: num(quote.distanceM ?? quote.distance, 0),
    durationS: num(quote.durationS ?? quote.duration, 0),
    priceMinor: num(quote.priceMinor ?? quote.price, 0),
    currency: str(quote.currency, 'KZT'),
    commissionBp: optionalNum(quote.commissionBp),
    commissionMinor: num(quote.commissionMinor, 0),
    driverNetMinor: num(quote.driverNetMinor, 0),
    surgeBp: num(quote.surgeBp, 0),
    breakdown: normalizeTripBreakdown(quote.breakdown),
    expiresAt: str(quote.expiresAt),
  };
}

export function normalizeTripAccepted(raw: unknown): TripAccepted {
  const container = asRecord(raw);
  const accepted = container.trip !== undefined ? asRecord(container.trip) : container;
  return {
    tripId: str(accepted.tripId ?? accepted.id),
    tripNumber: str(accepted.tripNumber ?? accepted.number, str(accepted.tripId ?? accepted.id)),
    status: str(accepted.status, 'SEARCHING'),
    priceMinor: num(accepted.priceMinor ?? accepted.price, 0),
    currency: str(accepted.currency, 'KZT'),
    requestedAt: str(accepted.requestedAt ?? accepted.createdAt),
  };
}

function normalizeTripTimeline(raw: unknown): TripTimelineEntry {
  const entry = asRecord(raw);
  return {
    status: str(entry.status ?? entry.toStatus, 'UNKNOWN'),
    at: str(entry.at ?? entry.createdAt ?? entry.changedAt ?? entry.occurredAt),
    actor: optionalStr(entry.actor ?? entry.changedBy),
  };
}

/**
 * Receipt of a finished ride.
 *
 * The service answers with a flat record (see `ReceiptResponse` in trip-service);
 * a receipt without a total is not a receipt, so `null` is returned and the screen
 * reports "чек недоступен" instead of printing a zero.
 */
export function normalizeTripReceipt(raw: unknown): TripReceipt | null {
  const container = asRecord(raw);
  const receipt = container.receipt !== undefined ? asRecord(container.receipt) : container;
  const priceMinor = optionalNum(receipt.priceMinor ?? receipt.totalMinor ?? receipt.amountMinor);
  if (priceMinor === null) {
    return null;
  }
  return {
    tripId: optionalStr(receipt.tripId),
    tripNumber: optionalStr(receipt.tripNumber ?? receipt.number),
    status: optionalStr(receipt.status),
    completedAt: optionalStr(
      receipt.completedAt ?? receipt.issuedAt ?? receipt.paidAt ?? receipt.createdAt,
    ),
    tariff: optionalStr(receipt.tariff),
    distanceM: optionalNum(receipt.distanceM ?? receipt.distance),
    durationS: optionalNum(receipt.durationS ?? receipt.duration),
    breakdown: normalizeReceiptBreakdown(receipt.breakdown ?? receipt.fare),
    surgeBp: optionalNum(receipt.surgeBp),
    priceMinor,
    currency: str(receipt.currency, 'KZT'),
    commissionBp: optionalNum(receipt.commissionBp),
    commissionMinor: optionalNum(receipt.commissionMinor ?? receipt.platformCommissionMinor),
    driverNetMinor: optionalNum(receipt.driverNetMinor ?? receipt.driverAccrualMinor),
    driverId: optionalStr(receipt.driverId),
    driverDisplayName: optionalStr(receipt.driverDisplayName ?? receipt.driverName),
    holdId: optionalStr(receipt.holdId),
    paymentId: optionalStr(receipt.paymentId),
    transactionId: optionalStr(receipt.transactionId),
  };
}

export function normalizeTrip(raw: unknown): Trip {
  const container = asRecord(raw);
  const trip = container.trip !== undefined ? asRecord(container.trip) : container;
  const timelineRaw = trip.timeline ?? trip.statusHistory ?? trip.history;
  const pickupRaw = trip.pickup ?? trip.pickupPoint;
  const dropoffRaw = trip.dropoff ?? trip.dropoffPoint;
  return {
    tripId: str(trip.tripId ?? trip.id ?? container.tripId),
    tripNumber: str(trip.tripNumber ?? trip.number, str(trip.tripId ?? trip.id)),
    status: str(trip.status, 'UNKNOWN'),
    riderUserId: optionalStr(trip.riderUserId ?? trip.userId),
    driverId: optionalStr(trip.driverId),
    driverName: driverNameOf(trip),
    vehiclePlate: optionalStr(trip.vehiclePlate ?? trip.plate),
    tariff: str(trip.tariff, 'ECONOMY'),
    pickup: pickupRaw === undefined || pickupRaw === null ? null : normalizeTripPoint(pickupRaw),
    dropoff: dropoffRaw === undefined || dropoffRaw === null ? null : normalizeTripPoint(dropoffRaw),
    distanceM: optionalNum(trip.distanceM ?? trip.distance),
    durationS: optionalNum(trip.durationS ?? trip.duration),
    priceMinor: optionalNum(trip.priceMinor ?? trip.price),
    commissionBp: optionalNum(trip.commissionBp),
    commissionMinor: optionalNum(trip.commissionMinor),
    driverNetMinor: optionalNum(trip.driverNetMinor),
    currency: str(trip.currency, 'KZT'),
    holdId: optionalStr(trip.holdId),
    holdStatus: optionalStr(trip.holdStatus),
    cancelReason: optionalStr(trip.cancelReason),
    ratingStars: optionalNum(trip.ratingStars ?? trip.rating),
    ratingComment: optionalStr(trip.ratingComment),
    requestedAt: optionalStr(trip.requestedAt ?? trip.createdAt),
    assignedAt: optionalStr(trip.assignedAt),
    arrivedAt: optionalStr(trip.arrivedAt),
    startedAt: optionalStr(trip.startedAt),
    completedAt: optionalStr(trip.completedAt),
    cancelledAt: optionalStr(trip.cancelledAt),
    timeline: arr(timelineRaw).map(normalizeTripTimeline),
    receipt:
      trip.receipt === undefined || trip.receipt === null
        ? normalizeTripReceipt(container.receipt ?? null)
        : normalizeTripReceipt(trip.receipt),
  };
}

/** Price for one tariff and one point pair (`POST /api/v1/trips/quote`). */
export function requestTripQuote(body: TripQuoteRequest): Promise<TripQuote> {
  return apiRequest<unknown>('/v1/trips/quote', { method: 'POST', body }).then(normalizeTripQuote);
}

/** The booking itself: one `Idempotency-Key` per user submit. */
export function createTrip(body: CreateTripRequest, idempotencyKey: string): Promise<TripAccepted> {
  return apiRequest<unknown>('/v1/trips', { method: 'POST', body, idempotencyKey }).then(
    normalizeTripAccepted,
  );
}

export function fetchTrip(tripId: string): Promise<Trip> {
  return apiRequest<unknown>(`/v1/trips/${encodeURIComponent(tripId)}`).then(normalizeTrip);
}

/**
 * Receipt of a finished ride (`GET /api/v1/trips/{tripId}/receipt`).
 *
 * A completed trip embeds the receipt, so this call is the fallback for the case
 * where only the trip was returned. `null` means "the service gave us nothing we
 * can print" — the screen must not render zeros in that case.
 */
export function fetchTripReceipt(tripId: string): Promise<TripReceipt | null> {
  return apiRequest<unknown>(`/v1/trips/${encodeURIComponent(tripId)}/receipt`).then(
    normalizeTripReceipt,
  );
}

export function fetchTrips(query: TripQuery = {}): Promise<TripPage> {
  return apiRequest<unknown>('/v1/trips', {
    query: {
      status: query.status,
      page: query.page ?? 0,
      size: query.size ?? 10,
    },
  }).then((raw) => normalizePage(raw, normalizeTrip));
}

export function cancelTrip(tripId: string, body: { reason: string }): Promise<Trip> {
  return apiRequest<unknown>(`/v1/trips/${encodeURIComponent(tripId)}/cancel`, {
    method: 'POST',
    body,
  }).then(normalizeTrip);
}

/** Rating a trip twice answers `409` — the page explains that instead of retrying. */
export function rateTrip(
  tripId: string,
  body: { stars: number; comment?: string },
): Promise<Trip> {
  return apiRequest<unknown>(`/v1/trips/${encodeURIComponent(tripId)}/rate`, {
    method: 'POST',
    body,
  }).then(normalizeTrip);
}

/* ------------------------------------------------------------------- qtime */

export function normalizeQtimeCompany(raw: unknown): QtimeCompany {
  const company = asRecord(raw);
  return {
    companyId: str(company.companyId ?? company.id),
    name: str(company.name ?? company.displayName, 'Компания'),
    category: optionalStr(company.category),
    city: optionalStr(company.city),
    address: optionalStr(company.address),
    lat: optionalNum(company.lat ?? company.latitude),
    lon: optionalNum(company.lon ?? company.lng ?? company.longitude),
    ratingBp: optionalNum(company.ratingBp ?? company.rating),
    reviewsCount: optionalNum(company.reviewsCount ?? company.reviews),
    specialistsCount: optionalNum(company.specialistsCount),
    servicesCount: optionalNum(company.servicesCount),
    minPriceMinor: optionalNum(company.minPriceMinor),
  };
}

function normalizeQtimeSpecialist(raw: unknown): QtimeSpecialist {
  const specialist = asRecord(raw);
  return {
    specialistId: str(specialist.specialistId ?? specialist.id),
    name: str(specialist.name ?? specialist.displayName, 'Специалист'),
    specialization: optionalStr(specialist.specialization),
    ratingBp: optionalNum(specialist.ratingBp ?? specialist.rating),
    experienceYears: optionalNum(specialist.experienceYears ?? specialist.experience),
  };
}

function normalizeQtimeService(raw: unknown): QtimeService {
  const service = asRecord(raw);
  return {
    serviceId: str(service.serviceId ?? service.id),
    name: str(service.name ?? service.title, 'Услуга'),
    durationMinutes: optionalNum(service.durationMinutes ?? service.duration),
    priceMinor: optionalNum(service.priceMinor ?? service.price),
    currency: str(service.currency, 'KZT'),
  };
}

export function normalizeQtimeCompanyDetail(raw: unknown): QtimeCompanyDetail {
  const container = asRecord(raw);
  const source = container.company !== undefined ? asRecord(container.company) : container;
  const summary = normalizeQtimeCompany(source);
  return {
    ...summary,
    timezone: optionalStr(source.timezone ?? container.timezone),
    specialists: arr(source.specialists ?? container.specialists).map(normalizeQtimeSpecialist),
    services: arr(source.services ?? container.services).map(normalizeQtimeService),
  };
}

export function normalizeQtimeSlots(raw: unknown): QtimeSlots {
  const container = asRecord(raw);
  return {
    date: str(container.date),
    specialistId: str(container.specialistId),
    serviceId: str(container.serviceId),
    durationMinutes: optionalNum(container.durationMinutes),
    timezone: str(container.timezone, 'Asia/Almaty'),
    slots: arr(container.slots ?? container.items).map((entry) => {
      const slot = asRecord(entry);
      return {
        startsAt: str(slot.startsAt ?? slot.start),
        endsAt: optionalStr(slot.endsAt ?? slot.end),
        // A slot without an explicit flag is treated as taken: offering a window
        // the service did not confirm is worse than hiding it.
        available: optionalBool(slot.available) ?? false,
        reason: optionalStr(slot.reason),
      };
    }),
  };
}

export function normalizeQtimeBooking(raw: unknown): QtimeBooking {
  const container = asRecord(raw);
  const booking = container.booking !== undefined ? asRecord(container.booking) : container;
  return {
    bookingId: str(booking.bookingId ?? booking.id),
    code: str(booking.code ?? booking.bookingCode, str(booking.bookingId ?? booking.id)),
    status: str(booking.status, 'CONFIRMED'),
    startsAt: str(booking.startsAt ?? booking.start),
    endsAt: optionalStr(booking.endsAt ?? booking.end),
    companyId: optionalStr(booking.companyId),
    companyName: optionalStr(booking.companyName),
    companyAddress: optionalStr(booking.companyAddress),
    specialistName: optionalStr(booking.specialistName),
    serviceName: optionalStr(booking.serviceName),
    durationMinutes: optionalNum(booking.durationMinutes),
    priceMinor: optionalNum(booking.priceMinor ?? booking.price),
    currency: str(booking.currency, 'KZT'),
  };
}

/** Public catalogue: readable without a session, so nobody has to log in to browse. */
export function fetchQtimeCompanies(query: QtimeCompanyQuery = {}): Promise<Page<QtimeCompany>> {
  return apiRequest<unknown>('/v1/qtime/companies', {
    query: {
      query: query.query,
      category: query.category,
      city: query.city,
      page: query.page ?? 0,
      size: query.size ?? 12,
    },
  }).then((raw) => normalizePage(raw, normalizeQtimeCompany));
}

export function fetchQtimeCompany(companyId: string): Promise<QtimeCompanyDetail> {
  return apiRequest<unknown>(`/v1/qtime/companies/${encodeURIComponent(companyId)}`).then(
    normalizeQtimeCompanyDetail,
  );
}

export interface QtimeSlotsQuery {
  specialistId: string;
  serviceId: string;
  /** Calendar day in the company's timezone: `YYYY-MM-DD`. */
  date: string;
}

export function fetchQtimeSlots(query: QtimeSlotsQuery): Promise<QtimeSlots> {
  return apiRequest<unknown>(
    `/v1/qtime/specialists/${encodeURIComponent(query.specialistId)}/slots`,
    { query: { serviceId: query.serviceId, date: query.date } },
  ).then(normalizeQtimeSlots);
}

/** Booking is a money path: the caller supplies one `Idempotency-Key` per intent. */
export function createBooking(
  body: CreateBookingRequest,
  idempotencyKey: string,
): Promise<QtimeBooking> {
  return apiRequest<unknown>('/v1/qtime/bookings', { method: 'POST', body, idempotencyKey }).then(
    normalizeQtimeBooking,
  );
}

export function fetchBookings(query: BookingQuery = {}): Promise<Page<QtimeBooking>> {
  return apiRequest<unknown>('/v1/qtime/bookings', {
    query: {
      status: query.status,
      page: query.page ?? 0,
      size: query.size ?? 10,
    },
  }).then((raw) => normalizePage(raw, normalizeQtimeBooking));
}

export function cancelBooking(
  bookingId: string,
  body: { reason: string },
): Promise<QtimeBooking> {
  return apiRequest<unknown>(`/v1/qtime/bookings/${encodeURIComponent(bookingId)}/cancel`, {
    method: 'POST',
    body,
  }).then(normalizeQtimeBooking);
}
