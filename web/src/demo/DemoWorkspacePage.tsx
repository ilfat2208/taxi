/**
 * Рабочая область демо-роли: продукт, а не галерея.
 *
 * Человек выбирает роль на входе и попадает в свой интерфейс: слева меню его экранов,
 * справа — рабочий экран на всю ширину. Никаких рамок устройств: консоль выглядит
 * консолью, мобильное приложение — мобильным приложением в узкой колонке. Рамки нужны
 * были только для борда, здесь их место занимает обычная вёрстка продукта.
 *
 * Под каждым экраном — короткая честная справка: статус, что из этого работает
 * по-настоящему и где ошибка, если она есть. Данные во всех экранах демонстрационные,
 * и это написано в шапке постоянно, а не мелким шрифтом.
 */
import { Suspense, lazy, useMemo } from 'react';
import { Link, Navigate, useParams } from 'react-router-dom';
import { Badge } from '../components/ui/Badge';
import { PageLoader } from '../components/ui/Spinner';
import { cx } from '../lib/cx';
import { loadScreen } from './registry';
import { groupScreens, roleById, roleScreens } from './roles';
import { STATUS_LABEL, STATUS_TONE } from './types';

export function DemoWorkspacePage() {
  const { role: roleId = '', screenId } = useParams();
  const role = roleById(roleId);

  const screens = useMemo(() => (role ? roleScreens(role) : []), [role]);
  const groups = useMemo(() => groupScreens(screens), [screens]);
  const active = screens.find((s) => s.id === screenId) ?? screens[0];

  if (!role) {
    return <Navigate to="/demo" replace />;
  }

  const Screen = active ? lazy(loadScreen(active.id)) : null;

  return (
    <div className="min-h-screen bg-[#F5F6F8]">
      <header className="border-b border-ink-200 bg-white">
        <div className="mx-auto flex max-w-[1600px] flex-wrap items-center gap-3 px-4 py-3">
          <Link to="/demo" className="flex items-center gap-2">
            <span className="grid h-8 w-8 place-items-center rounded-lg bg-brand-500 text-sm font-bold text-white">O</span>
            <span className="text-[15px] font-bold tracking-tight text-ink-900">{role.shellTitle}</span>
          </Link>
          <span className="rounded-full bg-brand-50 px-2.5 py-1 text-xs font-medium text-brand-700 ring-1 ring-inset ring-brand-200">
            {role.roleBadge}
          </span>
          <span className="rounded-full bg-ink-900/85 px-2.5 py-1 text-[11px] font-medium text-white">демо-данные</span>
          <span className="flex-1" />
          <Link to="/demo" className="rounded-xl bg-ink-100 px-3 py-2 text-xs font-medium text-ink-700">
            Сменить роль
          </Link>
          <Link to="/demo/all" className="rounded-xl bg-ink-100 px-3 py-2 text-xs font-medium text-ink-700">
            Все макеты
          </Link>
        </div>
      </header>

      <div className="mx-auto flex max-w-[1600px] gap-4 px-4 py-4">
        <aside className="hidden w-[280px] flex-none xl:block">
          <div className="sticky top-4 space-y-3">
            <div className="rounded-card border border-ink-200 bg-white p-3">
              <div className="text-[13px] font-semibold text-ink-800">{role.title}</div>
              <p className="mt-1 text-[11.5px] leading-snug text-ink-500">{role.who}</p>
            </div>
            <div className="rounded-card border border-ink-200 bg-white p-2">
              {groups.map((group) => (
                <div key={group.group} className="mb-2 last:mb-0">
                  <div className="px-2 py-1 text-[11px] uppercase tracking-wide text-ink-400">{group.group}</div>
                  {group.screens.map((screen) => (
                    <Link
                      key={screen.id}
                      to={`/demo/${role.id}/${screen.id}`}
                      className={cx(
                        'flex items-center gap-2 rounded-lg px-2 py-1.5 text-[12.5px]',
                        screen.id === active?.id ? 'bg-brand-50 font-semibold text-brand-700' : 'text-ink-600 hover:bg-ink-50',
                      )}
                    >
                      <span
                        className={cx(
                          'h-1.5 w-1.5 flex-none rounded-full',
                          screen.status === 'Работает' || screen.status === 'Ф2'
                            ? 'bg-success-500'
                            : screen.status === 'В работе'
                              ? 'bg-warning-500'
                              : 'bg-ink-300',
                        )}
                      />
                      <span className="truncate">{screen.title}</span>
                    </Link>
                  ))}
                </div>
              ))}
            </div>
          </div>
        </aside>

        <main className="min-w-0 flex-1 space-y-4">
          <div className="rounded-card border border-ink-200 bg-white p-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[13px] font-semibold text-ink-900">{role.title}</span>
              <span className="text-[12px] text-ink-500">{role.what}</span>
            </div>
            <p className="mt-1.5 text-[11.5px] leading-snug text-ink-500">{role.honesty}</p>
          </div>

          {active && Screen ? (
            <Suspense fallback={<PageLoader label="Открываем раздел…" />}>
              {role.shell === 'console' ? (
                <div className="overflow-x-auto">
                  <div className="flex min-h-[714px] min-w-[900px] flex-col gap-3 rounded-card border border-ink-200 bg-white p-4">
                    <Screen />
                  </div>
                </div>
              ) : (
                <div className="flex justify-center">
                  <div className="w-[390px] overflow-hidden rounded-[36px] border border-ink-200 bg-white shadow-lg">
                    <div className="flex h-7 flex-none items-center justify-between px-5 pt-1 text-[12px] font-semibold text-ink-900">
                      <span>9:41</span>
                      <span className="flex items-center gap-1 text-ink-500">
                        <span className="inline-block h-2 w-4 rounded-sm bg-ink-400" />
                        <span className="inline-block h-2 w-3 rounded-sm bg-ink-400" />
                        <span className="inline-block h-2.5 w-5 rounded-sm bg-ink-500" />
                      </span>
                    </div>
                    <div className="flex h-[816px] flex-col">{<Screen />}</div>
                    <div className="grid h-[22px] place-items-center">
                      <span className="h-[5px] w-[134px] rounded-full bg-ink-900/80" />
                    </div>
                  </div>
                </div>
              )}
            </Suspense>
          ) : (
            <div className="rounded-card border border-ink-200 bg-white p-4 text-sm text-ink-500">
              Для этой роли экраны ещё не перенесены.
            </div>
          )}

          {active ? (
            <div className="space-y-2 rounded-card border border-ink-200 bg-white p-4">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-[13px] font-semibold text-ink-900">{active.title}</span>
                <Badge tone={STATUS_TONE[active.status]}>{STATUS_LABEL[active.status]}</Badge>
                <span className="font-mono text-[11px] text-ink-400">{active.id}</span>
              </div>
              <p className="text-[12.5px] text-ink-600">{active.note}</p>
              <p className="text-[11.5px] text-ink-500">
                <b>Где в коде:</b> <code className="rounded bg-ink-100 px-1">{active.code}</code>
              </p>
              <p className="text-[11.5px] text-ink-500">
                <b>Эндпоинты и события:</b> <code className="rounded bg-ink-100 px-1">{active.endpoints}</code>
              </p>
            </div>
          ) : null}
        </main>
      </div>
    </div>
  );
}
