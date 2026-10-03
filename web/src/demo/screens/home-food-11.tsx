/**
 * home-food-11 · ORTA Tickets — афиша и подборки.
 *
 * Что на экране: поиск, категории, баннер премьеры и три события «сегодня и завтра»
 * с наличием мест и ценой «от».
 *
 * Честно: вертикали билетов в репозитории нет, билетные провайдеры не выбраны — события,
 * места и цены демонстрационные, афиши — градиентные плейсхолдеры.
 */
import { Badge } from '../../components/ui/Badge';
import { Chips, Money, Notice, PhoneAppBar, PhoneBody, PhoneCard, PhoneTabBar, Placeholder } from '../kit';

const TABS = ['Home', 'Food', 'Tickets', 'Build', 'Rent'];

const CATEGORIES = ['Все', 'Кино', 'Концерты', 'Театр', 'Спорт'];

const EVENTS = [
  {
    title: '«Қыз Жібек», опера-драма',
    where: 'Драмтеатр им. Ж. Шанина · 3 окт, 19:00',
    facts: '2 ч 20 мин с антрактом · 12+',
    seats: 'Есть места · 128',
    tone: 'success' as const,
    fromMinor: 250_000,
  },
  {
    title: 'Кино «Арман 3D» · вечерний сеанс',
    where: 'ТРЦ Shymkent Plaza · 2 окт, 21:40',
    facts: '1 ч 48 мин · 16+ · зал 4',
    seats: 'Осталось 14 мест',
    tone: 'warning' as const,
    fromMinor: 220_000,
  },
  {
    title: 'Цирк Шымкента · программа «Арена»',
    where: 'пр. Республики, 12 · 4 окт, 16:00',
    facts: '2 ч · 6+ · возврат за 24 часа',
    seats: 'Есть места · 340',
    tone: 'success' as const,
    fromMinor: 300_000,
  },
];

export default function HomeFood11() {
  return (
    <>
      <PhoneAppBar title="ORTA Tickets" subtitle="Шымкент · 12 событий на неделю" />
      <PhoneBody>
        <div className="rounded-xl border border-ink-200 bg-white px-3 py-2 text-[12.5px] text-ink-700">
          Концерт, кино, спектакль
        </div>

        <Chips items={CATEGORIES} active="Все" />

        <div className="rounded-2xl bg-brand-600 px-3 py-2.5 text-white">
          <div className="text-[13px] font-semibold">Премьера: «Қыз Жібек»</div>
          <div className="mt-0.5 text-[11.5px] text-white/85">
            Драмтеатр им. Ж. Шанина · 3 октября, 19:00 · 128 мест свободно
          </div>
        </div>

        <PhoneCard
          title="Сегодня и завтра"
          right={<span className="text-[12px] font-medium text-brand-600">Вся афиша</span>}
        >
          <div className="space-y-2.5">
            {EVENTS.map((event) => (
              <div key={event.title} className="space-y-2">
                <div className="flex gap-2.5">
                  <Placeholder
                    label="афиша — плейсхолдер"
                    className="wrap-anywhere h-[52px] w-[64px] flex-none text-center text-[10px]! leading-tight"
                  />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[12.5px] font-semibold text-ink-900">{event.title}</div>
                    <div className="truncate text-[11.5px] text-ink-500">{event.where}</div>
                    <div className="truncate text-[11.5px] text-ink-500">{event.facts}</div>
                  </div>
                </div>
                <div className="flex items-center justify-between gap-2">
                  <Badge tone={event.tone}>{event.seats}</Badge>
                  <span className="flex items-baseline gap-1">
                    <span className="text-[11px] text-ink-500">от</span>
                    <Money minor={event.fromMinor} />
                  </span>
                </div>
              </div>
            ))}
          </div>
        </PhoneCard>

        <Notice>
          Афиша, места и цены — демо: вертикали билетов в репозитории нет, билетные провайдеры не выбраны.
        </Notice>
      </PhoneBody>
      <PhoneTabBar items={TABS} active="Tickets" />
    </>
  );
}
