/**
 * home-food-09 · ORTA Food — бронь столика на время.
 *
 * Что на экране: параметры брони, свободные окна на сегодня, число гостей и срок,
 * на который окно держится.
 *
 * Честно, в двух плашках: запись опирается на готовое ядро QTime — services/qtime-service
 * уже отдаёт компании, услуги, расписание и свободные окна, а запись держит база
 * (scripts/e2e-qtime.ps1, 12 шагов, включая 409 SLOT_TAKEN). Но ресторан не салон:
 * в категориях QTime есть BEAUTY, BARBERSHOP, AUTO, HEALTH, SERVICES, а столик — это
 * не специалист, а ресурс на время. Нужны новая категория и модель ресурса.
 */
import { Badge } from '../../components/ui/Badge';
import { cx } from '../../lib/cx';
import { Notice, PhoneAppBar, PhoneBody, PhoneCard, PhoneTabBar, Row } from '../kit';

const TABS = ['Home', 'Food', 'Tickets', 'Build', 'Rent'];

type SlotState = 'free' | 'taken' | 'picked';

const SLOTS: Array<{ label: string; state: SlotState }> = [
  { label: '18:00', state: 'taken' },
  { label: '18:30', state: 'free' },
  { label: '19:00', state: 'taken' },
  { label: '19:30', state: 'free' },
  { label: '20:00', state: 'picked' },
  { label: '20:30', state: 'free' },
];

const SLOT_CLASS: Record<SlotState, string> = {
  free: 'bg-ink-100 text-ink-700',
  taken: 'bg-ink-100 text-ink-400 line-through',
  picked: 'bg-brand-500 font-semibold text-white',
};

export default function HomeFood09() {
  return (
    <>
      <PhoneAppBar title="Бронь столика" subtitle="Кафе «Дастархан» · 1,4 км · открыто до 23:00" back />
      <PhoneBody>
        <div className="flex flex-wrap gap-2">
          <Badge tone="brand">Столик на 4</Badge>
          <Badge tone="brand">Сегодня</Badge>
          <Badge tone="brand">20:00</Badge>
        </div>

        <PhoneCard title="Свободные окна · сегодня" right={<Badge tone="brand">QTime</Badge>}>
          <div className="grid grid-cols-3 gap-2">
            {SLOTS.map((slot) => (
              <span key={slot.label} className={cx('rounded-lg py-1.5 text-center text-[12px]', SLOT_CLASS[slot.state])}>
                {slot.label}
              </span>
            ))}
          </div>
          <div className="mt-2 text-[11px] text-ink-500">Серые зачёркнутые окна заняты — это ответ QTime, а не картинка</div>
          <div className="mt-1">
            <Row label="Гостей" value="4 · детский стул нужен" />
            <Row label="Окно держится" value="10 минут" />
          </div>
        </PhoneCard>

        <Notice tone="info">
          Свободные окна — из готового ядра: services/qtime-service отдаёт компании, услуги, расписание и
          свободные окна, а запись держит база (409 SLOT_TAKEN на занятое окно).
        </Notice>

        <Notice tone="warning">
          Но ресторан — не салон: в категориях QTime есть BEAUTY, BARBERSHOP, AUTO, HEALTH, SERVICES, а
          заведения питания туда не входят. Столик — ресурс на время, нужна новая категория и модель ресурса.
        </Notice>

        <div className="rounded-xl bg-brand-500 px-4 py-2.5 text-center text-[13px] font-semibold text-white">
          Забронировать на 20:00
        </div>
      </PhoneBody>
      <PhoneTabBar items={TABS} active="Food" />
    </>
  );
}
