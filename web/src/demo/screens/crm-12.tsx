/**
 * crm-12 · Клиенты и повторная запись.
 *
 * Клиентской базы в QTime нет: есть только booking.client_user_id — идентификатор аккаунта
 * ORTA ID без имени и телефона. Историю визитов API отдаёт самому клиенту, а SUPPORT и
 * ADMIN видят все записи; роли MERCHANT чужие записи не отдаются, поэтому салон свою базу
 * сегодня не увидит.
 *
 * Напоминаний нет ни в API, ни в модели: событие booking.created уходит в Kafka, но центра
 * уведомлений и пушей нет, поэтому «Напомнить» — кнопка без канала. Метка «постоянный» —
 * предлагаемое правило консоли, а не свойство сервиса.
 */
import type { ReactNode } from 'react';
import { Badge } from '../../components/ui/Badge';
import { ConsolePanel, ConsoleTable, Money, Notice } from '../kit';

const COLUMNS = ['Клиент', 'Визитов', 'Последний визит', 'Сумма визитов', 'Действие'];

interface ClientRow {
  id: string;
  note: string;
  visits: number;
  last: string;
  minor: number;
  action: string;
}

const CLIENTS: ClientRow[] = [
  { id: 'demo-client-1', note: 'постоянный: 4 визита за 90 дней', visits: 4, last: '2 окт, 10:30', minor: 3900000, action: 'Повторить' },
  { id: '01J8…9QW1T', note: 'постоянный: 5 визитов', visits: 5, last: '28 сен, 16:00', minor: 3150000, action: 'Повторить' },
  { id: '01M3…H5SX5', note: '3 визита', visits: 3, last: '21 сен, 12:00', minor: 2500000, action: 'Повторить' },
  { id: 'demo-client-7', note: 'первый визит', visits: 1, last: '18 сен, 11:00', minor: 600000, action: 'Напомнить' },
  { id: 'demo-client-9', note: 'отменил дважды', visits: 2, last: '10 сен, 15:00', minor: 0, action: 'Повторить' },
];

const ROWS: ReactNode[][] = CLIENTS.map((client) => [
  <span className="block">
    <span className="block truncate font-mono text-[12px] text-ink-800">{client.id}</span>
    <span className="block truncate text-[10.5px] text-ink-500">{client.note}</span>
  </span>,
  String(client.visits),
  client.last,
  <Money minor={client.minor} />,
  <span className="text-brand-600">{client.action}</span>,
]);

export default function CrmClients() {
  return (
    <>
      <div className="flex items-center gap-2">
        <div className="min-w-0">
          <div className="truncate text-[13px] font-semibold text-ink-900">Клиенты</div>
          <div className="truncate text-[11.5px] text-ink-500">
            Собираются из записей · ключ — <span className="font-mono">booking.client_user_id</span>
          </div>
        </div>
        <span className="ml-auto flex items-center gap-2">
          <Badge tone="brand">Все</Badge>
          <Badge tone="neutral">Постоянные</Badge>
          <Badge tone="neutral">Не приходили</Badge>
          <Badge tone="danger">напоминаний нет</Badge>
        </span>
      </div>

      <ConsolePanel
        title="База салона"
        right={<span className="text-[11px] text-ink-500">любимый мастер считается на клиенте по записям</span>}
      >
        <ConsoleTable columns={COLUMNS} rows={ROWS} />
      </ConsolePanel>

      <div className="grid grid-cols-2 gap-3">
        <Notice tone="warning">
          <b>Чего у клиентской базы нет.</b> Таблицы клиента нет — есть только{' '}
          <code className="rounded bg-black/5 px-1 font-mono text-[11px]">booking.client_user_id</code>. Имени и телефона
          в QTime тоже нет: они лежат в ORTA ID. Метка «постоянный» (3 визита за 90 дней) и повторная запись — предлагаемые
          правила консоли, а не свойство сервиса.
        </Notice>
        <Notice tone="danger">
          <b>История визитов и персональные данные — два разных вопроса.</b> Историю API отдаёт самому клиенту, а SUPPORT
          и ADMIN видят все записи; роли MERCHANT чужие записи не отдаются, поэтому салон свою базу сегодня не увидит.
          Показывать ли салону имя и телефон — решение о доступе и согласии, а не поле в таблице.
        </Notice>
      </div>
    </>
  );
}
