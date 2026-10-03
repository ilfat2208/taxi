/**
 * ORTA Business · Услуги и длительность (запись через QTime).
 *
 * Статус на борде «В работе»: ядро записи работает — компании отдают услуги с
 * durationMinutes, окна приходят из GET /api/v1/qtime/specialists/{id}/slots. Для
 * записи длительность не украшение: она решает, влезает ли услуга в окно.
 *
 * Честно не сделано (и это сказано на экране): управления услугами в QTime нет —
 * ни создания, ни правки, ни скрытия; связь «мерчант ↔ компания» не смоделирована,
 * поэтому «Создать услугу» нарисована неактивной.
 */
import { Badge } from '../../components/ui/Badge';
import { cx } from '../../lib/cx';
import { Chips, ConsolePanel, ConsoleRows, Notice, Row } from '../kit';

/** Пять услуг из макета: длительность, цена, мастера и состояние витрины. */
const SERVICES = [
  { title: 'Маникюр классический', meta: '60 мин · 6 000,00 ₸ · мастера: Айгуль С., Динара К.', rating: '4,8' },
  { title: 'Педикюр аппаратный', meta: '90 мин · 8 500,00 ₸ · мастер: Динара К.', rating: '4,7' },
  { title: 'Стрижка женская', meta: '45 мин · 5 000,00 ₸ · мастер: Мадина А.', rating: '4,9' },
  { title: 'Барбер-стрижка', meta: '45 мин · 4 500,00 ₸ · мастер: Ержан С.', rating: '4,6' },
  { title: 'Окрашивание в два тона', meta: '120 мин · 18 000,00 ₸ · мастер: Мадина А.', hidden: true },
];

/** Сетка дня: причина занятости приходит с окном, а не угадывается интерфейсом. */
const SLOTS = [
  { time: '09:00', state: 'free' },
  { time: '10:00', state: 'busy' },
  { time: '11:00', state: 'busy' },
  { time: '12:00', state: 'free' },
  { time: '13:00', state: 'break' },
  { time: '14:00', state: 'free' },
] as const;

const SLOT_CLASS: Record<(typeof SLOTS)[number]['state'], string> = {
  free: 'bg-success-50 text-success-700 ring-emerald-200',
  busy: 'bg-ink-100 text-ink-400 ring-ink-200',
  break: 'bg-warning-50 text-warning-700 ring-amber-200',
};

export default function Business07() {
  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      <div className="flex flex-none items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[16px] font-bold text-ink-900">Услуги</div>
          <div className="truncate text-[12px] text-ink-500">
            12 услуг · 4 мастера · 6 категорий · запись через QTime, часовой пояс Asia/Almaty
          </div>
        </div>
        <div className="flex flex-none items-center gap-2">
          <span className="rounded-full border border-ink-200 bg-white px-3 py-1.5 text-[12px] text-ink-600">
            Сетка записи: 05.10
          </span>
          <span className="rounded-full bg-ink-100 px-3 py-1.5 text-[12px] text-ink-400">Создать услугу</span>
        </div>
      </div>

      <div className="flex min-h-0 flex-1 gap-3">
        <div className="flex min-h-0 flex-1 flex-col gap-3">
          <ConsolePanel
            title="Каталог услуг"
            right={<span className="text-[11px] text-ink-400">Сортировка: по длительности</span>}
            className="min-h-0 flex-1 overflow-hidden"
          >
            <div className="flex items-center gap-2 rounded-xl border border-ink-200 bg-white px-3 py-2 text-[12px] text-ink-400">
              Название услуги или мастер
            </div>
            <div className="mt-2">
              <Chips
                items={['Все · 12', 'Активные · 11', 'Скрытые · 1', 'Без мастера · 0']}
                active="Все · 12"
              />
            </div>
            <div className="mt-3">
              <ConsoleRows
                items={SERVICES.map((service) => ({
                  title: service.title,
                  meta: service.meta,
                  right: service.hidden ? (
                    <Badge tone="warning">скрыта</Badge>
                  ) : (
                    <span className="flex-none text-[12px] tabular-nums text-ink-600">★ {service.rating}</span>
                  ),
                }))}
              />
            </div>
            <div className="mt-2">
              <Notice tone="warning">
                QTime работает, кабинета к нему нет: свободные окна, запись и отмена уже живут в{' '}
                <code>qtime-service</code>, но услуг в QTime нельзя создать или изменить — эндпоинтов управления нет, а
                связь «мерчант ↔ компания» не смоделирована. Этот экран её и предлагает.
              </Notice>
            </div>
          </ConsolePanel>
        </div>

        <div className="flex w-[300px] flex-none flex-col gap-3">
          <ConsolePanel
            title="Окна на 05.10"
            right={<span className="text-[11px] text-ink-400">мастер Айгуль С. · 60 мин</span>}
            className="flex-none"
          >
            <Row label="Шаг сетки" value="30 мин" />
            <Row label="Рабочее окно мастера" value="09:00–19:00" />
            <Row label="Перерыв" value="13:00–14:00" />
            <Row label="Запас до визита" value="15 мин" />

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
            Занятые окна приходят с <code>available:false</code> и причиной («занято», «перерыв»). Пересечение считается
            по интервалам, поэтому услуга на 90 минут не влезает в полчаса до перерыва.
          </Notice>
        </div>
      </div>
    </div>
  );
}
