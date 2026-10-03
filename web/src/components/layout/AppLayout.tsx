import type { ComponentType, SVGProps } from 'react';
import { Link, NavLink, Outlet, useNavigate } from 'react-router-dom';
import type { Role } from '../../api/types';
import { useAuth } from '../../auth/AuthContext';
import { DISPATCH_ROLES } from '../../auth/dispatchRoles';
import { useCart } from '../../hooks/useCart';
import { cx } from '../../lib/cx';
import { roleLabel } from '../../lib/format';
import { maskPhone } from '../../lib/phone';
import { Badge } from '../ui/Badge';
import { Button } from '../ui/Button';
import {
  CartIcon,
  DispatchIcon,
  HomeIcon,
  MarketIcon,
  OrdersIcon,
  PaymentsIcon,
  ServicesIcon,
  ShieldIcon,
  StoreIcon,
  TaxiIcon,
  TransferIcon,
  LogoutIcon,
} from './icons';

interface NavItem {
  to: string;
  label: string;
  icon: ComponentType<SVGProps<SVGSVGElement>>;
  /** Show only for these roles (omitted = everybody). */
  roles?: Role[];
  /** Rendered in the mobile tab bar. */
  mobile?: boolean;
  end?: boolean;
}

const NAV_ITEMS: NavItem[] = [
  { to: '/', label: 'Главная', icon: HomeIcon, mobile: true, end: true },
  // The two new verticals sit next to the home screen: on a phone they are the
  // reason the app is opened, and the tab bar is where they have to be reachable.
  { to: '/taxi', label: 'Такси', icon: TaxiIcon, mobile: true },
  { to: '/services', label: 'Услуги', icon: ServicesIcon, mobile: true },
  { to: '/transfer', label: 'Перевод', icon: TransferIcon, mobile: true },
  { to: '/payments', label: 'Платежи', icon: PaymentsIcon },
  { to: '/market', label: 'Маркет', icon: MarketIcon, mobile: true },
  { to: '/cart', label: 'Корзина', icon: CartIcon, mobile: true },
  { to: '/orders', label: 'Заказы', icon: OrdersIcon, mobile: true },
  { to: '/demo', label: 'Демо-макеты', icon: OrdersIcon },
  { to: '/merchant', label: 'Мой магазин', icon: StoreIcon, roles: ['MERCHANT'] },
  // Desktop-only on purpose: the console is a control room, and the tab bar is
  // already full on phones (`mobile` omitted = sidebar only).
  { to: '/dispatch', label: 'Диспетчерская', icon: DispatchIcon, roles: DISPATCH_ROLES },
  // Админка тоже только в сайдбаре: это рабочее место, а не экран райдера.
  { to: '/admin', label: 'Админка', icon: ShieldIcon, roles: ['ADMIN', 'SUPPORT'] },
];

function navLinkClass({ isActive }: { isActive: boolean }): string {
  return cx(
    'flex items-center gap-3 rounded-xl px-3 py-2 text-sm font-medium transition-colors',
    isActive ? 'bg-brand-50 text-brand-700' : 'text-ink-600 hover:bg-ink-100',
  );
}

/**
 * Application shell: header, desktop sidebar, mobile tab bar.
 *
 * Mobile-first: the tab bar is the primary navigation on phones and the sidebar
 * appears only from `lg`, so no route is ever reachable on one form factor only.
 */
export function AppLayout() {
  const { session, roles, logout } = useAuth();
  const navigate = useNavigate();
  const cart = useCart();
  const cartCount = cart.data?.itemCount ?? 0;

  const visibleItems = NAV_ITEMS.filter(
    (item) => !item.roles || item.roles.some((role) => roles.includes(role)),
  );

  const handleLogout = () => {
    logout();
    navigate('/login', { replace: true });
  };

  return (
    <div className="min-h-dvh bg-ink-50">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-full focus:bg-white focus:px-4 focus:py-2"
      >
        К содержимому
      </a>

      <header className="sticky top-0 z-30 border-b border-ink-200 bg-white/95 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-6xl items-center gap-3 px-4">
          <Link to="/" className="flex items-center gap-2">
            <span className="grid h-8 w-8 place-items-center rounded-xl bg-brand-500 text-sm font-bold text-white">
              O
            </span>
            <span className="text-base font-semibold text-ink-900">ORTA</span>
          </Link>

          <nav aria-label="Быстрые действия" className="ml-auto flex items-center gap-2">
            <Link
              to="/cart"
              className="relative rounded-full p-2 text-ink-600 hover:bg-ink-100"
              aria-label={`Корзина${cartCount > 0 ? `, товаров: ${cartCount}` : ''}`}
            >
              <CartIcon className="h-5 w-5" />
              {cartCount > 0 ? (
                <span className="absolute -right-0.5 -top-0.5 grid h-5 min-w-5 place-items-center rounded-full bg-brand-500 px-1 text-[11px] font-semibold text-white">
                  {cartCount}
                </span>
              ) : null}
            </Link>

            <div className="hidden items-center gap-2 sm:flex">
              <div className="text-right leading-tight">
                <p className="text-sm font-medium text-ink-800">
                  {session?.displayName ?? (session?.phone ? maskPhone(session.phone) : 'Гость')}
                </p>
                <p className="text-xs text-ink-500">
                  {roles.length > 0 ? roles.map(roleLabel).join(' · ') : 'без роли'}
                </p>
              </div>
            </div>

            <Button variant="secondary" size="sm" onClick={handleLogout} aria-label="Выйти из аккаунта">
              <LogoutIcon className="h-4 w-4" />
              <span className="hidden sm:inline">Выйти</span>
            </Button>
          </nav>
        </div>

        {roles.length > 0 ? (
          <div className="flex gap-1.5 overflow-x-auto border-t border-ink-100 px-4 py-1.5 sm:hidden">
            {roles.map((role) => (
              <Badge key={role} tone={role === 'ADMIN' ? 'brand' : 'neutral'}>
                {roleLabel(role)}
              </Badge>
            ))}
          </div>
        ) : null}
      </header>

      <div className="mx-auto flex max-w-6xl gap-6 px-4">
        <nav aria-label="Разделы" className="hidden w-56 shrink-0 py-6 lg:block">
          <ul className="space-y-1">
            {visibleItems.map((item) => (
              <li key={item.to}>
                <NavLink to={item.to} end={item.end} className={navLinkClass}>
                  <item.icon className="h-5 w-5" />
                  {item.label}
                </NavLink>
              </li>
            ))}
          </ul>
        </nav>

        <main id="main" className="min-w-0 flex-1 pb-24 pt-4 lg:pb-10 lg:pt-6">
          <Outlet />
        </main>
      </div>

      <nav
        aria-label="Основная навигация"
        className="fixed inset-x-0 bottom-0 z-30 border-t border-ink-200 bg-white/95 backdrop-blur lg:hidden"
      >
        <ul className="mx-auto flex max-w-6xl items-stretch">
          {visibleItems
            .filter((item) => item.mobile)
            .map((item) => (
              <li key={item.to} className="flex-1">
                <NavLink
                  to={item.to}
                  end={item.end}
                  className={({ isActive }) =>
                    cx(
                      'flex flex-col items-center gap-1 py-2 text-[11px] font-medium',
                      isActive ? 'text-brand-600' : 'text-ink-500',
                    )
                  }
                >
                  <item.icon className="h-5 w-5" />
                  {item.label}
                </NavLink>
              </li>
            ))}
        </ul>
      </nav>
    </div>
  );
}
