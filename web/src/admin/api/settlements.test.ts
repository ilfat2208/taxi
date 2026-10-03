import { describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClientProvider } from '@tanstack/react-query';
import { createTestQueryClient, headerOf, jsonResponse, problemResponse, stubFetch } from '../../test/utils';
import SettlementsSection from '../sections/settlements';
import {
  fetchSettlement,
  fetchSettlements,
  normalizeSettlement,
  normalizeSettlementDetail,
  normalizeSettlementRun,
  runSettlements,
} from './settlements';

/**
 * Расчёты с мерчантами.
 *
 * Образцы ответов скопированы из `SettlementDtos` и `docs/api.md` §10, а запросы
 * проверяются по факту: `SettlementController` принимает только
 * `merchantId`/`page`/`size`, поэтому в URL не должно появиться ни `status`, ни
 * пустого `merchantId=`. Идемпотентность прогона обеспечивает сервис, а не клиент,
 * поэтому `Idempotency-Key` в запрос запуска не подставляется.
 */

/** `SettlementDtos.SettlementResponse` — как есть, вместе с полями, которые UI не показывает. */
const SETTLEMENT = {
  settlementId: '01M3SETTLEMENT0000000000001',
  settlementNumber: 'SET-240902-A1B2C',
  merchantId: '01M3MERCHANT00000000000001',
  ownerUserId: 'U-MERCHANT-1',
  status: 'PAID',
  currency: 'KZT',
  grossMinor: 100_000,
  commissionMinor: 1_500,
  customerPaidMinor: 101_500,
  netMinor: 100_000,
  paymentCount: 1,
  payoutAccountId: '01M3ACCOUNT000000000000001',
  periodStart: '2024-09-01T10:00:00Z',
  periodEnd: '2024-09-02T00:00:00Z',
  createdAt: '2024-09-02T00:00:01Z',
  paidAt: '2024-09-02T00:00:02Z',
  failureReason: null,
};

describe('список расчётов', () => {
  it('читает страницу расчётов и её метаданные', async () => {
    const fetchMock = stubFetch(() =>
      jsonResponse({
        items: [SETTLEMENT],
        page: 0,
        size: 20,
        totalElements: 1,
        totalPages: 1,
        hasNext: false,
      }),
    );

    const page = await fetchSettlements({ page: 0, size: 20 });

    expect(String(fetchMock.mock.calls[0]?.[0])).toContain('/api/v1/settlements?');
    expect(page.totalElements).toBe(1);
    expect(page.items).toHaveLength(1);

    const settlement = page.items[0]!;
    expect(settlement.settlementNumber).toBe('SET-240902-A1B2C');
    expect(settlement.status).toBe('PAID');
    // Тождества сервиса: покупатель заплатил товары плюс комиссию, мерчанту — товары.
    expect(settlement.customerPaidMinor).toBe(settlement.grossMinor + settlement.commissionMinor);
    expect(settlement.netMinor).toBe(settlement.grossMinor);
  });

  it('не отправляет фильтр по статусу, которого нет в API, и пустой merchantId', async () => {
    const fetchMock = stubFetch(() =>
      jsonResponse({ items: [], page: 0, size: 20, totalElements: 0, totalPages: 0, hasNext: false }),
    );

    await fetchSettlements({ merchantId: '   ' });

    const url = String(fetchMock.mock.calls[0]?.[0]);
    expect(url).not.toContain('status');
    expect(url).not.toContain('merchantId');
    expect(url).toContain('page=0');
    expect(url).toContain('size=20');
  });

  it('передаёт merchantId, когда оператор сузил выборку', async () => {
    const fetchMock = stubFetch(() =>
      jsonResponse({ items: [SETTLEMENT], page: 1, size: 5, totalElements: 6, totalPages: 2, hasNext: true }),
    );

    const page = await fetchSettlements({ merchantId: SETTLEMENT.merchantId, page: 1, size: 5 });

    const url = String(fetchMock.mock.calls[0]?.[0]);
    expect(url).toContain(`merchantId=${SETTLEMENT.merchantId}`);
    expect(url).toContain('page=1');
    expect(page.hasNext).toBe(true);
    expect(page.totalPages).toBe(2);
  });

  it('оставляет «не пришло» отличным от нуля', () => {
    const settlement = normalizeSettlement({
      settlementId: 'set-1',
      merchantId: 'm-1',
      status: 'PENDING',
      currency: 'KZT',
      grossMinor: 0,
      commissionMinor: 0,
      customerPaidMinor: 0,
      netMinor: 0,
      paymentCount: 0,
      periodStart: '2024-09-01T10:00:00Z',
      periodEnd: '2024-09-02T00:00:00Z',
      createdAt: '2024-09-02T00:00:01Z',
      payoutAccountId: null,
      paidAt: null,
      failureReason: null,
    });

    expect(settlement.settlementNumber).toBe('set-1');
    expect(settlement.payoutAccountId).toBeNull();
    expect(settlement.paidAt).toBeNull();
    expect(settlement.failureReason).toBeNull();
    expect(settlement.grossMinor).toBe(0);
  });
});

