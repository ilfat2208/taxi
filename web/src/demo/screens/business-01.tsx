/**
 * ORTA Business · Обзор — первый экран смены.
 *
 * Статус на борде «В работе», и это главное про макет: сводного эндпоинта нет ни в
 * одном сервисе. KPI и график можно собрать только на клиенте, страницей запросов,
 * поэтому низ экрана прямо говорит об этом, а числа остаются демонстрационными.
 *
 * Правило экрана, взятое с борда: «одного экрана утром» — сначала то, что стоит
 * денег или клиента (список «что требует внимания»), потом графики.
 */
import { Badge } from '../../components/ui/Badge';
import { cx } from '../../lib/cx';
import { ConsolePanel, ConsoleRows, Notice } from '../kit';

/** Четыре показателя смены. Собраны из ответов разных сервисов — сводки нет. */
const KPIS = [
  { label: 'Выручка за неделю', value: '1 302 920 ₸', hint: '+12,4% к 21–27.09' },
  { label: 'Заказы', value: '96', hint: '88 оплачено · 5 отменено' },
  { label: 'Средний чек', value: '13 572 ₸', hint: 'маркет 11 040 · услуги 17 900' },
  { label: 'Возвраты', value: '2 · 9 980 ₸', hint: '0,8% от выручки' },
];

/** Высота столбцов — из макета борда; последний день ещё не закрыт. */
const WEEK = [
  { day: '28.09', height: 74 },
  { day: '29.09', height: 90 },
  { day: '30.09', height: 83 },
  { day: '01.10', height: 94 },
  { day: '02.10', height: 109 },
  { day: '03.10', height: 87 },
  { day: '04.10', height: 36, open: true },
];

const CHANNELS = [
  { name: 'Маркет — товары', value: '861 500,00 ₸ · 66%', width: '66%', tone: 'bg-brand-500' },
  { name: 'Услуги и записи, QTime', value: '441 420,00 ₸ · 34%', width: '34%', tone: 'bg-success-500' },
  { name: 'Доставка', value: '0,00 ₸ · самовывоз', width: '0%', tone: 'bg-ink-300' },
];

/** Список «что требует внимания»: каждое правило опирается на работающий контур. */
const ATTENTION = [
  { title: 'Заказ ORD-241003-8F3K', meta: 'не подтверждён 4 ч 12 мин', right: 'просрочен', tone: 'danger' as const },
  { title: 'Долг 46 400,00 ₸ · PENDING', meta: 'счёт для выплат не указан', right: 'нет счёта', tone: 'warning' as const },
  { title: 'Powerbank 20 000 мА·ч', meta: 'остаток 2 шт при минимуме 5', right: '2 шт', tone: 'warning' as const },
  { title: 'Записи на 04.10 без отметки визита', meta: 'висят в CONFIRMED, день закрыт', right: '2', tone: 'neutral' as const },
  { title: 'Отзыв 2★ без ответа', meta: 'ждёт ответа продавца', right: '2 дня', tone: 'neutral' as const },
  { title: 'Касса не подключена к ОФД', meta: 'чеки нефискальные', right: 'план', tone: 'neutral' as const },
];

