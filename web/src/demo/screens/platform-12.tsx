/**
 * platform-12 · Возвраты по платежу (телефон, работает).
 *
 * Эндпоинты: `POST /api/v1/payments/{id}/refund` с обязательным `Idempotency-Key` и
 * `GET /api/v1/payments/{id}/refunds`. Возврат — обратная проводка в леджжере, а не правка прошлой
 * операции: история её не переписывает. Полный возврат переводит платёж в `REVERSED`, частичных может
 * быть несколько, и их сумма не может превысить платёж. Спорное место подписано: пропорция возврата
 * комиссии 1,5% продуктом ещё не зафиксирована.
 */
import { Badge } from '../../components/ui/Badge';
import { Money, Notice, PhoneAppBar, PhoneBody, PhoneCard, PhoneTabBar, Row } from '../kit';

const TABS = ['Главная', 'История', 'Переводы', 'Профиль'];

const REFUNDS: Array<{ title: string; hint: string; badge: string; tone: 'success' | 'warning' | 'neutral' }> = [
  {
    title: '2 490,00 ₸ · частичный',
    hint: '7 окт, 14:02 · 2 из 3 товаров · продавец',
    badge: 'зачислен',
    tone: 'success',
  },
  {
    title: '1 500,00 ₸ · полный остаток',
    hint: 'заявка от 8 окт, 09:40 · ждёт продавца',
    badge: 'в обработке',
    tone: 'warning',
  },
];

export default function Platform12Screen() {
  return (
    <>
      <PhoneAppBar
        back
        title="Возвраты"
        subtitle="Платёж за заказ 01J8ZP…2M"
        right={<Badge tone="success">COMPLETED</Badge>}
      />
      <PhoneBody>
        <PhoneCard title="Платёж">
          <Row label="Оплачено" value={<Money minor={399000} />} />
          <Row label="Возвращено" value={<span className="font-semibold tabular-nums text-success-700">2 490,00 ₸</span>} />
          <Row label="Осталось у продавца" value={<Money minor={150000} />} strong />
        </PhoneCard>

        <PhoneCard title="Возвраты по этому платежу" right={<Badge tone="neutral">2 записи</Badge>}>
          <div className="divide-y divide-ink-50">
            {REFUNDS.map((refund) => (
              <div key={refund.title} className="flex items-center justify-between gap-2 py-2">
                <span className="min-w-0">
                  <span className="block truncate text-[12.5px] font-medium text-ink-800">{refund.title}</span>
                  <span className="block truncate text-[11px] text-ink-500">{refund.hint}</span>
                </span>
                <Badge tone={refund.tone}>{refund.badge}</Badge>
              </div>
            ))}
          </div>
          <Row label="POST /api/v1/payments/{id}/refund" value="нужен Idempotency-Key" />
        </PhoneCard>

        <PhoneCard title="Как считается возврат">
          <div className="space-y-2">
            <div className="flex gap-2">
              <span className="mt-1.5 h-2 w-2 flex-none rounded-full bg-success-500" />
              <span className="min-w-0">
                <span className="block text-[12.5px] font-medium text-ink-800">Платёж прошёл · COMPLETED</span>
                <span className="block text-[11px] text-ink-500">Деньги на счетах продавцов, комиссия — на счёте платформы</span>
              </span>
            </div>
            <div className="flex gap-2">
              <span className="mt-1.5 h-2 w-2 flex-none rounded-full bg-ink-400" />
              <span className="min-w-0">
                <span className="block text-[12.5px] font-medium text-ink-800">Возврат · обратная проводка</span>
                <span className="block text-[11px] text-ink-500">Новая операция, а не отмена старой: леджжер не переписывается</span>
              </span>
            </div>
          </div>
        </PhoneCard>

        <Notice tone="warning">
          <b>Комиссия 1,5% возвращается не всегда.</b> Пропорция возврата комиссии продуктом ещё не зафиксирована —
          поэтому в макете она не нарисована как решённое правило.
        </Notice>
      </PhoneBody>
      <PhoneTabBar items={TABS} active="История" />
    </>
  );
}
