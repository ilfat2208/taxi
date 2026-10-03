/**
 * API-слой раздела «Заказы» админ-панели.
 *
 * Пути и поля — из реальных контроллеров:
 *  - `services/order-service/.../api/SupportOrderController.java`
 *    (`@RequestMapping("/api/v1/support/orders")`): `/{orderId}`,
 *    `/by-number/{orderNumber}`, `/{orderId}/history`, `GET` (список) —
 *    ответы `OrderDtos.OrderResponse`, `OrderDtos.OrderHistoryResponse`,
 *    `OrderDtos.OrderSummaryResponse`;
 *  - `services/payment-service/.../api/PaymentController.java`:
 *    `GET /api/v1/payments/by-order/{orderId}` → `PaymentDtos.PaymentResponse`
 *    (оплата заказа, 404 `PAYMENT_NOT_FOUND`, если заказ никогда не платили).
 *
 * Ни одной мутации здесь нет: поддержка читает чужие заказы и ничего в них не
 * меняет — отмена живёт в `OrderController` и через support-контроллер недоступна.
 */
import { apiRequest } from '../../api/client';
import { normalizeOrder, normalizePage, normalizePayment } from '../../api/endpoints';
import type { Order, Page, Payment } from '../../api/types';
import { asRecord, listOf, numberOf, optionalNumberOf, optionalTextOf, textOf } from './supportCatalog';

/* -------------------------------------------------------------------- типы */

/**
 * Оплата одного мерчанта внутри заказа (`OrderDtos.OrderPaymentResponse`).
 *
 * После разделённого чекаута оплат у заказа несколько — по одной на магазин, и
 * доставка едет вместе с одной из них.
 */
export interface SupportOrderPayment {
  merchantId: string | null;
  /** `null`, пока оплата ещё не создана — это нормальное состояние незавершённого чекаута. */
  paymentId: string | null;
  status: string | null;
  amountMinor: number;
  feeMinor: number;
  totalMinor: number;
  currency: string;
}

/**
 * Заказ глазами поддержки: всё из `OrderResponse`, включая поля, которых нет в
 * публичном `Order` клиента (`sagaState`, `payments`, `paymentStatus`, `paidAt`).
 */
export interface SupportOrder extends Order {
  /** Состояние саги: именно оно отличает «оплаты ещё нет» от «исход оплаты неизвестен». */
  sagaState: string | null;
  /** Статус первой оплаты заказа, как его посчитал order-service. */
  paymentStatus: string | null;
  /** Число позиций, посчитанное сервисом (`itemCount`). */
  itemCount: number;
  /** Момент оплаты; `completedAt` в ответе нет — не подменяем одно другим. */
  paidAt: string | null;
  payments: SupportOrderPayment[];
}

/** Один переход саги (`OrderDtos.OrderHistoryResponse`): кто, из чего, во что и почему. */
export interface SupportOrderHistoryEntry {
  fromStatus: string | null;
  toStatus: string;
  reason: string | null;
  actor: string | null;
  createdAt: string | null;
}

/** Строка списка заказов: без позиций, один запрос на страницу. */
export interface SupportOrderSummary {
  orderId: string;
  orderNumber: string;
  status: string;
  currency: string;
  totalMinor: number;
  /**
   * Число позиций из `OrderSummaryResponse.itemCount`.
   *
   * `null`, когда счётчика в ответе нет (так отвечает общий `GET /api/v1/orders`:
   * у него в строке списка нет ни `itemCount`, ни самих позиций). Ноль здесь был бы
   * утверждением «в заказе нет товаров», которого сервис не делал.
   */
  itemCount: number | null;
  failureReason: string | null;
  createdAt: string;
  paidAt: string | null;
}

/** Оплата заказа из payment-service: поля оплаты плюс её привязка к заказу и владельцу. */
export interface SupportPayment extends Payment {
  orderId: string | null;
  ownerUserId: string | null;
  updatedAt: string | null;
}

export interface SupportOrderListQuery {
  /** Идентификатор пользователя, чьи заказы читаем (`?userId=`). */
  userId?: string;
  status?: string;
  page?: number;
  size?: number;
}

/* ------------------------------------------------------------ нормализация */

function normalizeSupportOrderPayment(raw: unknown): SupportOrderPayment {
  const record = asRecord(raw);
  const amountMinor = numberOf(record.amountMinor, 0);
  const feeMinor = numberOf(record.feeMinor, 0);
  return {
    merchantId: optionalTextOf(record.merchantId),
    paymentId: optionalTextOf(record.paymentId),
    status: optionalTextOf(record.status),
    amountMinor,
    feeMinor,
    totalMinor: numberOf(record.totalMinor, amountMinor + feeMinor),
    currency: textOf(record.currency, 'KZT'),
  };
}

/**
 * `OrderDtos.OrderResponse` → `SupportOrder`.
 *
 * Общие поля разбирает `normalizeOrder` из `api/endpoints` (он же собирает позиции
 * и вложенную историю из `items`/`history`), здесь добавляются только поля, которые
 * публичный клиент не читает. Полезные детали: `itemsTotalMinor` приходит из
 * `subtotalMinor`, `deliveryMinor` — из `deliveryFeeMinor`.
 */