describe('деталь расчёта', () => {
  it('читает расчёт вместе с покрывающими платежами', async () => {
    stubFetch(() =>
      jsonResponse({ settlement: SETTLEMENT, paymentIds: ['01M3PAYMENT000000000000001'] }),
    );

    const detail = await fetchSettlement(SETTLEMENT.settlementId);

    expect(detail.settlement.settlementNumber).toBe('SET-240902-A1B2C');
    expect(detail.paymentIds).toEqual(['01M3PAYMENT000000000000001']);
  });

  it('переживает ответ без списка платежей и без обёртки', () => {
    expect(normalizeSettlementDetail({}).paymentIds).toEqual([]);
    expect(normalizeSettlementDetail(SETTLEMENT).settlement.settlementId).toBe(SETTLEMENT.settlementId);
    expect(normalizeSettlementDetail({ settlement: SETTLEMENT, paymentIds: [null, ''] }).paymentIds).toEqual([]);
  });

  it('отдаёт ошибку сервиса как ApiError с кодом', async () => {
    stubFetch(() => problemResponse({ code: 'SETTLEMENT_NOT_FOUND', title: 'Not found', status: 404 }, 404));

    await expect(fetchSettlement('нет-такого')).rejects.toMatchObject({
      name: 'ApiError',
      status: 404,
      code: 'SETTLEMENT_NOT_FOUND',
    });
  });
});

describe('прогон расчётов', () => {
  it('запускает POST без тела и без Idempotency-Key и читает счётчики', async () => {
    const fetchMock = stubFetch(() =>
      jsonResponse({ computed: 3, paid: 2, failed: 1, awaitingPayoutAccount: 0, nothingToSettle: 4 }),
    );

    const result = await runSettlements();

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toContain('/api/v1/settlements/run');
    expect(init?.method).toBe('POST');
    expect(init?.body).toBeUndefined();
    expect(headerOf(init, 'Idempotency-Key')).toBeUndefined();

    expect(result).toEqual({ computed: 3, paid: 2, failed: 1, awaitingPayoutAccount: 0, nothingToSettle: 4 });
  });

  it('считает отсутствующие счётчики нулями, а не NaN', () => {
    expect(normalizeSettlementRun({ paid: '2' })).toEqual({
      computed: 0,
      paid: 2,
      failed: 0,
      awaitingPayoutAccount: 0,
      nothingToSettle: 0,
    });
    expect(normalizeSettlementRun(null).paid).toBe(0);
  });
});

/**
 * Раздел целиком: строка таблицы собирается из ответа сервиса, а запуск расчёта
 * существует только у ADMIN. Рендер здесь настоящий, потому что «кнопки нет» —
 * это утверждение про DOM, а не про код.
 */
