import { describe, expect, it } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { adminSectionById, densityOf } from '../sections';
import { jsonResponse, renderWithProviders, stubFetch } from '../../test/utils';
import { formatMoney } from '../../api/money';
import type { Payment } from '../../api/types';
import PaymentsSection, { averagesByCurrency, paymentsCsv } from './payments';

/**
 * Раздел «Платежи и возвраты» целиком: не картинки, а правила раздела.
 *
 * Проверяется ровно то, что раздел обещает оператору:
 *
 *  - плиток и панелей не меньше, чем обещает реестр разделов (`density`): те же числа
 *    считает браузерная проверка `e2e/check-admin.mjs`;
 *  - числа в плитках и в рейле посчитаны по загруженной странице, а не выдуманы;
 *  - рейл фильтрует выборку на сервере, и когда фильтр включён, у остальных статусов
 *    числа нет вовсе — ноль рядом с «Ошибка» читался бы как «ошибок нет»;
 *  - карточка платежа открывается по клику на строку и показывает заказ, владельца
 *    (взятого у счёта списания), переходы статусов и таблицу возвратов;
 *  - у SUPPORT нет ни формы возврата, ни помеченного изменяющего действия, а у ADMIN
 *    такое действие ровно одно.
 */

const SECTION = adminSectionById('payments')!;
const DENSITY = densityOf(SECTION);

