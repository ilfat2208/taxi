/**
 * ops-03 · Поддержка · карточка платежа и поездки (чек).
 *
 * Честность экрана: все три чтения уже разрешены роли SUPPORT — `GET /api/v1/payments/{id}` с историей
 * переходов, `/{id}/refunds`, `GET /api/v1/trips/{tripId}` и `/{tripId}/receipt`; экрана нет.
 * Суммы взяты из живой поездки: 400,00 + 960,00 + 488,00 = 1 848,00 ₸ и 1 626,24 + 221,76 = 1 848,00 ₸
 * при комиссии 1 200 bp. Id и время — демо.
 */
import { Badge } from '../../components/ui/Badge';
import { ConsolePanel, Money, Notice, Row } from '../kit';

const TRANSITIONS = [
  { at: '09:44:02', state: 'INITIATED', note: 'пассажир, счёт KZT CUSTOMER', tone: 'bg-ink-300' },
  { at: '09:44:05', state: 'PENDING', note: 'резерв 1 848,00 ₸, hold 01J8ZH…7QK2', tone: 'bg-ink-300' },
  { at: '10:42:11', state: 'COMPLETED', note: 'списание при завершении поездки, transactionId 01J8ZL4…', tone: 'bg-success-500' },
];

export default function Ops03PaymentTrip() {
  return (
    <>
      <div className="flex flex-none items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[15px] font-bold tracking-tight text-ink-900">Платёж и поездка</div>
          <div className="truncate text-[12px] text-ink-500">
            Платёж PM-01J8ZCQ7Y4R3 · поездка T01M3Y1A…690MJF (демо)
          </div>
        </div>
        <div className="flex flex-none items-center gap-2">
          <Badge tone="success">COMPLETED</Badge>
          <span className="rounded-xl bg-white px-3 py-1.5 text-[12px] text-ink-600 ring-1 ring-ink-200">
            Скопировать id
          </span>
        </div>
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-2 gap-3">
        <ConsolePanel title="Платёж · списание с кошелька" right={<Badge tone="brand">RIDE_PAYMENT</Badge>}>
          <Row label="Сумма" value={<Money minor={184800} />} strong />
          <Row label="Комиссия платформы" value={<span>221,76 ₸ · 1 200 bp</span>} />
          <Row label="Водителю" value={<Money minor={162624} />} />
          <Row label="Счёт списания" value={<span className="font-mono text-[11.5px]">01J8Z…QW1T</span>} />
          <Row label="Возвраты" value="нет" />
          <div className="my-2 border-t border-ink-100" />
          <div className="mb-2 text-[12.5px] font-semibold text-ink-800">История переходов</div>
          <ul className="space-y-2.5">
            {TRANSITIONS.map((step) => (
              <li key={step.state} className="flex gap-2.5">
                <span className={`mt-1.5 h-2 w-2 flex-none rounded-full ${step.tone}`} />
                <div className="min-w-0">
                  <div className="text-[12.5px] font-semibold text-ink-900">
                    {step.state} · {step.at}
                  </div>
                  <div className="text-[11.5px] text-ink-500">{step.note}</div>
                </div>
              </li>
            ))}
          </ul>
        </ConsolePanel>

        <div className="flex min-h-0 flex-col gap-3">
          <ConsolePanel title="Поездка и чек" right={<Badge tone="success">COMPLETED</Badge>}>
            <Row label="Тариф" value="COMFORT" />
            <Row label="Расстояние" value="6,4 км" />
            <Row label="Время" value="18 мин" />
            <Row label="База" value={<Money minor={40000} />} />
            <Row label="Километры" value={<Money minor={96000} />} />
            <Row label="Минуты" value={<Money minor={48800} />} />
            <Row label="Цена" value={<Money minor={184800} />} strong />
            <div className="mt-2">
              <Notice tone="info">
                <b>Инварианты чека сошлись:</b> 400,00 + 960,00 + 488,00 = 1 848,00 ₸ и 1 626,24 + 221,76 = 1 848,00 ₸.
                Деньги сдвинулись один раз: резерв при назначении, списание при завершении.
              </Notice>
            </div>
          </ConsolePanel>

          <ConsolePanel title="Что читает экран">
            <div className="text-[11.5px] text-ink-600">
              Все три чтения разрешены роли SUPPORT: <span className="font-mono">GET /api/v1/payments/{'{id}'}</span>,{' '}
              <span className="font-mono">/payments/{'{id}'}/refunds</span>,{' '}
              <span className="font-mono">GET /api/v1/trips/{'{tripId}'}</span> и{' '}
              <span className="font-mono">/{'{tripId}'}/receipt</span>. События:{' '}
              <span className="font-mono">trip.completed</span>, <span className="font-mono">payment.completed</span>.
            </div>
            <div className="mt-2 text-[11px] text-ink-400">
              Экрана нет ни у поддержки, ни в вебе — есть только страницы владельца. Id и время — демо.
            </div>
          </ConsolePanel>
        </div>
      </div>
    </>
  );
}
