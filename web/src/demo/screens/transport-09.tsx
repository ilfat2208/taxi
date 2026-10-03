/**
 * transport-09 — ORTA Auto, запись на СТО через QTime.
 *
 * Макетный экран, но сценарий опирается на готовое ядро: сетка окон, «одно окно
 * — одна запись», отмена, освобождающая окно, — это уже работает в
 * qtime-service. Чего нет: самой вертикали — СТО, мастеров и услуг автосервиса
 * в базе не существует, поэтому компания, мастер и цена демонстрационные.
 */
import { Chips, Notice, PhoneAppBar, PhoneBody, PhoneCard, Row } from '../kit';
import { cx } from '../../lib/cx';

const SLOTS: Array<{ time: string; state: 'taken' | 'selected' | 'free' }> = [
  { time: '09:00', state: 'taken' },
  { time: '10:30', state: 'taken' },
  { time: '12:00', state: 'selected' },
  { time: '14:00', state: 'free' },
  { time: '16:30', state: 'free' },
  { time: '18:00', state: 'free' },
];

export default function Transport09() {
  return (
    <>
      <PhoneAppBar title="Запись на СТО" subtitle="Свободные окна · через QTime" back />
      <PhoneBody>
        <PhoneCard className="ring-1 ring-inset ring-brand-200">
          <div className="flex items-start gap-3">
            <span className="grid h-9 w-9 flex-none place-items-center rounded-xl bg-gradient-to-br from-brand-500 to-brand-700 text-[13px] font-semibold text-white">
              М
            </span>
            <span className="min-w-0 flex-1">
              <span className="flex items-baseline gap-1.5">
                <span className="truncate text-[13px] font-semibold text-ink-900">СТО «Мотор-Сервис»</span>
                <span className="flex-none text-[11.5px] font-medium text-ink-700">★ 4,8</span>
                <span className="flex-none text-[11px] text-ink-400">· 214 отзывов</span>
              </span>
              <span className="mt-0.5 block text-[11.5px] text-ink-500">Замена масла и фильтра · 50 мин · 8 500 ₸</span>
            </span>
          </div>
        </PhoneCard>

        <PhoneCard
          title="Свободные окна · 2 октября"
          right={<span className="rounded-full bg-brand-50 px-2 py-0.5 text-[11px] font-medium text-brand-700">QTime</span>}
        >
          <Chips items={['Сегодня', 'Завтра', '4 окт']} active="Сегодня" />
          <div className="mt-3 grid grid-cols-3 gap-2">
            {SLOTS.map((slot) => (
              <span
                key={slot.time}
                className={cx(
                  'rounded-xl py-2 text-center text-[12px]',
                  slot.state === 'taken' && 'bg-ink-100 text-ink-300 line-through',
                  slot.state === 'selected' && 'bg-brand-500 font-semibold text-white',
                  slot.state === 'free' && 'border border-ink-200 bg-white text-ink-700',
                )}
              >
                {slot.time}
              </span>
            ))}
          </div>
          <div className="mt-3 flex items-center gap-3 border-t border-ink-100 pt-3">
            <span className="grid h-9 w-9 flex-none place-items-center rounded-full bg-gradient-to-br from-ink-700 to-ink-900 text-[13px] font-semibold text-white">
              А
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-[12.5px] font-semibold text-ink-900">Асхат · мастер-приёмщик</span>
              <span className="block text-[11px] text-ink-500">стаж 11 лет · 4,9 · 860 заказ-нарядов</span>
            </span>
          </div>
          <div className="mt-1">
            <Row label="Замена масла и фильтра" value="50 мин · 8 500 ₸" />
            <Row label="Окно держится" value="10 минут" />
          </div>
        </PhoneCard>

        <Notice tone="info">
          <b>Это готовое ядро, а не макет.</b> Окна, записи и правило «одно окно — одна запись» уже работают в
          qtime-service. Не хватает вертикали: СТО, мастеров и услуг автосервиса в базе нет — компания, мастер
          и цена здесь демонстрационные.
        </Notice>

        <div className="mt-auto" />
        <div className="rounded-xl bg-brand-500 px-4 py-3 text-center text-[13px] font-semibold text-white">
          Записаться на 12:00 · 8 500 ₸
        </div>
        <div className="text-center text-[11px] text-ink-500">
          Запись создаётся с Idempotency-Key; занятое окно вернёт 409 SLOT_TAKEN
        </div>
      </PhoneBody>
    </>
  );
}
