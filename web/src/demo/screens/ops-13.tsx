/**
 * ops-13 · Админка · лимиты и velocity-правила счетов.
 *
 * Честность экрана: лимиты по окнам читаются и меняются по API (ADMIN) и проверяются до движения денег
 * (отказ — 422 LIMIT_EXCEEDED / 422 VELOCITY_EXCEEDED с деталями window, limitMinor, usedMinor,
 * requestedMinor, remainingMinor), но интерфейса нет. Velocity — свойства приложения (enabled,
 * maxOperations, window), из интерфейса они не меняются, поэтому его поля показаны как план.
 * Дефолтного потолка существующим кошелькам нет; цифры лимитов и 11 отказов — демо.
 */
import { Badge } from '../../components/ui/Badge';
import { ConsolePanel, Kpis, Money, Notice, Row } from '../kit';

function Field({ label, value, muted }: { label: string; value: string; muted?: boolean }) {
  return (
    <div className="min-w-0 flex-1 rounded-xl border border-ink-200 px-3 py-2">
      <div className="text-[11px] text-ink-500">{label}</div>
      <div className={muted ? 'truncate text-[12.5px] text-ink-400' : 'truncate text-[13px] text-ink-900'}>{value}</div>
    </div>
  );
}

export default function Ops13Limits() {
  return (
    <>
      <div className="flex flex-none items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[15px] font-bold tracking-tight text-ink-900">Лимиты и velocity-правила счёта</div>
          <div className="truncate text-[12px] text-ink-500">
            Счёт 01J8ZCQ7Y4R3…M9QW1T · KZT · CUSTOMER (демо)
          </div>
        </div>
        <div className="flex flex-none items-center gap-2">
          <Badge tone="warning">11 отказов за сутки</Badge>
          <span className="rounded-xl bg-white px-3 py-1.5 text-[12px] text-ink-600 ring-1 ring-ink-200">
            История изменений
          </span>
        </div>
      </div>

      <Kpis
        items={[
          { label: 'Дневной лимит', value: '100 000,00 ₸', hint: 'демо' },
          { label: 'Израсходовано', value: '60 000,00 ₸' },
          { label: 'Осталось', value: '40 000,00 ₸', hint: 'операций в окне 3 / 10' },
        ]}
      />

      <div className="grid min-h-0 flex-1 grid-cols-2 gap-3">
        <ConsolePanel title="Окна лимитов" right={<Badge tone="warning">API есть, экрана нет</Badge>}>
          <div className="flex gap-2">
            <Field label="DAILY · лимит" value="100 000,00 ₸" />
            <Field label="MONTHLY · лимит" value="не задан · без лимита" muted />
          </div>
          <div className="mt-2">
            <Row label="Окно DAILY" value="01.10 00:00 — 02.10 00:00" />
            <Row
              label="Израсходовано / осталось"
              value={
                <span className="tabular-nums">
                  <Money minor={6000000} /> / <Money minor={4000000} />
                </span>
              }
            />
          </div>
          <div className="my-2 border-t border-ink-100" />
          <div className="mb-1.5 flex items-center justify-between">
            <span className="text-[12.5px] font-semibold text-ink-800">Velocity</span>
            <Badge tone="neutral">свойства приложения · план</Badge>
          </div>
          <div className="flex gap-2">
            <Field label="Максимум операций" value="10" muted />
            <Field label="Окно" value="PT5M" muted />
            <Field label="Включено" value="да" muted />
          </div>
          <div className="mt-2.5 flex items-center gap-2">
            <span className="rounded-xl bg-ink-100 px-3 py-2 text-[12px] font-medium text-ink-400">
              Сохранить лимит · недоступно
            </span>
            <span className="rounded-xl bg-white px-3 py-2 text-[12px] font-medium text-ink-700 ring-1 ring-ink-200">
              Снять лимит
            </span>
          </div>
          <div className="mt-2 text-[11px] text-ink-500">
            Лимит меняется ручкой <span className="font-mono">PUT /api/v1/accounts/{'{id}'}/limits</span> (ADMIN);
            velocity — <span className="font-mono">enabled</span>, <span className="font-mono">maxOperations</span>,{' '}
            <span className="font-mono">window</span>, и правка из UI остаётся планом
            (<span className="font-mono">PUT /api/v1/admin/accounts/{'{id}'}/velocity</span> — предложение).
          </div>
        </ConsolePanel>

        <ConsolePanel title="Правила, которые важнее кнопок">
          <Row label="Когда проверяется" value="до резерва" />
          <Row label="Отказ по лимиту" value={<span className="font-mono text-[11px]">422 LIMIT_EXCEEDED</span>} />
          <Row label="Отказ по скорости" value={<span className="font-mono text-[11px]">422 VELOCITY_EXCEEDED</span>} />
          <Row
            label="В деталях отказа"
            value={
              <span className="text-[11px]">window, limitMinor, usedMinor, requestedMinor, remainingMinor</span>
            }
          />
          <Row label="Нет лимита" value="без ограничения" />
          <Row
            label="Отказы за сутки"
            value={<span className="font-mono text-[11px]">taxi.account.limit.refusals</span>}
          />
          <div className="my-2 border-t border-ink-100" />
          <Notice tone="info">
            <b>Что работает, а что в плане.</b> Лимит счёта читается и меняется по API (
            <span className="font-mono">GET/PUT /api/v1/accounts/{'{id}'}/limits</span>) и проверяется до движения
            денег — иначе остался бы холд. Velocity из API не меняется: это свойства приложения.
          </Notice>
          <div className="mt-2 text-[11px] text-ink-400">
            Дефолтного потолка существующим кошелькам нет: лимит ставит оператор — это продуктовое решение, а не
            техническое. Цифры лимитов и 11 отказов — демо.
          </div>
        </ConsolePanel>
      </div>
    </>
  );
}
