/**
 * crm-03 · Календарь недели — загрузка.
 *
 * Матрица «мастер × день»: записи, загрузка, свободные окна и исключения расписания.
 * Честная деталь: недельного запроса в контракте нет — сетка отвечает за один день и
 * одну услугу, поэтому такая неделя для трёх мастеров салона это минимум 21 запрос.
 * Пустая клетка «выходной» — не ошибка, а отсутствие строки в рабочем шаблоне.
 */
import { cx } from '../../lib/cx';
import { ConsolePanel, Kpis, Notice } from '../kit';

const DAYS = ['пн 5', 'вт 6', 'ср 7', 'чт 8', 'пт 9', 'сб 10', 'вс 11'];

type Cell =
  | { kind: 'load'; bookings: number; percent: number; free: number; tight?: boolean }
  | { kind: 'vacation'; bookings: number }
  | { kind: 'shift'; from: string; to: string }
  | { kind: 'off' };

interface Row {
  name: string;
  meta: string;
  cells: Cell[];
}

const ROWS: Row[] = [
  {
    name: 'Айгуль Смагулова',
    meta: 'мастер маникюра · 4,90',
    cells: [
      { kind: 'vacation', bookings: 2 },
      { kind: 'load', bookings: 5, percent: 62, free: 8 },
      { kind: 'load', bookings: 6, percent: 74, free: 6 },
      { kind: 'load', bookings: 4, percent: 48, free: 11 },
      { kind: 'load', bookings: 7, percent: 88, free: 3 },
      { kind: 'load', bookings: 5, percent: 66, free: 7 },
      { kind: 'off' },
    ],
  },
  {
    name: 'Динара Ахметова',
    meta: 'парикмахер-стилист · 4,82',
    cells: [
      { kind: 'load', bookings: 6, percent: 70, free: 7 },
      { kind: 'load', bookings: 5, percent: 58, free: 9 },
      { kind: 'load', bookings: 8, percent: 94, free: 2, tight: true },
      { kind: 'load', bookings: 4, percent: 46, free: 12 },
      { kind: 'load', bookings: 7, percent: 84, free: 4 },
      { kind: 'load', bookings: 6, percent: 72, free: 6 },
      { kind: 'off' },
    ],
  },
  {
    name: 'Жанар Оспанова',
    meta: 'косметолог · 4,75',
    cells: [
      { kind: 'load', bookings: 4, percent: 44, free: 11 },
      { kind: 'load', bookings: 5, percent: 56, free: 9 },
      { kind: 'load', bookings: 3, percent: 32, free: 13 },
      { kind: 'load', bookings: 6, percent: 68, free: 7 },
      { kind: 'load', bookings: 2, percent: 24, free: 15 },
      { kind: 'shift', from: '12:00', to: '16:00' },
      { kind: 'off' },
    ],
  },
];

