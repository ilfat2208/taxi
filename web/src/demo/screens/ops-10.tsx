/**
 * ops-10 · Пульт · медленные запросы и журнал correlationId для разбора жалобы.
 *
 * Честность экрана: correlationId сквозной — шлюз генерирует его, он едет в заголовке
 * X-Correlation-Id, в MDC логов и в headers Kafka-событий, а при ошибке возвращается в RFC 7807
 * вместе с code; p95 по URI есть в GET /actuator/metrics/http.server.requests. Чего нет: хранилища
 * логов (Loki и ELK в compose отсутствуют) и готового списка медленных запросов — его агрегирует
 * консоль. Цепочка и тайминги — демо.
 */
import { Badge } from '../../components/ui/Badge';
import { ConsolePanel, Notice } from '../kit';

const SLOW = [
  { endpoint: 'POST /api/v1/orders', ms: '1 240 мс', width: '100%', tone: 'bg-brand-500' },
  { endpoint: 'POST /api/v1/payments/transfers', ms: '820 мс', width: '66%', tone: 'bg-warning-500' },
  { endpoint: 'POST /api/v1/trips/quote', ms: '610 мс', width: '49%', tone: 'bg-warning-500' },
  { endpoint: 'GET /api/v1/trips/{id}', ms: '410 мс', width: '33%', tone: 'bg-ink-300' },
  { endpoint: 'GET /api/v1/qtime/companies', ms: '180 мс', width: '14%', tone: 'bg-ink-300' },
];

const CHAIN = [
  {
    title: 'api-gateway · 201 · 12 мс',
    note: 'id сгенерирован, уехал в X-Correlation-Id',
    tone: 'bg-success-500',
  },
  {
    title: 'payment-service · 201 · 96 мс',
    note: 'перевод COMPLETED, Idempotency-Key принят',
    tone: 'bg-success-500',
  },
  {
    title: 'account-service · 200 · 41 мс',
    note: 'холд → capture, Σ debit = Σ credit',
    tone: 'bg-success-500',
  },
  {
    title: 'order-service · 500 · 1 240 мс',
    note: 'INTERNAL_ERROR, в ответе RFC 7807 тот же correlationId',
    tone: 'bg-brand-500',
  },
  {
    title: 'никогда не дошло',
    note: 'событие order.paid не опубликовано — outbox остался PENDING',
    tone: 'bg-ink-300',
  },
];

export default function Ops10SlowRequests() {
  return (
    <>
      <div className="flex flex-none items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[15px] font-bold tracking-tight text-ink-900">
            Разбор жалобы: медленные запросы и correlationId
          </div>
          <div className="truncate text-[12px] text-ink-500">
            Жалоба «деньги списались, заказ не создался» · разбор по одному идентификатору
          </div>
        </div>
        <div className="flex flex-none items-center gap-2">
          <Badge tone="info">окно 45 мин</Badge>
          <span className="rounded-xl bg-white px-3 py-1.5 text-[12px] text-ink-600 ring-1 ring-ink-200">Найти</span>
        </div>
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-2 gap-3">
        <ConsolePanel
          title="Медленные эндпоинты, p95"
          right={<span className="text-[11px] text-ink-500">actuator/metrics</span>}
        >
          <div className="space-y-2">
            {SLOW.map((item) => (
              <div key={item.endpoint}>
                <div className="flex items-baseline justify-between gap-3">
                  <span className="truncate font-mono text-[11px] text-ink-600">{item.endpoint}</span>
                  <span className="text-[12px] font-semibold tabular-nums text-ink-900">{item.ms}</span>
                </div>
                <div className="mt-1 h-1.5 rounded-full bg-ink-100">
                  <div className={`h-1.5 rounded-full ${item.tone}`} style={{ width: item.width }} />
                </div>
              </div>
            ))}
          </div>
          <div className="mt-2 text-[11px] text-ink-500">
            Источник — метрика <span className="font-mono">http.server.requests</span> из{' '}
            <span className="font-mono">GET /actuator/metrics</span>: p95 по URI есть, готового списка «топ медленных»
            нет — его собирает консоль. Числа — демо.
          </div>
          <div className="my-2 border-t border-ink-100" />
          <Notice tone="warning">
            <b>Что мешает разбору сегодня.</b> Централизованного хранилища логов нет (Loki и ELK в docker-compose
            отсутствуют), поэтому поиск по correlationId — это ручной grep по логам сервисов.
          </Notice>
        </ConsolePanel>

        <ConsolePanel title="correlationId" right={<Badge tone="info">сквозной</Badge>}>
          <div className="rounded-xl border border-brand-300 bg-brand-50/60 px-3 py-2">
            <div className="text-[11px] text-brand-700">Идентификатор запроса</div>
            <div className="font-mono text-[11.5px] text-ink-900">01J8ZCQ7Y4R3…M9QW1T</div>
          </div>
          <div className="mb-1 mt-3 text-[12.5px] font-semibold text-ink-800">Цепочка вызовов</div>
          <ul className="space-y-2">
            {CHAIN.map((step) => (
              <li key={step.title} className="flex gap-2.5">
                <span className={`mt-1.5 h-2 w-2 flex-none rounded-full ${step.tone}`} />
                <div className="min-w-0">
                  <div className="text-[12.5px] font-semibold text-ink-900">{step.title}</div>
                  <div className="text-[11.5px] text-ink-500">{step.note}</div>
                </div>
              </li>
            ))}
          </ul>
          <div className="mt-2 text-[11px] text-ink-400">
            Цепочка и тайминги — демо: журнал сегодня это grep по файлам сервисов, а{' '}
            <span className="font-mono">GET /api/v1/ops/traces/{'{correlationId}'}</span> — предложение.
          </div>
        </ConsolePanel>
      </div>
    </>
  );
}
