/**
 * ops-02 · Поддержка · карточка клиента: счета и последние операции.
 *
 * Честность экрана: API счетов существует, но поддержке счета не открыты — ручки
 * `GET /api/v1/accounts/{id}`, `/{id}/transactions` и `/{id}/holds?status=ACTIVE` доступны
 * владельцу и ADMIN, роли SUPPORT в контракте нет. Сегодня настоящий ответ — `403 FORBIDDEN`,
 * поэтому экран показывает целевой вид и говорит об этом прямо. Суммы и операции — демо.
 */
import { Badge } from '../../components/ui/Badge';
import { ConsolePanel, ConsoleRows, Kpis, Money, Notice, Row } from '../kit';

const OPERATIONS = [
  {
    title: 'Пополнение счёта',
    meta: 'сегодня 09:38 · TOP_UP (демо)',
    right: <span className="text-[13px] font-semibold tabular-nums text-success-700">+15 000,00 ₸</span>,
  },
  {
    title: 'Оплата поездки',
    meta: 'сегодня 10:42 · RIDE_PAYMENT',
    right: <span className="text-[13px] font-semibold tabular-nums text-brand-700">−1 848,00 ₸</span>,
  },
  {
    title: 'Перевод по номеру',
    meta: 'сегодня 08:47 · TRANSFER_OUT',
    right: <span className="text-[13px] font-semibold tabular-nums text-brand-700">−2 500,00 ₸</span>,
  },
  {
    title: 'Оплата записи QTime',
    meta: '24 сен 15:30 · BOOKING_PAYMENT',
    right: <span className="text-[13px] font-semibold tabular-nums text-brand-700">−1 240,00 ₸</span>,
  },
  {
    title: 'Оплата поездки · 28 сен',
    meta: '28 сен 11:15 · RIDE_PAYMENT',
    right: <span className="text-[13px] font-semibold tabular-nums text-brand-700">−905,72 ₸</span>,
  },
];

const READERS = [
  { title: 'support-agent-1', meta: 'чтение счёта · 09:41:12 (демо)', right: <Badge tone="info">чтение</Badge> },
  { title: 'support-agent-4', meta: 'чтение поездки · 28 сен 11:20', right: <Badge tone="neutral">чтение</Badge> },
];

export default function Ops02ClientCard() {
  return (
    <>
      <div className="flex flex-none items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[15px] font-bold tracking-tight text-ink-900">Айша Н. · карточка клиента</div>
          <div className="truncate text-[12px] text-ink-500">
            U-1A2B3C4D5E · +7 707 118 42 05 · клиент с 12.03.2026 (демо)
          </div>
        </div>
        <div className="flex flex-none items-center gap-2">
          <Badge tone="danger">SUPPORT · только чтение</Badge>
          <span className="rounded-xl bg-white px-3 py-1.5 text-[12px] text-ink-600 ring-1 ring-ink-200">
            Скопировать ссылку
          </span>
        </div>
      </div>

      <Kpis
        items={[
          { label: 'Доступно', value: '3 500,00 ₸' },
          { label: 'В резерве', value: '0,00 ₸' },
          { label: 'Операций за 30 дней', value: '42' },
        ]}
      />

      <div className="grid min-h-0 flex-1 grid-cols-2 gap-3">
        <ConsolePanel
          title="Счёт KZT · CUSTOMER"
          right={<Badge tone="success">ACTIVE</Badge>}
        >
          <div className="font-mono text-[11.5px] text-ink-500">01J8ZCQ7Y4R3…M9QW1T</div>
          <div className="mt-1">
            <Row label="Баланс" value={<Money minor={350000} />} />
            <Row label="В резерве" value={<Money minor={0} />} />
            <Row label="Доступно" value={<Money minor={350000} />} strong />
          </div>
          <div className="my-2 border-t border-ink-100" />
          <div className="mb-1 flex items-center justify-between">
            <span className="text-[12.5px] font-semibold text-ink-800">Последние операции</span>
            <span className="text-[11.5px] font-medium text-brand-600">Вся выписка</span>
          </div>
          <ConsoleRows items={OPERATIONS} />
        </ConsolePanel>

        <div className="flex min-h-0 flex-col gap-3">
          <ConsolePanel title="Права и след">
            <Notice tone="danger">
              <b>Счета поддержке не открыты.</b> Чтение счёта, выписки и резервов по контракту доступно владельцу и
              ADMIN — роли SUPPORT в списке нет. Экран показывает целевой вид, настоящий ответ сегодня —{' '}
              <span className="font-mono">403 FORBIDDEN</span>: доступ нужно разрешить явно.
            </Notice>
            <div className="my-2 border-t border-ink-100" />
            <div className="mb-1 text-[12.5px] font-semibold text-ink-800">Кто смотрел эти данные</div>
            <ConsoleRows items={READERS} />
          </ConsolePanel>

          <ConsolePanel title="Внутренние ручки">
            <div className="text-[11.5px] text-ink-600">
              <span className="font-mono">GET /api/v1/accounts/internal/resolve?phone</span> и{' '}
              <span className="font-mono">/accounts/internal/accounts/{'{id}'}</span> консоль не вызывает: это
              сервис-сервис по <span className="font-mono">X-Internal-Token</span>.
            </div>
            <div className="mt-2 text-[11px] text-ink-400">Операции, суммы и время на экране — демо.</div>
          </ConsolePanel>
        </div>
      </div>
    </>
  );
}
