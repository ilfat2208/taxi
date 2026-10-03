import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { adminSectionById, type AdminSection } from '../sections';
import OrdersSection from './orders';
import { createTestQueryClient, jsonResponse, problemResponse, stubFetch, type MockResponse } from '../../test/utils';

/**
 * Раздел «Заказы».
 *
 * Тела ответов — с DTO order-service и payment-service (см. `admin/api/supportOrders.ts`).
 * Проверяется: суммы только через `formatMoney`, 404 заказа и 404 оплаты — это разные
 * честные состояния, список платформы уходит с фильтрами, а элементов с
 * `data-admin-write` в разделе нет, потому что изменяющих операций у API нет.
 */

const section = adminSectionById('orders') as AdminSection;

const ORDER = {
  orderId: 'O-1',
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
  itemCount: 1,
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
  history: [],
  createdAt: '2026-10-02T09:59:58Z',
  updatedAt: '2026-10-02T10:00:04Z',
  paidAt: '2026-10-02T10:00:04Z',
};

const HISTORY = [
  { fromStatus: null, toStatus: 'PENDING_PAYMENT', reason: null, actor: 'U-1001', createdAt: '2026-10-02T10:00:00Z' },
  {
    fromStatus: 'PENDING_PAYMENT',
    toStatus: 'PAID',
    reason: 'payment settled',
    actor: 'payment-service',
    createdAt: '2026-10-02T10:00:04Z',
  },
];

const PAYMENT = {
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
};

function emptyPage() {
  return { items: [], page: 0, size: 10, totalElements: 0, totalPages: 0, hasNext: false };
}

function ordersApi(
  overrides: { order?: MockResponse; payment?: MockResponse; reservations?: MockResponse; list?: MockResponse } = {},
): (url: string) => MockResponse {
  return (url) => {
    if (url.includes('/v1/support/orders/by-number/')) {
      return overrides.order ?? jsonResponse(ORDER);
    }
    if (url.includes('/history')) {
      return jsonResponse(HISTORY);
    }
    if (url.includes('/v1/payments/by-order/')) {
      return overrides.payment ?? jsonResponse(PAYMENT);
    }
    if (url.includes('/v1/support/reservations/')) {
      return (
        overrides.reservations ??
        jsonResponse([{ id: 'R-1', orderId: 'O-1', productId: 'P-1', quantity: 2, status: 'COMMITTED' }])
      );
    }
    if (url.includes('/v1/support/orders/')) {
      return overrides.order ?? jsonResponse(ORDER);
    }
    return overrides.list ?? jsonResponse(emptyPage());
  };
}

