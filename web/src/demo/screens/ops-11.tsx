/**
 * ops-11 · Пульт · сверка инвариантов леджера и расчётов.
 *
 * Честность экрана: фоновый job реально работает (окно 15 минут, batch 500) и находит расхождения,
 * но только логирует их и пишет в метрику taxi.reconciliation.findings{kind} — деньги автоматически
 * не «чинятся», и это осознанное решение, а не недоделка. Ручного запуска и экрана нет: 900 000 мс
 * интервала и 120 000 мс начальной задержки — настоящие настройки job, числа проверок — демо.
 */
import { Badge } from '../../components/ui/Badge';
import { ConsolePanel, ConsoleRows, Kpis, Notice, Row } from '../kit';

const CHECKS = [
  {
    title: 'Расчёт подкреплён строками settlement_payment',
    right: <Badge tone="success">ок</Badge>,
  },
  {
    title: 'Суммы расчёта сходятся с платежами',
    right: <Badge tone="success">ок</Badge>,
  },
  {
    title: 'Возвраты не превышают платёж',
    right: <Badge tone="success">ок</Badge>,
  },
  {
    title: 'Завершённый платёж знает время завершения',
    right: <Badge tone="success">ок</Badge>,
  },
  {
    title: 'Σ debit = Σ credit по каждой транзакции',
    meta: 'держит БД и e2e, а не этот job',
    right: <Badge tone="neutral">БД</Badge>,
  },
];

export default function Ops11Reconciliation() {
  return (
    <>
      <div className="flex flex-none items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[15px] font-bold tracking-tight text-ink-900">
            Сверка инвариантов леджера и расчётов
          </div>
          <div className="truncate text-[12px] text-ink-500">
            Фоновая проверка · окно 15 минут · batch 500 (настоящие настройки job)
          </div>
        </div>
        <div className="flex flex-none items-center gap-2">
          <Badge tone="success">последний прогон 09:30 · находок 0</Badge>
          <span className="rounded-xl bg-white px-3 py-1.5 text-[12px] text-ink-600 ring-1 ring-ink-200">
            История прогонов
          </span>
        </div>
      </div>

      <Kpis
        items={[
          { label: 'Находок сейчас', value: '0', hint: 'демо' },
          { label: 'Проверок за прогон', value: '1 482', hint: 'демо' },
          { label: 'Интервал', value: '15 мин', hint: 'первый прогон +2 мин' },
        ]}
      />

      <div className="grid min-h-0 flex-1 grid-cols-2 gap-3">
        <ConsolePanel title="Что проверяет job">
          <ConsoleRows items={CHECKS} />
          <div className="my-2 border-t border-ink-100" />
          <div className="flex items-center gap-2">
            <span className="rounded-xl bg-white px-3 py-2 text-[12px] font-medium text-ink-700 ring-1 ring-ink-200">
              Открыть логи прогона
            </span>
            <span className="rounded-xl bg-ink-100 px-3 py-2 text-[12px] font-medium text-ink-400">
              Проверить сейчас · выключено
            </span>
          </div>
          <div className="mt-2 text-[11px] text-ink-500">
            Ручного запуска нет: job идёт по расписанию —{' '}
            <span className="font-mono">taxi.reconciliation.interval-ms=900000</span>,{' '}
            <span className="font-mono">initial-delay-ms=120000</span>,{' '}
            <span className="font-mono">batch-size=500</span>. Это свойства, а не кнопка;{' '}
            <span className="font-mono">POST /api/v1/ops/reconciliation/run</span> — предложение. Проверок за прогон
            1 482 — демо.
          </div>
        </ConsolePanel>

        <div className="flex min-h-0 flex-col gap-3">
          <ConsolePanel title="Журнал находок" right={<Badge tone="success">чисто</Badge>}>
            <div className="flex items-center gap-2.5">
              <span className="grid h-8 w-8 flex-none place-items-center rounded-full bg-success-50 text-[15px] text-success-700">
                ✓
              </span>
              <div className="min-w-0">
                <div className="text-[13px] font-semibold text-ink-900">Расхождений нет</div>
                <div className="text-[11.5px] text-ink-500">
                  Здоровое значение метрики <span className="font-mono">taxi.reconciliation.findings</span> — строго ноль
                </div>
              </div>
            </div>
            <div className="my-2 border-t border-ink-100" />
            <Row
              label="Метрика"
              value={<span className="font-mono text-[11px]">taxi.reconciliation.findings{'{kind}'}</span>}
            />
            <Row label="Читается" value={<span className="font-mono text-[11px]">GET /actuator/prometheus</span>} />
            <Row label="Поведение" value="лог + метрика" />
            <Row label="Автопочинка" value="нет и не будет" />
          </ConsolePanel>

          <ConsolePanel title="Почему не чиним автоматически" right={<Badge tone="warning">решение</Badge>}>
            <Notice tone="info">
              Находки только логируются: автоматически «править» деньги опаснее, чем сообщить о расхождении человеку.
              Молчаливая правка леджера — это то, из-за чего однажды пропадает чек.
            </Notice>
          </ConsolePanel>
        </div>
      </div>
    </>
  );
}
