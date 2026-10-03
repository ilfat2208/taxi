/**
 * ORTA Business · Заказ — карточка и история статусов.
 *
 * Статус на борде «Работает»: GET /api/v1/orders/{id} уже отдаёт позиции и
 * statusHistory, платёж — GET /api/v1/payments/by-order/{orderId}.
 *
 * Что экран честно оговаривает: переходов «подтверждён → доставлен» в контракте
 * заказа нет — статусы двигают оплата и отмена. Поэтому «Подтвердить» нарисована
 * неактивной, а рядом стоит пояснение: это предложение, а не работающая кнопка.
 */
import { Badge } from '../../components/ui/Badge';
import { ConsolePanel, ConsoleRows, Money, Notice, Row } from '../kit';

const POSITIONS = [
  { title: 'Смартфон Samsung Galaxy A55 128GB', meta: 'SKU SM-A556-128-BLK · 1 шт', minor: 18999000 },
  { title: 'Чехол-бампер для Galaxy A55', meta: 'SKU ACC-A55-CLR · 1 шт', minor: 499000 },
];

/** Append-only таймлайн: записи не переписываются, последний шаг ещё ожидается. */
const HISTORY = [
  { title: 'CREATED', meta: '18:12:03 · корзина, 2 позиции' },
  { title: 'PENDING_PAYMENT', meta: '18:12:04 · создан платёж' },
  { title: 'PAID', meta: '18:12:41 · списание 197 904,70 ₸', right: 'текущий' },
  { title: 'CONFIRMED', meta: '18:15 · подтверждено продавцом' },
  { title: 'DELIVERED', meta: 'ожидается · чек и закрытие резерва', pending: true },
];

export default function Business03() {
  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      <div className="flex flex-none items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-[16px] font-bold text-ink-900">Заказ ORD-241003-8F3K</span>
            <Badge tone="success">PAID</Badge>
          </div>
          <div className="truncate text-[12px] text-ink-500">
            Оформлен 03.10.2026, 18:12 · оплачен 18:12:41 · самовывоз, точка «Республики 12»
          </div>
        </div>
        <div className="flex flex-none items-center gap-2">
          <span className="rounded-full border border-ink-200 bg-white px-3 py-1.5 text-[12px] text-ink-700">Чек</span>
          <span className="rounded-full border border-ink-200 bg-white px-3 py-1.5 text-[12px] text-ink-700">Вернуть</span>
          <span className="rounded-full bg-ink-100 px-3 py-1.5 text-[12px] text-ink-400">Подтвердить</span>
        </div>
      </div>

      <div className="flex min-h-0 flex-1 gap-3">
        <div className="flex min-h-0 flex-1 flex-col gap-3">
          <ConsolePanel title="Покупатель и доставка" className="flex-none">
            <Row label="Покупатель" value="Данияр Сериков" strong />
            <Row label="Телефон" value="+7 705 118 77 03" />
            <Row label="Получение" value="Самовывоз, Республики 12" />
            <Row label="Комментарий" value="Позвонить за 10 минут" />
            <Row label="Счёт списания" value={<span className="font-mono text-[12px]">01M3XZ…H5SX5</span>} />
          </ConsolePanel>

          <ConsolePanel
            title="Позиции"
            right={<span className="text-[11px] text-ink-400">2 позиции · 2 шт</span>}
            className="min-h-0 flex-1 overflow-hidden"
          >
            <ConsoleRows
              items={POSITIONS.map((item) => ({
                title: item.title,
                meta: item.meta,
                right: <Money minor={item.minor} />,
              }))}
            />
            <div className="mt-2 border-t border-ink-100 pt-2">
              <Row label="Товары" value={<Money minor={19498000} />} />
              <Row label="Комиссия платформы 1,5%" value={<Money minor={292470} />} />
              <Row label="Покупатель заплатил" value={<Money minor={19790470} />} strong />
              <Row label="Мерчанту к выплате" value={<Money minor={19498000} />} strong />
            </div>
          </ConsolePanel>

          <Notice tone="warning">
            Переходов «подтверждён → доставлен» в контракте заказа нет: статусы двигают оплата и{' '}
            <code>{'POST /api/v1/orders/{id}/cancel'}</code>. Кнопка «Подтвердить» обозначает место, а не работу.
          </Notice>
        </div>

        <div className="flex w-[320px] flex-none flex-col gap-3">
          <ConsolePanel
            title="История статусов"
            right={<Badge tone="neutral">append-only</Badge>}
            className="flex-none"
          >
            <ConsoleRows
              items={HISTORY.map((step) => ({
                title: step.title,
                meta: step.meta,
                right: step.right ? (
                  <span className="text-[11px] font-medium text-ink-500">{step.right}</span>
                ) : step.pending ? (
                  <Badge tone="neutral">ожидается</Badge>
                ) : undefined,
              }))}
            />
            <p className="mt-2 text-[11px] text-ink-400">
              Таймлайн не переписывается: каждая запись — факт, а не текущее значение поля.
            </p>
          </ConsolePanel>

          <ConsolePanel title="Платёж" className="flex-none">
            <Row label="Платёж" value={<span className="font-mono text-[12px]">01M3Y1…W5D9</span>} />
            <Row label="Статус" value={<Badge tone="success">PAID</Badge>} />
            <Row label="Способ" value="Счёт ORTA" />
            <Row label="Комиссия" value={<Money minor={292470} />} />
            <Row label="Идемпотентность" value={<span className="font-mono text-[12px]">ord-8f3k-1</span>} />
          </ConsolePanel>
        </div>
      </div>
    </div>
  );
}