/** Ответ `GET /payments/{id}` — с заказом, мерчантом и обоими счетами. */
const COMPLETED = {
  paymentId: '01M3PAYMENT000000000000001',
  paymentNumber: 'PAY-240902-0001',
  type: 'MERCHANT_PAYMENT',
  status: 'COMPLETED',
  ownerUserId: 'U-CUSTOMER-1',
  sourceAccountId: '01M3ACCOUNT000000000000001',
  targetAccountId: '01M3ACCOUNT000000000000002',
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

/** Второй платёж страницы: упавший, без заказа и мерчанта. */
const FAILED = {
  ...COMPLETED,
  paymentId: '01M3PAYMENT000000000000002',
  paymentNumber: 'PAY-240902-0002',
  status: 'FAILED',
  merchantId: null,
  orderId: null,
  description: 'Перевод другу',
  amountMinor: 50_000,
  feeMinor: 0,
  totalMinor: 50_000,
  failureCode: 'INSUFFICIENT_FUNDS',
  failureReason: 'На счёте недостаточно средств',
  completedAt: null,
};

const TRANSITIONS = [
  { id: 'tr-1', fromStatus: null, toStatus: 'CREATED', reason: null, createdAt: '2024-09-02T10:00:00Z' },
  { id: 'tr-2', fromStatus: 'CREATED', toStatus: 'COMPLETED', reason: 'saga завершена', createdAt: '2024-09-02T10:00:01Z' },
];

const REFUND = {
  refundId: 'ref-1',
  paymentId: COMPLETED.paymentId,
  amountMinor: 40_000,
  currency: 'KZT',
  status: 'COMPLETED',
  reason: 'Клиент вернул товар',
  createdAt: '2024-09-03T10:00:00Z',
  updatedAt: '2024-09-03T10:00:05Z',
};

/** Счёт списания: у него и берётся владелец, которого нет в типе `Payment`. */
const ACCOUNT = {
  id: COMPLETED.sourceAccountId,
  ownerUserId: 'U-OWNER-1',
  ownerPhone: '+77001234567',
  displayName: 'Текущий счёт',
  type: 'CUSTOMER',
  currency: 'KZT',
  status: 'ACTIVE',
  balanceMinor: 500_000,
  heldMinor: 0,
  availableMinor: 500_000,
  createdAt: '2024-09-01T10:00:00Z',
};

function pageOf(items: unknown[], totalElements = items.length) {
  return {
    items,
    page: 0,
    size: 20,
    totalElements,
    totalPages: totalElements > 0 ? 1 : 0,
    hasNext: false,
  };
}

function paymentsApi() {
  return stubFetch((url) => {
    if (url.includes('/refunds')) {
      return jsonResponse([REFUND]);
    }
    if (/\/v1\/accounts\/[^?]+$/.test(url)) {
      return jsonResponse(ACCOUNT);
    }
    if (/\/v1\/payments\/[^?]+$/.test(url)) {
      return jsonResponse({ payment: COMPLETED, transitions: TRANSITIONS });
    }
    if (url.includes('status=FAILED')) {
      return jsonResponse(pageOf([FAILED]));
    }
    return jsonResponse(pageOf([COMPLETED, FAILED], 18));
  });
}

function renderSection(canWrite: boolean) {
  return renderWithProviders(
    <PaymentsSection section={SECTION} role={canWrite ? 'ADMIN' : 'SUPPORT'} canWrite={canWrite} />,
  );
}

/** Плитка по её подписи: без этого суммы плиток путаются с суммами строк таблицы. */
function tile(label: string): HTMLElement {
  const found = Array.from(document.querySelectorAll<HTMLElement>('[data-admin-kpi]')).find((node) =>
    (node.textContent ?? '').includes(label),
  );
  if (!found) {
    throw new Error(`плитка «${label}» не найдена`);
  }
  return found;
}

/**
 * Матчер суммы: разделители групп приходят то пробелом, то неразрывным пробелом.
 * Якоря обязательны: без них «15,00 ₸» нашлось бы и внутри «1 015,00 ₸».
 */
function money(minor: number, currency = 'KZT'): RegExp {
  const formatted = formatMoney(minor, currency).replace(/[\s\u00a0\u202f]+/g, '[\\s\\u00a0\\u202f]+');
  return new RegExp(`^${formatted}$`);
}

describe('раздел «Платежи и возвраты»: плотность и роли', () => {
  it.each([true, false])('держит плотность реестра при canWrite=%s', async (canWrite) => {
    paymentsApi();
    renderSection(canWrite);

    await screen.findByText(COMPLETED.paymentNumber);

    const kpis = document.querySelectorAll('[data-admin-kpi]').length;
    const panels = document.querySelectorAll('[data-admin-panel]').length;
    expect(kpis).toBeGreaterThanOrEqual(DENSITY.kpis);
    expect(panels).toBeGreaterThanOrEqual(canWrite ? DENSITY.panels : Math.max(1, DENSITY.panels - 1));
  });

  it('у SUPPORT нет ни формы возврата, ни помеченного действия', async () => {
    paymentsApi();
    renderSection(false);

    await screen.findByText(COMPLETED.paymentNumber);

    expect(document.querySelector('form')).toBeNull();
    expect(document.querySelector('[data-admin-write]')).toBeNull();
    expect(screen.getByText(/Возврат средств доступен только роли Администратор/i)).toBeInTheDocument();
  });

  it('у ADMIN действие возврата помечено ровно одно', async () => {
    paymentsApi();
    renderSection(true);

    await screen.findByText(COMPLETED.paymentNumber);

    const marked = document.querySelectorAll('[data-admin-write]');
    expect(marked).toHaveLength(1);
    expect(marked[0]?.getAttribute('data-admin-write')).toBe('возврат средств');
  });
});

describe('раздел «Платежи»: числа по загруженной странице', () => {
  it('считает плитки по странице и не смешивает валюты', async () => {
    paymentsApi();
    renderSection(true);

    await screen.findByText(COMPLETED.paymentNumber);

    // Счёт сервиса — отдельное число: оно из PageResponse, а не из двух строк на экране.
    expect(within(tile('Платежей по фильтру')).getByText('18')).toBeInTheDocument();
    expect(within(tile('Платежей по фильтру')).getByText(/на странице 2/)).toBeInTheDocument();

    // Сумма страницы: 101 500 + 50 000 минорных единиц одной валютой.
    expect(within(tile('Сумма на странице')).getByText(money(151_500))).toBeInTheDocument();

    // Доля неуспешных: один FAILED из двух строк.
    expect(within(tile('Доля неуспешных')).getByText('50 %')).toBeInTheDocument();
    expect(within(tile('Доля неуспешных')).getByText(/1 из 2/)).toBeInTheDocument();

    // Средний чек: 151 500 / 2 — целые минорные единицы, без дробных тиынов.
    expect(within(tile('Средний чек')).getByText(money(75_750))).toBeInTheDocument();
  });

  it('показывает средний чек каждой валютой отдельно и округляет вниз до тиына', () => {
    const mixed = [
      { currency: 'KZT', totalMinor: 101, count: 2 },
      { currency: 'USD', totalMinor: 1_000, count: 1 },
    ];

    expect(averagesByCurrency(mixed)).toEqual([
      { currency: 'KZT', totalMinor: 50, count: 2 },
      { currency: 'USD', totalMinor: 1_000, count: 1 },
    ]);
    expect(averagesByCurrency([])).toEqual([]);
  });

  it('на пустой странице не рисует диаграммы из воздуха', async () => {
    stubFetch(() => jsonResponse(pageOf([], 0)));
    renderSection(true);

    expect(await screen.findByText('Нечего показывать: на странице нет платежей')).toBeInTheDocument();
    expect(screen.getByText('Платежей не найдено')).toBeInTheDocument();
    expect(within(tile('Платежей по фильтру')).getByText('0')).toBeInTheDocument();
  });
});

describe('раздел «Платежи»: рейл статусов', () => {
  it('фильтрует выборку на сервере и молчит про числа остальных статусов', async () => {
    const fetchMock = paymentsApi();
    const user = userEvent.setup();
    renderSection(true);

    await screen.findByText(COMPLETED.paymentNumber);

    // До фильтра числа есть у обоих статусов страницы.
    expect((screen.getByRole('button', { name: /Выполнен/ }).textContent ?? '')).toMatch(/Выполнен\s*1/);
    expect((screen.getByRole('button', { name: /Ошибка/ }).textContent ?? '')).toMatch(/Ошибка\s*1/);

    await user.click(screen.getByRole('button', { name: /Ошибка/ }));
    await screen.findByText(FAILED.paymentNumber);

    await waitFor(() => {
      expect(fetchMock.mock.calls.some(([url]) => String(url).includes('status=FAILED'))).toBe(true);
    });

    // Страница загружена с фильтром: у остальных статусов числа нет, а не ноль.
    expect((screen.getByRole('button', { name: /Выполнен/ }).textContent ?? '').trim()).toBe('Выполнен');
    expect((screen.getByRole('button', { name: /Ошибка/ }).textContent ?? '')).toMatch(/Ошибка\s*1/);
    expect(screen.getByText(/уходит в сервис, поэтому у остальных пунктов числа нет/i)).toBeInTheDocument();
  });
});

describe('раздел «Платежи»: карточка платежа', () => {
  it('открывается по клику на строку и показывает заказ, владельца, переходы и возвраты', async () => {
    paymentsApi();
    const user = userEvent.setup();
    renderSection(true);

    const row = (await screen.findByText(COMPLETED.paymentNumber)).closest('tr')!;
    await user.click(row);

    // Заказ приходит в PaymentResponse: в таблице он сокращён, в карточке — целиком.
    expect(await screen.findByText(COMPLETED.orderId)).toBeInTheDocument();
    // Владелец теперь есть в самом платеже (`ownerUserId` в PaymentResponse), поэтому
    // запрос к счёту списания для его показа не нужен.
    expect(await screen.findByText(COMPLETED.ownerUserId)).toBeInTheDocument();
    expect(await screen.findByText('saga завершена')).toBeInTheDocument();

    // История возвратов — таблицей, с суммой, статусом, причиной и временем изменения.
    const refundTable = screen.getByText('Клиент вернул товар').closest('table')!;
    expect(within(refundTable).getByText(money(40_000))).toBeInTheDocument();
    expect(within(refundTable).getByText('Выполнен')).toBeInTheDocument();
    expect(refundTable.querySelector('caption')?.textContent).toMatch(/Возвраты по платежу/i);
    expect(screen.getByText(/Отдельной даты завершения у возврата нет/i)).toBeInTheDocument();
  });

  it('показывает код и причину отказа упавшего платежа', async () => {
    stubFetch((url) => {
      if (url.includes('/refunds')) {
        return jsonResponse([]);
      }
      if (/\/v1\/accounts\/[^?]+$/.test(url)) {
        return jsonResponse(ACCOUNT);
      }
      if (/\/v1\/payments\/[^?]+$/.test(url)) {
        return jsonResponse({ payment: FAILED, transitions: [] });
      }
      return jsonResponse(pageOf([FAILED]));
    });
    const user = userEvent.setup();
    renderSection(true);

    await user.click((await screen.findByText(FAILED.paymentNumber)).closest('tr')!);

    expect(await screen.findByText('INSUFFICIENT_FUNDS')).toBeInTheDocument();
    expect(screen.getByText('На счёте недостаточно средств')).toBeInTheDocument();
  });

  it('если сервис не прислал ownerUserId, владелец берётся у счёта списания', async () => {
    const withoutOwner = { ...COMPLETED, ownerUserId: null };
    stubFetch((url) => {
      if (url.includes('/refunds')) {
        return jsonResponse([]);
      }
      if (/\/v1\/accounts\/[^?]+$/.test(url)) {
        return jsonResponse(ACCOUNT);
      }
      if (/\/v1\/payments\/[^?]+$/.test(url)) {
        return jsonResponse({ payment: withoutOwner, transitions: [] });
      }
      return jsonResponse(pageOf([withoutOwner]));
    });
    const user = userEvent.setup();
    renderSection(true);

    await user.click((await screen.findByText(COMPLETED.paymentNumber)).closest('tr')!);

    // Запасной путь остаётся рабочим: без поля в платеже владелец всё равно виден.
    expect(await screen.findByText(ACCOUNT.ownerUserId)).toBeInTheDocument();
  });
});

describe('раздел «Платежи»: выгрузка загруженных строк', () => {
  it('собирает CSV из строк страницы в минорных единицах', () => {
    const csv = paymentsCsv([COMPLETED as unknown as Payment]);
    const [header, row] = csv.split('\r\n');

    expect(header).toBe(
      'paymentId,paymentNumber,type,status,orderId,merchantId,currency,amountMinor,feeMinor,totalMinor,createdAt',
    );
    expect(row).toContain(`"${COMPLETED.paymentId}"`);
    expect(row).toContain(`"${COMPLETED.orderId}"`);
    // Суммы — как их отдал сервис: 100000 минорных единиц, а не «1 000,00».
    expect(row).toContain('"100000"');
    expect(row).toContain('"101500"');
    expect(row).not.toContain('1 000,00');
  });

  it('подписывает кнопку выгрузки числом загруженных строк', async () => {
    paymentsApi();
    renderSection(true);

    await screen.findByText(COMPLETED.paymentNumber);

    expect(screen.getByRole('button', { name: /Скопировать CSV \(2\)/ })).toBeInTheDocument();
  });
});
