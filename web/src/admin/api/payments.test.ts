import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClientProvider } from '@tanstack/react-query';
import { bodyOf, createTestQueryClient, headerOf, jsonResponse, problemResponse, stubFetch } from '../../test/utils';
import { fetchPayment, fetchPayments, fetchRefunds, refundPayment } from '../../api/endpoints';
import PaymentsSection, { sumsByCurrency } from '../sections/payments';

/**
 * Платежи: проверка того, что раздел админки переиспользует существующий API-слой
 * без расхождений с сервисом.
 *
 * Образцы ответов — из `PaymentDtos` (`payment-service`). Тесты фиксируют ровно то,
 * на что опирается раздел: параметры запроса, разбор конвертов ответа и две
 * честные дыры контракта — `normalizePayment` не сохраняет `orderId`, а
 * `RefundResponse` не отдаёт `completedAt`.
 */

/** `PaymentDtos.PaymentResponse` целиком, включая поля, которых нет в типе клиента. */
const PAYMENT_RESPONSE = {
  paymentId: '01M3PAYMENT000000000000001',
  paymentNumber: 'PAY-240902-0001',
  type: 'MERCHANT_PAYMENT',
  status: 'COMPLETED',
  ownerUserId: 'U-CUSTOMER-1',
  sourceAccountId: '01M3ACCOUNT000000000000001',
  targetAccountId: null,
  merchantId: '01M3MERCHANT00000000000001',
  orderId: '01M3ORDER0000000000000001',
  amountMinor: 100_000,
  feeMinor: 1_500,
  totalMinor: 101_500,
  currency: 'KZT',
  description: 'Заказ № 1042',
  failureCode: null,
  failureReason: null,
  createdAt: '2024-09-02T10:00:00Z',
  updatedAt: '2024-09-02T10:00:01Z',
  completedAt: '2024-09-02T10:00:01Z',
};

describe('список платежей', () => {
  it('ходит на /v1/payments с серверным фильтром status и читает PageResponse', async () => {
    const fetchMock = stubFetch(() =>
      jsonResponse({
        items: [PAYMENT_RESPONSE],
        page: 0,
        size: 20,
        totalElements: 1,
        totalPages: 1,
        hasNext: false,
      }),
    );

    const page = await fetchPayments({ page: 0, size: 20, status: 'COMPLETED' });

    const url = String(fetchMock.mock.calls[0]?.[0]);
    expect(url).toContain('/api/v1/payments?');
    expect(url).toContain('page=0');
    expect(url).toContain('size=20');
    expect(url).toContain('status=COMPLETED');

    const payment = page.items[0]!;
    expect(payment.paymentNumber).toBe('PAY-240902-0001');
    expect(payment.merchantId).toBe(PAYMENT_RESPONSE.merchantId);
    // Три суммы сервиса: получателю amount, платформе fee, с плательщика total.
    expect(payment.totalMinor).toBe(payment.amountMinor + payment.feeMinor);
    expect(payment.completedAt).toBe('2024-09-02T10:00:01Z');
  });

  it('не отправляет status, когда фильтр не выбран', async () => {
    const fetchMock = stubFetch(() =>
      jsonResponse({ items: [], page: 0, size: 20, totalElements: 0, totalPages: 0, hasNext: false }),
    );

    await fetchPayments({ page: 2 });

    const url = String(fetchMock.mock.calls[0]?.[0]);
    expect(url).not.toContain('status');
    expect(url).toContain('page=2');
  });

  it('доводит orderId сервиса до платежа: по нему оператор находит заказ', async () => {
    stubFetch(() => jsonResponse({ items: [PAYMENT_RESPONSE], totalElements: 1, page: 0, size: 20 }));

    const page = await fetchPayments();

    expect(page.items[0]!.orderId).toBe(PAYMENT_RESPONSE.orderId);
    expect(page.items[0]!.merchantId).toBe(PAYMENT_RESPONSE.merchantId);
  });

  it('отдаёт ошибку сервиса как ApiError, чтобы экран показал humanMessage', async () => {
    stubFetch(() =>
      problemResponse({ code: 'PAYMENT_NOT_FOUND', title: 'Not found', detail: 'нет такого', status: 404 }, 404),
    );

    await expect(fetchPayments()).rejects.toMatchObject({ status: 404, code: 'PAYMENT_NOT_FOUND' });
  });
});

