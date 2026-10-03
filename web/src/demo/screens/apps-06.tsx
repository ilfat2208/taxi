/**
 * apps-06 · Заработок за смену (приложение водителя).
 *
 * Статус борда — «План»: агрегата за смену в API нет. Готова только сумма к
 * начислению по каждой поездке — GET /api/v1/trips/{tripId}/receipt.
 * Предлагаемая ручка — GET /api/v1/drivers/earnings (roadmap §8).
 *
 * Честность экрана: выплаты водителю не выполняются (DRIVER_PAYOUT — только
 * событие будущего шага), чаевые не поддержаны, поэтому «чаевых нет» стоит
 * плашкой, а не мелким шрифтом. Суммы демонстрационные.
 */
import { Badge } from '../../components/ui/Badge';
import { Money, Notice, PhoneAppBar, PhoneBody, PhoneCard, PhoneTabBar, Row } from '../kit';

const DRIVER_TABS = ['Смена', 'Поездки', 'Деньги', 'Профиль'];

/** Начисление = сумма поездки минус комиссия 12%. */
const SHIFT_TRIPS: Array<{ time: string; tariff: string; fare: number; net: number }> = [
  { time: '10:42', tariff: 'Комфорт', fare: 184800, net: 162624 },
  { time: '11:20', tariff: 'Эконом', fare: 125000, net: 110000 },
  { time: '12:05', tariff: 'Комфорт', fare: 210000, net: 184800 },
  { time: '12:38', tariff: 'Эконом', fare: 95000, net: 83600 },
];

export default function Apps06() {
  return (
    <>
      <PhoneAppBar
        title="Заработок за смену"
        subtitle="смена 08:05 — 15:40 · 7 ч 35 мин"
        right={<Badge tone="neutral">План</Badge>}
      />
      <PhoneBody>
        <PhoneCard className="shrink-0">
          <div className="text-[11.5px] text-ink-500">Начислено за смену · демо</div>
          <div className="text-[26px] font-bold leading-8">
            <Money minor={541024} />
          </div>
          <div className="mt-2 flex flex-wrap gap-2">
            <Badge tone="brand">4 поездки</Badge>
            <Badge tone="neutral">комиссия 737,76 ₸</Badge>
            <Badge tone="neutral">чаевых нет</Badge>
          </div>
        </PhoneCard>

        <PhoneCard title="Поездки смены" className="shrink-0">
          {SHIFT_TRIPS.map((trip, index) => (
            <div key={trip.time}>
              {index > 0 ? <div className="h-px bg-ink-50" /> : null}
              <div className="flex items-baseline gap-3 py-1.5">
                <span className="w-10 flex-none text-[11.5px] tabular-nums text-ink-500">{trip.time}</span>
                <span className="min-w-0 flex-1 truncate text-[12.5px] font-medium text-ink-800">
                  {trip.tariff} · <Money minor={trip.fare} />
                </span>
                <Money minor={trip.net} />
              </div>
            </div>
          ))}
        </PhoneCard>

        <PhoneCard className="shrink-0">
          <Row label="Сумма поездок" value={<Money minor={614800} />} />
          <Row label="Комиссия платформы 12%" value={<span className="text-brand-700">−737,76 ₸</span>} />
          <Row label="Итого к начислению" value={<Money minor={541024} />} strong />
        </PhoneCard>

        <Notice tone="warning">
          <b>Сводки за смену в API нет.</b> Готова только сумма по каждой поездке — из чека
          <span className="font-mono"> GET /api/v1/trips/{'{tripId}'}/receipt</span>. Предлагается
          <span className="font-mono"> GET /api/v1/drivers/earnings</span>. Выплата водителю тоже не
          выполняется, а чаевые не поддержаны вовсе.
        </Notice>

        <div className="shrink-0 rounded-xl bg-ink-100 px-3 py-2.5 text-center text-[13px] font-semibold text-ink-700">
          Счёт и выплаты — план
        </div>
      </PhoneBody>
      <PhoneTabBar items={DRIVER_TABS} active="Деньги" />
    </>
  );
}
