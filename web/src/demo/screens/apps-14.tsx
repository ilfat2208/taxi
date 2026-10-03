/**
 * apps-14 · Деньги за смену (ORTA Delivery).
 *
 * Статус борда — «План»: денег за доставку в системе нет, курьерская часть не
 * смоделирована. Ставки 500 ₸ за задание и 60 ₸ за километр — предложение
 * макета, а не правило системы. Механика выплат, которую можно переиспользовать,
 * работает у мерчантов: GET /api/v1/settlements. Предлагаемая ручка —
 * GET /api/v1/couriers/me/earnings.
 *
 * Честность экрана: выплат курьерам не существует, чаевых тоже. Данные
 * демонстрационные: запросов к API экран не делает.
 */
import { Badge } from '../../components/ui/Badge';
import { Money, Notice, PhoneAppBar, PhoneBody, PhoneCard, PhoneTabBar, Row } from '../kit';

const COURIER_TABS = ['Задания', 'Карта', 'Деньги', 'Профиль'];

const BASE_FEE = 50000;
const PER_KM = 6000;

const DONE: Array<{ id: string; time: string; payout: number }> = [
  { id: 'D-4816', time: '16:12', payout: 61020 },
  { id: 'D-4817', time: '16:48', payout: 54500 },
  { id: 'D-4819', time: '17:30', payout: 72000 },
  { id: 'D-4820', time: '18:14', payout: 63000 },
  { id: 'D-4821', time: '18:52', payout: 62000 },
];

export default function Apps14() {
  return (
    <>
      <PhoneAppBar
        title="Деньги за смену"
        subtitle="смена 14:40 — 19:05 · демо"
        right={<Badge tone="neutral">План</Badge>}
      />
      <PhoneBody>
        <PhoneCard className="shrink-0">
          <div className="text-[11.5px] text-ink-500">Заработано за смену · демо</div>
          <div className="text-[26px] font-bold leading-8 text-[#0F6E8C]">
            <Money minor={312520} />
          </div>
          <div className="mt-2 flex flex-wrap gap-2">
            <Badge tone="brand">5 доставок</Badge>
            <Badge tone="neutral">10,42 км</Badge>
            <Badge tone="neutral">чаевых нет</Badge>
          </div>
        </PhoneCard>

        <PhoneCard title="Выполненные задания" className="shrink-0">
          {DONE.map((task, index) => (
            <div key={task.id}>
              {index > 0 ? <div className="h-px bg-ink-50" /> : null}
              <div className="flex items-baseline gap-3 py-1.5">
                <span className="w-14 flex-none font-mono text-[11.5px] text-ink-500">{task.id}</span>
                <span className="flex-1 text-[11.5px] tabular-nums text-ink-500">{task.time}</span>
                <Money minor={task.payout} />
              </div>
            </div>
          ))}
        </PhoneCard>

        <PhoneCard className="shrink-0">
          <Row label="База: 5 × 500,00 ₸" value={<Money minor={5 * BASE_FEE} />} />
          <Row label="Километры: 10,42 × 60,00 ₸" value={<Money minor={1042 * PER_KM} />} />
          <Row label="Итого" value={<Money minor={312520} />} strong />
        </PhoneCard>

        <Notice tone="warning">
          <b>Выплат курьерам не существует.</b> Покупатель платит за заказ в{' '}
          <span className="font-mono">payment-service</span>, а курьерская часть не смоделирована: ни ставки, ни
          счёта, ни расчёта. Ставки выше — предложение макета; переиспользовать можно механику мерчантов
          (<span className="font-mono">GET /api/v1/settlements</span>).
        </Notice>

        <div className="shrink-0 rounded-xl bg-[#0F6E8C] px-3 py-2.5 text-center text-[13px] font-semibold text-white">
          Завершить смену — план
        </div>
      </PhoneBody>
      <PhoneTabBar items={COURIER_TABS} active="Деньги" />
    </>
  );
}