export default function CrmWeekLoad() {
  return (
    <>
      <div className="flex items-center gap-2">
        <span className="rounded-full bg-white px-3 py-1.5 text-[12px] text-ink-600 ring-1 ring-ink-200">‹ пред.</span>
        <span className="rounded-full bg-brand-500 px-3 py-1.5 text-[12px] font-medium text-white">5–11 окт</span>
        <span className="rounded-full bg-white px-3 py-1.5 text-[12px] text-ink-600 ring-1 ring-ink-200">след. ›</span>
        <span className="text-[11.5px] text-ink-500">Загрузка по мастерам, свободные окна и исключения · шаг 30 мин</span>
        <span className="ml-auto rounded-full bg-ink-100 px-2.5 py-1 text-[11px] text-ink-600">горизонт 30 дней</span>
      </div>

      <Kpis
        items={[
          { label: 'Записей за неделю', value: '62', hint: 'CONFIRMED и COMPLETED' },
          { label: 'Загрузка салона', value: '71%', hint: 'считается на клиенте' },
          { label: 'Свободных окон', value: '96', hint: 'кроме выходных и отпуска' },
        ]}
      />

      <ConsolePanel
        title="Мастер × день"
        right={<span className="text-[11px] text-ink-500">в клетке: записей · загрузка · свободных окон · исключение</span>}
      >
        <div className="overflow-hidden rounded-xl border border-ink-200">
          <div
            className="grid border-b border-ink-200 bg-ink-50"
            style={{ gridTemplateColumns: '150px repeat(7, minmax(0, 1fr))' }}
          >
            <div className="px-2 py-1.5 text-[10px] uppercase tracking-wide text-ink-500">мастер</div>
            {DAYS.map((day) => (
              <div key={day} className="border-l border-ink-100 px-2 py-1.5 text-[10px] uppercase tracking-wide text-ink-500">
                {day}
              </div>
            ))}
          </div>

          {ROWS.map((row) => (
            <div
              key={row.name}
              className="grid border-b border-ink-100 last:border-0"
              style={{ gridTemplateColumns: '150px repeat(7, minmax(0, 1fr))' }}
            >
              <div className="px-2 py-2">
                <div className="truncate text-[12px] font-semibold text-ink-800">{row.name}</div>
                <div className="truncate text-[10.5px] text-ink-500">{row.meta}</div>
              </div>
              {row.cells.map((cell, index) => (
                <div
                  key={`${row.name}-${DAYS[index]}`}
                  className={cx(
                    'border-l border-ink-100 px-2 py-2',
                    cell.kind === 'vacation' && 'bg-warning-50',
                    cell.kind === 'shift' && 'bg-brand-50',
                    cell.kind === 'off' && 'bg-ink-50',
                  )}
                >
                  {cell.kind === 'load' ? (
                    <>
                      <div className="text-[11px] font-semibold text-ink-800">{cell.bookings} записей</div>
                      <div className="mt-1 h-1.5 rounded-full bg-ink-100">
                        <div
                          className={cx('h-full rounded-full', cell.percent >= 90 ? 'bg-warning-500' : 'bg-brand-500')}
                          style={{ width: `${cell.percent}%` }}
                        />
                      </div>
                      <div className={cx('mt-1 text-[10.5px]', cell.tight ? 'text-warning-700' : 'text-ink-500')}>
                        свободно {cell.free}
                      </div>
                    </>
                  ) : null}
                  {cell.kind === 'vacation' ? (
                    <>
                      <div className="text-[11px] font-semibold text-warning-700">отпуск</div>
                      <div className="text-[10.5px] text-ink-500">{cell.bookings} записи висят</div>
                    </>
                  ) : null}
                  {cell.kind === 'shift' ? (
                    <>
                      <div className="text-[11px] font-semibold text-brand-600">доп. смена</div>
                      <div className="text-[10.5px] text-ink-500">
                        {cell.from}–{cell.to}
                      </div>
                    </>
                  ) : null}
                  {cell.kind === 'off' ? (
                    <>
                      <div className="text-[11px] font-semibold text-ink-500">выходной</div>
                      <div className="text-[10.5px] text-ink-400">строки нет в шаблоне</div>
                    </>
                  ) : null}
                </div>
              ))}
            </div>
          ))}
        </div>
      </ConsolePanel>

      <div className="grid grid-cols-2 gap-3">
        <Notice tone="warning">
          <b>Недельного запроса нет.</b> День для трёх мастеров — это 21 запрос сетки, для 12 мастеров демо-базы — 84,
          поэтому неделя считается на клиенте. Предлагается{' '}
          <code className="rounded bg-black/5 px-1 font-mono text-[11px]">GET /companies/&#123;id&#125;/load?from=&amp;to=</code>.
        </Notice>
        <Notice tone="neutral">
          За 30-й день сетка закрыта: горизонт записи 30 дней —
          это параметр сервиса (<code className="rounded bg-black/5 px-1 font-mono text-[11px]">bookingHorizonDays</code>),
          а не настройка салона. «Отпуск» и «доп. смена» в клетках — исключения расписания.
        </Notice>
      </div>
    </>
  );
}
