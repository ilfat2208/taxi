/**
 * ORTA Business · Возврат и чек.
 *
 * Статус на борде «Работает»: возврат — POST /api/v1/payments/{id}/refund с
 * обязательным Idempotency-Key, список возвратов — GET /api/v1/payments/{id}/refunds.
 *
 * Что экран честно оговаривает двумя плашками: пока расчёт в PENDING, возврат
 * поглощается расчётом, а после PAID он превращается в ручную корректировку
 * следующего периода; политика «кто платит комиссию при возврате» не
 * зафиксирована, фискального чека (ОФД/ККМ) нет вовсе.
 */
import { Badge } from '../../components/ui/Badge';
import { Chips, ConsolePanel, ConsoleRows, Money, Notice, Placeholder, Row } from '../kit';

const ITEMS = [
  { title: 'Чехол-бампер для Galaxy A55', meta: 'возврат позиции целиком', qty: 1, returned: true },
  { title: 'Смартфон Samsung Galaxy A55 128GB', meta: 'остаётся у покупателя', qty: 0, returned: false },
];

const RECEIPT_ITEMS = [
  { title: 'Galaxy A55 128GB · 1 шт', minor: 18999000 },
  { title: 'Чехол-бампер A55 · 1 шт', minor: 499000 },
];

export default function Business04() {
  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      <div className="flex flex-none items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-[16px] font-bold text-ink-900">Возврат и чек</span>
            <Badge tone="warning">Расчёт не выплачен</Badge>
          </div>
          <div className="flex items-center gap-1.5 text-[12px] text-ink-500">
            <span>Заказ ORD-241003-8F3K · платёж</span>
            <span className="font-mono">01M3Y1…W5D9</span>
            <span>·</span>
            <Money minor={19790470} />
          </div>
        </div>
        <span className="flex-none rounded-full border border-ink-200 bg-white px-3 py-1.5 text-[12px] text-ink-700">
          История платежа
        </span>
      </div>

      <div className="flex min-h-0 flex-1 gap-3">
        <div className="flex min-h-0 flex-1 flex-col gap-3">
          <ConsolePanel
            title="Возврат по заказу"
            right={<Chips items={['Полный', 'Частичный']} active="Частичный" />}
            className="flex-none"
          >
            <div className="divide-y divide-ink-50">
              {ITEMS.map((item) => (
                <div key={item.title} className="flex items-center justify-between gap-3 py-2">
                  <div className="min-w-0">
                    <div className="truncate text-[13px] text-ink-800">{item.title}</div>
                    <div className="truncate text-[11.5px] text-ink-500">{item.meta}</div>
                  </div>
                  <span className="flex flex-none items-center gap-2 rounded-full border border-ink-200 px-2.5 py-1 text-[12px] text-ink-700">
                    <span className="text-ink-400">−</span>
                    <span className="w-3 text-center font-semibold tabular-nums">{item.qty}</span>
                    <span className="text-ink-400">+</span>
                  </span>
                </div>
              ))}
            </div>

            <div className="mt-2 border-t border-ink-100 pt-2">
              <Row label="Сумма возврата" value={<Money minor={499000} />} />
              <Row label="Комиссия платформы" value={<Money minor={7485} />} />
              <Row label="Вернётся покупателю" value={<Money minor={506485} />} strong />
            </div>

            <div className="mt-2 flex items-center gap-2">
              <span className="text-[11.5px] text-ink-500">Причина:</span>
              <Chips items={['Не подошёл', 'Брак', 'Недовоз', 'Другое']} active="Не подошёл" />
            </div>

            <div className="mt-3 flex items-center justify-between gap-3">
              <span className="rounded-xl bg-brand-500 px-3.5 py-2 text-[12.5px] font-medium text-white">
                Вернуть 5 064,85 ₸
              </span>
              <span className="text-[11px] text-ink-400">
                Повтор с тем же Idempotency-Key не создаст второй возврат
              </span>
            </div>
          </ConsolePanel>

          <Notice tone="warning">
            Возврат возможен, пока расчёт не выплачен. Продажа попадает в выплату не сразу (
            <code>taxi.settlement.hold-period</code>: в демо <code>0s</code>, в реальности T+1 и больше). Пока долг в{' '}
            <code>PENDING</code> — возврат поглощается расчётом; после <code>PAID</code> он становится ручной
            корректировкой следующего периода. Интерфейс обязан сказать это до нажатия кнопки.
          </Notice>
        </div>

        <div className="flex w-[320px] flex-none flex-col gap-3">
          <ConsolePanel
            title="Чек"
            right={<span className="text-[11px] text-ink-400">копия покупателю</span>}
            className="flex-none"
          >
            <ConsoleRows items={RECEIPT_ITEMS.map((item) => ({ title: item.title, right: <Money minor={item.minor} /> }))} />
            <div className="mt-2 border-t border-ink-100 pt-2">
              <Row label="Товары" value={<Money minor={19498000} />} />
              <Row label="Комиссия платформы 1,5%" value={<Money minor={292470} />} />
              <Row label="Итого оплачено" value={<Money minor={19790470} />} strong />
            </div>
            <div className="mt-3 flex gap-2">
              <Placeholder label="QR фискального чека" className="h-[68px] w-[68px] flex-none" />
              <p className="text-[11px] text-ink-500">
                QR появится вместе с ОФД/ККМ. Сейчас касса к оператору фискальных данных не подключена, поэтому чек
                остаётся нефискальным документом платформы.
              </p>
            </div>
          </ConsolePanel>

          <ConsolePanel title="Документ" className="flex-none">
            <Row label="Номер чека" value={<span className="font-mono text-[12px]">ORD-241003-8F3K</span>} />
            <Row label="Кассир" value="Ержан С. · смена 03.10" />
            <Row label="ОФД / ККМ" value={<Badge tone="neutral">не подключено</Badge>} />
            <div className="mt-2 flex gap-2">
              <span className="rounded-full border border-ink-200 bg-white px-3 py-1.5 text-[12px] text-ink-700">
                Отправить на телефон
              </span>
              <span className="rounded-full border border-ink-200 bg-white px-3 py-1.5 text-[12px] text-ink-700">
                Скачать PDF
              </span>
            </div>
          </ConsolePanel>
        </div>
      </div>
    </div>
  );
}
