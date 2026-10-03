/**
 * ops-08 · Пульт · состояние сервисов и health.
 *
 * Честность экрана: пробы и healthcheck реальны — `GET /actuator/health`, `/health/liveness`,
 * `/health/readiness` (probes enabled, `show-details: when-authorized`), публичные пути шлюза —
 * `/actuator/health/**`, `/actuator/info`, `/actuator/prometheus`, а healthcheck в docker-compose
 * ждёт `wget /actuator/health | grep UP`. Агрегирующей панели сегодня нет — её и рисует экран.
 * Порты и состав сервисов взяты из docker-compose (8080–8088); uptime и счётчики проб — демо.
 */
import { Badge } from '../../components/ui/Badge';
import { ConsolePanel, ConsoleRows, Kpis, Notice, Row } from '../kit';

const SERVICES = [
  { name: 'api-gateway', port: ':8080', uptime: '3 ч 12 мин' },
  { name: 'account-service', port: ':8081', uptime: '3 ч 12 мин' },
  { name: 'payment-service', port: ':8082', uptime: '3 ч 11 мин' },
  { name: 'catalog-service', port: ':8083', uptime: '3 ч 11 мин' },
  { name: 'order-service', port: ':8084', uptime: '3 ч 10 мин' },
  { name: 'driver-service', port: ':8085', uptime: '3 ч 10 мин' },
  { name: 'trip-service', port: ':8086', uptime: '3 ч 9 мин' },
  { name: 'dispatch-service', port: ':8087', uptime: '3 ч 9 мин' },
  { name: 'qtime-service', port: ':8088', uptime: '3 ч 8 мин' },
];

export default function Ops08Health() {
  return (
    <>
      <div className="flex flex-none items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[15px] font-bold tracking-tight text-ink-900">Состояние сервисов и health</div>
          <div className="truncate text-[12px] text-ink-500">
            Девять сервисов, три базы инфраструктуры · опрос раз в 10 с (демо)
          </div>
        </div>
        <div className="flex flex-none items-center gap-2">
          <Badge tone="success">все пробы UP</Badge>
          <span className="rounded-xl bg-white px-3 py-1.5 text-[12px] text-ink-600 ring-1 ring-ink-200">
            Проверить все
          </span>
        </div>
      </div>

      <Kpis
        items={[
          { label: 'Сервисов', value: '9', hint: '27 проб в минуту' },
          { label: 'Отвечают UP', value: '9' },
          { label: 'Деградаций', value: '0' },
        ]}
      />

      <div className="grid min-h-0 flex-1 grid-cols-2 gap-3">
        <ConsolePanel
          title="Сервисы · порт · uptime"
          right={<span className="text-[11px] text-ink-500">порты из docker-compose</span>}
        >
          <ConsoleRows
            items={SERVICES.map((service) => ({
              title: service.name,
              right: (
                <>
                  <span className="font-mono text-[11px] text-ink-500">
                    {service.port} · {service.uptime}
                  </span>
                  <Badge tone="success">UP</Badge>
                </>
              ),
            }))}
          />
        </ConsolePanel>

        <ConsolePanel title="Пробы и публичные пути" right={<Badge tone="success">работает</Badge>}>
          <Row label={<span className="font-mono text-[11px]">GET /actuator/health</span>} value="UP" />
          <Row label={<span className="font-mono text-[11px]">/actuator/health/liveness</span>} value="UP" />
          <Row label={<span className="font-mono text-[11px]">/actuator/health/readiness</span>} value="UP" />
          <Row label="Детали проб" value="when-authorized" />
          <div className="my-2 border-t border-ink-100" />
          <div className="mb-1 text-[12.5px] font-semibold text-ink-800">Инфраструктура</div>
          <Row label="postgres + PostGIS" value="healthy" />
          <Row label="kafka" value="healthy" />
          <Row label="redis" value="healthy" />
          <div className="mt-2">
            <Notice tone="info">
              <b>Это работает сегодня.</b> Шлюз отдаёт наружу <span className="font-mono">/actuator/health/**</span>,{' '}
              <span className="font-mono">/actuator/info</span> и <span className="font-mono">/actuator/prometheus</span>;
              healthcheck в docker-compose ждёт <span className="font-mono">wget /actuator/health | grep UP</span>, и стек
              поднимается как 12 контейнеров healthy.
            </Notice>
          </div>
          <div className="mt-2 text-[11px] text-ink-400">
            Uptime и счётчики проб — демо: агрегирующей панели health нет, её и рисует экран.
          </div>
        </ConsolePanel>
      </div>
    </>
  );
}
