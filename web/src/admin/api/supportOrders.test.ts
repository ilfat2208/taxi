import { describe, expect, it } from 'vitest';
import {
  fetchPaymentByOrder,
  fetchSupportOrder,
  fetchSupportOrderByNumber,
  fetchSupportOrderHistory,
  fetchSupportOrders,
  normalizeSupportOrder,
  normalizeSupportOrderHistory,
  normalizeSupportOrderSummary,
  normalizeSupportPayment,
} from './supportOrders';
import { jsonResponse, stubFetch } from '../../test/utils';

/**
 * Заказы и оплаты в support-API.
 *
 * Тела ответов скопированы с DTO `OrderDtos.OrderResponse`,
 * `OrderDtos.OrderHistoryResponse`, `OrderDtos.OrderSummaryResponse`
 * (order-service) и `PaymentDtos.PaymentResponse` (payment-service). Проверки — про
 * соответствие полей реальному контракту: например, `paidAt` не подменяется
 * `completedAt`, `sagaState` не теряется, а отсутствующая оплата остаётся `null`,
 * а не нулевой суммой.
 */

const orderResponse = {
  orderId: '01M3ORDER0000000000000001',
  orderNumber: 'ORD-100500',
  status: 'PAID',
  sagaState: 'PAYMENT_SETTLED',
  currency: 'KZT',
  subtotalMinor: 259_800,
  deliveryFeeMinor: 79_000,
  totalMinor: 338_800,
  paymentId: 'PAY-1',
  paymentStatus: 'COMPLETED',
  failureReason: null,
  deliveryAddress: 'Шымкент, ул. Байтурсынова, 12, кв. 4',
  contactPhone: '+77012223344',
  comment: 'Позвонить за 10 минут',
  itemCount: 2,
  items: [
    {
      itemId: 'IT-1',
      productId: 'P-1',
      merchantId: 'M-1',
      title: 'Парацетамол 500 мг',
      unitPriceMinor: 129_900,
      quantity: 2,
      lineTotalMinor: 259_800,
      currency: 'KZT',
    },
  ],
  payments: [
    {
      merchantId: 'M-1',
      paymentId: 'PAY-1',
      status: 'COMPLETED',
      amountMinor: 259_800,
      feeMinor: 3_900,
      totalMinor: 263_700,
      currency: 'KZT',
    },
  ],
  history: [
    {
      fromStatus: null,
      toStatus: 'PENDING_PAYMENT',
      reason: null,
      actor: 'U-1001',
      createdAt: '2026-10-02T10:00:00Z',
    },
    {
      fromStatus: 'PENDING_PAYMENT',
      toStatus: 'PAID',
      reason: 'payment settled',
      actor: 'payment-service',
      createdAt: '2026-10-02T10:00:04Z',
    },
  ],
  createdAt: '2026-10-02T09:59:58Z',
  updatedAt: '2026-10-02T10:00:04Z',
  paidAt: '2026-10-02T10:00:04Z',
};

describe('normalizeSupportOrder', () => {
  it('читает заказ order-service со всеми полями, которых нет в публичном Order', () => {
    const order = normalizeSupportOrder(orderResponse);

    expect(order.orderId).toBe('01M3ORDER0000000000000001');
    expect(order.orderNumber).toBe('ORD-100500');
    expect(order.status).toBe('PAID');
    expect(order.sagaState).toBe('PAYMENT_SETTLED');
    expect(order.paymentStatus).toBe('COMPLETED');
    expect(order.itemCount).toBe(2);
    expect(order.paidAt).toBe('2026-10-02T10:00:04Z');
    expect(order.failureReason).toBeNull();
    expect(order.deliveryAddress).toContain('Байтурсынова');
    expect(order.contactPhone).toBe('+77012223344');
  });

  it('раскладывает суммы заказа: subtotal → позиции, deliveryFee → доставка', () => {
    const order = normalizeSupportOrder(orderResponse);

    expect(order.itemsTotalMinor).toBe(259_800);
    expect(order.deliveryMinor).toBe(79_000);
    expect(order.totalMinor).toBe(338_800);
  });

  it('читает позиции и оплаты по мерчантам', () => {
    const order = normalizeSupportOrder(orderResponse);

    expect(order.items).toHaveLength(1);
    expect(order.items[0]?.priceMinor).toBe(129_900);
    expect(order.items[0]?.totalMinor).toBe(259_800);
    expect(order.items[0]?.quantity).toBe(2);
    expect(order.items[0]?.merchantId).toBe('M-1');

    expect(order.payments).toHaveLength(1);
    expect(order.payments[0]?.merchantId).toBe('M-1');
    expect(order.payments[0]?.paymentId).toBe('PAY-1');
    expect(order.payments[0]?.status).toBe('COMPLETED');
    expect(order.payments[0]?.totalMinor).toBe(263_700);
  });

  it('оставляет отсутствующие поля пустыми, а не нулевыми', () => {
    const order = normalizeSupportOrder({ orderId: 'O-2', orderNumber: 'ORD-2', status: 'CREATED' });

    expect(order.sagaState).toBeNull();
    expect(order.paymentStatus).toBeNull();
    expect(order.paidAt).toBeNull();
    expect(order.payments).toEqual([]);
    expect(order.items).toEqual([]);
    expect(order.itemCount).toBe(0);
  });

  it('принимает заказ и в конверте {order: {...}}', () => {
    const order = normalizeSupportOrder({ order: orderResponse });

    expect(order.orderId).toBe('01M3ORDER0000000000000001');
    expect(order.sagaState).toBe('PAYMENT_SETTLED');
  });
});

