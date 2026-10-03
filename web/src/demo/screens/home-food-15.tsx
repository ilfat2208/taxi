/**
 * home-food-15 · ORTA Build — материалы.
 *
 * Что на экране: поиск по стройматериалам, разделы (материалы, услуги, техника, смета),
 * выбранные свойства товара и три позиции с фасовкой, поддоном, тоннажем и доставкой.
 *
 * Честно: services/catalog-service продаёт штучный товар и не знает тоннаж и поддоны,
 * поэтому витрина и цены — демо. Работающая на платформе часть — заказ и оплата
 * (POST /api/v1/orders, POST /api/v1/payments/merchant), но она про штучный товар.
 */
import { Badge } from '../../components/ui/Badge';
import { Chips, Money, Notice, PhoneAppBar, PhoneBody, PhoneCard, PhoneTabBar, Placeholder } from '../kit';

const TABS = ['Home', 'Food', 'Tickets', 'Build', 'Rent'];

const SECTIONS = ['Материалы', 'Услуги', 'Техника', 'Смета'];

const MATERIALS = [
  {
    title: 'Цемент ПЦ 400 Д20, мешок 50 кг',
    detail: 'Шымкентцемент · поддон 40 мешков, 72 000 ₸ · 2 т',
    priceMinor: 189_000,
    unit: '/ мешок',
    stock: '480 мешков',
    delivery: 'доставка 12 000 ₸',
  },
  {
    title: 'Арматура А500С, Ø12 мм',
    detail: 'прут 11,7 м · 1 т = 96 прутов · резка и гибка +8%',
    priceMinor: 31_800_000,
    unit: '/ тонна',
    stock: '6,4 тонны',
    delivery: 'доставка манипулятором',
  },
  {
    title: 'Кирпич керамический, 1 НФ',
    detail: 'полнотелый · поддон 275 шт, 26 400 ₸ · машина 5 поддонов',
    priceMinor: 9_600,
    unit: '/ штука',
    stock: '12 400 шт',
    delivery: 'доставка 18 000 ₸',
  },
];

export default function HomeFood15() {
  return (
    <>
      <PhoneAppBar title="ORTA Build" subtitle="Стройка · Шымкент · материалы, работы, техника" />
      <PhoneBody>
        <div className="rounded-xl border border-ink-200 bg-white px-3 py-2 text-[12.5px] text-ink-700">
          Цемент М400, мешок 50 кг
        </div>

        <Chips items={SECTIONS} active="Материалы" />

        <div className="flex flex-wrap gap-2">
          <Badge tone="brand">М400</Badge>
          <Badge tone="brand">мешок 50 кг</Badge>
          <Badge tone="neutral">поддон</Badge>
          <Badge tone="neutral">доставка сегодня</Badge>
        </div>

        <PhoneCard
          title="148 позиций · склад Шымкент"
          right={<span className="text-[12px] font-medium text-brand-600">Сначала дешёвые</span>}
        >
          <div className="space-y-2.5">
            {MATERIALS.map((material) => (
              <div key={material.title} className="space-y-2">
                <div className="flex gap-2.5">
                  <Placeholder
                    label="товар — плейсхолдер"
                    className="wrap-anywhere h-[56px] w-[64px] flex-none text-center text-[10px]! leading-tight"
                  />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[12.5px] font-semibold text-ink-900">{material.title}</div>
                    <div className="text-[11px] text-ink-500">{material.detail}</div>
                    <div className="text-[12px]">
                      <Money minor={material.priceMinor} />
                      <span className="text-ink-500"> {material.unit}</span>
                    </div>
                  </div>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  <Badge tone="success">{material.stock}</Badge>
                  <Badge tone="brand">{material.delivery}</Badge>
                </div>
              </div>
            ))}
          </div>
        </PhoneCard>

        <Notice>
          Цены и остатки — демо: каталог платформы продаёт штучный товар и не знает ни тоннажа, ни поддонов.
        </Notice>
      </PhoneBody>
      <PhoneTabBar items={TABS} active="Build" />
    </>
  );
}
