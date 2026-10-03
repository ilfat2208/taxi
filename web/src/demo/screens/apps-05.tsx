/**
 * apps-05 · Завершение и сумма к начислению (приложение водителя).
 *
 * Статус борда — «В работе»: завершение списывает деньги и собирает чек —
 * POST /api/v1/trips/internal/{tripId}/complete, затем чек
 * GET /api/v1/trips/{tripId}/receipt; до COMPLETED — 409 TRIP_NOT_COMPLETED.
 *
 * Честность экрана: суммы настоящие (400,00 + 960,00 + 488,00 = 1 848,00 ₸,
 * доход водителя 1 626,24 ₸ при комиссии 12%), но это сумма чека, а не деньги
 * на счёте: выплата водителю в этой фазе не выполняется. Карта — схема.
 * Данные демонстрационные: запросов к API экран не делает.
 */
import { Badge } from '../../components/ui/Badge';
import { Money, Notice, PhoneAppBar, PhoneBody, PhoneCard, Row } from '../kit';

const TRIP_ID = 'T01M3Y1AYYJGHVVY7NCZQ690MJF';

const FARE: Array<{ label: string; value: number }> = [
  { label: 'База', value: 40000 },
  { label: 'Расстояние 6,4 км', value: 96000 },
  { label: 'Время 18 мин', value: 48800 },
  { label: 'Пассажир заплатил', value: 184800 },
];

export default function Apps05() {
  return (
    <>
      <PhoneAppBar title="Поездка завершена" subtitle={TRIP_ID} right={<Badge tone="success">COMPLETED</Badge>} />
      <PhoneBody>
        <div className="relative h-[106px] shrink-0 overflow-hidden rounded-2xl bg-gradient-to-br from-[#EEF2F7] to-[#E3EAF3] ring-1 ring-ink-200">
          <div className="absolute left-6 top-6 h-9 w-14 rounded-md bg-[#DFE5EC]" />
          <div className="absolute left-30 top-4 h-9 w-16 rounded-md bg-[#DFE5EC]" />
          <div className="absolute left-56 top-6 h-10 w-14 rounded-md bg-[#DFE5EC]" />
          <div className="absolute -left-6 top-[68px] h-[10px] w-[420px] -rotate-[6deg] rounded-full bg-white" />
          <div className="absolute left-[122px] -top-3 h-[160px] w-[10px] rotate-[6deg] rounded-full bg-white" />
          <div className="absolute left-[64px] top-[44px] h-0 w-[218px] -rotate-[5deg] border-t-[3px] border-dashed border-brand-500" />
          <div className="absolute left-[264px] top-[34px] grid h-[22px] w-[22px] place-items-center rounded-full bg-[#0E7C7B] text-[10px] font-bold text-white ring-[3px] ring-white">
            Б
          </div>
          <span className="absolute left-2.5 top-2.5 rounded-full bg-white/95 px-2.5 py-1 text-[11px] font-medium text-ink-800 shadow-sm">
            Прибыли на точку Б · 10:42
          </span>
          <span className="absolute bottom-2.5 left-2.5 rounded-full bg-white/95 px-2.5 py-1 text-[10.5px] text-ink-500 shadow-sm">
            схема, не тайлы OSM
          </span>
        </div>

        <PhoneCard title="Чек поездки" className="shrink-0">
          {FARE.map((item) => (
            <Row key={item.label} label={item.label} value={<Money minor={item.value} />} />
          ))}
          <Row label="Комиссия платформы 12%" value={<span className="text-brand-700">−221,76 ₸</span>} />
        </PhoneCard>

        <div className="flex shrink-0 items-center justify-between gap-3 rounded-2xl bg-success-50 px-3 py-2.5 ring-1 ring-inset ring-emerald-200">
          <span className="text-[13px] font-semibold text-success-700">К начислению</span>
          <span className="text-[20px] font-bold leading-6 text-success-700">
            <Money minor={162624} />
          </span>
        </div>

        <Notice tone="warning">
          <b>Это сумма чека, а не деньги на счёте.</b> Выплата водителю в этой фазе не выполняется: у пассажира
          деньги списывает <span className="font-mono">account-service</span> (capture холда, события
          RIDE_PAYMENT и DRIVER_ACCRUAL), а расчёт с водителем — следующий шаг, той же механикой, что у
          мерчантов.
        </Notice>

        <div className="shrink-0 rounded-xl bg-brand-500 px-3 py-2.5 text-center text-[13px] font-semibold text-white">
          К следующему заказу
        </div>
      </PhoneBody>
    </>
  );
}
