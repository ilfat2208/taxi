/**
 * ORTA Services — выбор даты и окна (Ф2: раздел работает).
 *
 * Сетку даёт `GET /api/v1/qtime/specialists/{id}/slots?serviceId=&date=`:
 * длительность, часовой пояс и массив окон с `available` и `reason` — занятые
 * окна приходят тоже, иначе сетку не нарисовать.
 *
 * Правила видны прямо в сетке: окно = рабочее время минус перерыв, минус
 * подтверждённые записи по пересечению интервалов, минус прошедшее время.
 * Поэтому 12:00 нет (90 минут не влезают до обеда), 19:30 нет (конец после
 * 20:00), 13:00 — перерыв.
 *
 * Чего ещё нет: удержания окна на время выбора. Контракт знает только «одно окно —
 * одна запись» и <code>409 SLOT_TAKEN</code> при гонке, поэтому экран честно
 * предупреждает, а не обещает холд.
 */
import { Badge } from '../../components/ui/Badge';
import { cx } from '../../lib/cx';
import { Notice, PhoneAppBar, PhoneBody, PhoneCard } from '../kit';

/** Свободные, занятые и перерыв: `available: false` плюс причина. */
const SLOTS: Array<{ time: string; state: 'free' | 'busy' | 'on' }> = [
  { time: '09:00', state: 'free' },
  { time: '10:30', state: 'busy' },
  { time: '11:30', state: 'busy' },
  { time: '13:00', state: 'busy' },
  { time: '14:00', state: 'free' },
  { time: '15:30', state: 'on' },
  { time: '16:00', state: 'free' },
  { time: '17:30', state: 'free' },
  { time: '19:00', state: 'free' },
];

export default function ServicesHealth04() {
  return (
    <>
      <PhoneAppBar title="Шаг 3. Свободное окно" subtitle="Айгуль · Маникюр с покрытием · 90 мин" back />
      <PhoneBody>
        <div className="flex gap-2">
          {['Сегодня', 'Пт, 3 окт', 'Сб, 4 окт', 'Пн, 6 окт'].map((day) => (
            <span
              key={day}
              className={cx(
                'rounded-full px-3 py-1.5 text-[12px]',
                day === 'Пт, 3 окт' ? 'bg-brand-500 text-white' : 'bg-ink-100 text-ink-600',
              )}
            >
              {day}
            </span>
          ))}
        </div>

        <PhoneCard title="Пятница, 3 октября" right={<Badge tone="brand">Asia/Almaty</Badge>}>
          <div className="grid grid-cols-3 gap-2">
            {SLOTS.map((slot) => (
              <span
                key={slot.time}
                className={cx(
                  'rounded-lg py-1.5 text-center text-[12px] ring-1 ring-inset',
                  slot.state === 'on' && 'bg-brand-500 font-semibold text-white ring-brand-500',
                  slot.state === 'busy' && 'bg-ink-100 text-ink-400 line-through ring-ink-200',
                  slot.state === 'free' && 'bg-white text-ink-800 ring-ink-200',
                )}
              >
                {slot.time}
              </span>
            ))}
          </div>
          <p className="mt-2 text-[11px] text-ink-500">
            Зачёркнутые — <code>available: false</code>: 10:30 и 11:30 заняты, 13:00 — обед. 12:00 нет (90
            минут не влезают до перерыва), 19:30 нет (конец после 20:00).
          </p>
        </PhoneCard>

        <Notice>
          <b>Окно не «держится» за вами.</b> Пока вы выбираете, время свободно для всех: временного
          бронирования в контракте нет, поэтому гонку закрывает ответ <code>409 SLOT_TAKEN</code>, а не
          вторая запись на то же время.
        </Notice>

        <Notice tone="info">
          Окно = рабочее время минус перерыв, минус подтверждённые записи по пересечению интервалов, минус
          прошедшее время. Перерыв 13:00–14:00 — из <code>qtime.working_hours</code>.
        </Notice>

        <div className="mt-auto rounded-xl bg-brand-500 py-3 text-center text-[13px] font-semibold text-white">
          Продолжить · 15:30
        </div>
      </PhoneBody>
    </>
  );
}
