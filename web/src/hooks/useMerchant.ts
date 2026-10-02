import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { createMerchant, fetchMyMerchant } from '../api/endpoints';
import { isApiError } from '../api/errors';
import type { CreateMerchantRequest } from '../api/types';
import { queryKeys } from '../lib/queryKeys';

/**
 * Own merchant profile. A 404 (`MERCHANT_NOT_FOUND`) is a *state*, not a failure:
 * the console then offers onboarding instead of an error banner, so it is not
 * retried.
 */
export function useMyMerchant(enabled = true) {
  return useQuery({
    queryKey: queryKeys.merchant(),
    queryFn: fetchMyMerchant,
    enabled,
    retry: (failureCount, error) => (isApiError(error) && error.isNotFound ? false : failureCount < 1),
    staleTime: 30_000,
  });
}

export function useCreateMerchant() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateMerchantRequest) => createMerchant(body),
    retry: 0,
    onSuccess: (merchant) => {
      queryClient.setQueryData(queryKeys.merchant(), merchant);
      void queryClient.invalidateQueries({ queryKey: queryKeys.merchant() });
    },
  });
}
