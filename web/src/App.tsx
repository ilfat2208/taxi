import { useState } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider } from 'react-router-dom';
import { isRetryableError } from './api/client';
import { AuthProvider } from './auth/AuthContext';
import { createAppRouter } from './routes';

/**
 * Query client policy.
 *
 * Reads retry twice on transient failures only (`5xx`, `408`, `429`) — a 4xx is a
 * decision, not a hiccup, and retrying it wastes the user's time. Mutations never
 * retry automatically: money-moving requests are re-submitted by the user, which
 * reuses the same Idempotency-Key on purpose.
 */
export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        retry: isRetryableError,
        staleTime: 10_000,
        gcTime: 5 * 60_000,
        refetchOnWindowFocus: false,
      },
      mutations: {
        retry: 0,
      },
    },
  });
}

export function App() {
  // One client and one router per mount; recreating either would drop the cache
  // (and re-trigger every query) on each render.
  const [queryClient] = useState(createQueryClient);
  const [router] = useState(createAppRouter);

  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <RouterProvider router={router} />
      </AuthProvider>
    </QueryClientProvider>
  );
}

export default App;
