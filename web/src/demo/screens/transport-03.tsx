/**
 * transport-03 — ORTA Cargo, расчёт и оформление.
 *
 * Смета до заказа: ставка машины, грузчики, сопровождение экспедитора и итог.
 * Денежная часть здесь опирается на готовое ядро (холд при назначении машины,
 * списание при завершении), а сам заказ перевозки — макет: cargo-service нет.
 */
import { Money, Notice, PhoneAppBar, PhoneBody, PhoneCard, Row } from '../kit';

const STAVKA_MINOR = 1_840_000;
const LOADER_MINOR = 600_000;
const LOADERS = 2;
const EXPEDITOR_MINOR = 500_000;
const TOTAL_MINOR = STAVKA_MINOR + LOADER_MINOR * LOADERS + EXPEDITOR_MINOR;

export default function Transport03() {
  return (
    <>
      <PhoneAppBar title="Расчёт и оформление" subtitle="Газель · 2 грузчика · экспедитор" back />
      <PhoneBody>
        <PhoneCard right={<span className="text-[12px] font-medium text-brand-600">Изменить</span>} title="Маршрут">
          <div className="flex gap-3">
            <span className="flex flex-none flex-col items-center pt-1">
              <span className="h-2.5 w-2.5 rounded-full bg-brand-500" />
              <span className="my-1 h-5 w-0.5 bg-ink-200" />
              <span className="h-2.5 w-2.5 rounded-sm bg-emerald-500" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-[13px] font-semibold text-ink-900">пр. Тауке хана, 60</span>
              <span className="block text-[11.5px] text-ink-500">Склад · погрузка со двора</span>
              <span className="mt-3 block text-[13px] font-semibold text-ink-900">ул. Байтурсынова, 14</span>
              <span className="block text-[11.5px] text-ink-500">Квартира · 4 этаж, лифт есть</span>
            </span>
          </div>
          <div className="mt-2 border-t border-ink-100 pt-1">
            <Row label="Расстояние" value="10,4 км" />
            <Row label="Машина" value="Газель · тент 3,0 м" />
            <Row label="Подача" value="25 мин" />
          </div>
        </PhoneCard>

        <PhoneCard>
          <div className="flex items-center gap-3">
            <span className="min-w-0 flex-1">
              <span className="block text-[13px] font-semibold text-ink-900">Грузчики</span>
              <span className="block text-[11.5px] text-ink-500">2 человека · 6 000,00 ₸ каждый</span>
            </span>
            <span className="flex flex-none items-center gap-2 rounded-full bg-ink-100 px-2.5 py-1 text-[12px] font-semibold text-ink-800">
              <span className="text-ink-400">−</span>
              {LOADERS}
              <span className="text-ink-400">+</span>
            </span>
          </div>
          <div className="mt-3 flex items-center gap-3">
            <span className="min-w-0 flex-1">
              <span className="block text-[13px] font-semibold text-ink-900">Сопровождение</span>
              <span className="block text-[11.5px] text-ink-500">экспедитор принимает груз и подписывает акт</span>
            </span>
            <span className="flex-none rounded-full bg-brand-50 px-2 py-0.5 text-[11px] font-medium text-brand-700">
              включено
            </span>
          </div>
          <div className="mt-2 border-t border-ink-100 pt-1">
            <Row label="Ставка «Газель», 10,4 км" value={<Money minor={STAVKA_MINOR} />} />
            <Row label="Грузчики, 2 × 6 000,00 ₸" value={<Money minor={LOADER_MINOR * LOADERS} />} />
            <Row label="Сопровождение" value={<Money minor={EXPEDITOR_MINOR} />} />
            <div className="mt-2 flex items-baseline justify-between gap-3 border-t border-ink-100 pt-2">
              <span className="text-[11.5px] text-ink-500">Итого · оплата со счёта ORTA · KZT</span>
              <Money minor={TOTAL_MINOR} />
            </div>
          </div>
        </PhoneCard>

        <Notice tone="info">
          <b>Заказа перевозки в коде нет</b> — суммы демонстрационные. Готовы только холд и списание: их
          механика уже работает.
        </Notice>

        <div className="mt-auto" />
        <div className="rounded-xl bg-brand-500 px-4 py-3 text-center text-[13px] font-semibold text-white">
          Заказать перевозку · 35 400 ₸
        </div>
        <div className="text-center text-[11px] text-ink-500">
          Повтор с тем же Idempotency-Key не создаст второй заказ
        </div>
      </PhoneBody>
    </>
  );
}
