/**
 * home-food-03 · ORTA Home — заявка на просмотр.
 *
 * Что на экране: объект заявки, выбор дня, сетка свободного времени агента, контакты
 * из ORTA ID, комментарий и отправка заявки на выбранное окно.
 *
 * Честно: это заявка, а не бронь. В записи через QTime окно держит база (занятое окно
 * отдаёт 409 SLOT_TAKEN), у показа квартиры такого механизма нет — окно подтверждает
 * агентство. Повтор кнопки не создаёт вторую заявку только там, где есть Idempotency-Key.
 */
import { Badge } from '../../components/ui/Badge';
import { cx } from '../../lib/cx';
import { Chips, Money, Notice, PhoneAppBar, PhoneBody, PhoneCard, PhoneTabBar, Placeholder } from '../kit';

const TABS = ['Home', 'Food', 'Tickets', 'Build', 'Rent'];

const DAYS = ['Сегодня', 'Завтра', 'Другая дата'];

type SlotState = 'free' | 'taken' | 'picked';

const SLOTS: Array<{ label: string; state: SlotState }> = [
  { label: '13:00', state: 'taken' },
  { label: '15:30', state: 'picked' },
  { label: '17:00', state: 'free' },
  { label: '18:30', state: 'taken' },
  { label: '19:30', state: 'free' },
  { label: '20:30', state: 'free' },
];

const SLOT_CLASS: Record<SlotState, string> = {
  free: 'bg-ink-100 text-ink-700',
  taken: 'bg-ink-100 text-ink-400 line-through',
  picked: 'bg-brand-500 font-semibold text-white',
};

export default function HomeFood03() {
  return (
    <>
      <PhoneAppBar title="Заявка на просмотр" subtitle="ул. Тауке хана, 83 · 2-комн., 68 м²" back />
      <PhoneBody>
        <PhoneCard>
          <div className="flex items-center gap-2.5">
            <Placeholder
              label="плейсхолдер"
              className="wrap-anywhere h-[64px] w-[64px] flex-none text-center text-[10px]! leading-tight"
            />
            <div className="min-w-0 flex-1">
              <div className="truncate text-[12.5px] font-semibold text-ink-900">ID 01M7HM4K2Q</div>
              <div className="truncate text-[11.5px] text-ink-500">
                <Money minor={2_490_000_000} /> · продажа · собственник
              </div>
            </div>
            <Badge tone="brand">Выбрано</Badge>
          </div>
        </PhoneCard>

        <Chips items={DAYS} active="Сегодня" />

        <PhoneCard title="Свободное время агента" right={<Badge tone="brand">показы</Badge>}>
          <div className="grid grid-cols-3 gap-2">
            {SLOTS.map((slot) => (
              <span key={slot.label} className={cx('rounded-lg py-1.5 text-center text-[12px]', SLOT_CLASS[slot.state])}>
                {slot.label}
              </span>
            ))}
          </div>
          <div className="mt-2 text-[11px] text-ink-500">Серые зачёркнутые окна заняты: агент уже ведёт показ</div>
        </PhoneCard>

        <div className="space-y-2">
          <div className="rounded-xl border border-ink-200 bg-white px-3 py-2">
            <div className="text-[11px] text-ink-500">Имя и телефон из ORTA ID</div>
            <div className="text-[13px] font-semibold text-ink-900">Айдар · +7 700 123 45 67</div>
          </div>
          <div className="rounded-xl border border-ink-200 bg-white px-3 py-2">
            <div className="text-[11px] text-ink-500">Комментарий агенту</div>
            <div className="text-[13px] text-ink-800">Можно посмотреть в субботу с женой?</div>
          </div>
        </div>

        <Notice>
          Это заявка, а не бронь: окно подтверждает агентство. В записи через QTime окно держит база (занятое →
          409 SLOT_TAKEN), у показа квартиры такого механизма нет.
        </Notice>

        <div className="rounded-xl bg-brand-500 px-4 py-2.5 text-center text-[13px] font-semibold text-white">
          Отправить заявку на 15:30
        </div>
      </PhoneBody>
      <PhoneTabBar items={TABS} active="Home" />
    </>
  );
}
