import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { cancelOrder, createOrder, fetchOrder, fetchOrders } from '../api/endpoints';
import type { OrderQuery } from '../api/endpoints';
import type { CreateOrderRequest } from '../api/types';
import { queryKeys } from '../lib/queryKeys';

/** Statuses the order service can still move out of on its own. */
export const POLLED_ORDER_STATUSES = ['PENDING_PAYMENT', 'CREATED', 'PAID'];

/** How many refetches a single pending order gets before polling stops (~1 min). */
export const ORDER_POLL_LIMIT = 30;
export const ORDER_POLL_INTERVAL_MS = 2_000;

export function useOrders(query: OrderQuery) {
  return useQuery({
    queryKey: queryKeys.orders(query),
    queryFn: () => fetchOrders(query),
    staleTime: 10_000,
    placeholderData: (previous) => previous,
  });
}

/**
 * One order, polled while the saga is still running.
 *
 * Polling stops on its own: as soon as the status leaves the pending set, and
 * after {@link ORDER_POLL_LIMIT} attempts so a stuck order cannot make the page
 * poll forever. `dataUpdateCount` is the attempt counter.
 */
export function useOrder(orderId: string | undefined, options: { poll?: boolean } = {}) {
  const poll = options.poll ?? true;
  return useQuery({
    queryKey: queryKeys.order(orderId ?? 'none'),
    queryFn: () => fetchOrder(orderId as string),
    enabled: Boolean(orderId),
    retry: 0,
    refetchInterval: (query) => {
      if (!poll) {
        return false;
      }
      const status = query.state.data?.status;
      if (!status || !POLLED_ORDER_STATUSES.includes(status)) {
        return false;
      }
      return query.state.dataUpdateCount >= ORDER_POLL_LIMIT ? false : ORDER_POLL_INTERVAL_MS;
    },
  });
}

export function useCreateOrder() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ body, idempotencyKey }: { body: CreateOrderRequest; idempotencyKey: string }) =>
      createOrder(body, idempotencyKey),
    retry: 0,
    onSuccess: (order) => {
      queryClient.setQueryData(queryKeys.order(order.orderId), order);
      void queryClient.invalidateQueries({ queryKey: queryKeys.cart() });
      void queryClient.invalidateQueries({ queryKey: ['orders', 'list'] });
      void queryClient.invalidateQueries({ queryKey: queryKeys.accounts() });
    },
  });
}

export function useCancelOrder() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (orderId: string) => cancelOrder(orderId),
    retry: 0,
    onSuccess: (order) => {
      queryClient.setQueryData(queryKeys.order(order.orderId), order);
      void queryClient.invalidateQueries({ queryKey: ['orders', 'list'] });
      void queryClient.invalidateQueries({ queryKey: queryKeys.accounts() });
    },
  });
}
