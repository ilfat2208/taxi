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

export type Role = 'CUSTOMER' | 'MERCHANT' | 'SUPPORT' | 'ADMIN' | 'DRIVER' | 'DISPATCHER';

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
  /** Заказ маркетплейса, если платёж за него: приходит в `PaymentResponse` и его видно в админке. */
  orderId: string | null;
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
  /** Сервис отдаёт `updatedAt`; сюда же кладётся `completedAt`, если он когда-нибудь появится. */
  completedAt?: string | null;
  updatedAt?: string | null;
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

/* -------------------------------------------------------------- dispatch */

/**
 * One driver on duty, as the dispatcher console sees him
 * (`GET /api/v1/dispatch/drivers`).
 *
 * The position is a *projection*: `ageSeconds` says how old the last fix is and
 * `stale` is the server's own verdict against `staleAfterSeconds`, so the UI never
 * has to guess whether a dot on the map is still true.
 */
export interface DispatchDriver {
  driverId: string;
  displayName: string;
  phone: string;
  status: string;
  lat: number;
  lon: number;
  headingDeg: number;
  speedKph: number;
  ageSeconds: number;
  stale: boolean;
}

export interface DispatchDriversResponse {
  generatedAt: string;
  staleAfterSeconds: number;
  /** Drivers on duty, including those whose position has not arrived yet. */
  onDuty: number;
  withPosition: number;
  drivers: DispatchDriver[];
}

/** A candidate for a manual assignment (`GET /api/v1/dispatch/nearest`). */
export interface DispatchCandidate {
  driverId: string;
  displayName: string;
  /** Distance from the requested point to the driver's last known position. */
  distanceM: number;
  lat: number;
  lon: number;
  ageSeconds: number;
}

export interface DispatchNearestResponse {
  generatedAt: string;
  radiusM: number;
  candidates: DispatchCandidate[];
}

export interface NearestDriversQuery {
  lat: number;
  lon: number;
  radiusM?: number;
  limit?: number;
}

/* ------------------------------------------------------------------ trips */

/**
 * A point of the route (`trip-service`).
 *
 * The platform has no geocoder yet, so `address` is always typed by the rider:
 * the client never invents a street name from a pair of coordinates.
 */
export interface TripPoint {
  lat: number;
  lon: number;
  address: string;
}

/** Tariffs the backend quotes today (see `POST /api/v1/trips/quote`). */
export type TripTariff = 'ECONOMY' | 'COMFORT';

export interface TripQuoteRequest {
  pickup: TripPoint;
  dropoff: TripPoint;
  tariff: TripTariff;
}

/** Fare components; every field is an integer in minor units. */
export interface TripQuoteBreakdown {
  baseMinor: number;
  distanceMinor: number;
  timeMinor: number;
}

/** One priced offer for one tariff, valid until `expiresAt`. */
export interface TripQuote {
  quoteId: string;
  tariff: string;
  distanceM: number;
  durationS: number;
  priceMinor: number;
  currency: Currency | string;
  /** Platform commission in basis points: `1200` = 12%. */
  commissionBp: number | null;
  commissionMinor: number;
  driverNetMinor: number;
  /** Surge in basis points: 1500 = ×1,15. Zero means no surge. */
  surgeBp: number;
  breakdown: TripQuoteBreakdown;
  expiresAt: string;
}

export interface CreateTripRequest {
  quoteId: string;
  comment?: string;
}

/** `POST /api/v1/trips` answers `202` with this receipt, not with the full trip. */
export interface TripAccepted {
  tripId: string;
  tripNumber: string;
  status: string;
  priceMinor: number;
  currency: Currency | string;
  requestedAt: string;
}

export type TripStatus =
  | 'SEARCHING'
  | 'ASSIGNED'
  | 'ARRIVED'
  | 'IN_PROGRESS'
  | 'COMPLETED'
  | 'CANCELLED_BY_RIDER'
  | 'CANCELLED_BY_DRIVER'
  | 'NO_DRIVERS_FOUND'
  | string;

export interface TripTimelineEntry {
  status: string;
  at: string;
  /** `RIDER` / `DRIVER` / `SYSTEM` — whatever the service recorded. */
  actor: string | null;
}

/**
 * Receipt of a finished ride (`GET /api/v1/trips/{tripId}/receipt`, also embedded
 * in the trip view of a completed trip).
 *
 * The service answers with the receipt or refuses with `409 TRIP_NOT_COMPLETED`:
 * there is no "empty" receipt, and the client must not fabricate one. Optional
 * fields are omitted from the screen rather than printed as zeros.
 */
