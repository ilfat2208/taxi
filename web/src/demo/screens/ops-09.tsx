/**
 * ops-09 · Пульт · инциденты и деградации.
 *
 * Честность экрана: реестра инцидентов, дежурств и алертинга в репозитории нет — Alertmanager и Grafana
 * в docker-compose тоже отсутствуют. Экран опирается только на то, что уже отдаётся: GET /actuator/health,
 * GET /actuator/prometheus и бизнес-метрики. Пороги открытия — предложение, инциденты и время — демо.
 */
import { Badge } from '../../components/ui/Badge';
import { ConsolePanel, ConsoleRows, Kpis, Notice, Row } from '../kit';

const INCIDENTS = [
  {
    title: 'Записи в DLT payment.events',
    meta: 'ретраи не помогли · payment-service · 09:12',
    right: (
      <>
        <Badge tone="danger">SEV-2</Badge>
        <span className="text-[11.5px] text-ink-500">38 мин</span>
      </>
    ),
  },
  {
    title: 'p95 /api/v1/trips/quote · 2,4 с',
    meta: 'trip-service · 08:40 · деградация, не отказ',
    right: (
      <>
        <Badge tone="warning">SEV-3</Badge>
        <span className="text-[11.5px] text-ink-500">1 ч 05</span>
      </>
    ),
  },
  {
    title: 'Лаг settlement.events 900 сообщений',
    meta: 'payment-service · закрыт 08:12 после рестарта',
    right: (
      <>
        <Badge tone="neutral">SEV-3</Badge>
        <span className="text-[11.5px] text-ink-500">закрыт</span>
      </>
    ),
  },
  {
    title: 'Долг перед мерчантами рос 6 часов',
    meta: 'taxi.settlement.debt.minor · закрыт 27 сен',
    right: (
      <>
        <Badge tone="neutral">SEV-2</Badge>
        <span className="text-[11.5px] text-ink-500">закрыт</span>
      </>
    ),
  },
];

export default function Ops09Incidents() {
  return (
    <>
      <div className="flex flex-none items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[15px] font-bold tracking-tight text-ink-900">Инциденты и деградации</div>
          <div className="truncate text-[12px] text-ink-500">
            Что сломано, кого это касается и кто ведёт разбор
          </div>
        </div>
        <div className="flex flex-none items-center gap-2">
          <Badge tone="danger">2 открытых</Badge>
          <span className="rounded-xl bg-white px-3 py-1.5 text-[12px] text-ink-600 ring-1 ring-ink-200">
            Создать инцидент
          </span>
        </div>
      </div>

      <Kpis
        items={[
          { label: 'Открытых инцидентов', value: '2' },
          { label: 'Деградаций', value: '1', hint: 'не отказ' },
          { label: 'Время до реакции', value: '4 мин', hint: 'закрыто за сутки — 3' },
        ]}
      />

      <div className="grid min-h-0 flex-1 grid-cols-2 gap-3">
        <ConsolePanel title="Активные и недавние" right={<span className="text-[11px] font-medium text-brand-600">Все инциденты</span>}>
          <ConsoleRows items={INCIDENTS} />
          <div className="mt-2 text-[11px] text-ink-400">
            Инциденты, время и дежурные — демо: реестра инцидентов в репозитории нет.
          </div>
        </ConsolePanel>

        <ConsolePanel title="Правила открытия · предлагаемые" right={<Badge tone="neutral">проект</Badge>}>
          <Row label="findings сверки > 0" value={<Badge tone="danger">SEV-2</Badge>} />
          <Row label="DLT > 0" value={<Badge tone="danger">SEV-2</Badge>} />
          <Row label="lag > 1 000" value={<Badge tone="warning">SEV-3</Badge>} />
          <Row label="failed{reason} > 20 / 5 мин" value={<Badge tone="danger">SEV-2</Badge>} />
          <Row label="health DOWN 2 пробы подряд" value={<Badge tone="danger">SEV-1</Badge>} />
          <div className="my-2 border-t border-ink-100" />
          <div className="text-[11.5px] text-ink-600">
            Опора — реальные <span className="font-mono">GET /actuator/health</span> и{' '}
            <span className="font-mono">GET /actuator/prometheus</span>, метрики{' '}
            <span className="font-mono">taxi.reconciliation.findings</span>,{' '}
            <span className="font-mono">taxi.settlement.debt.minor</span>,{' '}
            <span className="font-mono">taxi.payment.failed{'{reason}'}</span>.
          </div>
        </ConsolePanel>
      </div>

      <Notice tone="warning">
        <b>Экран — предложение.</b> Системы инцидентов, дежурств и алертинга в репозитории нет: ни Alertmanager, ни
        Grafana в docker-compose. Сегодня инцидент замечает человек, а не система; предлагаемые ручки —{' '}
        <span className="font-mono">POST /api/v1/ops/incidents</span>,{' '}
        <span className="font-mono">GET /api/v1/ops/incidents?status=</span>,{' '}
        <span className="font-mono">POST /api/v1/ops/incidents/{'{id}'}/ack</span>.
      </Notice>
    </>
  );
}
