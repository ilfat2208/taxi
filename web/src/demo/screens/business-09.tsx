/**
 * ORTA Business · Выплаты: долг PENDING и выплата PAID.
 *
 * Статус на борде «Работает»: три состояния расчёта — PAID, PENDING и FAILED —
 * уже приходят из GET /api/v1/settlements?merchantId, события settlement.paid и
 * settlement.failed публикуются, реквизит меняется через
 * PATCH /api/v1/merchants/me/payout-account.
 *
 * Честная оговорка: реквизит — это счёт ORTA (леджжер), внешнего IBAN и вывода в
 * банк в коде нет, поэтому «Изменить счёт» — выбор счёта, а не банковские
 * реквизиты. Именно поэтому на экране прямо написано, почему деньги не уходят.
 */
import { Badge } from '../../components/ui/Badge';
import { ConsolePanel, Kpis, Money, Notice, Row } from '../kit';

export default function Business09() {
  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      <div className="flex flex-none items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-[16px] font-bold text-ink-900">Выплаты и реквизиты</span>
            <Badge tone="warning">1 расчёт ждёт счёт</Badge>
          </div>
          <div className="truncate text-[12px] text-ink-500">
            Расчёты по расписанию · taxi.settlement.hold-period: в демо 0s, в реальности T+1 и больше
          </div>
        </div>
        <span className="flex-none rounded-full border border-ink-200 bg-white px-3 py-1.5 text-[12px] text-ink-700">
          Обновить
        </span>
      </div>

      <div className="flex-none">
        <Kpis
          items={[
            { label: 'Выплачено за неделю', value: '608 930 ₸', hint: 'один расчёт PAID' },
            { label: 'Долг PENDING', value: '46 400 ₸', hint: 'счёт для выплат не указан' },
            { label: 'Повтор после FAILED', value: '12 900 ₸', hint: 'следующий прогон' },
          ]}
        />
      </div>

      <div className="flex min-h-0 flex-1 gap-3">
        <div className="flex min-h-0 flex-1 flex-col gap-3">
          <ConsolePanel title="Расчёт SET-241003-C7D1" right={<Badge tone="success">PAID</Badge>} className="flex-none">
            <Row label="Стоимость товаров за вычетом возвратов" value={<Money minor={65533000} />} />
            <Row label="Комиссия платформы 1,5%" value={<Money minor={982995} />} />
            <Row label="К выплате мерчанту (net)" value={<Money minor={65533000} />} strong />
            <Row label="Выплачено" value="03.10.2026, 00:00:07" />
          </ConsolePanel>

          <ConsolePanel title="Расчёт SET-241004-D4E7" right={<Badge tone="warning">PENDING</Badge>} className="flex-none">
            <Row label="Стоимость товаров (gross)" value={<Money minor={4640000} />} />
            <Row label="Причина ожидания" value={<span className="text-warning-700">не указан счёт для выплат</span>} />
          </ConsolePanel>

          <ConsolePanel
            title="Расчёт SET-241001-B9F2"
            right={
              <span className="flex items-center gap-2">
                <span className="text-[11px] text-ink-400">прошлый период</span>
                <Badge tone="danger">FAILED</Badge>
              </span>
            }
            className="min-h-0 flex-1 overflow-hidden"
          >
            <Row label="Сумма" value={<Money minor={1290000} />} />
            <Row label="Причина отказа" value="счёт получателя закрыт" />
            <Row label="Долг" value="остался на балансе, повтор в следующем прогоне" />
            <Row label="Платежей в расчётах" value="25" strong />
          </ConsolePanel>
        </div>

        <div className="flex w-[330px] flex-none flex-col gap-3">
          <ConsolePanel
            title="Реквизиты для выплат"
            right={<Badge tone="success">проверен</Badge>}
            className="flex-none"
          >
            <Row label="Счёт ORTA" value={<span className="font-mono text-[12px]">01M3Z9…8O1A</span>} />
            <Row label="Владелец" value="ТОО «Шымкент Трейд»" />
            <Row label="БИН" value="180 340 021 945" />
            <Row
              label="IBAN для вывода"
              value={<span className="text-ink-400">план — вывод на банк не сделан</span>}
            />
            <div className="mt-2">
              <span className="rounded-full border border-ink-200 bg-white px-3 py-1.5 text-[12px] text-ink-700">
                Изменить счёт
              </span>
            </div>
          </ConsolePanel>

          <Notice tone="warning">
            Без счёта деньги не уходят: пока реквизит не указан, продажи продолжают копиться, но расчёт навсегда
            остаётся в <code>PENDING</code> — платформа не «задерживает» выплату, ей просто некуда платить. Кабинет
            обязан показать это прямо в списке продаж, а не только в финансах.
          </Notice>

          <Notice tone="info">
            <code>PATCH /api/v1/merchants/me/payout-account</code> принимает <code>accountId</code> — это счёт ORTA, а не
            внешний IBAN: внутренние выплаты идут леджжером, вывод в банк — план.
          </Notice>
        </div>
      </div>
    </div>
  );
}