export interface TripReceipt {
  tripId: string | null;
  tripNumber: string | null;
  status: string | null;
  /** When the receipt was issued — the completion moment of the ride. */
  completedAt: string | null;
  tariff: string | null;
  distanceM: number | null;
  durationS: number | null;
  breakdown: TripQuoteBreakdown | null;
  surgeBp: number | null;
  priceMinor: number;
  currency: Currency | string;
  commissionBp: number | null;
  commissionMinor: number | null;
  driverNetMinor: number | null;
  driverId: string | null;
  driverDisplayName: string | null;
  holdId: string | null;
  /**
   * Payment order behind the ride. Always `null` in the wallet phase: a ride is
   * charged through the account, and `transactionId` is that ledger movement.
   */
  paymentId: string | null;
  transactionId: string | null;
}

/**
 * Trip view (`GET /api/v1/trips/{tripId}`).
 *
 * There is no ETA field in the contract, so the screen never shows "3 мин до
 * подачи": it explains the stage instead. Optional fields stay `null` when the
 * service did not send them, and the UI omits those rows entirely.
 */
export interface Trip {
  tripId: string;
  tripNumber: string;
  status: TripStatus;
  riderUserId: string | null;
  driverId: string | null;
  driverName: string | null;
  vehiclePlate: string | null;
  tariff: string;
  pickup: TripPoint | null;
  dropoff: TripPoint | null;
  distanceM: number | null;
  durationS: number | null;
  priceMinor: number | null;
  commissionMinor: number | null;
  driverNetMinor: number | null;
  currency: Currency | string;
  holdId: string | null;
  /** State of the money hold: `ACTIVE`, `CAPTURED`, `RELEASED`. */
  holdStatus: string | null;
  cancelReason: string | null;
  ratingStars: number | null;
  ratingComment: string | null;
  /** Platform commission in basis points: `1200` = 12%. */
  commissionBp: number | null;
  requestedAt: string | null;
  assignedAt: string | null;
  arrivedAt: string | null;
  startedAt: string | null;
  completedAt: string | null;
  cancelledAt: string | null;
  timeline: TripTimelineEntry[];
  /** Present on a completed trip when the service embeds the receipt. */
  receipt: TripReceipt | null;
}

export interface TripQuery {
  status?: string;
  page?: number;
  size?: number;
}

export type TripPage = Page<Trip>;

/* ------------------------------------------------------------------ qtime */

/**
 * A company taking bookings through QTime (`GET /api/v1/qtime/companies`).
 *
 * Ratings arrive in basis points (`480` = 4,8) and every counter is optional:
 * a company without a price list has `minPriceMinor === null` and the card says
 * nothing about prices instead of showing "от 0 ₸".
 */
export interface QtimeCompany {
  companyId: string;
  name: string;
  category: string | null;
  city: string | null;
  address: string | null;
  lat: number | null;
  lon: number | null;
  ratingBp: number | null;
  reviewsCount: number | null;
  specialistsCount: number | null;
  servicesCount: number | null;
  minPriceMinor: number | null;
}

export interface QtimeSpecialist {
  specialistId: string;
  name: string;
  specialization: string | null;
  ratingBp: number | null;
  experienceYears: number | null;
}

export interface QtimeService {
  serviceId: string;
  name: string;
  durationMinutes: number | null;
  priceMinor: number | null;
  currency: Currency | string;
}

/** Company card with the two catalogues the booking flow needs. */
export interface QtimeCompanyDetail extends QtimeCompany {
  /** IANA zone of the company's schedule, when the service names one. */
  timezone: string | null;
  specialists: QtimeSpecialist[];
  services: QtimeService[];
}

/** One bookable window; `reason` explains an unavailable one when the service sends it. */
export interface QtimeSlot {
  startsAt: string;
  endsAt: string | null;
  available: boolean;
  /**
   * Human-readable phrase for a taken window («занято», «перерыв») — the service
   * writes it for a person, so the grid shows it as it came.
   */
  reason: string | null;
}

export interface QtimeSlots {
  date: string;
  specialistId: string;
  serviceId: string;
  durationMinutes: number | null;
  /** IANA zone of the schedule; the UI prints times in it, not in the browser's. */
  timezone: string;
  slots: QtimeSlot[];
}

export interface CreateBookingRequest {
  specialistId: string;
  serviceId: string;
  /** ISO-8601 instant of the chosen window. */
  startsAt: string;
  comment?: string;
}

export interface QtimeBooking {
  bookingId: string;
  code: string;
  status: string;
  startsAt: string;
  endsAt: string | null;
  companyId: string | null;
  companyName: string | null;
  companyAddress: string | null;
  specialistName: string | null;
  serviceName: string | null;
  durationMinutes: number | null;
  priceMinor: number | null;
  currency: Currency | string;
}

export interface QtimeCompanyQuery {
  query?: string;
  category?: string;
  city?: string;
  page?: number;
  size?: number;
}

export interface BookingQuery {
  status?: string;
  page?: number;
  size?: number;
}
