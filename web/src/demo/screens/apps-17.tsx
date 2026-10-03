/**
 * apps-17 · Мерчант: выплаты и долг (ORTA Business).
 *
 * Статус борда — «В работе»: расчёты работают — GET /api/v1/settlements?merchantId=,
 * GET /api/v1/settlements/{id} со списком платежей (MerchantSettlement,
 * MerchantSettlementJob), счёт для выплат меняет
 * PATCH /api/v1/merchants/me/payout-account.
 *
 * Честность экрана: PENDING значит «платить некуда» — долг зафиксирован, но счёта
 * нет; FAILED значит «счёт закрыт» — выплата повторится, долг остался. Период
 * удержания taxi.settlement.hold-period в демо 0 с. Суммы демонстрационные.
 */
import { Badge } from '../../components/ui/Badge';
import { Money, Notice, PhoneAppBar, PhoneBody, PhoneCard, PhoneTabBar } from '../kit';

const MERCHANT_TABS = ['Заказы', 'Товары', 'Выплаты', 'Отзывы'];

type SettlementTone = 'warning' | 'danger' | 'success';

const SETTLEMENTS: Array<{
  state: string;
  tone: SettlementTone;
  id: string;
  amount: number;
  hint: string;
}> = [
  {
    state: 'PENDING',
    tone: 'warning',
    id: 'SET-261005-Q4T9D',
    amount: 322000,
    hint: '1 платёж · долг зафиксирован, платить пока некуда',
  },
  {
    state: 'FAILED',
    tone: 'danger',
    id: 'SET-260928-A3F7K',
    amount: 512000,
    hint: 'счёт закрыт · выплата повторится, долг остался',
  },
  {
    state: 'PAID',
    tone: 'success',
    id: 'SET-261001-K7M2P',
    amount: 3452000,
    hint: '01.10.2026 · 3 платежа · покупатели заплатили 35 037,80 ₸',
  },
];

export default function Apps17() {
  return (
    <>
      <PhoneAppBar
        title="Выплаты и долг"
        subtitle="FreshMarket · счёт для выплат не указан"
        right={<Badge tone="warning">есть долг</Badge>}
      />
      <PhoneBody>
        <div className="shrink-0 rounded-2xl border border-warning-500/40 bg-warning-50 p-3">
          <div className="text-[11.5px] text-warning-700">Долг к выплате · демо</div>
          <div className="text-[26px] font-bold leading-8 text-warning-700">
            <Money minor={834000} />
          </div>
          <div className="mt-1 text-[11.5px] text-warning-700">
            3 220,00 ₸ ждут счёта · 5 120,00 ₸ после неудачной выплаты
          </div>
        </div>

        <div className="shrink-0 rounded-xl bg-success-700 px-3 py-2.5 text-center text-[13px] font-semibold text-white">
          Указать счёт для выплат
        </div>

        <PhoneCard title="Расчёты" className="shrink-0" right={<Badge tone="neutral">GET /settlements</Badge>}>
          {SETTLEMENTS.map((item, index) => (
            <div key={item.id}>
              {index > 0 ? <div className="my-2.5 h-px bg-ink-100" /> : null}
              <div className="flex items-center gap-2.5">
                <Badge tone={item.tone}>{item.state}</Badge>
                <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-ink-500">{item.id}</span>
                <Money minor={item.amount} />
              </div>
              <div className="mt-1 text-[11px] text-ink-500">{item.hint}</div>
            </div>
          ))}
        </PhoneCard>

        <Notice tone="info">
          <b>Продажа попадает в расчёт не сразу.</b> Есть период удержания{' '}
          <span className="font-mono">taxi.settlement.hold-period</span>: в демо 0 с, в жизни T+1 и больше —
          чтобы возврат успел поглотиться до выплаты. События — settlement.created, settlement.paid,
          settlement.failed.
        </Notice>
      </PhoneBody>
      <PhoneTabBar items={MERCHANT_TABS} active="Выплаты" />
    </>
  );
}