export function normalizeSupportOrder(raw: unknown): SupportOrder {
  const record = asRecord(asRecord(raw).order ?? raw);
  return {
    ...normalizeOrder(raw),
    sagaState: optionalTextOf(record.sagaState),
    paymentStatus: optionalTextOf(record.paymentStatus),
    itemCount: numberOf(record.itemCount, 0),
    paidAt: optionalTextOf(record.paidAt),
    payments: listOf(record.payments).map(normalizeSupportOrderPayment),
  };
}

/** История переходов; `actor` — то, чего нет в публичном `OrderStatusHistoryEntry`. */
export function normalizeSupportOrderHistory(raw: unknown): SupportOrderHistoryEntry[] {
  return listOf(raw).map((entry) => {
    const record = asRecord(entry);
    return {
      fromStatus: optionalTextOf(record.fromStatus),
      toStatus: textOf(record.toStatus ?? record.status, 'UNKNOWN'),
      reason: optionalTextOf(record.reason ?? record.comment),
      actor: optionalTextOf(record.actor),
      createdAt: optionalTextOf(record.createdAt ?? record.changedAt ?? record.occurredAt),
    };
  });
}

export function normalizeSupportOrderSummary(raw: unknown): SupportOrderSummary {
  const record = asRecord(raw);
  const orderId = textOf(record.orderId ?? record.id);
  return {
    orderId,
    orderNumber: textOf(record.orderNumber ?? record.number, orderId),
    status: textOf(record.status, 'UNKNOWN'),
    currency: textOf(record.currency, 'KZT'),
    totalMinor: numberOf(record.totalMinor, 0),
    itemCount: optionalNumberOf(record.itemCount),
    failureReason: optionalTextOf(record.failureReason),
    createdAt: textOf(record.createdAt),
    paidAt: optionalTextOf(record.paidAt),
  };
}

/** Платёж дополняется `orderId`/`ownerUserId`/`updatedAt`, которых нет в типе `Payment`. */
export function normalizeSupportPayment(raw: unknown): SupportPayment {
  const record = asRecord(raw);
  return {
    ...normalizePayment(raw),
    orderId: optionalTextOf(record.orderId),
    ownerUserId: optionalTextOf(record.ownerUserId),
    updatedAt: optionalTextOf(record.updatedAt),
  };
}

/* -------------------------------------------------------------- запросы */

/**
 * Заказ по идентификатору (`SupportOrderController.orderById`).
 * 404 `ORDER_NOT_FOUND`; чтение чужого заказа записывается в аудит.
 */
export function fetchSupportOrder(orderId: string): Promise<SupportOrder> {
  return apiRequest<unknown>(`/v1/support/orders/${encodeURIComponent(orderId)}`).then(
    normalizeSupportOrder,
  );
}

/**
 * Заказ по номеру, который клиент называет по телефону
 * (`SupportOrderController.orderByNumber`). 404 `ORDER_NOT_FOUND`.
 */
export function fetchSupportOrderByNumber(orderNumber: string): Promise<SupportOrder> {
  return apiRequest<unknown>(
    `/v1/support/orders/by-number/${encodeURIComponent(orderNumber)}`,
  ).then(normalizeSupportOrder);
}

/** След саги: каждый переход, кто его вызвал и почему (`SupportOrderController.history`). */
export function fetchSupportOrderHistory(orderId: string): Promise<SupportOrderHistoryEntry[]> {
  return apiRequest<unknown>(
    `/v1/support/orders/${encodeURIComponent(orderId)}/history`,
  ).then(normalizeSupportOrderHistory);
}

/**
 * Оплата заказа (`PaymentController.byOrder`).
 *
 * Отдаёт *рассчитанную* оплату заказа, а если заказ платили дважды — оплату в
 * терминальном состоянии; 404 `PAYMENT_NOT_FOUND`, когда заказ никогда не платили.
 * Все оплаты-по-мерчантам лежат в самом заказе (`payments`), отдельной ручки для них
 * в REST нет (она осталась внутренней).
 */
export function fetchPaymentByOrder(orderId: string): Promise<SupportPayment> {
  return apiRequest<unknown>(`/v1/payments/by-order/${encodeURIComponent(orderId)}`).then(
    normalizeSupportPayment,
  );
}

/**
 * Заказы по пользователю и/или статусу, новые первыми
 * (`SupportOrderController.list`, `GET /api/v1/support/orders`).
 *
 * Это единственная ручка, которая отдаёт заказы *всей* платформы: `GET /api/v1/orders`
 * (`fetchOrders`) отдаёт заказы вызывающего пользователя, поэтому у оператора он
 * показывает только его собственные.
 */
export function fetchSupportOrders(query: SupportOrderListQuery = {}): Promise<Page<SupportOrderSummary>> {
  // `userId` из пробелов — это «фильтра нет»: сервер (`SupportOrderService.listOrders`)
  // трактует пустую строку так же, и отправлять её в запрос незачем.
  const userId = query.userId?.trim();
  return apiRequest<unknown>('/v1/support/orders', {
    query: {
      userId: userId === '' ? undefined : userId,
      status: query.status,
      page: query.page ?? 0,
      size: query.size ?? 10,
    },
  }).then((raw) => normalizePage(raw, normalizeSupportOrderSummary));
}
