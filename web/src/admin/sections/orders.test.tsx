import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
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
 * честные состояния, список платформы уходит с фильтрами, рейл статусов показывает
 * серверные числа, посчитанные отдельными короткими запросами, а элементов с
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

/** Две строки списка: одна оплачена, одна отменена — на них проверяются плитки. */
const LIST_ROW_PAID = {
  orderId: 'O-1',
  orderNumber: 'ORD-100500',
  status: 'PAID',
  currency: 'KZT',
  totalMinor: 338_800,
  itemCount: 1,
  failureReason: null,
  createdAt: '2026-10-02T09:59:58Z',
  paidAt: '2026-10-02T10:00:04Z',
};

const LIST_ROW_CANCELLED = {
  orderId: 'O-2',
  orderNumber: 'ORD-100501',
  status: 'CANCELLED',
  currency: 'KZT',
  totalMinor: 100_000,
  itemCount: 2,
  failureReason: 'клиент отменил',
  createdAt: '2026-10-02T09:30:00Z',
  paidAt: null,
};

function emptyPage() {
  return { items: [], page: 0, size: 10, totalElements: 0, totalPages: 0, hasNext: false };
}

function ordersApi(
  overrides: {
    order?: MockResponse;
    payment?: MockResponse;
    reservations?: MockResponse;
    list?: MockResponse;
    mineList?: MockResponse;
  } = {},
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
    if (url.includes('/v1/support/orders?')) {
      const status = /[?&]status=([A-Z_]+)/.exec(url)?.[1];
      const size = /[?&]size=(\d+)/.exec(url)?.[1];
      // Запросы размером в одну строку — это счётчики рейла: берём у них totalElements.
      if (size === '1') {
        const totals: Record<string, number> = { PAID: 5, CANCELLED: 3, PENDING_PAYMENT: 2 };
        return jsonResponse({ ...emptyPage(), totalElements: totals[status ?? ''] ?? 0, totalPages: 1 });
      }
      return overrides.list ?? jsonResponse(emptyPage());
    }
    if (url.includes('/v1/support/orders/')) {
      return overrides.order ?? jsonResponse(ORDER);
    }
    return overrides.mineList ?? jsonResponse(emptyPage());
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

/** Плитка по подписи: иконка плитки текста не даёт, поэтому текст начинается с подписи. */
function kpi(label: string): HTMLElement {
  const found = Array.from(document.querySelectorAll<HTMLElement>('[data-admin-kpi]')).find((node) =>
    (node.textContent ?? '').trim().startsWith(label),
  );
  if (!found) {
    throw new Error(`нет плитки «${label}»`);
  }
  return found;
}

/** Значение плитки берём отдельным элементом: в тексте плитки цифра неотличима от подписи. */
function kpiValue(label: string): string {
  const value = kpi(label).querySelector('.text-2xl');
  if (!value) {
    throw new Error(`у плитки «${label}» нет значения`);
  }
  // Пробелы нормализуем: formatMoney разделяет разряды неразрывным пробелом.
  return (value.textContent ?? '').replace(/\s+/g, ' ').trim();
}

function urls(fetchMock: { mock: { calls: unknown[][] } }): string[] {
  return fetchMock.mock.calls.map(([url]) => String(url));
}

describe('раздел «Заказы»', () => {
  it('ищет заказ по номеру и показывает суммы, позиции, историю, оплату и резервы', async () => {
    const fetchMock = renderOrders(ordersApi());

    fireEvent.change(await screen.findByLabelText('Номер заказа'), { target: { value: 'ORD-100500' } });
    fireEvent.click(screen.getByRole('button', { name: 'Найти заказ' }));

    expect(await screen.findByText('Заказ № ORD-100500')).toBeInTheDocument();
    expect(urls(fetchMock)).toContain('/api/v1/support/orders/by-number/ORD-100500');

    // Суммы — только из ответа, в минорных единицах, через formatMoney.
    expect(detailRow('Товары')).toHaveTextContent('2 598,00 ₸');
    expect(detailRow('Доставка')).toHaveTextContent('790,00 ₸');
    expect(detailRow('Итого')).toHaveTextContent('3 388,00 ₸');

    // Поля, которых нет в публичном клиенте, тоже показаны: сага, статус оплаты, момент оплаты.
    expect(screen.getByText('сага: PAYMENT_SETTLED')).toBeInTheDocument();
    expect(screen.getByText('позиций: 1')).toBeInTheDocument();
    expect(detailRow('Состояние саги')).toHaveTextContent('PAYMENT_SETTLED');
    expect(detailRow('Статус оплаты')).toHaveTextContent('Выполнен');
    expect(detailRow('Момент оплаты')).toHaveTextContent('02.10.2026');
    expect(screen.getByText('Парацетамол 500 мг')).toBeInTheDocument();
    expect(detailRow('Адрес доставки')).toHaveTextContent('Байтурсынова');

    // История переходов: автор перехода приходит из ответа сервиса.
    // Статус ищем как абзац: «Ожидает оплаты» есть ещё и в рейле статусов слева.
    expect(await screen.findByText('Ожидает оплаты', { selector: 'p' })).toBeInTheDocument();
    expect(screen.getByText(/кто: payment-service/)).toBeInTheDocument();

    // Оплата заказа и резервы стока — отдельными запросами.
    expect(await screen.findByText('Номер платежа')).toBeInTheDocument();
    expect(detailRow('Номер платежа')).toHaveTextContent('PMT-1');
    expect(detailRow('Списано с плательщика')).toHaveTextContent('2 637,00 ₸');
    // Панель ищем как заголовок: та же подпись есть у sr-only-подписи таблицы резервов.
    expect(await screen.findByRole('heading', { name: 'Резервы стока по заказу' })).toBeInTheDocument();
    expect(screen.getByText('COMMITTED')).toBeInTheDocument();
  });

  it('держит плотность разметки: плитки и блоки помечены и видны без открытого заказа', async () => {
    renderOrders(ordersApi());

    expect(await screen.findByText('Раздел ничего не меняет')).toBeInTheDocument();

    // Реестр обещает 3 плитки и 3 блока; проверка `e2e/check-admin.mjs` считает эти
    // атрибуты, поэтому их число фиксируем и здесь.
    expect(document.querySelectorAll('[data-admin-kpi]').length).toBeGreaterThanOrEqual(3);
    expect(document.querySelectorAll('[data-admin-panel]').length).toBeGreaterThanOrEqual(3);

    // Деталь справа на месте и честно говорит, что заказ не выбран.
    expect(screen.getByText('Заказ не выбран')).toBeInTheDocument();
    expect(screen.getByLabelText('Номер заказа')).toBeInTheDocument();
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

  it('ищет по идентификатору, когда выбран этот режим, и не ходит на сервер с пустым полем', async () => {
    const fetchMock = renderOrders(ordersApi());

    await screen.findByText('Раздел ничего не меняет');
    fireEvent.click(screen.getByRole('button', { name: 'Найти заказ' }));

    // Запросы списков уходят сразу (это не поиск), а точечного поиска заказа — нет.
    expect(urls(fetchMock).filter((url) => /support\/orders\/[^?]/.test(url))).toHaveLength(0);

    fireEvent.change(screen.getByLabelText('Что ищем'), { target: { value: 'id' } });
    fireEvent.change(screen.getByLabelText('Идентификатор заказа'), { target: { value: 'O-1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Найти заказ' }));

    await screen.findByText('Заказ № ORD-100500');
    expect(urls(fetchMock)).toContain('/api/v1/support/orders/O-1');
  });

  it('рейл статусов показывает серверные числа и фильтрует список платформы', async () => {
    const fetchMock = renderOrders(ordersApi());

    expect(await screen.findByText('Заказов не найдено')).toBeInTheDocument();

    const rail = screen.getByLabelText('Фильтр по статусу заказа');
    // Числа — из отдельных запросов ?status=…&size=1: группировки по статусам у ручки нет.
    expect(within(rail).getByRole('button', { name: /Оплачен/ })).toHaveTextContent('5');
    expect(within(rail).getByRole('button', { name: /Отменён/ })).toHaveTextContent('3');
    expect(await screen.findByText(/Числа серверные, но добыты шестью запросами/)).toBeInTheDocument();
    // Ровно шесть запросов-счётчиков (size=1), а не седьмой: у списка размер другой.
    expect(urls(fetchMock).filter((url) => /[?&]size=1(&|$)/.test(url))).toHaveLength(6);

    fireEvent.click(within(rail).getByRole('button', { name: /Отменён/ }));

    await waitFor(() => {
      expect(
        urls(fetchMock).some((url) => url.includes('/v1/support/orders?') && url.includes('status=CANCELLED') && url.includes('size=10')),
      ).toBe(true);
    });
  });

  it('передаёт фильтр по пользователю в support-список и объясняет, чей это список', async () => {
    const fetchMock = renderOrders(ordersApi());

    expect(await screen.findByText('Заказов не найдено')).toBeInTheDocument();
    // Общий список вызывающего не запрашивается, пока выбран источник «платформа».
    expect(urls(fetchMock).some((url) => url.startsWith('/api/v1/orders?'))).toBe(false);

    fireEvent.change(screen.getByLabelText('Пользователь (userId)'), { target: { value: 'U-1001' } });

    await waitFor(
      () => {
        expect(urls(fetchMock).some((url) => url.includes('userId=U-1001'))).toBe(true);
      },
      { timeout: 3_000 },
    );
    expect(document.querySelector('[data-admin-write]')).toBeNull();
  });

  it('источник «Мои заказы» честно говорит, что это заказы вызывающего', async () => {
    const fetchMock = renderOrders(ordersApi());

    await screen.findByText('Заказов не найдено');

    fireEvent.click(screen.getByRole('button', { name: 'Мои заказы' }));

    expect(await screen.findByText('Это не заказы всей платформы')).toBeInTheDocument();
    expect(await screen.findByText('Заказов нет')).toBeInTheDocument();
    expect(urls(fetchMock).some((url) => url.startsWith('/api/v1/orders?'))).toBe(true);
    expect(screen.getByText(/показывает его собственные заказы/)).toBeInTheDocument();
    // Оговорка про отсутствующий счётчик позиций тоже на месте.
    expect(screen.getByText(/есть не в каждой строке списка/)).toBeInTheDocument();
  });

  it('считает плитки по загруженной странице, а не по всей базе', async () => {
    renderOrders(
      ordersApi({
        list: jsonResponse({
          items: [LIST_ROW_PAID, LIST_ROW_CANCELLED],
          page: 0,
          size: 10,
          totalElements: 42,
          totalPages: 5,
          hasNext: true,
        }),
      }),
    );

    await screen.findByText('ORD-100500');

    // Счёт сервера — отдельная плитка и отдельная подпись.
    expect(kpiValue('Заказов по фильтру')).toBe('42');
    expect(kpiValue('Оплачено')).toBe('1');
    expect(kpiValue('Не оплачено')).toBe('1');
    expect(kpiValue('Отменённых')).toBe('1');
    expect(kpiValue('Позиций в выборке')).toBe('3');
    // Сумма — через formatMoney, по строкам страницы.
    expect(kpiValue('Сумма выборки')).toBe('4 388,00 ₸');
    expect(screen.getByText(/остальные числа посчитаны по загруженной странице/)).toBeInTheDocument();
  });

  it('ничего не меняет: изменяющих кнопок в разделе нет', async () => {
    renderOrders(ordersApi());

    expect(await screen.findByText('Раздел ничего не меняет')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /отменить|вернуть|повторить оплату/i })).not.toBeInTheDocument();
    expect(document.querySelector('[data-admin-write]')).toBeNull();

    // Честные оговорки про отсутствующее в API остаются на экране.
    expect(screen.getByText('Список всех оплат заказа по REST недоступен.')).toBeInTheDocument();
    expect(screen.getByText('Мутаций нет вообще.')).toBeInTheDocument();
    expect(screen.getByText(/Статусы — только шесть из/)).toBeInTheDocument();
  });
});
