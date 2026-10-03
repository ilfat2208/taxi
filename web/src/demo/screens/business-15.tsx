/**
 * ORTA Business · Настройки: точки, часы работы, фискализация, интеграции.
 *
 * Статус на борде «В работе»: часть данных уже существует — адрес и координаты
 * компании живут в QTime (GET /api/v1/qtime/companies/{companyId}), рабочее время и
 * перерывы учитываются при расчёте окон (422 OUTSIDE_WORKING_HOURS), выплаты
 * подключаются через PATCH /api/v1/merchants/me/payout-account.
 *
 * Честно не сделано: интерфейса настроек нет, ОФД и ККМ не подключены и чеки
 * нефискальные, мультиточечность, налоги, API-ключи и вебхуки — план. Поэтому
 * «Добавить точку», «Отозвать» и «Сохранить» не изображают работу.
 */
import { Badge } from '../../components/ui/Badge';
import { ConsolePanel, ConsoleRows, Notice, Row } from '../kit';

const POINTS = [
  { title: '«Республики 12»', meta: 'основная точка · пр. Республики 12 · 09:00–19:00', state: 'активна', tone: 'success' as const },
  { title: '«Мега»', meta: 'точка выдачи · ТРЦ Mega · 10:00–21:00', state: 'активна', tone: 'success' as const },
  { title: '«Доставка по городу»', meta: 'курьерская зона · радиус 8 км от центра', state: 'план', tone: 'neutral' as const },
];

const INTEGRATIONS = [
  { title: 'QTime — расписание и записи', meta: 'чтение и отмена', state: 'подключено', tone: 'success' as const },
  { title: 'ORTA Pay — выплаты на счёт', meta: 'расчёты и события', state: 'подключено', tone: 'success' as const },
  { title: 'ORTA Map, 1С, вебхуки', meta: 'интеграций нет', state: 'план', tone: 'neutral' as const },
];

export default function Business15() {
  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      <div className="flex flex-none items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-[16px] font-bold text-ink-900">Настройки</span>
            <Badge tone="warning">3 блока не настроены</Badge>
          </div>
          <div className="truncate text-[12px] text-ink-500">
            Точки и адреса · часы работы · налоги и фискализация · интеграции и API-ключи
          </div>
        </div>
        <div className="flex flex-none items-center gap-2">
          <span className="rounded-full border border-ink-200 bg-white px-3 py-1.5 text-[12px] text-ink-700">Проверить</span>
          <span className="rounded-full bg-brand-500 px-3.5 py-1.5 text-[12px] font-medium text-white">Сохранить</span>
        </div>
      </div>

      <div className="flex min-h-0 flex-1 gap-3">
        <div className="flex min-h-0 flex-1 flex-col gap-3">
          <ConsolePanel
            title="Точки и адреса"
            right={<span className="rounded-full bg-ink-100 px-3 py-1 text-[11.5px] text-ink-400">Добавить точку</span>}
            className="flex-none"
          >
            <ConsoleRows
              items={POINTS.map((point) => ({
                title: point.title,
                meta: point.meta,
                right: <Badge tone={point.tone}>{point.state}</Badge>,
              }))}
            />
            <p className="mt-2 text-[11px] text-ink-500">
              Координаты 42.31784, 69.59215 и 42.34990, 69.59010 — то, что видит клиент в компании QTime (
              <code>address</code>, <code>lat</code>, <code>lon</code>): без них точка не показывается на карте. Геозона
              доставки не сделана — точка есть только на бумаге.
            </p>
          </ConsolePanel>

          <ConsolePanel
            title="Часы работы и запись"
            right={<span className="text-[11px] text-ink-400">влияет на сетку окон QTime</span>}
            className="min-h-0 flex-1 overflow-hidden"
          >
            <Row label="Понедельник — пятница" value="09:00–19:00" />
            <Row label="Суббота" value="10:00–16:00" />
            <Row label="Воскресенье" value={<span className="text-ink-400">закрыто</span>} />
            <Row label="Шаг сетки записи" value="30 мин" />
            <Row label="Часовой пояс" value="Asia/Almaty" />
            <div className="mt-2">
              <Notice tone="info">
                Запись вне рабочих часов или в перерыв QTime уже отклоняет кодом <code>422 OUTSIDE_WORKING_HOURS</code> —
                кабинет обязан предупредить об этом до сохранения, а не после.
              </Notice>
            </div>
          </ConsolePanel>
        </div>

        <div className="flex w-[320px] flex-none flex-col gap-3">
          <ConsolePanel
            title="Налоги и фискализация"
            right={<Badge tone="warning">не настроено</Badge>}
            className="flex-none"
          >
            <Row label="Налоговый режим" value="упрощёнка, без НДС" />
            <Row label="ОФД" value={<span className="text-ink-400">не подключён</span>} />
            <Row label="ККМ / виртуальная касса" value={<span className="text-ink-400">не подключена</span>} />
            <Row label="Чеки покупателю" value={<span className="text-ink-400">нефискальные</span>} />
            <Row label="Комиссия платформы 1,5%" value="правило платформы, не настройка" />
          </ConsolePanel>

          <ConsolePanel
            title="Интеграции и API-ключи"
            right={<span className="text-[11px] text-ink-400">доступ — только по JWT</span>}
            className="min-h-0 flex-1 overflow-hidden"
          >
            <ConsoleRows
              items={INTEGRATIONS.map((integration) => ({
                title: integration.title,
                meta: integration.meta,
                right: <Badge tone={integration.tone}>{integration.state}</Badge>,
              }))}
            />
            <div className="mt-2 flex items-center justify-between gap-3 rounded-xl bg-ink-50 px-3 py-2">
              <span className="min-w-0">
                <span className="block truncate font-mono text-[12px] text-ink-700">orta_live_sk_7f3k…c1</span>
                <span className="block text-[11px] text-ink-500">только чтение · выдан 12.09.2026</span>
              </span>
              <span className="flex-none rounded-full bg-ink-100 px-3 py-1 text-[11.5px] text-ink-400">Отозвать</span>
            </div>
            <div className="mt-2">
              <Notice tone="warning">
                API-ключей в платформе нет: интеграции ходят по JWT с ролью MERCHANT. Мультиточечность, налоги и
                вебхуки — план.
              </Notice>
            </div>
          </ConsolePanel>
        </div>
      </div>
    </div>
  );
}