describe('деталь платежа и возвраты', () => {
  it('читает PaymentDetailsResponse вместе с переходами статусов', async () => {
    stubFetch(() =>
      jsonResponse({
        payment: PAYMENT_RESPONSE,
        transitions: [
          {
            id: 'tr-1',
            fromStatus: null,
            toStatus: 'CREATED',
            reason: null,
            actor: 'SYSTEM',
            createdAt: '2024-09-02T10:00:00Z',
          },
          {
            id: 'tr-2',
            fromStatus: 'CREATED',
            toStatus: 'COMPLETED',
            reason: 'saga завершена',
            actor: 'SYSTEM',
            createdAt: '2024-09-02T10:00:01Z',
          },
        ],
      }),
    );

    const detail = await fetchPayment(PAYMENT_RESPONSE.paymentId);

    expect(detail.payment.status).toBe('COMPLETED');
    expect(detail.transitions.map((transition) => transition.toStatus)).toEqual(['CREATED', 'COMPLETED']);
    expect(detail.transitions[1]!.reason).toBe('saga завершена');
  });

  it('читает возвраты как массив RefundResponse: время берётся из updatedAt', async () => {
    stubFetch(() =>
      jsonResponse([
        {
          refundId: 'ref-1',
          paymentId: PAYMENT_RESPONSE.paymentId,
          amountMinor: 40_000,
          currency: 'KZT',
          status: 'COMPLETED',
          reason: 'Возврат по запросу клиента',
          createdAt: '2024-09-03T10:00:00Z',
          updatedAt: '2024-09-03T10:00:01Z',
        },
        {
          refundId: 'ref-2',
          paymentId: PAYMENT_RESPONSE.paymentId,
          amountMinor: 10_000,
          currency: 'KZT',
          status: 'FAILED',
          reason: 'счёт закрыт',
          createdAt: '2024-09-03T11:00:00Z',
          updatedAt: '2024-09-03T11:00:01Z',
        },
      ]),
    );

    const refunds = await fetchRefunds(PAYMENT_RESPONSE.paymentId);

    expect(refunds).toHaveLength(2);
    expect(refunds[0]!.amountMinor).toBe(40_000);
    // У возврата нет отдельной даты завершения: сервис присылает updatedAt, и именно оно
    // попадает в completedAt, а createdAt остаётся временем создания записи.
    expect(refunds[0]!.updatedAt).toBe('2024-09-03T10:00:01Z');
    expect(refunds[0]!.completedAt).toBe('2024-09-03T10:00:01Z');
    expect(refunds[0]!.createdAt).toBe('2024-09-03T10:00:00Z');
  });

  it('шлёт возврат с Idempotency-Key и телом RefundRequest', async () => {
    const fetchMock = stubFetch(() =>
      jsonResponse(
        {
          refundId: 'ref-1',
          paymentId: PAYMENT_RESPONSE.paymentId,
          amountMinor: 40_000,
          currency: 'KZT',
          status: 'COMPLETED',
          reason: 'Возврат по запросу клиента',
          createdAt: '2024-09-03T10:00:00Z',
          updatedAt: '2024-09-03T10:00:01Z',
        },
        201,
      ),
    );

    await refundPayment(
      PAYMENT_RESPONSE.paymentId,
      { amountMinor: 40_000, reason: 'Возврат по запросу клиента' },
      'idem-key-1',
    );

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toContain(`/api/v1/payments/${PAYMENT_RESPONSE.paymentId}/refund`);
    expect(init?.method).toBe('POST');
    expect(headerOf(init, 'Idempotency-Key')).toBe('idem-key-1');
    expect(bodyOf<{ amountMinor: number; reason: string }>(init)).toEqual({
      amountMinor: 40_000,
      reason: 'Возврат по запросу клиента',
    });
  });
});

describe('суммы по валютам на странице', () => {
  it('не смешивает разные валюты в одно число', () => {
    const items = [
      { currency: 'KZT', totalMinor: 101_500 },
      { currency: 'KZT', totalMinor: 50_000 },
      { currency: 'USD', totalMinor: 1_000 },
    ];

    const sums = sumsByCurrency(
      items,
      (item) => item.currency,
      (item) => item.totalMinor,
    );

    expect(sums).toEqual([
      { currency: 'KZT', totalMinor: 151_500, count: 2 },
      { currency: 'USD', totalMinor: 1_000, count: 1 },
    ]);
  });

  it('на пустой странице не придумывает нулевую сумму', () => {
    expect(sumsByCurrency([], (item: { currency: string }) => item.currency, () => 0)).toEqual([]);
  });
});

