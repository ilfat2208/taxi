/**
 * home-food-19 · ORTA Rent — каталог вещей и инструмента.
 *
 * Что на экране: поиск, категории аренды и три позиции со ставкой за сутки (или за час),
 * наличием, залогом и расстоянием до пункта выдачи.
 *
 * Честно: вертикали аренды в репозитории нет — каталог, наличие и ставки демо. Зато
 * залог как холд — готовая часть: services/account-service умеет reserve, capture и
 * release, поэтому залог на экране подписан как возвращаемый, а не как платёж.
 */
import { Badge } from '../../components/ui/Badge';
import { Chips, Money, Notice, PhoneAppBar, PhoneBody, PhoneCard, PhoneTabBar, Placeholder } from '../kit';

const TABS = ['Home', 'Food', 'Tickets', 'Build', 'Rent'];

const CATEGORIES = ['Инструмент', 'Техника', 'Фото и звук', 'Залы', 'Туризм'];

const ITEMS = [
  {
    title: 'Перфоратор Bosch GBH 2-26',
    detail: 'SDS-plus · кейс, 3 бура · пункт: Тауке хана, 83',
    rateMinor: 190_000,
    rate: '/ сутки',
    stock: 'в наличии 3',
    deposit: 'залог 30 000 ₸',
    distance: '1,2 км',
  },
  {
    title: 'Мотоблок Neva МБ-2',
    detail: 'фрезы, плуг · пункт: пр. Республики, 12',
    rateMinor: 450_000,
    rate: '/ сутки',
    stock: 'в наличии 1',
    deposit: 'залог 60 000 ₸',
    distance: '2,4 км',
  },
  {
    title: 'Конференц-зал на 40 человек',
    detail: 'проектор, флипчарт, кофе-брейк · центр Шымкента',
    rateMinor: 900_000,
    rate: '/ час',
    stock: 'свободен завтра',
    deposit: 'залог 50 000 ₸',
    distance: 'бронь по времени',
  },
];

export default function HomeFood19() {
  return (
    <>
      <PhoneAppBar title="ORTA Rent" subtitle="Аренда инструмента и вещей · Шымкент" />
      <PhoneBody>
        <div className="rounded-xl border border-ink-200 bg-white px-3 py-2 text-[12.5px] text-ink-700">
          Перфоратор, мотоблок, проектор
        </div>

        <Chips items={CATEGORIES} active="Инструмент" />

        <PhoneCard
          title="286 вещей · пункты выдачи рядом"
          right={<span className="text-[12px] font-medium text-brand-600">Сначала дешёвые</span>}
        >
          <div className="space-y-2.5">
            {ITEMS.map((item) => (
              <div key={item.title} className="space-y-2">
                <div className="flex gap-2.5">
                  <Placeholder
                    label="вещь — плейсхолдер"
                    className="wrap-anywhere h-[56px] w-[64px] flex-none text-center text-[10px]! leading-tight"
                  />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[12.5px] font-semibold text-ink-900">{item.title}</div>
                    <div className="truncate text-[11px] text-ink-500">{item.detail}</div>
                    <div className="text-[12px]">
                      <Money minor={item.rateMinor} />
                      <span className="text-ink-500"> {item.rate}</span>
                    </div>
                  </div>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  <Badge tone="success">{item.stock}</Badge>
                  <Badge tone="warning">{item.deposit}</Badge>
                  <Badge tone="brand">{item.distance}</Badge>
                </div>
              </div>
            ))}
          </div>
        </PhoneCard>

        <Notice>
          Каталог, наличие и ставки — демо: вертикали аренды в репозитории нет. Залог — это холд, и он
          работает: services/account-service умеет reserve, capture и release.
        </Notice>
      </PhoneBody>
      <PhoneTabBar items={TABS} active="Rent" />
    </>
  );
}
