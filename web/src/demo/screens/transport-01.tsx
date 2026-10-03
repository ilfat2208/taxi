/**
 * transport-01 — ORTA Cargo, параметры груза.
 *
 * Вход в расчёт перевозки: адреса, тип груза и четыре числа (габариты, вес,
 * объём, этаж), от которых зависят и машина, и цена. Направления ORTA Cargo в
 * коде нет, поэтому все значения — демонстрационные, и на экране это сказано
 * прямым текстом, а не мелким шрифтом.
 */
import { Chips, Notice, PhoneAppBar, PhoneBody, PhoneCard, PhoneTabBar, Row } from '../kit';

const CARGO_TYPES = ['Мебель', 'Стройматериалы', 'Бытовая техника', 'Оборудование'];

/** Четыре числа, которые задают и машину, и цену. */
const DIMENSIONS: Array<{ label: string; value: string }> = [
  { label: 'Самое большое место', value: '2,1 × 0,9 × 0,8 м' },
  { label: 'Вес', value: '≈ 180 кг' },
  { label: 'Объём', value: '2,4 м³' },
  { label: 'Подъём на этаж', value: '4 этаж · лифт есть' },
];

export default function Transport01() {
  return (
    <>
      <PhoneAppBar
        title="ORTA Cargo"
        subtitle="Грузоперевозки · Шымкент · демо-данные"
        right={
          <span className="grid h-9 w-9 place-items-center rounded-xl bg-gradient-to-br from-brand-500 to-brand-700 text-[13px] font-bold text-white">
            C
          </span>
        }
      />
      <PhoneBody>
        <PhoneCard>
          <div className="text-[11px] text-ink-500">Откуда</div>
          <div className="mt-0.5 text-[13px] font-semibold text-ink-900">пр. Тауке хана, 60 · склад</div>
          <div className="mt-3 text-[11px] text-ink-500">Куда</div>
          <div className="mt-0.5 text-[13px] font-semibold text-ink-900">ул. Байтурсынова, 14 · квартира, 4 этаж</div>
        </PhoneCard>

        <div>
          <div className="mb-2 text-[13px] font-semibold text-ink-800">Что везём</div>
          <Chips items={CARGO_TYPES} active="Мебель" />
        </div>

        <PhoneCard
          title="Диван и две тумбы"
          right={<span className="text-[12px] font-medium text-brand-600">Изменить</span>}
        >
          <div className="mb-1 text-[11.5px] text-ink-500">мебель, без упаковки</div>
          {DIMENSIONS.map((item) => (
            <Row key={item.label} label={item.label} value={item.value} />
          ))}
        </PhoneCard>

        <Notice tone="neutral">
          <b>Направления ORTA Cargo в коде нет.</b> Адреса, габариты и вес — демонстрационные данные макета.
          Сначала параметры груза, потом цена: в фургон диван не входит, а перегруз запрещён.
        </Notice>

        <div className="mt-auto" />
        <div className="rounded-xl bg-brand-500 px-4 py-3 text-center text-[13px] font-semibold text-white">
          Подобрать машину
        </div>
        <div className="text-center text-[11px] text-ink-500">Цена считается по габаритам, весу и расстоянию</div>
      </PhoneBody>
      <PhoneTabBar items={['Грузы', 'Заказы', 'Счёт', 'Профиль']} active="Грузы" />
    </>
  );
}
