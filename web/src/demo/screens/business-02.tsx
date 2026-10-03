/**
 * ORTA Business · Продажи и заказы — список с фильтрами.
 *
 * Статус на борде «Работает»: GET /api/v1/orders?page&size&status отдаёт заказы с
 * позициями, сумма и комиссия берутся из платежа заказа. Здесь только интерфейс —
 * данных нет, числа демонстрационные.
 *
 * Честная оговорка, которую экран повторяет: эндпоинт отдаёт «свои заказы»
 * пользователя, а не срез по мерчанту — фильтра merchantId для роли MERCHANT в
 * контракте нет. Пять колонок вместо шести — сознательно: седьмая колонка борда
 * не влезает в рабочую область 828 px и обрезалась.
 */
import { Badge } from '../../components/ui/Badge';
import { Chips, ConsolePanel, ConsoleTable, Money, Notice } from '../kit';

type OrderStatus = 'PENDING_PAYMENT' | 'PAID' | 'CONFIRMED' | 'DELIVERED' | 'CANCELLED' | 'FAILED';

const STATUS_TONE: Record<OrderStatus, 'success' | 'info' | 'warning' | 'neutral' | 'danger'> = {
  PENDING_PAYMENT: 'warning',
  PAID: 'success',
  CONFIRMED: 'info',
  DELIVERED: 'info',
  CANCELLED: 'neutral',
  FAILED: 'danger',
};

/** Шесть строк из макета борда: заказ, покупатель, дата и позиции, сумма, статус. */
const ORDERS: Array<{
  id: string;
  customer: string;
  date: string;
  positions: string;
  totalMinor: number;
  status: OrderStatus;
}> = [
  { id: 'ORD-241004-9K2M', customer: 'Алия Нурлановна', date: '04.10, 09:41', positions: '3 поз. · 5 шт', totalMinor: 1339800, status: 'PENDING_PAYMENT' },
  { id: 'ORD-241003-8F3K', customer: 'Данияр Сериков', date: '03.10, 18:12', positions: '2 поз. · 2 шт', totalMinor: 19790470, status: 'PAID' },
  { id: 'ORD-241003-7D1Q', customer: 'Мадина Ахметова', date: '03.10, 15:40', positions: '2 поз. · 2 шт', totalMinor: 2535470, status: 'CONFIRMED' },
  { id: 'ORD-241003-6C7L', customer: 'Ерлан Кайратович', date: '03.10, 12:05', positions: '4 поз. · 6 шт', totalMinor: 858690, status: 'DELIVERED' },
  { id: 'ORD-241003-5B4N', customer: 'Асель Жумабаева', date: '03.10, 10:22', positions: '1 поз. · 1 шт', totalMinor: 506485, status: 'CANCELLED' },
  { id: 'ORD-241002-3Z8R', customer: 'Гульнара Сапарова', date: '02.10, 13:47', positions: '1 поз. · 2 шт', totalMinor: 3245970, status: 'FAILED' },
];

export default function Business02() {
  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      <div className="flex flex-none items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[16px] font-bold text-ink-900">Продажи и заказы</div>
          <div className="truncate text-[12px] text-ink-500">96 заказов за неделю · 3 в работе · 2 возврата</div>
        </div>
        <div className="flex flex-none items-center gap-2">
          <span className="rounded-full border border-ink-200 bg-white px-3 py-1.5 text-[12px] text-ink-600">Период: 28.09–04.10</span>
          <span className="rounded-full border border-ink-200 bg-white px-3 py-1.5 text-[12px] text-ink-600">Точка: все</span>
          <span className="rounded-full border border-ink-200 bg-white px-3 py-1.5 text-[12px] text-ink-700">Выгрузить CSV</span>
        </div>
      </div>

      <ConsolePanel
        title="Заказы"
        right={<span className="text-[11px] text-ink-400">Сортировка: новые сверху</span>}
        className="min-h-0 flex-1"
      >
        <div className="flex items-center gap-2 rounded-xl border border-ink-200 bg-white px-3 py-2 text-[12px] text-ink-400">
          Номер заказа, телефон покупателя или название товара
        </div>
        <div className="mt-2">
          <Chips items={['Все · 96', 'Оплачены · 88', 'В работе · 3', 'Отменены · 5', 'Возвраты · 2']} active="Все · 96" />
        </div>

        <div className="mt-3">
          <ConsoleTable
            columns={['Заказ', 'Покупатель', 'Дата и позиции', 'Сумма', 'Статус']}
            rows={ORDERS.map((order) => [
              <span key="id" className="font-medium text-ink-900">{order.id}</span>,
              order.customer,
              `${order.date} · ${order.positions}`,
              <Money key="sum" minor={order.totalMinor} />,
              <Badge key="status" tone={STATUS_TONE[order.status]}>{order.status}</Badge>,
            ])}
          />
        </div>

        <div className="mt-2 flex items-center justify-between gap-3">
          <span className="text-[11.5px] text-ink-500">Показано 6 из 96 · страница 1</span>
          <span className="flex items-center gap-2">
            <span className="rounded-full border border-ink-200 bg-white px-3 py-1 text-[12px] text-ink-400">Назад</span>
            <span className="rounded-full border border-ink-200 bg-white px-3 py-1 text-[12px] text-ink-700">Вперёд</span>
          </span>
        </div>
      </ConsolePanel>

      <div className="flex flex-none gap-3">
        <div className="flex-1">
          <Notice tone="info">
            Ошибки платежей видны прямо в строке: <code>FAILED</code> и <code>INSUFFICIENT_FUNDS</code> приходят из{' '}
            <code>payment-service</code> вместе с <code>failureCode</code> — их не нужно искать в другом разделе.
          </Notice>
        </div>
        <div className="w-[340px] flex-none">
          <Notice tone="warning">
            Эндпоинт отдаёт «свои заказы» пользователя, а не срез по мерчанту: фильтра <code>merchantId</code> для роли
            MERCHANT в контракте нет.
          </Notice>
        </div>
      </div>
    </div>
  );
}
