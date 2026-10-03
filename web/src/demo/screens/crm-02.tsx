/**
 * crm-02 · Перенос и быстрые действия.
 *
 * Свободные клетки справа — то, что реально отдаёт сетка окон (`available: false` с
 * причиной), поэтому окно ищется по данным, а не на глазок. Самого переноса нет: в
 * агрегате есть только cancel, complete и markNoShow, эндпоинта reschedule нет.
 * Экран показывает перенос как предложение и прямо называет цену сегодняшнего обхода:
 * отмена плюс новая запись — два события и разорванная связь между ними.
 */
import { Badge } from '../../components/ui/Badge';
import { cx } from '../../lib/cx';
import { ConsolePanel, Notice, Row } from '../kit';

const DAY_START_MINUTES = 10 * 60;
const SLOT_PX = 16;
const HOURS = ['10:00', '11:00', '12:00', '13:00', '14:00', '15:00', '16:00', '17:00'];
const SLOTS = 16; // 10:00–18:00

interface Block {
  start: string;
  minutes: number;
  title: string;
  meta: string;
  state?: 'moving' | 'cancelled' | 'free';
}

const BLOCKS: Block[] = [
  { start: '10:30', minutes: 120, title: 'Окрашивание в один тон', meta: '10:30–12:30 · переносится · 15 000 ₸', state: 'moving' },
  { start: '13:00', minutes: 120, title: 'Укладка волос · отменена', meta: 'окно освободилось сразу · CANCELLED_BY_CLIENT', state: 'cancelled' },
  { start: '15:00', minutes: 60, title: 'свободно 15:00–16:00 · 60 мин', meta: 'короче услуги', state: 'free' },
  { start: '16:00', minutes: 120, title: 'свободно 16:00–18:00 · 120 мин подойдёт', meta: 'клетки из ответа сетки', state: 'free' },
];

function toMinutes(time: string) {
  return Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5));
}

const topOf = (start: string) => ((toMinutes(start) - DAY_START_MINUTES) / 30) * SLOT_PX;
const heightOf = (minutes: number) => (minutes / 30) * SLOT_PX;

export default function CrmReschedule() {
  return (
    <>
      <div className="flex items-center gap-2">
        <div className="min-w-0">
          <div className="truncate text-[13px] font-semibold text-ink-900">Окрашивание в один тон · Динара Ахметова</div>
          <div className="truncate text-[11.5px] text-ink-500">
            QT-8F3J7P · 10:30–12:30 · 120 мин · 15 000 ₸ · окно держит частичный уникальный индекс
          </div>
        </div>
        <span className="ml-auto flex items-center gap-2">
          <Badge tone="danger">переноса нет в API</Badge>
          <span className="rounded-full bg-white px-3 py-1.5 text-[12px] text-ink-600 ring-1 ring-ink-200">Закрыть</span>
        </span>
      </div>

      <div className="grid grid-cols-[minmax(0,1fr)_320px] gap-3">
        <ConsolePanel
          title="Динара Ахметова · пятница, 2 октября"
          right={<span className="text-[11px] text-ink-500">10:00–18:00 · занято 4 окна · свободно 5</span>}
        >
          <div className="flex overflow-hidden rounded-xl border border-ink-200">
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
              <div className="absolute left-0 right-0 top-24 h-8 bg-ink-100" />
              <div className="absolute left-1 top-[100px] text-[10px] text-ink-500">перерыв 13:00–14:00</div>
              <div className="relative" style={{ height: SLOTS * SLOT_PX }}>
                {BLOCKS.map((block) => {
                  const boxHeight = heightOf(block.minutes);
                  return (
                    <div
                      key={block.start}
                      className={cx(
                        'absolute left-1 right-1 overflow-hidden rounded-lg px-1.5 py-0.5',
                        block.state === 'moving' && 'border-l-[3px] border-brand-700 bg-brand-500',
                        block.state === 'cancelled' && 'border-l-[3px] border-brand-500 bg-brand-50',
                        block.state === 'free' && 'border border-dashed border-brand-300 bg-white',
                      )}
                      style={{ top: topOf(block.start), height: boxHeight }}
                    >
                      <span
                        className={cx(
                          'block truncate text-[11px] leading-[14px] font-medium',
                          block.state === 'moving' ? 'text-white' : block.state === 'free' ? 'text-brand-600' : 'text-ink-800',
                        )}
                      >
                        {block.title}
                      </span>
                      {boxHeight >= 30 ? (
                        <span
                          className={cx(
                            'block truncate text-[10.5px] leading-[13px]',
                            block.state === 'moving' ? 'text-white' : 'text-ink-500',
                          )}
                        >
                          {block.meta}
                        </span>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </ConsolePanel>

        <ConsolePanel
          title="Перенести на 16:00"
          right={<Badge tone="warning">конфликт не проверен</Badge>}
        >
          <Row label="Новое окно" value="16:00–18:00" strong />
          <Row label="Мастер" value="Динара Ахметова" />
          <Row label="Услуга" value="Окрашивание в один тон" />
          <Row label="Длительность" value="120 мин" />
          <Row label="Цена снапшотом" value="15 000,00 ₸" />
          <Row label="Сдвиг" value="+5 ч 30 мин" />
          <div className="my-2 border-t border-ink-100" />
          <div className="rounded-xl bg-ink-50 px-2.5 py-1.5 text-[12.5px] text-ink-700">Клиент просит позже</div>
          <div className="mt-2">
            <Notice tone="danger">
              <b>Переноса нет ни в API, ни в агрегате.</b> Сегодня это отмена плюс новая запись: два события,
              разорванная связь между ними и риск, что освобождённое окно займёт другой клиент, пока салон звонит
              первому.
            </Notice>
          </div>
          <div className="mt-3 flex items-center gap-2">
            <span className="rounded-xl bg-brand-300 px-3 py-1.5 text-[12px] font-medium text-white">Перенести</span>
            <span className="rounded-xl bg-white px-3 py-1.5 text-[12px] text-ink-700 ring-1 ring-ink-200">Отмена</span>
            <span className="text-[10.5px] text-ink-400">кнопка неактивна: эндпоинта нет</span>
          </div>
        </ConsolePanel>
      </div>

      <Notice tone="neutral">
        Предлагается <code className="rounded bg-black/5 px-1 font-mono text-[11px]">POST /bookings/&#123;id&#125;/reschedule</code> —
        одно событие <code className="rounded bg-black/5 px-1 font-mono text-[11px]">booking.rescheduled</code> со старым и новым
        окном в одной транзакции. Услуга и цена при переносе не меняются: снапшот в записи остаётся тем, что клиенту назвали.
      </Notice>
    </>
  );
}
