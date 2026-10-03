/**
 * ops-07 · Пульт · живые метрики: задержка событий, очереди, DLT, отказы.
 *
 * Честность экрана — главное на этой странице: метрики реально отдаются каждым сервисом
 * (`GET /actuator/prometheus`, `/actuator/metrics`), но их никто не собирает и не хранит —
 * Prometheus и Grafana в docker-compose нет. Поэтому все числа и график здесь демонстрационные,
 * `taxi.outbox.pending` пока только соглашение из docs/architecture.md, а размер DLT
 * (`<topic>.DLT`) виден лишь в Kafka UI на :8090.
 */
import { Badge } from '../../components/ui/Badge';
import { ConsolePanel, Kpis, Notice, Row } from '../kit';

/** Ряд задержки e2e за 45 минут, мс. Шкала графика — до 1 000 мс (критерий Ф1). */
const LATENCY = [
  { at: '09:00', ms: 180 },
  { at: '09:05', ms: 260 },
  { at: '09:10', ms: 240 },
  { at: '09:15', ms: 380 },
  { at: '09:20', ms: 420 },
  { at: '09:25', ms: 470 },
  { at: '09:30', ms: 450 },
  { at: '09:35', ms: 560 },
  { at: '09:40', ms: 580 },
  { at: '09:45', ms: 615 },
];

const LAG = [
  { topic: 'payment.events', messages: 42, width: '42%', tone: 'bg-warning-500' },
  { topic: 'trip.events', messages: 31, width: '31%', tone: 'bg-brand-500' },
  { topic: 'driver.events', messages: 28, width: '28%', tone: 'bg-brand-500' },
  { topic: 'settlement.events', messages: 19, width: '19%', tone: 'bg-brand-500' },
  { topic: 'qtime.events', messages: 8, width: '8%', tone: 'bg-brand-500' },
];

export default function Ops07Metrics() {
  return (
    <>
      <div className="flex flex-none items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[15px] font-bold tracking-tight text-ink-900">Живые метрики</div>
          <div className="truncate text-[12px] text-ink-500">
            Задержка событий, очереди, DLT и отказы платежей · срез 09:45 (демо)
          </div>
        </div>
        <div className="flex flex-none items-center gap-2">
          <Badge tone="warning">Prometheus не подключён</Badge>
          <span className="rounded-xl bg-white px-3 py-1.5 text-[12px] text-ink-600 ring-1 ring-ink-200">Обновить</span>
        </div>
      </div>

      <Notice tone="warning">
        <b>Цифры демонстрационные, а не собранные.</b> Prometheus и Grafana в docker-compose нет: метрики{' '}
        <span className="font-mono">/actuator/prometheus</span> отдаются каждым сервисом, но собирать и хранить их
        некому. Размер DLT (<span className="font-mono">&lt;topic&gt;.DLT</span>) виден только в Kafka UI:{' '}
        <span className="font-mono">8090</span>.
      </Notice>

      <Kpis
        items={[
          { label: 'Задержка событий p95', value: '490 мс', hint: 'живой замер e2e' },
          { label: 'Лаг очередей', value: '128', hint: 'сообщений' },
          { label: 'Отказы платежей за час', value: '6', hint: 'демо' },
        ]}
      />

      <div className="grid min-h-0 flex-1 grid-cols-2 gap-3">
        <ConsolePanel title="Задержка: outbox → Kafka → проекция" right={<Badge tone="success">p95 490 мс</Badge>}>
          <div className="text-[11.5px] text-ink-500">
            Критерий Ф1 — меньше секунды; график за 45 минут — демо.
          </div>
          <div className="mt-1 flex items-center justify-between text-[10.5px] text-ink-500">
            <span>мс, окно 45 минут</span>
            <span className="text-brand-600">— — 1 000 мс: критерий Ф1</span>
          </div>
          <div className="relative mt-1 h-[96px]">
            <div className="absolute inset-x-0 top-0 border-t border-dashed border-brand-400" />
            <div className="flex h-full items-end gap-1">
              {LATENCY.map((point) => (
                <div
                  key={point.at}
                  className="flex-1 rounded-t bg-brand-500/80"
                  style={{ height: `${point.ms / 10}%` }}
                />
              ))}
            </div>
          </div>
          <div className="mt-1 flex justify-between text-[10px] text-ink-400">
            <span>09:00</span>
            <span>09:15</span>
            <span>09:30</span>
            <span>09:45</span>
          </div>
          <div className="my-2 border-t border-ink-100" />
          <div className="mb-1 text-[12.5px] font-semibold text-ink-800">Лаг по топикам, сообщений</div>
          <div className="space-y-1">
            {LAG.map((item) => (
              <div key={item.topic}>
                <div className="flex items-baseline justify-between gap-3">
                  <span className="font-mono text-[11px] text-ink-600">{item.topic}</span>
                  <span className="text-[12px] text-ink-800">{item.messages}</span>
                </div>
                <div className="mt-0.5 h-1.5 rounded-full bg-ink-100">
                  <div className={`h-1.5 rounded-full ${item.tone}`} style={{ width: item.width }} />
                </div>
              </div>
            ))}
          </div>
        </ConsolePanel>

        <ConsolePanel title="Бизнес-метрики" right={<span className="text-[11px] text-ink-500">за час, демо</span>}>
          <Row label={<span className="font-mono text-[11px]">taxi.settlement.debt.minor</span>} value="0,00 ₸" />
          <Row label={<span className="font-mono text-[11px]">taxi.settlement.overdue.count</span>} value="0" />
          <Row label={<span className="font-mono text-[11px]">taxi.payment.open.count</span>} value="3" />
          <Row
            label={<span className="font-mono text-[11px]">taxi.payment.failed{'{INSUFFICIENT_FUNDS}'}</span>}
            value="4"
          />
          <Row label={<span className="font-mono text-[11px]">taxi.payment.failed{'{HOLD_FAILED}'}</span>} value="2" />
          <Row label={<span className="font-mono text-[11px]">taxi.reconciliation.findings</span>} value="0" />
          <Row label={<span className="font-mono text-[11px]">taxi.account.limit.refusals</span>} value="11" />
          <Row
            label={<span className="font-mono text-[11px]">&lt;topic&gt;.DLT</span>}
            value={<span className="text-[11.5px]">только Kafka UI :8090</span>}
          />
          <Row
            label={<span className="font-mono text-[11px]">taxi.outbox.pending</span>}
            value={<span className="text-[11.5px]">соглашение из docs, в коде нет</span>}
          />
          <div className="mt-2 text-[11px] text-ink-500">
            Здоровое значение находок сверки — строго ноль: растущий долг перед мерчантами означает, что выплаты
            сломаны.
          </div>
        </ConsolePanel>
      </div>
    </>
  );
}
