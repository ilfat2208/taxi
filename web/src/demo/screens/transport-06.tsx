/**
 * transport-06 — ORTA Cargo, завершение и чек.
 *
 * Форма чека повторяет уже работающий чек поездки: разбивка цены, признак
 * «списано один раз», номер заказа, который человек называет поддержке, и
 * оценка только по завершённому заказу. Все числа и номер — демо.
 */
import { Money, Notice, PhoneAppBar, PhoneBody, PhoneCard, Row } from '../kit';

const STAVKA_MINOR = 1_840_000;
const LOADERS_MINOR = 1_200_000;
const EXPEDITOR_MINOR = 500_000;
const TOTAL_MINOR = STAVKA_MINOR + LOADERS_MINOR + EXPEDITOR_MINOR;
const ORDER_NUMBER = 'C01M3Y1AYYJGHVVY7NCZQ690MJF';

export default function Transport06() {
  return (
    <>
      <PhoneAppBar
        title="Перевозка завершена"
        subtitle="10:52 · пр. Байтурсынова, 14"
        right={<span className="rounded-full bg-success-50 px-2 py-0.5 text-[11px] font-medium text-success-700">завершена</span>}
      />
      <PhoneBody>
        <PhoneCard>
          <div className="flex items-baseline justify-between gap-3">
            <span className="text-[11.5px] text-ink-500">Списано со счёта ORTA · KZT</span>
            <Money minor={TOTAL_MINOR} />
          </div>
          <div className="mt-2 border-t border-ink-100 pt-1">
            <Row label="Ставка «Газель», 10,4 км" value={<Money minor={STAVKA_MINOR} />} />
            <Row label="Грузчики, 2 × 6 000,00 ₸" value={<Money minor={LOADERS_MINOR} />} />
            <Row label="Сопровождение" value={<Money minor={EXPEDITOR_MINOR} />} />
            <div className="mt-2 flex items-baseline justify-between gap-3 border-t border-ink-100 pt-2">
              <span className="text-[11.5px] text-ink-500">Итого · списано один раз</span>
              <Money minor={TOTAL_MINOR} />
            </div>
          </div>
          <div className="mt-2 truncate font-mono text-[11px] text-ink-600">{ORDER_NUMBER}</div>
        </PhoneCard>

        <PhoneCard title="Что зафиксировано">
          <Row label="Вес по факту" value="178 кг (заявлено 180)" />
          <Row label="Перевес" value="нет" />
          <Row label="Акт" value="подписан получателем" />
        </PhoneCard>

        <PhoneCard title="Оцените перевозку" right={<span className="text-[11px] text-ink-500">по завершённому заказу</span>}>
          <div className="flex gap-1 text-[18px] leading-none text-amber-500">
            <span>★</span>
            <span>★</span>
            <span>★</span>
            <span>★</span>
            <span className="text-ink-300">★</span>
          </div>
          <p className="mt-2 text-[11px] text-ink-500">Оценка — один раз и только по завершённому заказу, как в такси.</p>
        </PhoneCard>

        <Notice tone="neutral">
          <b>Чека по перевозке в коде нет:</b> все числа и номер — демо.
        </Notice>

        <div className="mt-auto" />
        <div className="rounded-xl bg-brand-500 px-4 py-3 text-center text-[13px] font-semibold text-white">
          Оценить · 4 звезды
        </div>
        <div className="rounded-xl border border-ink-200 bg-white px-4 py-2.5 text-center text-[13px] font-medium text-ink-700">
          Скачать чек
        </div>
      </PhoneBody>
    </>
  );
}
