/**
 * Вход в демо-режим: выбор роли.
 *
 * Это замена «галерее макетов» на входе. Человеку не нужно решать, какой макет
 * посмотреть: он выбирает, кем входит — администратором, владельцем бизнеса,
 * администратором салона, поддержкой, водителем, курьером или клиентом — и попадает
 * в свой интерфейс с меню. Дальше он ходит по продукту, а не по картинкам.
 *
 * Под каждой ролью написано, что в ней работает по-настоящему: роли с серыми
 * пометками — это ещё проект, и об этом сказано до входа, а не после.
 */
import { Link } from 'react-router-dom';
import { Badge } from '../components/ui/Badge';
import { Card, CardBody, CardHeader } from '../components/ui/Card';
import { DEMO_ROLES, roleScreens } from './roles';

export function DemoRolePickerPage() {
  return (
    <div className="space-y-4">
      <Card>
        <CardHeader
          title="Демо-режим ORTA"
          subtitle="Выберите, кем войти, и увидите продукт с этой стороны — со своими данными, меню и рабочими экранами"
        />
        <CardBody className="space-y-3 text-sm text-ink-600">
          <p>
            Вход настоящий по смыслу, но данные демонстрационные: за каждым экраном стоит макет с
            правдоподобными числами, а не живая база. Что из этого уже работает в коде — видно по статусу
            рядом с экраном и в справке роли.
          </p>
          <div className="flex flex-wrap gap-2">
            <Badge tone="success">Работает — проверено e2e</Badge>
            <Badge tone="info">Ф2 — сделано в текущей фазе</Badge>
            <Badge tone="warning">В работе — API есть, интерфейса нет</Badge>
            <Badge tone="neutral">План — кода нет</Badge>
          </div>
        </CardBody>
      </Card>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {DEMO_ROLES.map((role) => {
          const screens = roleScreens(role);
          const working = screens.filter((s) => s.status === 'Работает' || s.status === 'Ф2').length;
          const api = screens.filter((s) => s.status === 'В работе').length;
          return (
            <div key={role.id} className="flex flex-col justify-between rounded-card border border-ink-200 bg-white p-4 shadow-sm">
              <div className="space-y-2">
                <div className="flex items-start justify-between gap-2">
                  <span className="text-sm font-semibold text-ink-900">{role.title}</span>
                  <Badge tone={role.shell === 'console' ? 'brand' : 'neutral'}>
                    {role.shell === 'console' ? 'консоль' : 'приложение'}
                  </Badge>
                </div>
                <p className="text-xs text-ink-500">{role.who}</p>
                <p className="text-xs text-ink-600">{role.what}</p>
                <div className="flex flex-wrap gap-1.5 pt-1">
                  <Badge tone="success">{working} работают</Badge>
                  <Badge tone="warning">{api} только API</Badge>
                  <Badge tone="neutral">{screens.length - working - api} план</Badge>
                </div>
                <p className="line-clamp-3 text-[11.5px] leading-snug text-ink-500">{role.honesty}</p>
              </div>
              <div className="mt-3 flex items-center gap-2">
                <Link to={`/demo/${role.id}`} className="rounded-xl bg-brand-500 px-3 py-2 text-xs font-medium text-white">
                  Войти как {role.title.toLowerCase()}
                </Link>
                <span className="text-[11px] text-ink-400">{screens.length} экранов</span>
              </div>
            </div>
          );
        })}
      </div>

      <Card>
        <CardBody className="flex flex-wrap items-center gap-3 text-sm text-ink-600">
          <span>
            <b className="text-ink-900">Все макеты списком</b> — 162 экрана с фильтрами по разделу и статусу, если нужно
            посмотреть выборочно.
          </span>
          <Link to="/demo/all" className="rounded-xl bg-ink-100 px-3 py-2 text-xs font-medium text-ink-700">
            Открыть список всех экранов
          </Link>
        </CardBody>
      </Card>
    </div>
  );
}
