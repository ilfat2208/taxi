/**
 * crm-01 · Календарь дня.
 *
 * Колонки мастеров, записи блоками с ценой из снапшота, перерыв 13:00–14:00 и линия
 * текущего времени. Сетка нарисована div'ами: шаг 30 минут — 16 px, поэтому высота
 * блока равна длительности услуги, а не подбирается на глаз.
 *
 * Честно про данные: такой ответ API сегодня не собирается. Сетка окон отвечает за
 * одного мастера и одну услугу, а MERCHANT календарь своей компании не читает вовсе,
 * поэтому «день салона» пришлось бы клеить из мастеров × услуг запросов. Демо: салон
 * «Лотос», три мастера, Шымкент.
 */
import { Badge } from '../../components/ui/Badge';
import { cx } from '../../lib/cx';
import { ConsolePanel, Kpis, Money, Notice } from '../kit';

const DAY_START_MINUTES = 9 * 60;
const SLOT_PX = 16; // получасовое окно сетки
const HOURS = ['09:00', '10:00', '11:00', '12:00', '13:00', '14:00', '15:00', '16:00', '17:00', '18:00'];

/** Пятница, шаблон пн–сб 09:00–20:00; последний визит дня заканчивается в 19:00. */
const SLOTS = 20;

interface BookingBlock {
  start: string;
  minutes: number;
  title: string;
  who?: string;
  code?: string;
  priceMinor: number;
  state?: 'now' | 'cancelled' | 'free';
}

interface MasterColumn {
  name: string;
  meta: string;
  blocks: BookingBlock[];
}

const MASTERS: MasterColumn[] = [
  {
    name: 'Айгуль Смагулова',
    meta: 'мастер маникюра · 4,90 · 6 лет · 78%',
    blocks: [
      { start: '09:30', minutes: 90, title: 'Маникюр с покрытием', who: 'Асель Н.', code: 'QT-8F3K2M', priceMinor: 450000 },
      { start: '11:30', minutes: 75, title: 'Педикюр', who: 'Мадина Т.', priceMinor: 550000 },
      { start: '14:30', minutes: 120, title: 'Наращивание ресниц', who: 'Алия Ж. · личная услуга', priceMinor: 1200000 },
      { start: '17:00', minutes: 90, title: 'Маникюр с покрытием', who: 'Гульмира С.', code: 'QT-8F3K9D', priceMinor: 450000 },
    ],
  },
  {
    name: 'Динара Ахметова',
    meta: 'парикмахер-стилист · 4,82 · 9 лет · 60%',
    blocks: [
      { start: '09:00', minutes: 60, title: 'Женская стрижка · идёт сейчас', priceMinor: 600000, state: 'now' },
      { start: '10:30', minutes: 120, title: 'Окрашивание в один тон', who: 'Айнур К.', code: 'QT-8F3J7P', priceMinor: 1500000 },
      { start: '15:00', minutes: 45, title: 'Укладка · отменена клиентом', priceMinor: 400000, state: 'cancelled' },
      { start: '16:30', minutes: 60, title: 'Женская стрижка', priceMinor: 600000 },
    ],
  },
  {
    name: 'Жанар Оспанова',
    meta: 'косметолог · 4,75 · 4 года · 55%',
    blocks: [
      { start: '10:00', minutes: 60, title: 'Чистка лица', priceMinor: 900000 },
      { start: '12:00', minutes: 45, title: 'Пилинг лица', priceMinor: 700000 },
      { start: '14:00', minutes: 60, title: 'Чистка лица', priceMinor: 900000 },
      { start: '16:00', minutes: 30, title: 'свободно 16:00 · 1 окно', priceMinor: 0, state: 'free' },
    ],
  },
];

function toMinutes(time: string) {
  return Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5));
}

const topOf = (time: string) => ((toMinutes(time) - DAY_START_MINUTES) / 30) * SLOT_PX;
const heightOf = (minutes: number) => (minutes / 30) * SLOT_PX;

