import type { OrderQuery, PaymentQuery } from '../api/endpoints';
import type { BookingQuery, ProductQuery, QtimeCompanyQuery, TripQuery } from '../api/types';

/**
 * Every server-state key in one place.
 *
 * Keys are hierarchical so a mutation can invalidate a precise slice
 * (`invalidateQueries({ queryKey: queryKeys.accounts() })`) instead of nuking the
 * whole cache — the difference between "the balance updated" and "the screen
 * flickered".
 */
export const queryKeys = {
  profile: () => ['profile'] as const,

  accounts: () => ['accounts'] as const,
  account: (accountId: string) => ['accounts', accountId] as const,
  accountTransactions: (accountId: string, page: number, size: number) =>
    ['accounts', accountId, 'transactions', { page, size }] as const,
  accountHolds: (accountId: string) => ['accounts', accountId, 'holds'] as const,

  payments: (query: PaymentQuery) => ['payments', 'list', query] as const,
  payment: (paymentId: string) => ['payments', 'detail', paymentId] as const,
  refunds: (paymentId: string) => ['payments', 'detail', paymentId, 'refunds'] as const,

  products: (query: ProductQuery) => ['catalog', 'products', query] as const,
  product: (productId: string) => ['catalog', 'product', productId] as const,
  categories: () => ['catalog', 'categories'] as const,

  cart: () => ['cart'] as const,

  orders: (query: OrderQuery) => ['orders', 'list', query] as const,
  order: (orderId: string) => ['orders', 'detail', orderId] as const,

  merchant: () => ['merchant', 'me'] as const,

  /** Live fleet projection; polled every couple of seconds by the console. */
  dispatchDrivers: () => ['dispatch', 'drivers'] as const,
  /**
   * Nearest drivers around one selected driver. The coordinates are deliberately
   * NOT part of the key: the driver keeps moving, and rebuilding the key every poll
   * would leave a trail of dead cache entries instead of refreshing one.
   */
  dispatchNearest: (driverId: string, radiusM: number, limit: number) =>
    ['dispatch', 'nearest', { driverId, radiusM, limit }] as const,

  /**
   * Taxi quotes are keyed by the *route signature* (rounded coordinates) and the
   * tariff, never by the typed address: an address is free text with no geocoder
   * behind it, and re-pricing the same two points on every keystroke would only
   * spend requests on an identical answer.
   */
  tripQuote: (route: string, tariff: string) => ['trips', 'quote', { route, tariff }] as const,
  trip: (tripId: string) => ['trips', 'detail', tripId] as const,
  tripReceipt: (tripId: string) => ['trips', 'receipt', tripId] as const,
  trips: (query: TripQuery) => ['trips', 'list', query] as const,

  qtimeCompanies: (query: QtimeCompanyQuery) => ['qtime', 'companies', query] as const,
  qtimeCompany: (companyId: string) => ['qtime', 'company', companyId] as const,
  qtimeSlots: (specialistId: string, serviceId: string, date: string) =>
    ['qtime', 'slots', { specialistId, serviceId, date }] as const,
  qtimeBookings: (query: BookingQuery) => ['qtime', 'bookings', query] as const,
};
