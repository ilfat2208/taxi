/**
 * ORTA Business · Акты и сверка.
 *
 * Статус на борде «В работе»: основание для сверки работает — GET
 * /api/v1/settlements/{id} отдаёт расчёт вместе со списком покрытых платежей.
 *
 * Честно не сделано: акта как документа нет — ни PDF, ни ЭЦП, ни срока хранения,
 * поэтому «Сформировать акт» и «Подписать ЭЦП» обозначают место, а не работу.
 * Правило экрана с борда: расхождение объясняется, а не скрывается.
 */
import { Badge } from '../../components/ui/Badge';
import { ConsolePanel, ConsoleRows, Money, Notice, Row } from '../kit';

const RECONCILIATION = [
  { label: 'Продажи за период (gross)', minor: 66032000 },
  { label: 'Возвраты, поглощённые до расчёта', minor: -499000 },
  { label: 'Начислено к выплате', minor: 65533000 },
  { label: 'Комиссия платформы удержана с покупателей', minor: 990480 },
  { label: 'Выплачено (SET-241003-C7D1)', minor: 60893000 },
  { label: 'Осталось в долге PENDING (SET-241004-D4E7)', minor: 4640000 },
];

const SETTLEMENTS = [
  { title: 'SET-241003-C7D1', meta: '22 платежа · 655 330,00 ₸', right: 'сошлось', tone: 'success' as const },
  { title: 'SET-241004-D4E7', meta: '3 платежа · 46 400,00 ₸ · ждёт счёт', right: 'в долге', tone: 'warning' as const },
  { title: 'SET-241001-B9F2', meta: 'прошлый период · 12 900,00 ₸ · счёт закрыт', right: 'повтор', tone: 'neutral' as const },
];

export default function Business10() {
  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      <div className="flex flex-none items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[16px] font-bold text-ink-900">Акты и сверка</div>
          <div className="flex items-center gap-1.5 text-[12px] text-ink-500">
            <span>Период 01–03.10.2026 · акт № 2026-10-003 · расчёт</span>
            <span className="font-mono">SET-241003-C7D1</span>
          </div>
        </div>
        <div className="flex flex-none items-center gap-2">
          <span className="rounded-full border border-ink-200 bg-white px-3 py-1.5 text-[12px] text-ink-600">01–03.10</span>
          <span className="rounded-full bg-ink-100 px-3 py-1.5 text-[12px] text-ink-400">Отправить на e-mail</span>
          <span className="rounded-full bg-ink-100 px-3 py-1.5 text-[12px] text-ink-400">Сформировать акт</span>
        </div>
      </div>

      <div className="flex min-h-0 flex-1 gap-3">
        <div className="flex min-h-0 flex-1 flex-col gap-3">
          <ConsolePanel
            title="Сверка: начисления ↔ выплаты"
            right={<Badge tone="success">расхождений нет</Badge>}
            className="flex-none"
          >
            {RECONCILIATION.map((line) => (
              <Row key={line.label} label={line.label} value={<Money minor={line.minor} />} />
            ))}
            <div className="mt-1 border-t border-ink-100 pt-1">
              <Row label="Расхождение" value={<Money minor={0} />} strong />
            </div>
          </ConsolePanel>

          <ConsolePanel
            title="Сверено по платежам"
            right={<span className="text-[11px] text-ink-400">документ-основание для сверки</span>}
            className="min-h-0 flex-1 overflow-hidden"
          >
            <ConsoleRows
              items={SETTLEMENTS.map((item) => ({
                title: item.title,
                meta: item.meta,
                right: <Badge tone={item.tone}>{item.right}</Badge>,
              }))}
            />
            <div className="mt-2 border-t border-ink-100 pt-1">
              <Row label="Платежей сверено" value="25" strong />
            </div>
          </ConsolePanel>

          <Notice tone="warning">
            Расхождение объясняется, а не скрывается: если сумма платежей не сходится с расчётом, кабинет показывает
            строку расхождения с причиной (возврат, отменённый платёж, <code>FAILED</code>), а не «итог, который вроде бы
            верный». Ровно тот же принцип, что у пустых значений в клиенте: нет данных — нет цифры, а не ноль.
          </Notice>
        </div>

        <div className="flex w-[330px] flex-none flex-col gap-3">
          <ConsolePanel title="Акт за период" className="flex-none">
            <Row label="Номер" value={<span className="font-mono text-[12px]">2026-10-003</span>} />
            <Row label="Исполнитель" value="ORTA (платформа)" />
            <Row label="Заказчик" value="ТОО «Шымкент Трейд»" />
            <Row label="Сумма по акту" value={<Money minor={65533000} />} strong />
            <Row label="Статус" value={<Badge tone="neutral">черновик</Badge>} />
            <div className="mt-2 flex gap-2">
              <span className="rounded-full bg-ink-100 px-3 py-1.5 text-[12px] text-ink-400">Скачать PDF</span>
              <span className="rounded-full bg-ink-100 px-3 py-1.5 text-[12px] text-ink-400">Подписать ЭЦП</span>
            </div>
          </ConsolePanel>

          <Notice tone="warning">
            Акт — макет: в коде нет ни документа, ни подписи, ни срока хранения. Основание для сверки уже есть — расчёт и
            список покрытых им платежей; предлагается <code>{'GET /api/v1/settlements/{id}/act'}</code>.
          </Notice>
        </div>
      </div>
    </div>
  );
}
