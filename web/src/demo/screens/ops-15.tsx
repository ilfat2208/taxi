/**
 * ops-15 · Админка · справочники (города, категории, услуги) и демо-данные со сбросом.
 *
 * Честность экрана: справочников и сброса в интерфейсе нет — Шымкент зашит в демо-данные. Чтением уже
 * отдаются категории каталога (GET /api/v1/catalog/categories) и компании QTime (GET /api/v1/qtime/companies),
 * из «демо» реально работают пополнение счёта (POST /api/v1/accounts/{id}/top-up, ADMIN, демо-деньги),
 * симулятор парка (scripts/simulate-fleet.ps1, 7 машин, Шымкент) и счёт-подвеска по taxi.demo.seed.
 * Кнопка сброса намеренно выключена: действие необратимое, ручки POST /api/v1/admin/demo/reset нет.
 */
import { Badge } from '../../components/ui/Badge';
import { ConsolePanel, ConsoleRows, Notice } from '../kit';

const DICTIONARIES = [
  {
    title: 'Города',
    meta: 'Шымкент зашит в демо-данные, справочника нет',
    right: <Badge tone="neutral">1</Badge>,
  },
  {
    title: 'Категории каталога',
    meta: 'GET /api/v1/catalog/categories',
    right: <Badge tone="success">читается</Badge>,
  },
  {
    title: 'Компании и специалисты QTime',
    meta: 'GET /api/v1/qtime/companies, /{id}',
    right: <Badge tone="success">читается</Badge>,
  },
  {
    title: 'Услуги и расписание',
    meta: 'приходят из qtime-service, справочника нет',
    right: <Badge tone="neutral">нет справочника</Badge>,
  },
];

const DEMO = [
  {
    title: 'Демо-пополнение счёта',
    meta: 'POST /accounts/{id}/top-up · ADMIN, демо-деньги',
    right: <Badge tone="success">есть</Badge>,
  },
  {
    title: 'Парк машин по Шымкенту',
    meta: 'simulate-fleet.ps1 · 7 машин, раз в 2 с',
    right: <Badge tone="success">есть</Badge>,
  },
  {
    title: 'Счёт-подвеска для демо-денег',
    meta: 'taxi.demo.seed, создаётся идемпотентно',
    right: <Badge tone="success">есть</Badge>,
  },
  {
    title: 'Сквозные сценарии',
    meta: 'e2e-driver-duty, e2e-dispatch, smoke-test',
    right: <Badge tone="success">есть</Badge>,
  },
  {
    title: 'Сброс демо-данных',
    meta: 'сегодня dev-down и init-скрипты Postgres',
    right: <Badge tone="danger">в плане</Badge>,
  },
];

export default function Ops15Dictionaries() {
  return (
    <>
      <div className="flex flex-none items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[15px] font-bold tracking-tight text-ink-900">Справочники и демо-данные</div>
          <div className="truncate text-[12px] text-ink-500">
            Города, категории, услуги · демо-пополнение, парк машин и сброс
          </div>
        </div>
        <div className="flex flex-none items-center gap-2">
          <Badge tone="brand">пилот: Шымкент</Badge>
          <Badge tone="neutral">план</Badge>
        </div>
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-2 gap-3">
        <ConsolePanel title="Справочники" right={<span className="text-[11px] font-medium text-brand-600">Добавить запись</span>}>
          <ConsoleRows items={DICTIONARIES} />
          <div className="mt-2 text-[11px] text-ink-500">
            Справочники показывают то, что уже отдаётся чтением; редактирования нет. Предлагаемые ручки:{' '}
            <span className="font-mono">GET/PUT /api/v1/admin/dictionaries/{'{kind}'}</span>.
          </div>
        </ConsolePanel>

        <ConsolePanel title="Демо-данные" right={<Badge tone="neutral">работает скриптами</Badge>}>
          <ConsoleRows items={DEMO} />
          <div className="mt-2 flex flex-col gap-2">
            <span className="rounded-xl bg-white px-3 py-2 text-center text-[12px] font-medium text-ink-700 ring-1 ring-ink-200">
              Пополнить демо-счёт
            </span>
            <span className="rounded-xl bg-ink-100 px-3 py-2 text-center text-[12px] font-medium text-ink-400">
              Сбросить демо-данные · выключено
            </span>
          </div>
          <div className="mt-2 text-[11px] text-ink-500">
            Сброс — необратимое действие, поэтому кнопка выключена до появления ручки и подтверждения вводом слова:{' '}
            <span className="font-mono">POST /api/v1/admin/demo/reset</span>.
          </div>
        </ConsolePanel>
      </div>

      <Notice tone="warning">
        <b>Экрана нет — есть только то, что работает рядом.</b> Справочника городов и услуг в коде не существует:
        Шымкент зашит в демо-данные, а «демо» живёт скриптами. Пополнение, парк машин и счёт-подвеска помечены как
        реально работающие, всё остальное на этом экране — проект.
      </Notice>
    </>
  );
}
