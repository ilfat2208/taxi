/**
 * Оболочка админ-панели.
 *
 * Отдельный от клиентского приложения каркас: у админки своё меню разделов слева,
 * своя шапка с ролью и выходом и никакой корзины с таб-баром райдера. Пункт «Открыть
 * приложение» возвращает в клиент — панель не должна быть тупиком.
 *
 * Роль приходит снаружи: оболочка не решает, кому доступна админка, она только
 * показывает, кто вошёл, и честно предупреждает SUPPORT, что запись закрыта.
 */
import type { ReactNode } from 'react';
import { Link, NavLink } from 'react-router-dom';
import { Badge } from '../components/ui/Badge';
import { buttonClass } from '../components/ui/Button';
import { roleLabel } from '../lib/format';
import { maskPhone } from '../lib/phone';
import { cx } from '../lib/cx';
import { ADMIN_SECTIONS } from './sections';

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
  const visible = ADMIN_SECTIONS.filter((section) => section.roles.includes(role));

  return (
    <div className="min-h-screen bg-ink-50" data-admin-shell data-admin-role={role} data-admin-readonly={!canWrite}>
      <header className="border-b border-ink-200 bg-white">
        <div className="mx-auto flex max-w-[1500px] flex-wrap items-center gap-3 px-4 py-3 lg:px-6">
          <Link to="/admin" className="flex items-baseline gap-2">
            <span className="text-lg font-semibold tracking-tight text-brand-700">ORTA</span>
            <span className="text-sm text-ink-500">админ-панель</span>
          </Link>
          <Badge tone={canWrite ? 'brand' : 'neutral'}>
            {roleLabel(role)}
            {canWrite ? ' · полный доступ' : ' · только чтение'}
          </Badge>
          <span className="hidden text-sm text-ink-500 sm:inline">{maskPhone(userName)}</span>
          <div className="ml-auto flex items-center gap-2">
            <Link to="/" className={buttonClass({ variant: 'secondary', size: 'sm' })}>
              Открыть приложение
            </Link>
            <button type="button" onClick={onLogout} className={buttonClass({ variant: 'ghost', size: 'sm' })}>
              Выйти
            </button>
          </div>
        </div>
      </header>

      <div className="mx-auto flex max-w-[1500px] flex-col gap-6 px-4 py-6 lg:flex-row lg:px-6">
        <nav aria-label="Разделы админки" className="lg:w-64 lg:shrink-0" data-admin-nav>
          <ul className="flex gap-1 overflow-x-auto pb-2 lg:flex-col lg:overflow-visible lg:pb-0">
            {visible.map((section) => (
              <li key={section.id} className="shrink-0 lg:shrink">
                <NavLink
                  to={`/admin/${section.id}`}
                  className={({ isActive }) =>
                    cx(
                      'flex items-center gap-2 rounded-xl px-3 py-2 text-sm font-medium whitespace-nowrap transition-colors',
                      isActive ? 'bg-brand-50 text-brand-700' : 'text-ink-600 hover:bg-ink-100',
                    )
                  }
                  aria-current={section.id === sectionId ? 'page' : undefined}
                >
                  {section.title}
                </NavLink>
              </li>
            ))}
          </ul>

          {!canWrite && (
            <p
              data-admin-readonly-banner
              className="mt-3 hidden rounded-xl bg-white p-3 text-xs leading-relaxed text-ink-500 ring-1 ring-ink-200 lg:block"
            >
              Роль {roleLabel(role)} видит админку только для чтения: возвраты, расчёты, назначения, отмены и лимиты
              доступны роли {roleLabel('ADMIN')}.
            </p>
          )}
        </nav>

        <main className="min-w-0 flex-1" data-admin-section={sectionId}>
          {!canWrite && (
            <p
              data-admin-readonly-banner
              className="mb-4 rounded-xl bg-warning-50 px-3 py-2 text-sm text-warning-700 ring-1 ring-amber-200 lg:hidden"
            >
              Режим только для чтения: изменяющие действия скрыты.
            </p>
          )}
          {children}
        </main>
      </div>
    </div>
  );
}
