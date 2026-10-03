/**
 * transport-14 — ORTA Delivery, расчёт и выбор скорости.
 *
 * Четыре тарифа и страховка — выдуманные числа для правдоподобного примера.
 * Денежный сценарий опирается на готовое ядро: холд при закреплении курьера,
 * списание при вручении, release при отмене — account-service это уже умеет.
 */
import { Money, Notice, PhoneAppBar, PhoneBody, PhoneCard, Row } from '../kit';
import { cx } from '../../lib/cx';

interface Tariff {
  key: string;
  mark: string;
  name: string;
  detail: string;
  minor: number;
  eta: string;
  selected: boolean;
}

const TARIFFS: Tariff[] = [
  { key: 'express', mark: 'Э', name: 'Экспресс', detail: 'курьер выезжает сразу, до 60 минут', minor: 390_000, eta: '60 мин', selected: false },
  { key: 'day', mark: 'Д', name: 'В течение дня', detail: 'до 3 часов, интервал на выбор', minor: 240_000, eta: 'до 3 ч', selected: true },
  { key: 'eco', mark: 'К', name: 'Эконом', detail: 'соберём машину с другими заказами', minor: 140_000, eta: 'до 21:00', selected: false },
  { key: 'point', mark: 'П', name: 'В пункт выдачи', detail: 'получатель заберёт сам · хранится 5 дней', minor: 90_000, eta: 'завтра', selected: false },
];

const INSURANCE_MINOR = 50_000;
const TOTAL_MINOR = 240_000 + INSURANCE_MINOR;

export default function Transport14() {
  return (
    <>
      <PhoneAppBar title="Расчёт доставки" subtitle="7,8 км · 3 кг · посылка" back />
      <PhoneBody>
        <PhoneCard>
          <div className="space-y-1">
            {TARIFFS.map((tariff) => (
              <div
                key={tariff.key}
                className={cx(
                  'flex items-center gap-3 rounded-xl px-2 py-2',
                  tariff.selected ? 'bg-brand-50 ring-1 ring-inset ring-brand-200' : '',
                )}
              >
                <span
                  className={cx(
                    'grid h-9 w-9 flex-none place-items-center rounded-xl text-[13px] font-semibold',
                    tariff.selected ? 'bg-gradient-to-br from-brand-500 to-brand-700 text-white' : 'bg-ink-100 text-ink-500',
                  )}
                >
                  {tariff.mark}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] font-semibold text-ink-900">{tariff.name}</span>
                  <span className="block truncate text-[11.5px] text-ink-500">{tariff.detail}</span>
                </span>
                <span className="flex-none text-right">
                  <span className="block text-[12.5px]">
                    <Money minor={tariff.minor} />
                  </span>
                  <span className="block text-[11px] text-ink-400">{tariff.eta}</span>
                </span>
              </div>
            ))}
          </div>
        </PhoneCard>

        <PhoneCard>
          <Row label="Тариф «В течение дня»" value={<Money minor={240_000} />} />
          <Row label="Страховка, 1 % от 50 000,00 ₸" value={<Money minor={INSURANCE_MINOR} />} />
          <div className="mt-2 flex items-baseline justify-between gap-3 border-t border-ink-100 pt-2">
            <span className="text-[11.5px] text-ink-500">Итого · счёт ORTA · KZT</span>
            <Money minor={TOTAL_MINOR} />
          </div>
        </PhoneCard>

        <Notice tone="neutral">
          <b>Когда двигаются деньги.</b> Резерв — при закреплении курьера, списание — при вручении. Отмена до
          забора посылки возвращает зарезервированное полностью. Курьерской вертикали и тарифов в коде нет:
          суммы демонстрационные, готовы только холды и леджер.
        </Notice>

        <div className="mt-auto" />
        <div className="rounded-xl bg-brand-500 px-4 py-3 text-center text-[13px] font-semibold text-white">
          Отправить · 2 900 ₸
        </div>
        <div className="text-center text-[11px] text-ink-500">
          Повтор с тем же Idempotency-Key не создаст вторую доставку
        </div>
      </PhoneBody>
    </>
  );
}