describe('normalizeSupportOrderHistory', () => {
  it('читает переходы вместе с автором и причиной', () => {
    const history = normalizeSupportOrderHistory(orderResponse.history);

    expect(history).toHaveLength(2);
    expect(history[0]).toMatchObject({ fromStatus: null, toStatus: 'PENDING_PAYMENT', actor: 'U-1001' });
    expect(history[1]).toMatchObject({
      fromStatus: 'PENDING_PAYMENT',
      toStatus: 'PAID',
      reason: 'payment settled',
      actor: 'payment-service',
      createdAt: '2026-10-02T10:00:04Z',
    });
  });

  it('пустой список — это пустая история, а не выдуманный переход', () => {
    expect(normalizeSupportOrderHistory([])).toEqual([]);
    expect(normalizeSupportOrderHistory(null)).toEqual([]);
  });
});

describe('normalizeSupportOrderSummary', () => {
  it('читает строку списка заказов', () => {
    const summary = normalizeSupportOrderSummary({
      orderId: 'O-3',
      orderNumber: 'ORD-3',
      status: 'CANCELLED',
      currency: 'KZT',
      totalMinor: 100_000,
      itemCount: 3,
      failureReason: 'PAYMENT_DECLINED',
      createdAt: '2026-10-01T09:00:00Z',
      paidAt: null,
    });

    expect(summary.orderId).toBe('O-3');
    expect(summary.totalMinor).toBe(100_000);
    expect(summary.itemCount).toBe(3);
    expect(summary.failureReason).toBe('PAYMENT_DECLINED');
    expect(summary.paidAt).toBeNull();
  });

  it('не превращает отсутствующий счётчик позиций в ноль', () => {
    // Так отвечает общий `GET /api/v1/orders`: в строке списка нет ни позиций,
    // ни `itemCount`. Ноль на экране означал бы «в заказе нет товаров».
    const summary = normalizeSupportOrderSummary({
      orderId: 'O-4',
      orderNumber: 'ORD-4',
      status: 'PAID',
      currency: 'KZT',
      totalMinor: 100_000,
      createdAt: '2026-10-01T09:00:00Z',
    });

    expect(summary.itemCount).toBeNull();
  });
});

describe('normalizeSupportPayment', () => {
  it('читает оплату заказа из payment-service вместе с привязкой к заказу', () => {
    const payment = normalizeSupportPayment({
      paymentId: 'PAY-1',
      paymentNumber: 'PMT-1',
      type: 'MERCHANT_PAYMENT',
      status: 'COMPLETED',
      ownerUserId: 'U-1001',
      sourceAccountId: 'ACC-1',
      targetAccountId: null,
      merchantId: 'M-1',
      orderId: 'O-1',
      amountMinor: 259_800,
      feeMinor: 3_900,
      totalMinor: 263_700,
      currency: 'KZT',
      description: 'Оплата заказа ORD-100500',
      failureCode: null,
      failureReason: null,
      createdAt: '2026-10-02T10:00:03Z',
      updatedAt: '2026-10-02T10:00:04Z',
      completedAt: '2026-10-02T10:00:04Z',
    });

    expect(payment.paymentId).toBe('PAY-1');
    expect(payment.orderId).toBe('O-1');
    expect(payment.ownerUserId).toBe('U-1001');
    expect(payment.status).toBe('COMPLETED');
    expect(payment.amountMinor).toBe(259_800);
    expect(payment.feeMinor).toBe(3_900);
    expect(payment.totalMinor).toBe(263_700);
    expect(payment.updatedAt).toBe('2026-10-02T10:00:04Z');
  });
});

describe('пути запросов раздела заказов', () => {
  it('ходит на support-эндпоинты заказов и на оплату по заказу', async () => {
    const fetchMock = stubFetch(() => jsonResponse(orderResponse));
    const calls = () => fetchMock.mock.calls.map(([url]) => String(url));

    await fetchSupportOrder('O-1');
    await fetchSupportOrderByNumber('ORD-100500');
    await fetchSupportOrderHistory('O-1');
    await fetchPaymentByOrder('O-1');

    expect(calls()).toEqual([
      '/api/v1/support/orders/O-1',
      '/api/v1/support/orders/by-number/ORD-100500',
      '/api/v1/support/orders/O-1/history',
      '/api/v1/payments/by-order/O-1',
    ]);
  });

  it('передаёт фильтры списка заказов платформы', async () => {
    const fetchMock = stubFetch(() =>
      jsonResponse({ items: [], page: 1, size: 20, totalElements: 0, totalPages: 0, hasNext: false }),
    );

    await fetchSupportOrders({ userId: 'U-1001', status: 'PAID', page: 1, size: 20 });

    expect(String(fetchMock.mock.calls[0]?.[0])).toBe(
      '/api/v1/support/orders?userId=U-1001&status=PAID&page=1&size=20',
    );
  });

  it('не отправляет пустые фильтры в списке заказов', async () => {
    const fetchMock = stubFetch(() =>
      jsonResponse({ items: [], page: 0, size: 10, totalElements: 0, totalPages: 0, hasNext: false }),
    );

    await fetchSupportOrders({ userId: '   ' });

    expect(String(fetchMock.mock.calls[0]?.[0])).toBe('/api/v1/support/orders?page=0&size=10');
  });

  it('404 оплаты доходит до UI как PAYMENT_NOT_FOUND, а не как пустая оплата', async () => {
    stubFetch(() => jsonResponse({ code: 'PAYMENT_NOT_FOUND', detail: 'order O-9 was never paid' }, 404));

    await expect(fetchPaymentByOrder('O-9')).rejects.toMatchObject({
      status: 404,
      code: 'PAYMENT_NOT_FOUND',
    });
  });
});
