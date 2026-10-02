import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { createTransfer, fetchPayment, fetchPayments, fetchRefunds, refundPayment } from '../api/endpoints';
import type { PaymentQuery } from '../api/endpoints';
import type { RefundRequest, TransferRequest } from '../api/types';
import { queryKeys } from '../lib/queryKeys';

export function usePayments(query: PaymentQuery) {
  return useQuery({
    queryKey: queryKeys.payments(query),
    queryFn: () => fetchPayments(query),
    staleTime: 10_000,
    placeholderData: (previous) => previous,
  });
}

export function usePayment(paymentId: string | undefined) {
  return useQuery({
    queryKey: queryKeys.payment(paymentId ?? 'none'),
    queryFn: () => fetchPayment(paymentId as string),
    enabled: Boolean(paymentId),
    staleTime: 5_000,
  });
}

export function useRefunds(paymentId: string | undefined, enabled = true) {
  return useQuery({
    queryKey: queryKeys.refunds(paymentId ?? 'none'),
    queryFn: () => fetchRefunds(paymentId as string),
    enabled: Boolean(paymentId) && enabled,
    retry: 0,
  });
}

/**
 * P2P transfer. `retry: 0` on purpose: the mutation must be re-submitted by the
 * user (same Idempotency-Key) so a transient failure never looks like a double
 * movement of money.
 */
export function useCreateTransfer() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ body, idempotencyKey }: { body: TransferRequest; idempotencyKey: string }) =>
      createTransfer(body, idempotencyKey),
    retry: 0,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.accounts() });
      void queryClient.invalidateQueries({ queryKey: ['payments'] });
    },
  });
}

export function useRefundPayment() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      paymentId,
      body,
      idempotencyKey,
    }: {
      paymentId: string;
      body: RefundRequest;
      idempotencyKey: string;
    }) => refundPayment(paymentId, body, idempotencyKey),
    retry: 0,
    onSuccess: (_payment, variables) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.payment(variables.paymentId) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.refunds(variables.paymentId) });
      void queryClient.invalidateQueries({ queryKey: ['payments', 'list'] });
      void queryClient.invalidateQueries({ queryKey: queryKeys.accounts() });
    },
  });
}
