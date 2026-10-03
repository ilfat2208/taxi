/**
 * transport-16 — ORTA Delivery, вручение и подтверждение получателем.
 *
 * Правило, которое защищает экран: последнюю милю закрывает получатель, а не
 * курьер, — иначе спор «отдал / не отдал» неразрешим, а деньги списываются по
 * чужому слову. Ни кода вручения, ни СМС-провайдера, ни самого понятия
 * «получатель» в репозитории нет, поэтому цифры демонстрационные.
 */
import { Notice, PhoneAppBar, PhoneBody, PhoneCard, Placeholder, Row } from '../kit';

const CODE = ['4', '7', '2', '9'];

export default function Transport16() {
  return (
    <>
      <PhoneAppBar
        title="Получение посылки"
        subtitle="ORTA Delivery · курьер у вас · демо"
        right={
          <span className="grid h-9 w-9 place-items-center rounded-xl bg-ink-100 text-[12px] font-semibold text-ink-600">
            QR
          </span>
        }
      />
      <PhoneBody>
        <PhoneCard
          title="Код получателя"
          right={<span className="rounded-full bg-brand-50 px-2 py-0.5 text-[11px] font-medium text-brand-700">из SMS</span>}
        >
          <div className="flex items-center gap-2.5">
            {CODE.map((digit, index) => (
              <span
                key={index}
                className="grid h-[48px] w-11 place-items-center rounded-xl bg-brand-50 text-[22px] font-bold text-ink-900"
              >
                {digit}
              </span>
            ))}
            <span className="text-[11px] text-ink-500">действует 10 минут</span>
          </div>
          <p className="mt-2 text-[11px] text-ink-500">
            Код называется курьеру; в своём приложении он вводит его, а не отмечает вручение «на глаз».
          </p>
        </PhoneCard>

        <div className="flex flex-col items-center gap-1.5">
          <Placeholder label="QR" className="h-[96px] w-[96px] text-[11px]" />
          <p className="text-[10.5px] text-ink-500">QR для курьера — то же подтверждение без диктовки кода</p>
        </div>

        <PhoneCard>
          <div className="flex items-center gap-3">
            <span className="grid h-10 w-10 flex-none place-items-center rounded-full bg-gradient-to-br from-brand-600 to-brand-800 text-[15px] font-semibold text-white">
              А
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-[12.5px] font-semibold text-ink-900">Айгуль · получатель</span>
              <span className="block truncate text-[11px] text-ink-500">+7 701 555 22 11 · от Ерлана, пр. Республики, 12</span>
            </span>
          </div>
          <div className="mt-1 border-t border-ink-100 pt-1">
            <Row label="Что везём" value="посылка, 40 × 30 × 25 см" />
          </div>
        </PhoneCard>

        <Notice tone="neutral">
          <b>Подтверждение — это факт, а не кнопка «ок».</b> Вручение фиксируется кодом получателя: после него
          списываются деньги и закрывается заказ.
        </Notice>

        <Notice tone="warning">
          <b>Кода вручения и СМС-провайдера в коде нет</b> — цифры и QR демонстрационные, работают только
          события Kafka (outbox).
        </Notice>

        <div className="mt-auto" />
        <div className="rounded-xl bg-brand-500 px-4 py-3 text-center text-[13px] font-semibold text-white">
          Подтвердить получение
        </div>
        <div className="rounded-xl px-4 py-2 text-center text-[13px] font-medium text-brand-600">Это не моя посылка</div>
      </PhoneBody>
    </>
  );
}
