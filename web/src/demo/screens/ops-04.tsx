/**
 * ops-04 · Поддержка · возврат средств с причиной.
 *
 * Честность экрана: возврат работает в коде (`POST /api/v1/payments/{id}/refund` с обязательным
 * `Idempotency-Key`, причина обязательна, накопленные возвраты не превышают платёж), но это действие
 * оператора, а не агента: поддержка read-only по деньгам, поэтому кнопка выключена. Спорно: и чтение,
 * и возврат идут через `PaymentAccess.canAccess()`, который сегодня пропускает SUPPORT, — серверное
 * правило нужно ужесточить, интерфейс этого не заменит. Мотив и ключ — демо.
 */
import { Badge } from '../../components/ui/Badge';
import { Chips, ConsolePanel, Money, Notice, Row } from '../kit';

const STEPS = [
  { title: 'Новая проводка-кредит', note: 'возврат ссылается на refundId, списание не разворачивается', tone: 'bg-ink-300' },
  {
    title: 'Деньги на счёт-источник',
    note: 'POST /api/v1/accounts/internal/credits, идемпотентно по (referenceType, referenceId)',
    tone: 'bg-ink-300',
  },
  { title: 'Полный возврат → REVERSED', note: 'частичный оставляет платёж COMPLETED', tone: 'bg-success-500' },
];

export default function Ops04Refund() {
  return (
    <>
      <div className="flex flex-none items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[15px] font-bold tracking-tight text-ink-900">Возврат средств</div>
          <div className="truncate text-[12px] text-ink-500">
            Платёж PM-01J8ZCQ7Y4R3 · 1 848,00 ₸ · COMPLETED (демо)
          </div>
        </div>
        <div className="flex flex-none items-center gap-2">
          <Badge tone="danger">SUPPORT: read-only по деньгам</Badge>
        </div>
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-2 gap-3">
        <ConsolePanel title="Параметры возврата" right={<Badge tone="success">код готов</Badge>}>
          <div className="space-y-2.5">
            <div className="rounded-xl border border-ink-200 px-3 py-2">
              <div className="text-[11px] text-ink-500">Платёж</div>
              <div className="font-mono text-[11.5px] text-ink-800">PM-01J8ZCQ7Y4R3 · 1 848,00 ₸ · COMPLETED</div>
            </div>
            <div className="rounded-xl border border-brand-300 bg-brand-50/60 px-3 py-2">
              <div className="text-[11px] text-brand-700">Сумма возврата</div>
              <div className="text-[13px] text-ink-900">
                <Money minor={184800} />
              </div>
            </div>
            <div className="rounded-xl border border-ink-200 px-3 py-2">
              <div className="text-[11px] text-ink-500">Причина возврата · обязательна</div>
              <div className="text-[13px] text-ink-900">Услуга не оказана</div>
            </div>
          </div>

          <div className="mt-2">
            <Chips
              items={['Двойное списание', 'Услуга не оказана', 'Отмена заказа', 'Ошибка оператора']}
              active="Услуга не оказана"
            />
          </div>

          <div className="mt-2.5 rounded-xl border border-ink-200 px-3 py-2">
            <div className="text-[11px] text-ink-500">Idempotency-Key · обязателен</div>
            <div className="font-mono text-[11.5px] text-ink-800">6f1c9d20-4a7e-4a1f…5a8c11</div>
          </div>

          <div className="mt-2.5 flex items-center gap-2">
            <span className="rounded-xl bg-ink-100 px-3 py-2 text-[12px] font-medium text-ink-400">
              Вернуть 1 848,00 ₸ · недоступно поддержке
            </span>
            <span className="rounded-xl bg-white px-3 py-2 text-[12px] font-medium text-ink-700 ring-1 ring-ink-200">
              Показать расчёт
            </span>
          </div>

          <div className="mt-2">
            <Notice tone="danger">
              <b>Роль SUPPORT не двигает деньги.</b> Возврат выполняет оператор с ролью ADMIN или MERCHANT.
              Поддержка читает платёж, объясняет клиенту и передаёт оператору.
            </Notice>
          </div>
          <div className="mt-2 text-[11px] text-ink-400">
            Пустая сумма означает «весь остаток к возврату»: <span className="font-mono">amountMinor = null</span> — так
            отменяет оплаченный заказ order-service.
          </div>
        </ConsolePanel>

        <div className="flex min-h-0 flex-col gap-3">
          <ConsolePanel title="Что произойдёт">
            <ul className="space-y-2.5">
              {STEPS.map((step) => (
                <li key={step.title} className="flex gap-2.5">
                  <span className={`mt-1.5 h-2 w-2 flex-none rounded-full ${step.tone}`} />
                  <div className="min-w-0">
                    <div className="text-[12.5px] font-semibold text-ink-900">{step.title}</div>
                    <div className="text-[11.5px] text-ink-500">{step.note}</div>
                  </div>
                </li>
              ))}
            </ul>
            <div className="my-2 border-t border-ink-100" />
            <Row label="Повтор с тем же ключом" value="тот же возврат" />
            <Row label="Возвраты всего" value="≤ суммы платежа" />
          </ConsolePanel>

          <ConsolePanel title="Отказы, которые нужно объяснить клиенту">
            <div className="space-y-1.5 text-[11.5px] text-ink-700">
              <div>
                больше платежа — <span className="font-mono">422 REFUND_EXCEEDS_PAYMENT</span>
              </div>
              <div>
                платёж не завершён — <span className="font-mono">409 PAYMENT_NOT_COMPLETED</span>
              </div>
              <div>
                возвращён целиком — <span className="font-mono">409 PAYMENT_NOT_REVERSIBLE</span>
              </div>
            </div>
            <div className="mt-2">
              <Notice tone="warning">
                <b>Спорное место в коде.</b> И чтение, и возврат проходят одну проверку{' '}
                <span className="font-mono">PaymentAccess.canAccess()</span>, которая сегодня пропускает SUPPORT.
                Принцип «поддержка не двигает деньги» пока держит интерфейс — правило нужно и на сервере.
              </Notice>
            </div>
          </ConsolePanel>
        </div>
      </div>
    </>
  );
}
