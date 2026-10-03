/**
 * home-food-01 · ORTA Home — поиск и фильтры.
 *
 * Что на экране: поисковая строка, фильтры сделки и вложенные фильтры, карта
 * (плейсхолдер) и две карточки объектов со списком «42 объекта · сетка и карта».
 *
 * Честно: каталога недвижимости в репозитории нет, поэтому объекты — демо-данные,
 * карта — плейсхолдер, а слой объектов на карте — план ORTA Map. Никаких запросов
 * экран не делает: все числа и подписи — константы этого файла.
 */
import { Badge } from '../../components/ui/Badge';
import { Chips, Money, Notice, PhoneAppBar, PhoneBody, PhoneCard, PhoneTabBar, Placeholder } from '../kit';

const TABS = ['Home', 'Food', 'Tickets', 'Build', 'Rent'];

const DEAL_TYPES = ['Купить', 'Снять', 'Посуточно', 'Участки'];
const APPLIED_FILTERS = ['2 комнаты', 'до 25 млн ₸', '60–80 м²'];

const LISTINGS = [
  {
    title: '2-комн. квартира, 68 м²',
    address: 'Аль-Фарабийский · ул. Тауке хана, 83',
    facts: '4/9 этаж · ремонт есть · мебель · парковка',
    seller: 'Собственник' as const,
    priceMinor: 2_490_000_000,
  },
  {
    title: '3-комн. квартира, 84 м²',
    address: 'Аль-Фарабийский · пр. Республики, 12',
    facts: '7/12 этаж · новостройка 2024 · без мебели',
    seller: 'От агентства' as const,
    priceMinor: 2_940_000_000,
  },
];

export default function HomeFood01() {
  return (
    <>
      <PhoneAppBar title="ORTA Home" subtitle="Недвижимость · Шымкент · 1 284 объекта" />
      <PhoneBody>
        <div className="rounded-xl border border-ink-200 bg-white px-3 py-2 text-[12.5px] text-ink-700">
          2-комнатная, Аль-Фарабийский район
        </div>

        <div className="space-y-2">
          <Chips items={DEAL_TYPES} active="Купить" />
          <div className="flex flex-wrap gap-2">
            {APPLIED_FILTERS.map((filter) => (
              <Badge key={filter} tone="brand">
                {filter}
              </Badge>
            ))}
            <Badge tone="neutral">Все фильтры</Badge>
          </div>
        </div>

        <div className="relative">
          <Placeholder label="карта объектов — плейсхолдер" className="wrap-anywhere h-[110px] w-full px-6 text-center leading-tight" />
          <span className="absolute left-2 top-2 rounded-full bg-white/95 px-2 py-1 text-[10px] text-ink-700 shadow-sm">
            42 объекта рядом
          </span>
          <span className="absolute right-2 top-2 rounded-full bg-white/95 px-2 py-1 text-[10px] text-ink-700 shadow-sm">
            Аль-Фарабийский
          </span>
        </div>

        <PhoneCard title="42 объекта · сетка и карта" right={<span className="text-[12px] font-medium text-brand-600">Сначала дешевле</span>}>
          <div className="space-y-3">
            {LISTINGS.map((listing) => (
              <div key={listing.title} className="space-y-2">
                <div className="flex gap-2.5">
                  <Placeholder
                    label="фото — плейсхолдер"
                    className="wrap-anywhere h-[62px] w-[80px] flex-none text-center text-[10px]! leading-tight"
                  />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[12.5px] font-semibold text-ink-900">{listing.title}</div>
                    <div className="truncate text-[11.5px] text-ink-500">{listing.address}</div>
                    <div className="truncate text-[11.5px] text-ink-500">{listing.facts}</div>
                  </div>
                </div>
                <div className="flex items-center justify-between gap-2">
                  <Badge tone={listing.seller === 'Собственник' ? 'success' : 'neutral'}>{listing.seller}</Badge>
                  <Money minor={listing.priceMinor} />
                </div>
              </div>
            ))}
          </div>
        </PhoneCard>

        <Notice>
          Объекты и карта — демо-данные: каталога недвижимости в репозитории нет. Слой объектов на карте —
          план ORTA Map, фотографии — градиентные плейсхолдеры.
        </Notice>
      </PhoneBody>
      <PhoneTabBar items={TABS} active="Home" />
    </>
  );
}