export default function Business01() {
  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      <div className="flex flex-none items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[16px] font-bold text-ink-900">Обзор</div>
          <div className="truncate text-[12px] text-ink-500">
            Неделя 28.09–04.10.2026 · маркет и услуги · данные на 04.10, 09:44
          </div>
        </div>
        <div className="flex flex-none items-center gap-2">
          <span className="flex rounded-full bg-ink-100 p-0.5 text-[12px]">
            <span className="rounded-full bg-white px-3 py-1 font-medium text-ink-900 shadow-sm">Неделя</span>
            <span className="px-3 py-1 text-ink-500">Месяц</span>
            <span className="px-3 py-1 text-ink-500">Смена</span>
          </span>
          <span className="rounded-full border border-ink-200 bg-white px-3 py-1.5 text-[12px] text-ink-700">Экспорт</span>
        </div>
      </div>

      <div className="grid flex-none grid-cols-4 gap-3">
        {KPIS.map((kpi) => (
          <div key={kpi.label} className="rounded-2xl border border-ink-200 bg-white p-3">
            <div className="truncate text-[11px] text-ink-500">{kpi.label}</div>
            <div className="mt-1 text-[15px] font-bold tabular-nums text-ink-900">{kpi.value}</div>
            <div className="mt-0.5 truncate text-[11px] text-ink-400" title={kpi.hint}>
              {kpi.hint}
            </div>
          </div>
        ))}
      </div>

      <div className="flex min-h-0 flex-1 gap-3">
        <div className="flex min-h-0 flex-1 flex-col gap-3">
          <ConsolePanel
            title="Выручка по дням"
            right={<span className="text-[11px] text-ink-400">столбцы — выручка дня, линия — прошлая неделя</span>}
            className="min-h-0"
          >
            <div className="flex items-end justify-between" style={{ height: 112 }}>
              {WEEK.map((bar) => (
                <div key={bar.day} className="flex w-[46px] items-end justify-center">
                  <span
                    className={cx('block w-full rounded-t', bar.open ? 'bg-brand-300' : 'bg-brand-500')}
                    style={{ height: bar.height }}
                  />
                </div>
              ))}
            </div>
            <div className="flex justify-between border-t border-ink-200 pt-1">
              {WEEK.map((bar) => (
                <span key={bar.day} className="w-[46px] text-center text-[10px] text-ink-500">
                  {bar.day}
                </span>
              ))}
            </div>
            <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-ink-500">
              <span className="flex items-center gap-1">
                <span className="inline-block h-2 w-2 rounded-sm bg-brand-500" />
                Выручка дня
              </span>
              <span className="flex items-center gap-1">
                <span className="inline-block h-2 w-2 rounded-sm bg-brand-300" />
                Текущий день, смена не закрыта
              </span>
              <span className="flex items-center gap-1">
                <span className="inline-block h-2 w-2 rounded-sm bg-ink-400" />
                21–27.09
              </span>
              <span className="flex items-center gap-1">
                <span className="inline-block h-2 w-2 rounded-sm bg-ink-100" />
                Максимум недели — 248 700 ₸, пятница
              </span>
            </div>
          </ConsolePanel>

          <ConsolePanel
            title="Каналы продаж"
            right={<span className="text-[11px] text-ink-400">выручка без комиссии платформы</span>}
            className="flex-none"
          >
            <div className="space-y-2">
              {CHANNELS.map((channel) => (
                <div key={channel.name}>
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="truncate text-[12.5px] text-ink-600">{channel.name}</span>
                    <span className="flex-none text-[12.5px] font-medium tabular-nums text-ink-900">{channel.value}</span>
                  </div>
                  <div className="mt-1 h-1.5 rounded-full bg-ink-100">
                    <div className={cx('h-1.5 rounded-full', channel.tone)} style={{ width: channel.width }} />
                  </div>
                </div>
              ))}
            </div>
          </ConsolePanel>
        </div>

        <ConsolePanel
          title="Что требует внимания"
          right={<Badge tone="danger">6</Badge>}
          className="flex w-[300px] flex-none flex-col overflow-hidden"
        >
          <ConsoleRows
            items={ATTENTION.map((item) => ({
              title: item.title,
              meta: item.meta,
              right: <Badge tone={item.tone}>{item.right}</Badge>,
            }))}
          />
          <div className="mt-2 border-t border-ink-100 pt-2">
            <Notice tone="warning">
              Сводного эндпоинта нет: KPI и этот список собираются на клиенте из <code>order-service</code>,{' '}
              <code>payment-service</code>, <code>catalog-service</code> и <code>qtime-service</code>. Предлагается{' '}
              <code>GET /api/v1/analytics/merchant/summary</code>.
            </Notice>
          </div>
        </ConsolePanel>
      </div>
    </div>
  );
}