/**
 * Роль важнее данных: правило «SUPPORT только читает» проверяется на настоящем
 * рендере, потому что его нельзя проверить ни нормализатором, ни глазами по коду —
 * форма возврата не должна существовать в DOM, а не быть выключенной.
 */
describe('раздел «Платежи»: возврат по роли', () => {
  const SECTION = {
    id: 'payments',
    title: 'Платежи и возвраты',
    description: 'Все платежи платформы',
    endpoints: 'GET /api/v1/payments',
    roles: ['ADMIN', 'SUPPORT'] as Array<'ADMIN' | 'SUPPORT'>,
    write: 'Возврат средств',
  };

  function paymentsApi() {
    return stubFetch((url) => {
      if (url.includes('/refunds')) {
        return jsonResponse([]);
      }
      if (/\/v1\/payments\/[^?]+$/.test(url)) {
        return jsonResponse({ payment: PAYMENT_RESPONSE, transitions: [] });
      }
      return jsonResponse({ items: [PAYMENT_RESPONSE], page: 0, size: 20, totalElements: 1, totalPages: 1 });
    });
  }

  function renderSection(canWrite: boolean) {
    // `createElement` вместо JSX: файл остаётся `.ts` и в списке разрешённых путей.
    return render(
      createElement(
        QueryClientProvider,
        { client: createTestQueryClient() },
        createElement(PaymentsSection, {
          section: SECTION,
          role: canWrite ? 'ADMIN' : 'SUPPORT',
          canWrite,
        }),
      ),
    );
  }

  it('для SUPPORT формы и помеченного действия нет вообще, а есть объяснение про ADMIN', async () => {
    paymentsApi();
    renderSection(false);

    await screen.findByText(PAYMENT_RESPONSE.paymentNumber);

    expect(screen.queryByRole('button', { name: /вернуть/i })).toBeNull();
    expect(document.querySelector('form')).toBeNull();
    expect(document.querySelector('[data-admin-write]')).toBeNull();
    expect(screen.getByText(/Возврат средств доступен только роли Администратор/i)).toBeInTheDocument();
  });

  it('у ADMIN форма и помеченное действие на месте даже без выбранного платежа', async () => {
    paymentsApi();
    renderSection(true);

    await screen.findByText(PAYMENT_RESPONSE.paymentNumber);

    const marker = document.querySelector('[data-admin-write]');
    expect(marker).not.toBeNull();
    expect(marker?.getAttribute('data-admin-write')).toBe('возврат средств');
    expect(screen.getByRole('button', { name: /Вернуть деньги/i })).toBeInTheDocument();
  });

  it('без выбранного платежа возврат не уходит в сервис, а объясняет, чего не хватает', async () => {
    const fetchMock = paymentsApi();
    const user = userEvent.setup();
    renderSection(true);

    await screen.findByText(PAYMENT_RESPONSE.paymentNumber);
    await user.click(screen.getByRole('button', { name: /Вернуть деньги/i }));

    expect(screen.getByText(/Выберите платёж: возврат оформляется по конкретному платежу/i)).toBeInTheDocument();
    expect(fetchMock.mock.calls.some(([url, init]) => String(url).endsWith('/refund') && init?.method === 'POST')).toBe(
      false,
    );
  });

  it('для ADMIN возврат уходит суммой по умолчанию и с Idempotency-Key', async () => {
    const fetchMock = paymentsApi();
    const user = userEvent.setup();
    renderSection(true);

    await screen.findByText(PAYMENT_RESPONSE.paymentNumber);
    await user.selectOptions(screen.getByLabelText(/^Платёж$/), PAYMENT_RESPONSE.paymentId);
    await user.clear(screen.getByLabelText(/Причина возврата/i));
    await user.type(screen.getByLabelText(/Причина возврата/i), 'Клиент вернул товар');
    await user.click(screen.getByRole('button', { name: /Вернуть деньги/i }));

    await waitFor(() => {
      expect(
        fetchMock.mock.calls.some(
          ([url, init]) => String(url).endsWith('/refund') && init?.method === 'POST',
        ),
      ).toBe(true);
    });

    const call = fetchMock.mock.calls.find(
      ([url, init]) => String(url).endsWith('/refund') && init?.method === 'POST',
    )!;
    expect(headerOf(call[1], 'Idempotency-Key')).toBeTruthy();
    // Сумма по умолчанию — весь остаток к возврату, посчитанный из минорных единиц сервиса.
    expect(bodyOf<{ amountMinor: number; reason: string }>(call[1])).toEqual({
      amountMinor: PAYMENT_RESPONSE.amountMinor,
      reason: 'Клиент вернул товар',
    });
  });
});
