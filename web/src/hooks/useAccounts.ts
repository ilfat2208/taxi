import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  createAccount,
  fetchAccounts,
  fetchAccountTransactions,
  fetchAccountHolds,
  topUpAccount,
} from '../api/endpoints';
import type { CreateAccountRequest, TopUpRequest } from '../api/types';
import { queryKeys } from '../lib/queryKeys';
import { useAuth } from '../auth/AuthContext';

/** Accounts of the caller, with a sensible balance-first ordering. */
export function useAccounts() {
  const { isAuthenticated } = useAuth();
  return useQuery({
    queryKey: queryKeys.accounts(),
    queryFn: fetchAccounts,
    enabled: isAuthenticated,
    staleTime: 15_000,
  });
}

/** Ledger statement of one account; `page`/`size` are part of the key. */
export function useAccountTransactions(accountId: string | null, page = 0, size = 20) {
  return useQuery({
    queryKey: queryKeys.accountTransactions(accountId ?? 'none', page, size),
    queryFn: () => fetchAccountTransactions(accountId as string, { page, size }),
    enabled: accountId !== null && accountId !== '',
    staleTime: 10_000,
  });
}

/** Funds reserved for in-flight payments (`heldMinor` explained). */
export function useAccountHolds(accountId: string | null) {
  return useQuery({
    queryKey: queryKeys.accountHolds(accountId ?? 'none'),
    queryFn: () => fetchAccountHolds(accountId as string, { status: 'ACTIVE' }),
    enabled: accountId !== null && accountId !== '',
    staleTime: 10_000,
  });
}

export function useCreateAccount() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateAccountRequest) => createAccount(body),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.accounts() });
    },
  });
}

/** ADMIN-only demo top-up; the key is supplied by the caller (money path). */
export function useTopUpAccount() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      accountId,
      body,
      idempotencyKey,
    }: {
      accountId: string;
      body: TopUpRequest;
      idempotencyKey: string;
    }) => topUpAccount(accountId, body, idempotencyKey),
    retry: 0,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.accounts() });
    },
  });
}
