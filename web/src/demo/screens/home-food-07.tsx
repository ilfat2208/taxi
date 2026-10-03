/**
 * home-food-07 · ORTA Food — меню заведения и блюдо.
 *
 * Что на экране: шапка заведения с рейтингом, режим заказа, категории меню, три блюда
 * с весом, составом, ценой и количеством и кнопка «В корзину».
 *
 * Честно: корзина маркета для блюд не подходит — services/order-service и
 * POST /api/v1/cart/items привязаны к товару каталога с остатком, а у блюда остатка нет.
 * Состав и аллергены — демо: этих полей в контракте пока нет.
 */
import { Badge } from '../../components/ui/Badge';
import { Chips, Money, Notice, PhoneAppBar, PhoneBody, PhoneCard, PhoneTabBar, Placeholder } from '../kit';

const TABS = ['Home', 'Food', 'Tickets', 'Build', 'Rent'];

const MODES = ['Доставка', 'Самовывоз', 'В зале'];
const CATEGORIES = ['Плов', 'Салаты', 'Шашлык', 'Напитки'];

const DISHES = [
  {
    title: 'Плов с бараниной',
    detail: '450 г · рис, баранина, морковь, зира',
    priceMinor: 390_000,
    quantity: 1,
  },
  {
    title: 'Манты с тыквой',
    detail: '5 шт · 320 г · со сметаной',
    priceMinor: 270_000,
    quantity: 1,
  },
  {
    title: 'Чай с молоком',
    detail: '0,5 л · в чайнике',
    priceMinor: 80_000,
    quantity: 0,
  },
];

export default function HomeFood07() {
  return (
    <>
      <PhoneAppBar title="Кафе «Дастархан»" subtitle="Аль-Фарабийский · 1,4 км · 4,7 · 320 отзывов" back />
      <PhoneBody>
        <div className="relative">
          <Placeholder
            label="фото заведения — плейсхолдер"
            className="wrap-anywhere h-[84px] w-full px-6 text-center leading-tight"
          />
          <span className="absolute right-2 top-2">
            <Badge tone="success">Открыто</Badge>
          </span>
        </div>

        <div className="space-y-2">
          <Chips items={MODES} active="Доставка" />
          <Chips items={CATEGORIES} active="Плов" />
        </div>

        <PhoneCard title="Меню · средний чек 4 500 ₸">
          <div className="space-y-2">
            {DISHES.map((dish) => (
              <div key={dish.title} className="flex items-center gap-2.5">
                <Placeholder
                  label="блюдо — плейсхолдер"
                  className="wrap-anywhere h-[52px] w-[64px] flex-none text-center text-[10px]! leading-tight"
                />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[12.5px] font-semibold text-ink-900">{dish.title}</div>
                  <div className="truncate text-[11px] text-ink-500">{dish.detail}</div>
                  <div className="text-[12px]">
                    <Money minor={dish.priceMinor} />
                  </div>
                </div>
                <span className="flex flex-none items-center gap-1.5 rounded-lg bg-ink-100 px-2 py-1 text-[12px] text-ink-600">
                  <span>−</span>
                  <span className="font-semibold text-ink-900">{dish.quantity}</span>
                  <span>+</span>
                </span>
              </div>
            ))}
          </div>
        </PhoneCard>

        <div className="rounded-xl bg-brand-500 px-4 py-2.5 text-center text-[13px] font-semibold text-white">
          В корзину · 2 позиции · 6 600 ₸
        </div>

        <Notice>
          Корзина маркета для блюд не подходит: заказ и POST /api/v1/cart/items привязаны к товару каталога
          с остатком. Состав, вес и аллергены — демо: обязательных полей меню в контракте пока нет.
        </Notice>
      </PhoneBody>
      <PhoneTabBar items={TABS} active="Food" />
    </>
  );
}
