/**
 * Оболочка админ-панели: тёмное меню группами, живые счётчики, поиск по меню, карточка оператора.
 *
 * Каркас отдельный от клиентского приложения: своё меню слева, своя шапка с ролью и выходом
 * и никакой корзины с таб-баром райдера. Пункт «Открыть приложение» возвращает в клиент —
 * панель не должна быть тупиком.
 *
 * Меню повторяет то, к чему привыкли в обычных админках: группы с заголовками, у пунктов —
 * счётчики «сколько ждёт внимания» (настоящие числа из сервисов, см. `attention.ts`), сверху
 * поиск по пунктам, снизу карточка вошедшего. Меню складное: на широком экране кнопка в шапке
 * сворачивает его до иконок, на узком — открывает панель поверх страницы.
 *
 * Роль приходит снаружи: оболочка не решает, кому доступна админка, она только показывает,
 * кто вошёл, и честно предупреждает SUPPORT, что запись закрыта.
 */
import { useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { Link, NavLink } from 'react-router-dom';
import { Badge } from '../components/ui/Badge';
import { buttonClass } from '../components/ui/Button';
import { roleLabel } from '../lib/format';
import { maskPhone } from '../lib/phone';
import { cx } from '../lib/cx';
import {
  ChevronLeftIcon,
  DispatchIcon,
  HomeIcon,
  LogoutIcon,
  MarketIcon,
  MenuIcon,
  OrdersIcon,
  PaymentsIcon,
  PulseIcon,
  SearchIcon,
  ServicesIcon,
  ShieldIcon,
  StoreIcon,
  TaxiIcon,
  TransferIcon,
  WalletIcon,
} from '../components/layout/icons';
import { ADMIN_SECTIONS, type AdminSection } from './sections';
import { ATTENTION_BY_SECTION, useAttentionCounts, type AttentionCounts } from './attention';
import { navGroupsFor } from './nav';

/** Иконка пункта меню: одна на раздел, по смыслу раздела, а не по алфавиту. */
const SECTION_ICONS: Record<string, typeof HomeIcon> = {
  overview: HomeIcon,
  pulse: PulseIcon,
  payments: PaymentsIcon,
  settlements: TransferIcon,
  accounts: WalletIcon,
  trips: TaxiIcon,
  bookings: ServicesIcon,
  fleet: DispatchIcon,
  catalog: MarketIcon,
  orders: OrdersIcon,
  reference: StoreIcon,
};

function initialsOf(name: string): string {
  const digits = name.replace(/\D/g, '');
  return digits.length >= 2 ? digits.slice(-2) : 'OR';
}

export function AdminLayout({
  sectionId,
  role,
  canWrite,
  onLogout,
  userName,
  children,
}: {
  sectionId: string;
  role: 'ADMIN' | 'SUPPORT';
  canWrite: boolean;
  onLogout: () => void;
  userName: string;
  children: ReactNode;
}) {
  const [menuQuery, setMenuQuery] = useState('');
  const [collapsed, setCollapsed] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);

  const counts = useAttentionCounts(true);
  const groups = useMemo(() => navGroupsFor(ADMIN_SECTIONS, role), [role]);

  const filtered = useMemo(() => {
    const needle = menuQuery.trim().toLowerCase();
    if (needle === '') {
      return groups;
    }
    return groups
      .map((group) => ({
        title: group.title,
        items: group.items.filter(
          (section) =>
            section.title.toLowerCase().includes(needle) || section.id.includes(needle),
        ),
      }))
      .filter((group) => group.items.length > 0);
  }, [groups, menuQuery]);

  const activeSection = ADMIN_SECTIONS.find((section) => section.id === sectionId);
  const badgeFor = (section: AdminSection): number | undefined => {
    const key = ATTENTION_BY_SECTION[section.id];
    return key ? (counts[key as keyof AttentionCounts] as number | undefined) : undefined;
  };

  const sidebar = (
    <div className="flex h-full flex-col bg-brand-900 text-white">
      <div className="flex items-center gap-2 px-4 py-4">
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-white/10 text-sm font-bold">O</span>
        {!collapsed && (
          <div className="min-w-0">
            <div className="truncate text-sm font-semibold tracking-tight">ORTA</div>
            <div className="truncate text-[11px] text-brand-200">админ-панель</div>
          </div>
        )}
        <button
          type="button"
          onClick={() => setCollapsed((value) => !value)}
          className="ml-auto hidden rounded-lg p-1.5 text-brand-200 hover:bg-white/10 hover:text-white lg:block"
          aria-label={collapsed ? 'Развернуть меню' : 'Свернуть меню'}
          title={collapsed ? 'Развернуть меню' : 'Свернуть меню'}
        >
          <ChevronLeftIcon className={cx('h-4 w-4 transition-transform', collapsed && 'rotate-180')} />
        </button>
      </div>

      {!collapsed && (
        <div className="px-3 pb-3">
          <div className="relative">
            <SearchIcon className="pointer-events-none absolute top-1/2 left-2.5 h-4 w-4 -translate-y-1/2 text-brand-200" />
            <input
              value={menuQuery}
              onChange={(event) => setMenuQuery(event.target.value)}
              placeholder="Поиск в меню…"
              aria-label="Поиск раздела в меню"
              className="w-full rounded-xl border border-white/15 bg-white/5 py-2 pr-2 pl-8 text-sm text-white placeholder:text-brand-200 focus:border-white/40 focus:outline-none"
            />
          </div>
        </div>
      )}

      <nav aria-label="Разделы админки" className="min-h-0 flex-1 overflow-y-auto px-2 pb-3" data-admin-nav>
        {filtered.length === 0 && !collapsed && (
          <p className="px-2 py-3 text-xs text-brand-200">Ничего не найдено. Очистите поиск.</p>
        )}
        {filtered.map((group) => (
          <div key={group.title} className="mb-3">
            {!collapsed && (
              <div className="px-2 pb-1 text-[10px] font-semibold tracking-wider text-brand-200/80 uppercase">
                {group.title}
              </div>
            )}
            <ul className="space-y-0.5">
              {group.items.map((section) => {
                const Icon = SECTION_ICONS[section.id] ?? ShieldIcon;
                const badge = badgeFor(section);
                return (
                  <li key={section.id}>
                    <NavLink
                      to={`/admin/${section.id}`}
                      onClick={() => setDrawerOpen(false)}
                      title={collapsed ? section.title : undefined}
                      className={({ isActive }) =>
                        cx(
                          'flex items-center gap-2.5 rounded-xl px-2.5 py-2 text-sm transition-colors',
                          isActive
                            ? 'bg-white/15 font-semibold text-white'
                            : 'text-brand-100 hover:bg-white/10 hover:text-white',
                          collapsed && 'justify-center',
                        )
                      }
                      aria-current={section.id === sectionId ? 'page' : undefined}
                    >
                      <Icon className="h-4 w-4 shrink-0" />
                      {!collapsed && <span className="min-w-0 flex-1 truncate">{section.title}</span>}
                      {!collapsed && typeof badge === 'number' && (
                        <span
                          className={cx(
                            'rounded-full px-1.5 py-0.5 text-[11px] font-semibold',
                            badge > 0 ? 'bg-warning-500 text-white' : 'bg-white/10 text-brand-100',
                          )}
                          title={
                            badge > 0
                              ? `Ждёт внимания: ${badge}`
                              : 'Очередь внимания пуста'
                          }
                        >
                          {badge}
                        </span>
                      )}
                    </NavLink>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </nav>

      <div className="border-t border-white/10 p-3">
        <div className={cx('flex items-center gap-2', collapsed && 'justify-center')}>
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-white/15 text-xs font-semibold">
            {initialsOf(userName)}
          </span>
          {!collapsed && (
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-medium">{maskPhone(userName)}</div>
              <div className="truncate text-[11px] text-brand-200">
                {roleLabel(role)}
                {canWrite ? ' · полный доступ' : ' · только чтение'}
              </div>
            </div>
          )}
          <button
            type="button"
            onClick={onLogout}
            className="rounded-lg p-1.5 text-brand-200 hover:bg-white/10 hover:text-white"
            aria-label="Выйти"
            title="Выйти"
          >
            <LogoutIcon className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-ink-100" data-admin-shell data-admin-role={role} data-admin-readonly={!canWrite}>
      {/* Меню: на широком экране — колонка (складная), на узком — панель поверх страницы. */}
      <aside
        className={cx(
          'fixed inset-y-0 left-0 z-40 transition-[width,transform] duration-200',
          collapsed ? 'lg:w-16' : 'lg:w-64',
          'w-64',
          drawerOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0',
        )}
      >
        {sidebar}
      </aside>
      {drawerOpen && (
        <button
          type="button"
          aria-label="Закрыть меню"
          onClick={() => setDrawerOpen(false)}
          className="fixed inset-0 z-30 bg-ink-900/40 lg:hidden"
        />
      )}

      <div className={cx('flex min-h-screen flex-col transition-[padding] duration-200', collapsed ? 'lg:pl-16' : 'lg:pl-64')}>
        <header className="sticky top-0 z-20 border-b border-ink-200 bg-white">
          <div className="flex flex-wrap items-center gap-3 px-4 py-2.5 lg:px-6">
            <button
              type="button"
              onClick={() => setDrawerOpen(true)}
              className="rounded-lg p-1.5 text-ink-600 hover:bg-ink-100 lg:hidden"
              aria-label="Открыть меню"
            >
              <MenuIcon className="h-5 w-5" />
            </button>

            <nav aria-label="Хлебные крошки" className="flex min-w-0 items-center gap-2 text-sm">
              <Link to="/admin/overview" className="text-ink-500 hover:text-ink-700">
                Админка
              </Link>
              <span className="text-ink-300">/</span>
              <span className="truncate font-medium text-ink-900">{activeSection?.title ?? sectionId}</span>
            </nav>

            <Badge tone={canWrite ? 'brand' : 'neutral'} className="ml-auto">
              {roleLabel(role)}
            </Badge>
            <Link to="/" className={buttonClass({ variant: 'secondary', size: 'sm' })}>
              Открыть приложение
            </Link>
          </div>
        </header>

        <main className="min-w-0 flex-1 px-4 py-5 lg:px-6" data-admin-section={sectionId}>
          {!canWrite && (
            <p
              data-admin-readonly-banner
              className="mb-4 rounded-xl bg-warning-50 px-3 py-2 text-sm text-warning-700 ring-1 ring-amber-200"
            >
              Роль {roleLabel(role)} видит админку только для чтения: возвраты, расчёты, назначения, отмены и лимиты
              доступны роли {roleLabel('ADMIN')}. Изменяющие кнопки поэтому не отрисованы — это правило сервера, а не
              только интерфейса.
            </p>
          )}
          {children}
        </main>

        <footer className="border-t border-ink-200 bg-white px-4 py-3 text-xs text-ink-500 lg:px-6">
          ORTA · админ-панель · данные приходят из сервисов по тем эндпоинтам, что указаны в каждом разделе. Роль{' '}
          {roleLabel(role)}: {canWrite ? 'изменения разрешены' : 'изменения недоступны'}.
        </footer>
      </div>
    </div>
  );
}
