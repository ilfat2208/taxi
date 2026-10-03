/**
 * ops-01 · Поддержка · поиск клиента (телефон, счёт, платёж, поездка, запись).
 *
 * Честность экрана: точечные чтения (`GET /api/v1/payments/{id}`, `/trips`, `/qtime/bookings/{id}`,
 * `/support/orders`) работают, но сквозного поиска нет — `GET /api/v1/accounts/internal/resolve?phone`
 * внутренняя ручка, её вызывают только сервисы по `X-Internal-Token`, поэтому единую строку по
 * телефону собирает консоль. Телефон, id и суммы — демо.
 */
import { Badge } from '../../components/ui/Badge';
import { Chips, ConsolePanel, ConsoleRows, Notice } from '../kit';

const FOUND = [
  {
    title: 'Айша Н. · +7 707 118 42 05',
    meta: 'U-1A2B3C4D5E · 2 счёта KZT · 4 поездки · 1 запись',
    right: (
      <>
        <Badge tone="success">клиент</Badge>
        <span className="text-[12px] font-medium text-brand-600">Карточка</span>
      </>
    ),
  },
  {
    title: 'Счёт KZT · CUSTOMER',
    meta: '01J8Z…QW1T · доступно 3 500,00 ₸',
    right: (
      <>
        <Badge tone="success">ACTIVE</Badge>
        <span className="text-[12px] font-medium text-brand-600">Операции</span>
      </>
    ),
  },
  {
    title: 'Платёж PM-01J8ZCQ7Y4R3 · 1 848,00 ₸',
    meta: 'RIDE_PAYMENT · сегодня 10:42:11',
    right: (
      <>
        <Badge tone="success">COMPLETED</Badge>
        <span className="text-[12px] font-medium text-brand-600">Платёж</span>
      </>
    ),
  },
  {
    title: 'Поездка T01M3Y1A…690MJF',
    meta: 'COMFORT · 6,4 км · 18 мин · 1 848,00 ₸',
    right: (
      <>
        <Badge tone="success">COMPLETED</Badge>
        <span className="text-[12px] font-medium text-brand-600">Поездка</span>
      </>
    ),
  },
  {
    title: 'Запись QTime B-01M3YB7QK2 · стрижка',
    meta: '24 сен, 15:30 · специалист Асель К.',
    right: (
      <>
        <Badge tone="neutral">CONFIRMED</Badge>
        <span className="text-[12px] font-medium text-brand-600">Запись</span>
      </>
    ),
  },
];

export default function Ops01ClientSearch() {
  return (
    <>
      <div className="flex flex-none items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[15px] font-bold tracking-tight text-ink-900">Поиск клиента</div>
          <div className="truncate text-[12px] text-ink-500">
            Телефон, счёт, платёж, поездка или номер записи — одна строка
          </div>
        </div>
        <div className="flex flex-none items-center gap-2">
          <Badge tone="warning">в работе</Badge>
          <span className="rounded-xl bg-white px-3 py-1.5 text-[12px] text-ink-600 ring-1 ring-ink-200">Сбросить</span>
        </div>
      </div>

      <ConsolePanel>
        <div className="flex items-center gap-2 rounded-xl border border-ink-200 bg-white px-3 py-2.5">
          <span className="text-[13px] text-ink-400">⌕</span>
          <span className="text-[14px] text-ink-900">+7 707 118 42 05</span>
          <span className="ml-auto rounded-lg bg-brand-500 px-3 py-1.5 text-[12px] font-medium text-white">Найти</span>
        </div>
        <div className="mt-3">
          <Chips items={['Телефон', 'Счёт', 'Платёж', 'Поездка', 'Запись', 'Заказ']} active="Телефон" />
        </div>
      </ConsolePanel>

      <ConsolePanel
        title="Найдено 5 объектов"
        right={<span className="text-[11px] text-ink-500">каждое открытие — чтение чужих данных</span>}
      >
        <ConsoleRows items={FOUND} />
      </ConsolePanel>

      <Notice tone="info">
        <b>Чтение чужих данных фиксируется:</b> открытие карточки — это чтение, и строка в{' '}
        <span className="font-mono">support_audit_record</span> пишется в той же транзакции, что и выдача данных.
      </Notice>

      <Notice tone="warning">
        <b>Сквозного поиска нет:</b> точечные чтения работают, но единую строку по телефону собирает консоль —{' '}
        <span className="font-mono">accounts/internal/resolve?phone</span> внутренняя ручка по{' '}
        <span className="font-mono">X-Internal-Token</span>. Телефон, id и суммы — демо.
      </Notice>
    </>
  );
}
