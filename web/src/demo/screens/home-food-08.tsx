/**
 * home-food-08 · ORTA Food — корзина и оформление доставки.
 *
 * Что на экране: две позиции с количеством, адрес доставки, время, счёт списания,
 * счёт заказа и кнопка оплаты.
 *
 * Честно: оплата — готовое ядро (POST /api/v1/payments/merchant, повтор с тем же
 * Idempotency-Key). А комиссия в Food ещё не решена: в маркете платформа берёт 1,5%
 * с покупателя, но у еды сбор обычно платит заведение — это открытый вопрос, и он
 * подписан на экране, а не спрятан строкой в чеке.
 */
import { Chips, Money, Notice, PhoneAppBar, PhoneBody, PhoneCard, PhoneTabBar, Placeholder, Row } from '../kit';

const TABS = ['Home', 'Food', 'Tickets', 'Build', 'Rent'];

const ITEMS = [
  { title: 'Плов с бараниной', detail: 'Дастархан · 450 г', priceMinor: 390_000, quantity: 1 },
  { title: 'Манты с тыквой', detail: 'Дастархан · 5 шт', priceMinor: 270_000, quantity: 1 },
];

const TIMING = ['Как можно скорее', 'Ко времени 20:00'];

export default function HomeFood08() {
  return (
    <>
      <PhoneAppBar title="Корзина" subtitle="Кафе «Дастархан» · 2 позиции · Аль-Фарабийский" back />
      <PhoneBody>
        <PhoneCard>
          <div className="space-y-2">
            {ITEMS.map((item) => (
              <div key={item.title} className="flex items-center gap-2.5">
                <Placeholder
                  label="блюдо — плейсхолдер"
                  className="wrap-anywhere h-[56px] w-[64px] flex-none text-center text-[10px]! leading-tight"
                />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[12.5px] font-semibold text-ink-900">{item.title}</div>
                  <div className="truncate text-[11px] text-ink-500">{item.detail}</div>
                  <div className="text-[12px]">
                    <Money minor={item.priceMinor} />
                    <span className="text-ink-500"> за порцию</span>
                  </div>
                </div>
                <span className="flex flex-none items-center gap-1.5 rounded-lg bg-ink-100 px-2 py-1 text-[12px] text-ink-600">
                  <span>−</span>
                  <span className="font-semibold text-ink-900">{item.quantity}</span>
                  <span>+</span>
                </span>
              </div>
            ))}
          </div>
        </PhoneCard>

        <PhoneCard title="Доставка">
          <div className="text-[11.5px] text-ink-500">Аль-Фарабийский · ул. Тауке хана, 83, кв. 12</div>
          <div className="mt-2">
            <Chips items={TIMING} active="Как можно скорее" />
          </div>
          <div className="mt-2 rounded-xl border border-ink-200 bg-white px-3 py-2">
            <div className="text-[11px] text-ink-500">Счёт списания</div>
            <div className="text-[12.5px] text-ink-800">
              ORTA · KZT · доступно <Money minor={409_465_210} />
            </div>
          </div>
        </PhoneCard>

        <PhoneCard>
          <Row label="Блюда (2)" value={<Money minor={660_000} />} />
          <Row label="Доставка" value={<Money minor={70_000} />} />
          <Row label="Итого к оплате" value={<Money minor={730_000} />} strong />
        </PhoneCard>

        <Notice>
          Комиссия здесь ещё не решена: в маркете платформа берёт 1,5% с покупателя, но у еды сбор обычно
          платит заведение. Пока это открытый вопрос, а не спрятанная строка в чеке.
        </Notice>

        <div className="rounded-xl bg-brand-500 px-4 py-2.5 text-center text-[13px] font-semibold text-white">
          Оплатить · 7 300,00 ₸
        </div>
      </PhoneBody>
      <PhoneTabBar items={TABS} active="Food" />
    </>
  );
}
