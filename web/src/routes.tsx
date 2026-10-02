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
import { MyBookingsPage } from './pages/MyBookingsPage';
import { NotFoundPage } from './pages/NotFoundPage';
import { OrderDetailPage } from './pages/OrderDetailPage';
import { OrdersPage } from './pages/OrdersPage';
import { PaymentDetailPage } from './pages/PaymentDetailPage';
import { PaymentsPage } from './pages/PaymentsPage';
import { ProductPage } from './pages/ProductPage';
import { RouteErrorPage } from './pages/RouteErrorPage';
import { ServiceCompanyPage } from './pages/ServiceCompanyPage';
import { ServicesPage } from './pages/ServicesPage';
import { TransferPage } from './pages/TransferPage';

/**
 * Route table.
 *
 * Everything except `/login` sits behind `<RequireAuth>`; `/merchant` adds the
 * MERCHANT role on top of the session check. The mobile-first shell lives in
 * `AppLayout`, so every page renders inside the same navigation.
 *
 * Lazily loaded pages are the ones that pull in Leaflet (~150 kB): the dispatcher
 * console and `/taxi`, which no customer should download to look at their balance.
 * Both check their own role — see `DispatchPage` and the `/taxi` branch below.
 *
 * The two verticals of the rider client live at fixed paths (they are referenced by
 * the README and the screenshot scripts): `/taxi` orders a ride, `/taxi/:tripId`
 * shows one ride, `/services` is the QTime catalogue, `/services/:companyId` books a
 * visit and `/services/bookings` lists the rider's bookings.
 */
const DispatchPage = lazy(() =>
  import('./pages/DispatchPage').then((module) => ({ default: module.DispatchPage })),
);

const TaxiPage = lazy(() =>
  import('./pages/TaxiPage').then((module) => ({ default: module.TaxiPage })),
);

// The ride screen draws the same Leaflet map, so it is split out as well.
const TripPage = lazy(() =>
  import('./pages/TripPage').then((module) => ({ default: module.TripPage })),
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
          // `/taxi` renders its own role gate (like `/dispatch`): a rider without the
          // CUSTOMER role must still land on the screen that explains why.
          {
            path: 'taxi',
            element: <RequireAuth roles={['CUSTOMER']} />,
            children: [
              {
                index: true,
                element: (
                  <Suspense fallback={<PageLoader label="Загружаем карту и котировки…" />}>
                    <TaxiPage />
                  </Suspense>
                ),
              },
              {
                path: ':tripId',
                element: (
                  <Suspense fallback={<PageLoader label="Загружаем поездку…" />}>
                    <TripPage />
                  </Suspense>
                ),
              },
            ],
          },
          // Reading the QTime catalogue needs no role (and no session server-side);
          // writing a booking does, and so does the list of one's own bookings.
          {
            path: 'services',
            children: [
              { index: true, element: <ServicesPage /> },
              {
                path: 'bookings',
                element: <RequireAuth roles={['CUSTOMER']} />,
                children: [{ index: true, element: <MyBookingsPage /> }],
              },
              { path: ':companyId', element: <ServiceCompanyPage /> },
            ],
          },
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