function renderOrders(handler: (url: string) => MockResponse) {
  const fetchMock = stubFetch(handler);
  render(
    <QueryClientProvider client={createTestQueryClient()}>
      <MemoryRouter>
        <OrdersSection section={section} role="SUPPORT" canWrite={false} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return fetchMock;
}

function detailRow(label: string): HTMLElement {
  const row = screen.getByText(label).closest('div');
  if (!row) {
    throw new Error(`нет строки «${label}»`);
  }
  return row;
}

describe('раздел «Заказы»', () => {
  it('ищет заказ по номеру и показывает суммы, позиции, историю, оплату и резервы', async () => {
    const fetchMock = renderOrders(ordersApi());

    fireEvent.change(await screen.findByLabelText('Номер заказа'), { target: { value: 'ORD-100500' } });
    fireEvent.click(screen.getByRole('button', { name: 'Найти заказ' }));

    expect(await screen.findByText('Заказ № ORD-100500')).toBeInTheDocument();
    expect(fetchMock.mock.calls.map(([url]) => String(url))).toContain(
      '/api/v1/support/orders/by-number/ORD-100500',
    );

    // Суммы — только из ответа, в минорных единицах, через formatMoney.
    expect(detailRow('Товары')).toHaveTextContent('2 598,00 ₸');
    expect(detailRow('Доставка')).toHaveTextContent('790,00 ₸');
    expect(detailRow('Итого')).toHaveTextContent('3 388,00 ₸');

    // Поля, которых нет в публичном клиенте, тоже показаны.
    expect(screen.getByText('сага: PAYMENT_SETTLED')).toBeInTheDocument();
    expect(screen.getByText('позиций: 1')).toBeInTheDocument();
    expect(screen.getByText('Парацетамол 500 мг')).toBeInTheDocument();
    expect(detailRow('Адрес доставки')).toHaveTextContent('Байтурсынова');

    // История переходов: автор перехода приходит из ответа сервиса.
    // Статус ищем как абзац: «Ожидает оплаты» есть ещё и в опциях фильтра статуса.
    expect(await screen.findByText('Ожидает оплаты', { selector: 'p' })).toBeInTheDocument();
    expect(screen.getByText(/кто: payment-service/)).toBeInTheDocument();

    // Оплата заказа и резервы стока — отдельными запросами.
    expect(await screen.findByText('Номер платежа')).toBeInTheDocument();
    expect(detailRow('Номер платежа')).toHaveTextContent('PMT-1');
    expect(detailRow('Списано с плательщика')).toHaveTextContent('2 637,00 ₸');
    expect(await screen.findByText('Резервы стока по заказу')).toBeInTheDocument();
    expect(screen.getByText('COMMITTED')).toBeInTheDocument();
  });

  it('404 оплаты объясняет, что заказ никогда не платили', async () => {
    renderOrders(
      ordersApi({
        payment: problemResponse(
          { status: 404, code: 'PAYMENT_NOT_FOUND', title: 'Not Found', detail: 'order O-1 was never paid' },
          404,
        ),
      }),
    );

    fireEvent.change(await screen.findByLabelText('Номер заказа'), { target: { value: 'ORD-100500' } });
    fireEvent.click(screen.getByRole('button', { name: 'Найти заказ' }));

    expect(await screen.findByText('Заказ никогда не был оплачен')).toBeInTheDocument();
    expect(screen.getByText(/404 PAYMENT_NOT_FOUND/)).toBeInTheDocument();
  });

  it('404 заказа — это EmptyState по номеру, а не пустая карточка', async () => {
    renderOrders(
      ordersApi({
        order: problemResponse(
          { status: 404, code: 'ORDER_NOT_FOUND', title: 'Not Found', detail: 'order ORD-9 not found' },
          404,
        ),
      }),
    );

    fireEvent.change(await screen.findByLabelText('Номер заказа'), { target: { value: 'ORD-9' } });
    fireEvent.click(screen.getByRole('button', { name: 'Найти заказ' }));

    expect(await screen.findByText('Заказ не найден')).toBeInTheDocument();
    expect(screen.getByText(/404 ORDER_NOT_FOUND/)).toBeInTheDocument();
  });

  it('ищет по идентификатору, когда выбран этот режим', async () => {
    const fetchMock = renderOrders(ordersApi());

    fireEvent.change(await screen.findByLabelText('Что ищем'), { target: { value: 'id' } });
    fireEvent.change(screen.getByLabelText('Идентификатор заказа'), { target: { value: 'O-1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Найти заказ' }));

    await screen.findByText('Заказ № ORD-100500');
    expect(fetchMock.mock.calls.map(([url]) => String(url))).toContain('/api/v1/support/orders/O-1');
  });

  it('не отправляет поиск заказа с пустым полем', async () => {
    const fetchMock = renderOrders(ordersApi());

    await screen.findByText('Раздел ничего не меняет');
    fireEvent.click(screen.getByRole('button', { name: 'Найти заказ' }));

    // Запросы списков уходят сразу (это не поиск), а точечного поиска заказа — нет.
    expect(
      fetchMock.mock.calls.filter(([url]) => /support\/orders\/[^?]/.test(String(url))),
    ).toHaveLength(0);
  });

  it('передаёт фильтр по пользователю в support-список и объясняет, чей это список', async () => {
    const fetchMock = renderOrders(ordersApi());

    expect(await screen.findByText('Заказов не найдено')).toBeInTheDocument();
    expect(screen.getByText('Заказов нет')).toBeInTheDocument();
    expect(screen.getByText('Это не заказы всей платформы')).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Пользователь (userId)'), { target: { value: 'U-1001' } });

    await waitFor(
      () => {
        expect(
          fetchMock.mock.calls.some(([url]) => String(url).includes('userId=U-1001')),
        ).toBe(true);
      },
      { timeout: 3_000 },
    );
    expect(document.querySelector('[data-admin-write]')).toBeNull();
  });

  it('ничего не меняет: изменяющих кнопок в разделе нет', async () => {
    renderOrders(ordersApi());

    expect(await screen.findByText('Раздел ничего не меняет')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /отменить|вернуть|повторить оплату/i })).not.toBeInTheDocument();
  });
});
