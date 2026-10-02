/**
 * Wire types for the taxi API.
 *
 * Conventions that the whole client relies on:
 *  - every amount is an integer in MINOR units (tiyn/cents): 150000 = 1 500,00 KZT;
 *  - every id is an opaque string (26-char ULID server-side);
 *  - every timestamp is an ISO-8601 string with offset;
 *  - page endpoints answer with the same envelope (`Page<T>`).
 */

export type Currency = 'KZT' | 'USD' | 'EUR' | 'RUB';

export type Role = 'CUSTOMER' | 'MERCHANT' | 'SUPPORT' | 'ADMIN';

export interface Page<T> {
  items: T[];
  page: number;
  size: number;
  totalElements: number;
  totalPages: number;
  hasNext: boolean;
}

/** RFC 7807 body produced by `common-web`'s GlobalExceptionHandler. */
export interface Problem {
  type?: string;
  title?: string;
  status?: number;
  detail?: string;
  code?: string;
  instance?: string;
  correlationId?: string;
  timestamp?: string;
  details?: Record<string, unknown>;
  errors?: ProblemFieldError[];
}

export interface ProblemFieldError {
  field?: string;
  message?: string;
  rejectedValue?: unknown;
}

/* ------------------------------------------------------------------ auth */

export interface TokenResponse {
  accessToken: string;
  tokenType: string;
  /** Token lifetime in seconds. */
  expiresIn: number;
  userId: string;
  roles: string[];
}

export interface Profile {
  userId: string;
  phone: string;
  displayName: string;
  roles: string[];
  /** Not part of the documented contract; used by the merchant console when the gateway exposes it. */
  merchantId?: string | null;
}

/* -------------------------------------------------------------- accounts */

export interface Account {
  id: string;
  ownerUserId: string;
  ownerPhone: string;
  displayName: string;
  type: string;
  currency: Currency | string;
  status: string;
  balanceMinor: number;
  heldMinor: number;
  availableMinor: number;
  createdAt: string;
}

export type TransactionDirection = 'CREDIT' | 'DEBIT' | string;

export interface AccountTransaction {
  id: string;
  direction: TransactionDirection;
  amountMinor: number;
  currency: Currency | string;
  balanceAfterMinor: number;
  operation: string;
  referenceType: string | null;
  referenceId: string | null;
  description: string | null;
  createdAt: string;
}

export type TransactionPage = Page<AccountTransaction>;

export interface CreateAccountRequest {
  currency: Currency;
  type: string;
  displayName?: string;
}

/** `GET /api/v1/accounts/{id}/holds` — money reserved for in-flight operations. */
export interface AccountHold {
  holdId: string;
  accountId: string;
  amountMinor: number;
  currency: Currency | string;
  status: string;
  referenceType?: string | null;
  referenceId?: string | null;
  reason?: string | null;
  expiresAt?: string | null;
  createdAt?: string | null;
}

export interface TopUpRequest {
  amountMinor: number;
  reason: string;
}

/* -------------------------------------------------------------- payments */

export type PaymentStatus =
  | 'CREATED'
  | 'PENDING'
  | 'PROCESSING'
  | 'COMPLETED'
  | 'FAILED'
  | 'CANCELLED'
  | 'REFUNDED'
  | 'PARTIALLY_REFUNDED'
  | string;

export interface Payment {
  paymentId: string;
  paymentNumber: string;
  type: string;
  status: PaymentStatus;
  amountMinor: number;
  feeMinor: number;
  totalMinor: number;
  currency: Currency | string;
  sourceAccountId: string | null;
  targetAccountId: string | null;
  merchantId: string | null;
  description: string | null;
  failureCode: string | null;
  failureReason: string | null;
  createdAt: string;
  completedAt: string | null;
}

export interface PaymentTransition {
  id?: string;
  fromStatus?: string | null;
  toStatus: string;
  status?: string;
  reason?: string | null;
  comment?: string | null;
  createdAt?: string;
  occurredAt?: string;
}

/** A refund recorded against a payment (`GET /payments/{id}/refunds`). */
export interface Refund {
  refundId: string;
  paymentId: string;
  amountMinor: number;
  currency: Currency | string;
  status: string;
  reason?: string | null;
  createdAt?: string | null;
  completedAt?: string | null;
}

export interface PaymentDetail {
  payment: Payment;
  transitions: PaymentTransition[];
}

export interface TransferRequest {
  sourceAccountId: string;
  targetPhone?: string;
  targetAccountId?: string;
  amountMinor: number;
  currency: Currency | string;
  description?: string;
}

export interface RefundRequest {
  amountMinor: number;
  reason: string;
}

/* --------------------------------------------------------------- catalog */

