/**
 * ORTA Business · Записи и расписание — мастера и окна.
 *
 * Статус на борде «В работе»: ядро записи работает. Сетка окон приходит из
 * GET /api/v1/qtime/specialists/{id}/slots?serviceId&date, отмена —
 * POST /api/v1/qtime/bookings/{id}/cancel (окно освобождается сразу), завершение
 * визита — POST /api/v1/qtime/internal/bookings/{id}/complete, и в документации
 * он прямо назван «для кабинета ORTA Business».
 *
 * Честно: сводки по мастерам и загрузке нет, привязки мерчанта к компании нет, и
 * пока её нет, роль MERCHANT может отменить любую запись, не только свою. Поэтому
 * «Перенести» нарисована неактивной, а «отметить визит» и «отменить» — рабочими.
 */
import { Badge } from '../../components/ui/Badge';
import { cx } from '../../lib/cx';
import { ConsolePanel, ConsoleRows, Notice, Row } from '../kit';

/** Загрузка дня одной строкой: два ряда в узкой панели выталкивали список записей. */
const MASTERS = [
  { name: 'Айгуль С. · маникюр', load: '4 из 6 окон · 67% · 4,8' },
  { name: 'Динара К. · педикюр', load: '3 из 5 окон · 60% · 4,7' },
  { name: 'Мадина А. · парикмахер', load: '3 из 4 окон · 75% · 4,9' },
  { name: 'Ержан С. · барбер', load: '1 из 2 окон · 50% · 4,6' },
];

const BOOKINGS = [
  { slot: '09:00–10:00', client: 'Алия Нурлановна', meta: 'Маникюр · Айгуль С. · 6 000,00 ₸' },
  { slot: '10:00–11:30', client: 'Асель Жумабаева', meta: 'Педикюр · Динара К. · 8 500,00 ₸' },
  { slot: '12:00–12:45', client: 'Мадина Ахметова', meta: 'Стрижка · Мадина А. · 5 000,00 ₸' },
  { slot: '14:00–15:30', client: 'Тимур Оспанов', meta: 'Окрашивание · Мадина А. · 18 000,00 ₸' },
];

const SLOTS = [
  { time: '11:00', state: 'free' },
  { time: '12:00', state: 'busy' },
  { time: '13:00', state: 'break' },
  { time: '15:00', state: 'busy' },
  { time: '17:00', state: 'free' },
  { time: '18:00', state: 'free' },
] as const;

const SLOT_CLASS: Record<(typeof SLOTS)[number]['state'], string> = {
  free: 'bg-success-50 text-success-700 ring-emerald-200',
  busy: 'bg-ink-100 text-ink-400 ring-ink-200',
  break: 'bg-warning-50 text-warning-700 ring-amber-200',
};

export default function Business12() {
  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      <div className="flex flex-none items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[16px] font-bold text-ink-900">Записи и расписание</div>
          <div className="truncate text-[12px] text-ink-500">
            05.10.2026 · 4 мастера · 17 рабочих окон · 11 записей · Asia/Almaty
          </div>
        </div>
        <div className="flex flex-none items-center gap-2">
          <span className="flex rounded-full bg-ink-100 p-0.5 text-[12px]">
            <span className="rounded-full bg-white px-3 py-1 font-medium text-ink-900 shadow-sm">День</span>
            <span className="px-3 py-1 text-ink-500">Неделя</span>
          </span>
          <span className="rounded-full border border-ink-200 bg-white px-3 py-1.5 text-[12px] text-ink-700">
            Открыть сетку
          </span>
        </div>
      </div>

      <div className="flex min-h-0 flex-1 gap-3">
        <div className="flex min-h-0 flex-1 flex-col gap-3">
          <ConsolePanel
            title="Мастера и загрузка"
            right={<span className="text-[11px] text-ink-400">записи / рабочие окна дня</span>}
            className="flex-none"
          >
            <ConsoleRows
              items={MASTERS.map((master) => ({
                title: master.name,
                right: <span className="text-[12px] tabular-nums text-ink-700">{master.load}</span>,
              }))}
            />
          </ConsolePanel>

          <ConsolePanel
            title="Записи на 05.10"
            right={<span className="text-[11px] text-ink-400">отмена освобождает окно сразу</span>}
            className="min-h-0 flex-1 overflow-hidden"
          >
            <ConsoleRows
              items={BOOKINGS.map((booking) => ({
                title: `${booking.slot} · ${booking.client}`,
                meta: booking.meta,
                right: <Badge tone="info">CONFIRMED</Badge>,
              }))}
            />
            <div className="mt-2 flex items-center gap-2 border-t border-ink-100 pt-2">
              <span className="rounded-full border border-ink-200 bg-white px-3 py-1.5 text-[12px] text-ink-700">
                Отметить визит
              </span>
              <span className="rounded-full bg-ink-100 px-3 py-1.5 text-[12px] text-ink-400">Перенести</span>
              <span className="rounded-full border border-ink-200 bg-white px-3 py-1.5 text-[12px] text-ink-700">
                Отменить
              </span>
              <span className="text-[11px] text-ink-400">эндпоинта переноса в QTime нет</span>
            </div>
          </ConsolePanel>
        </div>

        <div className="flex w-[320px] flex-none flex-col gap-3">
          <ConsolePanel title="Правила окон" className="flex-none">
            <Row label="Шаг сетки" value="30 мин" />
            <Row label="Рабочий день" value="09:00–19:00" />
            <Row label="Перерыв" value="13:00–14:00" />
            <Row label="Часовой пояс" value="Asia/Almaty" />
            <div className="mt-3 grid grid-cols-3 gap-2">
              {SLOTS.map((slot) => (
                <span
                  key={slot.time}
                  className={cx(
                    'rounded-lg px-2 py-1.5 text-center text-[12px] tabular-nums ring-1 ring-inset',
                    SLOT_CLASS[slot.state],
                  )}
                >
                  {slot.time}
                </span>
              ))}
            </div>
            <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-ink-500">
              <span className="flex items-center gap-1">
                <span className="inline-block h-2 w-2 rounded-sm bg-success-500" />
                свободно
              </span>
              <span className="flex items-center gap-1">
                <span className="inline-block h-2 w-2 rounded-sm bg-ink-300" />
                занято
              </span>
              <span className="flex items-center gap-1">
                <span className="inline-block h-2 w-2 rounded-sm bg-warning-500" />
                перерыв
              </span>
            </div>
          </ConsolePanel>

          <Notice tone="info">
            Занятое окно возвращается с <code>available:false</code> и причиной; пересечение считается по интервалам,
            поэтому услуга на 90 минут не влезает в полчаса до перерыва.
          </Notice>

          <Notice tone="danger">
            Дыра, которую нужно закрыть до кабинета: связь «мерчант ↔ компания» в QTime не смоделирована — компании
            приходят из каталога вертикали, привязки к аккаунту нет. Пока её нет, роль MERCHANT может отменить любую
            запись, не только свою (это записано и в коде: <code>QtimeAccess</code>). Сводки по мастерам тоже нет.
          </Notice>
        </div>
      </div>
    </div>
  );
}
