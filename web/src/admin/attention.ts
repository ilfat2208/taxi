/**
 * Счётчики «сколько ждёт внимания» для меню админки.
 *
 * В обычной админке у пунктов меню стоят числа: сколько заказов не принято, сколько не
 * доставлено. Здесь те же числа, но настоящие: каждый берётся у сервиса запросом
 * `page=0&size=1` и читает `totalElements` — то есть это количество по всей базе, а не по
 * загруженной странице. Ноль означает «очередь пуста», а не «неизвестно»; если запрос упал,
 * счётчик просто не показывается — выдать недоступность сервиса за ноль было бы враньём.
 *
 * Запросы идут один раз на панель и обновляются раз в минуту: меню не должно грузить
 * сервисы сильнее, чем сами разделы.
 */
import { useQuery } from '@tanstack/react-query';
import { fetchBookings, fetchOrders, fetchPayments, fetchTrips } from '../api/endpoints';

export interface AttentionCounts {
  /** Платежи в статусе FAILED. */
  failedPayments?: number;
  /** Поездки, где машина не нашлась. */
  noDriverTrips?: number;
  /** Записи, отменённые компанией. */
  cancelledBookings?: number;
  /** Заказы, ждущие оплаты. */
  pendingOrders?: number;
}

const ATTENTION_STALE_MS = 60_000;

function total(value: { totalElements?: number } | undefined): number | undefined {
  const count = value?.totalElements;
  return typeof count === 'number' && Number.isFinite(count) ? count : undefined;
}

/** Числа для пунктов меню: у каждого — свой запрос, чтобы один упавший сервис не гасил остальные. */
export function useAttentionCounts(enabled: boolean): AttentionCounts {
  const failedPayments = useQuery({
    queryKey: ['admin', 'attention', 'payments', 'FAILED'],
    queryFn: () => fetchPayments({ status: 'FAILED', page: 0, size: 1 }),
    enabled,
    staleTime: ATTENTION_STALE_MS,
    retry: 0,
  });

  const noDriverTrips = useQuery({
    queryKey: ['admin', 'attention', 'trips', 'NO_DRIVERS_FOUND'],
    queryFn: () => fetchTrips({ status: 'NO_DRIVERS_FOUND', page: 0, size: 1 }),
    enabled,
    staleTime: ATTENTION_STALE_MS,
    retry: 0,
  });

  const cancelledBookings = useQuery({
    queryKey: ['admin', 'attention', 'bookings', 'CANCELLED_BY_COMPANY'],
    queryFn: () => fetchBookings({ status: 'CANCELLED_BY_COMPANY', page: 0, size: 1 }),
    enabled,
    staleTime: ATTENTION_STALE_MS,
    retry: 0,
  });

  const pendingOrders = useQuery({
    queryKey: ['admin', 'attention', 'orders', 'PENDING_PAYMENT'],
    queryFn: () => fetchOrders({ status: 'PENDING_PAYMENT', page: 0, size: 1 }),
    enabled,
    staleTime: ATTENTION_STALE_MS,
    retry: 0,
  });

  return {
    failedPayments: failedPayments.isSuccess ? total(failedPayments.data) : undefined,
    noDriverTrips: noDriverTrips.isSuccess ? total(noDriverTrips.data) : undefined,
    cancelledBookings: cancelledBookings.isSuccess ? total(cancelledBookings.data) : undefined,
    pendingOrders: pendingOrders.isSuccess ? total(pendingOrders.data) : undefined,
  };
}

/** К какому пункту меню относится каждый счётчик. */
export const ATTENTION_BY_SECTION: Record<string, keyof AttentionCounts> = {
  payments: 'failedPayments',
  trips: 'noDriverTrips',
  bookings: 'cancelledBookings',
  orders: 'pendingOrders',
};