export interface Product {
  id: string;
  merchantId: string;
  merchantName: string;
  title: string;
  description: string | null;
  category: string | null;
  brand: string | null;
  priceMinor: number;
  currency: Currency | string;
  imageUrl: string | null;
  status: string;
  availableQuantity: number;
  /** Present on the product card (`GET /catalog/products/{id}`). */
  onHand?: number;
  reserved?: number;
  available?: number;
  /** Public seller block; only the product card carries it. */
  merchant?: MerchantSummary | null;
  sku?: string | null;
}

/** Public face of a seller (`GET /api/v1/merchants/{id}`). */
export interface MerchantSummary {
  id: string;
  name: string;
  displayName?: string | null;
  city?: string | null;
  status?: string | null;
  ratingBasisPoints?: number;
}

/** A merchant's own profile (`GET /api/v1/merchants/me`). */
export interface Merchant extends MerchantSummary {
  ownerUserId?: string | null;
  phone?: string | null;
  email?: string | null;
  createdAt?: string | null;
}

export interface CreateMerchantRequest {
  name: string;
  displayName?: string;
  phone?: string;
  email?: string;
  city?: string;
}

export interface Category {
  id?: string;
  name: string;
  slug?: string;
  productCount?: number;
}

export type ProductSort = 'price_asc' | 'price_desc' | 'newest' | 'relevance';

export interface ProductQuery {
  query?: string;
  category?: string;
  merchantId?: string;
  page?: number;
  size?: number;
  sort?: ProductSort;
}

export type ProductPage = Page<Product>;

/**
 * Payload for `POST /api/v1/catalog/products`.
 * Mirrors the server's `CreateProductRequest` (sku and initialStock are required
 * by the catalog service), minus the server-owned fields.
 */
export interface CreateProductRequest {
  sku: string;
  title: string;
  description?: string;
  category: string;
  brand?: string;
  priceMinor: number;
  currency: Currency;
  imageUrl?: string;
  initialStock?: number;
}

/** Payload for `PATCH /api/v1/catalog/products/{id}` — every field is optional. */
export interface UpdateProductRequest {
  title?: string;
  description?: string;
  category?: string;
  brand?: string;
  priceMinor?: number;
  status?: string;
  /** Delta, not an absolute value: concurrent edits add up on the server. */
  stockDelta?: number;
  stockReason?: string;
}

/* ------------------------------------------------------------ cart/order */

export interface CartItem {
  itemId: string;
  productId: string;
  title: string;
  priceMinor: number;
  currency: Currency | string;
  quantity: number;
  totalMinor?: number;
  imageUrl?: string | null;
  merchantId?: string | null;
  merchantName?: string | null;
  availableQuantity?: number | null;
}

export interface Cart {
  cartId?: string;
  items: CartItem[];
  itemCount: number;
  itemsTotalMinor: number;
  deliveryMinor: number;
  totalMinor: number;
  currency: Currency | string;
}

export interface AddCartItemRequest {
  productId: string;
  quantity: number;
}

export interface UpdateCartItemRequest {
  quantity: number;
}

export type OrderStatus =
  | 'CREATED'
  | 'PENDING_PAYMENT'
  | 'PAID'
  | 'CONFIRMED'
  | 'SHIPPED'
  | 'DELIVERED'
  | 'CANCELLED'
  | 'FAILED'
  | string;

export interface OrderItem {
  orderItemId?: string;
  id?: string;
  productId: string;
  title: string;
  quantity: number;
  priceMinor: number;
  totalMinor?: number;
  currency?: Currency | string;
  merchantId?: string | null;
  merchantName?: string | null;
  imageUrl?: string | null;
}

export interface OrderStatusHistoryEntry {
  status?: string;
  toStatus?: string;
  fromStatus?: string | null;
  comment?: string | null;
  reason?: string | null;
  createdAt?: string;
  changedAt?: string;
  occurredAt?: string;
}

export interface Order {
  orderId: string;
  orderNumber: string;
  status: OrderStatus;
  currency: Currency | string;
  itemsTotalMinor: number;
  deliveryMinor: number;
  totalMinor: number;
  deliveryAddress: string;
  contactPhone: string;
  comment: string | null;
  sourceAccountId: string | null;
  paymentId?: string | null;
  failureCode?: string | null;
  failureReason?: string | null;
  createdAt: string;
  updatedAt?: string | null;
  completedAt?: string | null;
  items: OrderItem[];
  statusHistory: OrderStatusHistoryEntry[];
}

export interface CreateOrderRequest {
  deliveryAddress: string;
  contactPhone: string;
  comment?: string;
  sourceAccountId: string;
}

export type OrderPage = Page<Order>;
