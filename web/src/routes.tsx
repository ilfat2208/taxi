import { Suspense, lazy } from 'react';
import { createBrowserRouter, type RouteObject } from 'react-router-dom';
import { RequireAuth } from './auth/guards';
import { AppLayout } from './components/layout/AppLayout';
import { PageLoader } from './components/ui/Spinner';
import { CartPage } from './pages/CartPage';
import { DashboardPage } from './pages/DashboardPage';
import { LoginPage } from './pages/LoginPage';
import { MarketPage } from './pages/MarketPage';
import { MerchantPage } from './pages/MerchantPage';
import { NotFoundPage } from './pages/NotFoundPage';
import { OrderDetailPage } from './pages/OrderDetailPage';
import { OrdersPage } from './pages/OrdersPage';
import { PaymentDetailPage } from './pages/PaymentDetailPage';
import { PaymentsPage } from './pages/PaymentsPage';
import { ProductPage } from './pages/ProductPage';
import { RouteErrorPage } from './pages/RouteErrorPage';
import { TransferPage } from './pages/TransferPage';

/**
 * Route table.
 *
 * Everything except `/login` sits behind `<RequireAuth>`; `/merchant` adds the
 * MERCHANT role on top of the session check. The mobile-first shell lives in
 * `AppLayout`, so every page renders inside the same navigation.
 *
 * `/dispatch` is the one lazily loaded page: it pulls in Leaflet (~150 kB), which
 * no customer should download to look at their balance. It checks its own role —
 * see `DispatchPage`.
 */
const DispatchPage = lazy(() =>
  import('./pages/DispatchPage').then((module) => ({ default: module.DispatchPage })),
);

export const appRoutes: RouteObject[] = [
  { path: '/login', element: <LoginPage />, errorElement: <RouteErrorPage /> },
  {
    element: <RequireAuth />,
    errorElement: <RouteErrorPage />,
    children: [
      {
        element: <AppLayout />,
        errorElement: <RouteErrorPage />,
        children: [
          { index: true, element: <DashboardPage /> },
          { path: 'transfer', element: <TransferPage /> },
          { path: 'payments', element: <PaymentsPage /> },
          { path: 'payments/:paymentId', element: <PaymentDetailPage /> },
          { path: 'market', element: <MarketPage /> },
          { path: 'market/:productId', element: <ProductPage /> },
          { path: 'cart', element: <CartPage /> },
          { path: 'orders', element: <OrdersPage /> },
          { path: 'orders/:orderId', element: <OrderDetailPage /> },
          {
            path: 'merchant',
            element: <RequireAuth roles={['MERCHANT']} />,
            children: [{ index: true, element: <MerchantPage /> }],
          },
          // `/dispatch` renders its own role gate: a user without the dispatcher role
          // must still land on the screen that explains (and can request) the token.
          {
            path: 'dispatch',
            element: (
              <Suspense fallback={<PageLoader label="Загружаем диспетчерскую…" />}>
                <DispatchPage />
              </Suspense>
            ),
          },
          { path: '*', element: <NotFoundPage /> },
        ],
      },
    ],
  },
];

export function createAppRouter() {
  return createBrowserRouter(appRoutes);
}