describe('раздел «Расчёты»', () => {
  const SECTION = {
    id: 'settlements',
    title: 'Расчёты с мерчантами',
    description: 'Долг перед продавцом и его выплата',
    endpoints: 'GET /api/v1/settlements',
    roles: ['ADMIN', 'SUPPORT'] as Array<'ADMIN' | 'SUPPORT'>,
    write: 'Запуск расчёта',
  };

  const PENDING_SETTLEMENT = {
    ...SETTLEMENT,
    settlementId: '01M3SETTLEMENT0000000000002',
    settlementNumber: 'SET-240903-B2C3D',
    status: 'PENDING',
    paidAt: null,
    payoutAccountId: null,
  };

  function settlementsApi() {
    return stubFetch((url, init) => {
      if (url.includes('/run') && init?.method === 'POST') {
        return jsonResponse({ computed: 2, paid: 1, failed: 0, awaitingPayoutAccount: 1, nothingToSettle: 0 });
      }
      if (/\/v1\/settlements\/[^?]+$/.test(url)) {
        return jsonResponse({ settlement: SETTLEMENT, paymentIds: ['01M3PAYMENT000000000000001'] });
      }
      return jsonResponse({
        items: [SETTLEMENT, PENDING_SETTLEMENT],
        page: 0,
        size: 20,
        totalElements: 2,
        totalPages: 1,
        hasNext: false,
      });
    });
  }

  function renderSection(canWrite: boolean) {
    return render(
      createElement(
        QueryClientProvider,
        { client: createTestQueryClient() },
        createElement(SettlementsSection, {
          section: SECTION,
          role: canWrite ? 'ADMIN' : 'SUPPORT',
          canWrite,
        }),
      ),
    );
  }

  it('показывает суммы строки в мажорных единицах и с валютой сервиса', async () => {
    settlementsApi();
    renderSection(false);

    const row = (await screen.findByText('SET-240902-A1B2C')).closest('tr')!;
    const text = row.textContent ?? '';

    // 100000 минорных единиц — это «1 000,00 ₸», а не «100000».
    expect(text).toMatch(/1[\s\u00a0\u202f]000,00\s*₸/);
    expect(text).not.toContain('100000');
    expect(text).toContain('SET-240902-A1B2C');
  });

  it('фильтр по статусу честно ограничен страницей и говорит об этом', async () => {
    settlementsApi();
    const user = userEvent.setup();
    renderSection(false);

    await screen.findByText('SET-240902-A1B2C');
    // Статус выбирается в рейле: сервис параметр status не принимает, поэтому это
    // отбор по загруженной странице, и рядом написано именно так.
    expect(screen.getByText(/Числа в пилюлях — по загруженной странице/i)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /Ошибка/ }));

    expect(screen.queryByText('SET-240902-A1B2C')).toBeNull();
    expect(
      screen.getByText(/На этой странице нет расчётов со статусом/i),
    ).toBeInTheDocument();
  });

  it('открывает деталь и показывает покрывающие платежи как идентификаторы', async () => {
    settlementsApi();
    const user = userEvent.setup();
    renderSection(false);

    await user.click((await screen.findAllByRole('button', { name: 'Детали' }))[0]!);

    expect(await screen.findByText('01M3PAYMENT000000000000001')).toBeInTheDocument();
    expect(screen.getByText(/Деталь расчёта отдаёт только идентификаторы платежей/i)).toBeInTheDocument();
  });

  it('у SUPPORT кнопки запуска нет, а есть объяснение про ADMIN', async () => {
    settlementsApi();
    renderSection(false);

    await screen.findByText('SET-240902-A1B2C');

    expect(screen.queryByRole('button', { name: /Запустить расчёт/i })).toBeNull();
    expect(document.querySelector('[data-admin-write]')).toBeNull();
    expect(screen.getByText(/Запуск расчёта доступен только роли Администратор/i)).toBeInTheDocument();
  });

  it('у ADMIN запуск помечен data-admin-write: раздел объявлен изменяющим', async () => {
    settlementsApi();
    renderSection(true);

    const marker = await screen.findByRole('button', { name: /Запустить расчёт/i });
    expect(marker.getAttribute('data-admin-write')).toBe('запуск расчёта');
  });

  it('у ADMIN запуск подтверждается, уходит без тела и показывает счётчики прогона', async () => {
    const fetchMock = settlementsApi();
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
    const user = userEvent.setup();
    renderSection(true);

    await user.click(await screen.findByRole('button', { name: /Запустить расчёт/i }));

    await waitFor(() => {
      expect(screen.getByText(/Прогон завершён/i)).toBeInTheDocument();
    });

    const call = fetchMock.mock.calls.find(([url]) => String(url).endsWith('/v1/settlements/run'))!;
    expect(call[1]?.method).toBe('POST');
    expect(call[1]?.body).toBeUndefined();
    expect(headerOf(call[1], 'Idempotency-Key')).toBeUndefined();

    expect(confirmSpy).toHaveBeenCalled();
    expect(screen.getByText('Посчитано расчётов: 2')).toBeInTheDocument();
    expect(screen.getByText('Ждут счёт для выплаты: 1')).toBeInTheDocument();
  });

  it('отказ в подтверждении не отправляет запрос', async () => {
    const fetchMock = settlementsApi();
    vi.spyOn(window, 'confirm').mockReturnValue(false);
    const user = userEvent.setup();
    renderSection(true);

    await user.click(await screen.findByRole('button', { name: /Запустить расчёт/i }));

    expect(fetchMock.mock.calls.some(([url]) => String(url).endsWith('/run'))).toBe(false);
  });
});