export default function CrmCalendarDay() {
  return (
    <>
      <div className="flex items-center gap-2">
        <span className="rounded-full bg-white px-3 py-1.5 text-[12px] text-ink-600 ring-1 ring-ink-200">‹</span>
        <span className="rounded-full bg-brand-500 px-3 py-1.5 text-[12px] font-medium text-white">Сегодня</span>
        <span className="rounded-full bg-white px-3 py-1.5 text-[12px] text-ink-600 ring-1 ring-ink-200">›</span>
        <span className="text-[12px] text-ink-500">Пятница, 2 октября 2026 · смена 09:00–20:00 · шаг 30 мин</span>
        <span className="ml-auto rounded-full bg-info-50 px-2.5 py-1 text-[11px] text-info-700">сейчас 09:44</span>
      </div>

      <Kpis
        items={[
          { label: 'Записей на сегодня', value: '12', hint: 'из них 2 закрыто' },
          { label: 'Загрузка мастеров', value: '64%', hint: 'перерыв не считается' },
          { label: 'Свободных окон в сетке', value: '41', hint: 'шаг 30 мин' },
        ]}
      />

      <ConsolePanel
        title="Мастера салона"
        right={<Badge tone="neutral">блок — запись с ценой из снапшота</Badge>}
      >
        <div className="overflow-hidden rounded-xl border border-ink-200">
          <div className="grid border-b border-ink-200 bg-ink-50" style={{ gridTemplateColumns: '54px repeat(3, minmax(0, 1fr))' }}>
            <div className="px-2 py-1.5 text-[10px] uppercase tracking-wide text-ink-500">время</div>
            {MASTERS.map((master) => (
              <div key={master.name} className="border-l border-ink-100 px-2 py-1.5">
                <div className="truncate text-[12px] font-semibold text-ink-800">{master.name}</div>
                <div className="truncate text-[10.5px] text-ink-500">{master.meta}</div>
              </div>
            ))}
          </div>

          <div className="flex">
            <div className="w-[54px] flex-none">
              {HOURS.map((hour) => (
                <div key={hour} className="h-8 border-b border-ink-100 px-2 pt-0.5 text-[10.5px] text-ink-500">
                  {hour}
                </div>
              ))}
            </div>

            <div className="relative min-w-0 flex-1">
              <div className="pointer-events-none absolute inset-0">
                {HOURS.map((hour) => (
                  <div key={hour} className="h-8 border-b border-ink-100" />
                ))}
              </div>

              {/* 13:00–14:00: перерыв целиком внутри смены — правило рабочего шаблона */}
              <div className="absolute left-0 right-0 top-32 h-8 bg-ink-100" />
              <div className="absolute left-1 top-[132px] text-[10px] text-ink-500">перерыв</div>

              {/* текущее время: 09:44 — 23 px от начала сетки */}
              <div className="absolute left-0 right-0 top-[23px] h-0.5 bg-brand-500/80" />
              <span className="absolute right-1 top-0 z-20 rounded-full bg-brand-500 px-2 py-0.5 text-[10px] font-bold text-white">
                сейчас 09:44
              </span>

              <div className="relative flex" style={{ height: SLOTS * SLOT_PX }}>
                {MASTERS.map((master) => (
                  <div key={master.name} className="relative min-w-0 flex-1 border-l border-ink-100">
                    {master.blocks.map((block) => {
                      const boxHeight = heightOf(block.minutes);
                      return (
                        <div
                          key={`${master.name}-${block.start}`}
                          className={cx(
                            'absolute left-0.5 right-0.5 overflow-hidden rounded-lg px-1.5 py-0.5',
                            block.state === 'free' && 'border border-dashed border-brand-300 bg-white',
                            block.state === 'cancelled' && 'border border-dashed border-ink-300 bg-ink-50',
                            block.state === 'now' && 'border-l-[3px] border-success-500 bg-success-50',
                            !block.state && 'border-l-[3px] border-brand-500 bg-brand-50',
                          )}
                          style={{ top: topOf(block.start), height: boxHeight }}
                        >
                          <span
                            className={cx(
                              'block truncate text-[11px] leading-[14px] font-medium',
                              block.state === 'cancelled' ? 'text-ink-500' : 'text-ink-800',
                            )}
                          >
                            {block.title}
                          </span>
                          {boxHeight >= 30 ? (
                            <span
                              className={cx(
                                'block truncate text-[10.5px] leading-[13px]',
                                block.state === 'free' ? 'text-brand-600' : 'text-ink-500',
                              )}
                            >
                              {block.start}–{endOf(block.start, block.minutes)} · {block.minutes} мин
                              {block.priceMinor > 0 ? ' · ' : ''}
                              {block.priceMinor > 0 ? <Money minor={block.priceMinor} /> : null}
                            </span>
                          ) : null}
                          {boxHeight >= 46 && (block.who || block.code) ? (
                            <span className="block truncate text-[10.5px] leading-[13px] text-ink-500">
                              {[block.who, block.code].filter(Boolean).join(' · ')}
                            </span>
                          ) : null}
                        </div>
                      );
                    })}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </ConsolePanel>

      <Notice tone="warning">
        <b>Ответа «день компании» в API нет.</b> Сетка окон отдаёт занятые клетки с причиной, но только по одному
        мастеру и одной услуге, а роли <code className="rounded bg-black/5 px-1 font-mono text-[11px]">MERCHANT</code>{' '}
        календарь своей компании не возвращается вовсе: день пришлось бы собирать из мастеров × услуг запросов.
        Предлагается <code className="rounded bg-black/5 px-1 font-mono text-[11px]">GET /companies/&#123;id&#125;/calendar?date=</code>.
      </Notice>
    </>
  );
}

/** Конец блока: нужен только для подписи, арифметика та же, что у сетки. */
function endOf(start: string, minutes: number) {
  const total = toMinutes(start) + minutes;
  const hh = String(Math.floor(total / 60)).padStart(2, '0');
  const mm = String(total % 60).padStart(2, '0');
  return `${hh}:${mm}`;
}
