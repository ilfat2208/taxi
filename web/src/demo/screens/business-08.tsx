/**
 * ORTA Business · Финансы — начисления и комиссия.
 *
 * Статус на борде «Работает»: расчёты и платежи живут в working-контуре —
 * GET /api/v1/settlements?merchantId, GET /api/v1/settlements/{id} (расчёт вместе
 * со списком покрытых платежей), GET /api/v1/payments?page&size&status.
 *
 * Честная оговорка: построчной таблицы «платёж → комиссия» отдельным эндпоинтом
 * нет — она складывается из расчёта и его платежей, поэтому на больших периодах
 * это тяжёлый запрос. Здесь данные демонстрационные.
 */
import { Badge } from '../../components/ui/Badge';
import { ConsolePanel, ConsoleTable, Kpis, Money, Notice, Row } from '../kit';

type SettlementState = 'в расчёте' | 'поглощён' | 'не оплачен';

const STATE_TONE: Record<SettlementState, 'success' | 'warning' | 'neutral'> = {
  'в расчёте': 'success',
  'поглощён': 'warning',
  'не оплачен': 'neutral',
};

/** Разбор по заказам: gross без комиссии, комиссия платформы и net мерчанту. */
const ACCRUALS: Array<{
  order: string;
  grossMinor: number;
  commissionMinor: number;
  netMinor: number;
  state: SettlementState;
}> = [
  { order: 'ORD-241003-8F3K', grossMinor: 19498000, commissionMinor: 292470, netMinor: 19498000, state: 'в расчёте' },
  { order: 'ORD-241003-7D1Q', grossMinor: 2498000, commissionMinor: 37470, netMinor: 2498000, state: 'в расчёте' },
  { order: 'ORD-241003-5B4N', grossMinor: -499000, commissionMinor: -7485, netMinor: -499000, state: 'поглощён' },
  { order: 'ORD-241002-3Z8R', grossMinor: 3198000, commissionMinor: 47970, netMinor: 0, state: 'не оплачен' },
];

export default function Business08() {
  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      <div className="flex flex-none items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[16px] font-bold text-ink-900">Начисления и комиссия</div>
          <div className="flex items-center gap-1.5 text-[12px] text-ink-500">
            <span>Период 01–03.10.2026 · расчёт</span>
            <span className="font-mono">SET-241003-C7D1</span>
            <span>· выручка без комиссии</span>
          </div>
        </div>
        <div className="flex flex-none items-center gap-2">
          <span className="rounded-full border border-ink-200 bg-white px-3 py-1.5 text-[12px] text-ink-600">01–03.10</span>
          <span className="rounded-full border border-ink-200 bg-white px-3 py-1.5 text-[12px] text-ink-700">Экспорт</span>
        </div>
      </div>

      <div className="flex-none">
        <Kpis
          items={[
            { label: 'Продажи без комиссии', value: '660 320 ₸', hint: 'gross за период' },
            { label: 'Комиссия платформы 1,5%', value: '9 904,80 ₸', hint: 'удержано с покупателей' },
            { label: 'Начислено к выплате', value: '655 330 ₸', hint: 'net, к выплате мерчанту' },
          ]}
        />
      </div>

      <ConsolePanel
        title="Начисления по заказам"
        right={<span className="text-[11px] text-ink-400">41 платёж в расчёте</span>}
        className="min-h-0 flex-1 overflow-hidden"
      >
        <ConsoleTable
          columns={['Заказ', 'Без комиссии', 'Комиссия', 'Мерчанту', 'Расчёт']}
          rows={ACCRUALS.map((line) => [
            <span key="o" className="font-medium text-ink-900">{line.order}</span>,
            <Money key="g" minor={line.grossMinor} />,
            <Money key="c" minor={line.commissionMinor} />,
            <Money key="n" minor={line.netMinor} />,
            <Badge key="s" tone={STATE_TONE[line.state]}>{line.state}</Badge>,
          ])}
        />
        <div className="mt-2 rounded-xl bg-ink-50 px-3 py-2 font-mono text-[11px] text-ink-500">
          customerPaidMinor = grossMinor + commissionMinor · netMinor = grossMinor
        </div>
      </ConsolePanel>

      <div className="flex flex-none gap-3">
        <ConsolePanel title="Сводка периода" className="flex-1">
          <Row label="Возвраты за период" value={<Money minor={-499000} />} />
          <Row label="Итого позиций в расчёте" value="41 платёж" />
          <Row label="Начислено к выплате за период" value={<Money minor={65533000} />} strong />
          <Row label="В том числе комиссия платформы" value={<Money minor={990480} />} />
        </ConsolePanel>

        <div className="flex w-[300px] flex-none flex-col gap-3">
          <ConsolePanel title="Комиссия платформы" className="flex-none">
            <Row label="Ставка платформы" value="1,5%" />
            <Row label="Удержано за период" value={<Money minor={990480} />} strong />
          </ConsolePanel>

          <Notice tone="info">
            Комиссия — правило, а не спорное место: ставка зафиксирована в коде и проверена сквозным сценарием{' '}
            <code>scripts/e2e-marketplace.ps1</code>.
          </Notice>
        </div>
      </div>
    </div>
  );
}
