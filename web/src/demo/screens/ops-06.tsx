/**
 * ops-06 · Поддержка · аудит чтения: кто смотрел чьи данные.
 *
 * Честность экрана: это принцип, а не деталь — каждое успешное чтение чужих данных пишет строку в
 * `support_audit_record` в той же транзакции, поэтому «данные выданы» и «строка есть» одно событие,
 * а неудачный поиск следа не оставляет. Журнал читается ручками `/support/audit/catalog` и
 * `/support/audit/orders` (роль ADMIN); числа чтений и имена агентов — демо.
 */
import { Badge } from '../../components/ui/Badge';
import { Chips, ConsolePanel, ConsoleRows, Kpis, Notice, Row } from '../kit';

const READINGS = [
  { title: '1 · support-agent-1', meta: 'чтение заказа SALE-01M3YA… по жалобе', right: '09:41:12' },
  { title: '2 · support-agent-4', meta: 'чтение поездки T01M3Y1A…', right: '09:38:55' },
  { title: '3 · support-agent-1', meta: 'чтение платежа PM-01J8ZCQ7Y4R3', right: '09:33:07' },
  { title: '4 · support-agent-7', meta: 'чтение товара 01M3YB… и остатка', right: '09:22:41' },
  { title: '5 · support-agent-4', meta: 'чтение записи QTime B-01M3YB7QK2', right: '08:59:18' },
];

export default function Ops06Audit() {
  return (
    <>
      <div className="flex flex-none items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[15px] font-bold tracking-tight text-ink-900">Аудит чтения чужих данных</div>
          <div className="truncate text-[12px] text-ink-500">
            Кто смотрел чьи данные и когда · журнал append-only
          </div>
        </div>
        <div className="flex flex-none items-center gap-2">
          <Badge tone="success">пишется в той же транзакции</Badge>
          <Badge tone="info">журнал читает ADMIN</Badge>
          <span className="rounded-xl bg-white px-3 py-1.5 text-[12px] text-ink-600 ring-1 ring-ink-200">
            Экспорт CSV
          </span>
        </div>
      </div>

      <Kpis
        items={[
          { label: 'Чтений за сутки', value: '312', hint: 'демо' },
          { label: 'Агентов', value: '4' },
          { label: 'Клиентов затронуто', value: '118' },
        ]}
      />

      <div className="grid min-h-0 flex-1 grid-cols-2 gap-3">
        <ConsolePanel title="Журнал чтений" right={<span className="text-[11px] text-ink-500">append-only</span>}>
          <Chips
            items={['Все', 'Каталог и заказы', 'Платежи', 'Поездки', 'Записи QTime']}
            active="Все"
          />
          <div className="mt-2.5">
            <ConsoleRows items={READINGS} />
          </div>
          <div className="mt-2 border-t border-ink-100 pt-1.5">
            <Row
              label="correlationId последнего чтения"
              value={<span className="font-mono text-[11px]">01J8ZCQ7Y4R3…M9QW1T</span>}
            />
          </div>
        </ConsolePanel>

        <ConsolePanel title="Как это устроено" right={<Badge tone="success">работает</Badge>}>
          <Row label="Запись" value={<span className="font-mono text-[11.5px]">support_audit_record</span>} />
          <Row label="Момент" value="в той же транзакции" />
          <Row label="Неудачный поиск" value="следа не оставляет" />
          <Row label="Журнал" value="только ADMIN" />
          <div className="my-2 border-t border-ink-100" />
          <div className="text-[11.5px] text-ink-600">
            Журнал читается двумя ручками по сервисам:{' '}
            <span className="font-mono">GET /api/v1/support/audit/catalog?resourceType=&amp;resourceId=</span> и{' '}
            <span className="font-mono">GET /api/v1/support/audit/orders?resourceType=&amp;resourceId=</span>. Пути
            разделены намеренно: один и тот же путь принадлежал бы двум сервисам, и шлюз не смог бы выбрать маршрут.
          </div>
          <div className="my-2 border-t border-ink-100" />
          <Row
            label="Метрики чтений"
            value={
              <span className="flex flex-col items-end font-mono text-[11px]">
                <span>taxi.catalog.support.read</span>
                <span>taxi.order.support.read</span>
              </span>
            }
          />
          <div className="mt-2 text-[11px] text-ink-400">
            Числа чтений и имена агентов — демо: журнал наполняется живыми записями.
          </div>
        </ConsolePanel>
      </div>

      <Notice tone="info">
        <b>Чтение фиксируется всегда.</b> Агент видит, что его чтение записано, но не правит журнал: строки не
        редактируются и не удаляются.
      </Notice>
    </>
  );
}
