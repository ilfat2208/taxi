/**
 * home-food-06 · ORTA Food — подборки и заведения рядом.
 *
 * Что на экране: три режима (доставка, самовывоз, бронь столика), поиск, подборка,
 * две подборки-плитки и два заведения рядом с рейтингом, временем доставки и бронью.
 *
 * Честно: витрины еды в репозитории нет — ближайшее работающее это маркет
 * (web/src/pages/MarketPage.tsx и services/catalog-service). Курьеров и трекинга тоже
 * нет: ORTA Delivery — план, поэтому доставка показана обещанием времени заведения.
 */
import { Badge } from '../../components/ui/Badge';
import { Chips, Notice, PhoneAppBar, PhoneBody, PhoneCard, PhoneTabBar, Placeholder } from '../kit';

const TABS = ['Home', 'Food', 'Tickets', 'Build', 'Rent'];

const MODES = ['Доставка', 'Самовывоз', 'Бронь столика', 'Завтрак'];

const COLLECTIONS = [
  { title: 'Казахская кухня', sub: '18 заведений · плейсхолдер' },
  { title: 'Кофейни рядом', sub: '9 заведений · плейсхолдер' },
];

const VENUES = [
  {
    name: 'Кафе «Дастархан»',
    menu: 'Плов, манты, шашлык · 4,7 · 320 отзывов',
    delivery: '1,4 км · доставка 40–55 мин · от 700 ₸ · столиков 12',
    open: 'Открыто до 23:00',
    booking: 'Бронь на 20:00',
  },
  {
    name: 'Кофейня «Шымкент Роастерс»',
    menu: 'Кофе, завтраки, десерты · 4,8 · 512 отзывов',
    delivery: '0,9 км · доставка 25–35 мин · от 500 ₸ · самовывоз −10%',
    open: 'Открыто до 22:00',
    booking: 'Бронь на 18:30',
  },
];

export default function HomeFood06() {
  return (
    <>
      <PhoneAppBar title="ORTA Food" subtitle="Шымкент · доставка 35–50 минут" />
      <PhoneBody>
        <div className="rounded-xl border border-ink-200 bg-white px-3 py-2 text-[12.5px] text-ink-700">
          Плов, шашлык, кофе
        </div>

        <Chips items={MODES} active="Доставка" />

        <div className="rounded-2xl bg-brand-500 px-3 py-2.5 text-white">
          <div className="text-[13px] font-semibold">Подборка: ужин на двоих</div>
          <div className="mt-0.5 text-[11.5px] text-white/85">
            Шесть ресторанов Шымкента с открытой бронью на вечер и доставкой до 22:30
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2">
          {COLLECTIONS.map((collection) => (
            <div key={collection.title} className="rounded-2xl border border-ink-200 bg-white p-2.5">
              <Placeholder
                label="фото · плейсхолдер"
                className="wrap-anywhere h-[48px] w-full px-2 text-center leading-tight"
              />
              <div className="mt-2 text-[12.5px] font-semibold text-ink-900">{collection.title}</div>
              <div className="text-[11px] text-ink-500">{collection.sub}</div>
            </div>
          ))}
        </div>

        <PhoneCard
          title="Рядом с вами · 6 заведений"
          right={<span className="text-[12px] font-medium text-brand-600">На карте</span>}
        >
          <div className="space-y-2.5">
            {VENUES.map((venue) => (
              <div key={venue.name} className="space-y-2">
                <div className="flex gap-2.5">
                  <Placeholder
                    label="логотип — плейсхолдер"
                    className="wrap-anywhere h-[44px] w-[64px] flex-none text-center text-[10px]! leading-tight"
                  />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[12.5px] font-semibold text-ink-900">{venue.name}</div>
                    <div className="truncate text-[11.5px] text-ink-500">{venue.menu}</div>
                    <div className="truncate text-[11.5px] text-ink-500">{venue.delivery}</div>
                  </div>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  <Badge tone="success">{venue.open}</Badge>
                  <Badge tone="brand">{venue.booking}</Badge>
                </div>
              </div>
            ))}
          </div>
        </PhoneCard>

        <Notice>
          Заведения, доставка и брони — демо-данные: витрины еды в репозитории нет. Курьеров и трекинга
          тоже нет — ORTA Delivery в плане, поэтому «доставка 40–55 мин» это обещание заведения.
        </Notice>
      </PhoneBody>
      <PhoneTabBar items={TABS} active="Food" />
    </>
  );
}
