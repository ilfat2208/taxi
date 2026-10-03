import { describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { adminSectionById, densityOf } from '../sections';
import { jsonResponse, renderWithProviders, stubFetch } from '../../test/utils';
import { formatMoney } from '../../api/money';
import { formatDate } from '../../lib/format';
import type { Settlement } from '../api/settlements';
import SettlementsSection, { settlementsCsv } from './settlements';

/**
 * Раздел «Расчёты с мерчантами» целиком: не картинки, а правила раздела.
 *
 * Проверяется ровно то, что раздел обещает оператору:
 *
 *  - плиток и панелей не меньше, чем обещает реестр разделов (`density`): те же числа
 *    считает браузерная проверка `e2e/check-admin.mjs`;
 *  - статус отбирается по загруженной странице и подписан именно так: сервис параметра
 *    `status` не принимает, поэтому в запросах его быть не должно;
 *  - период последнего расчёта и доли статусов считает клиент по странице;
 *  - карточка расчёта открывается по клику на строку, показывает поля расчёта и
 *    покрывающие платежи без сумм — их сервис в этом ответе не отдаёт;
 *  - у SUPPORT нет ни кнопки запуска, ни помеченного изменяющего действия, а у ADMIN
 *    такое действие ровно одно.
 */

const SECTION = adminSectionById('settlements')!;
const DENSITY = densityOf(SECTION);

/** `SettlementDtos.SettlementResponse` — выплаченный расчёт. */
const PAID = {
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
  periodEnd: '2024-09-02T12:00:00Z',
  createdAt: '2024-09-02T12:00:01Z',
  paidAt: '2024-09-02T12:00:02Z',
  failureReason: null,
};

/** Второй расчёт страницы: долг записан, счёта для выплаты нет. */
const PENDING = {
  ...PAID,
  settlementId: '01M3SETTLEMENT0000000000002',
  settlementNumber: 'SET-240905-B2C3D',
  status: 'PENDING',
  grossMinor: 200_000,
  commissionMinor: 3_000,
  customerPaidMinor: 203_000,
  netMinor: 200_000,
  payoutAccountId: null,
  paidAt: null,
  periodStart: '2024-09-04T10:00:00Z',
  // Позже всех закрыт период: именно этот расчёт попадает в плитку «Период последнего расчёта».
  periodEnd: '2024-09-05T12:00:00Z',
};

function pageOf(items: unknown[]) {
  return {
    items,
    page: 0,
    size: 20,
    totalElements: items.length,
    totalPages: items.length > 0 ? 1 : 0,
    hasNext: false,
  };
}

function settlementsApi() {
  return stubFetch((url, init) => {
    if (url.includes('/run') && init?.method === 'POST') {
      return jsonResponse({ computed: 2, paid: 1, failed: 0, awaitingPayoutAccount: 1, nothingToSettle: 0 });
    }
    if (/\/v1\/settlements\/[^?]+$/.test(url)) {
      return jsonResponse({ settlement: PAID, paymentIds: ['01M3PAYMENT000000000000001'] });
    }
    if (url.includes('merchantId=01M3MERCHANT00000000000001')) {
      return jsonResponse(pageOf([PAID]));
    }
    return jsonResponse(pageOf([PAID, PENDING]));
  });
}

function renderSection(canWrite: boolean) {
  return renderWithProviders(
    <SettlementsSection section={SECTION} role={canWrite ? 'ADMIN' : 'SUPPORT'} canWrite={canWrite} />,
  );
}

/** Плитка по подписи: без этого суммы плиток путаются с суммами строк таблицы. */
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

describe('раздел «Расчёты с мерчантами»: плотность и роли', () => {
  it.each([true, false])('держит плотность реестра при canWrite=%s', async (canWrite) => {
    settlementsApi();
    renderSection(canWrite);

    await screen.findByText(PAID.settlementNumber);

    const kpis = document.querySelectorAll('[data-admin-kpi]').length;
    const panels = document.querySelectorAll('[data-admin-panel]').length;
    expect(kpis).toBeGreaterThanOrEqual(DENSITY.kpis);
    expect(panels).toBeGreaterThanOrEqual(canWrite ? DENSITY.panels : Math.max(1, DENSITY.panels - 1));
  });

  it('у SUPPORT нет кнопки запуска и помеченного действия', async () => {
    settlementsApi();
    renderSection(false);

    await screen.findByText(PAID.settlementNumber);

    expect(screen.queryByRole('button', { name: /Запустить расчёт/i })).toBeNull();
    expect(document.querySelector('[data-admin-write]')).toBeNull();
    expect(screen.getByText(/Запуск расчёта доступен только роли Администратор/i)).toBeInTheDocument();
  });

  it('у ADMIN действие запуска помечено ровно одно', async () => {
    settlementsApi();
    renderSection(true);

    await screen.findByText(PAID.settlementNumber);

    const marked = document.querySelectorAll('[data-admin-write]');
    expect(marked).toHaveLength(1);
    expect(marked[0]?.getAttribute('data-admin-write')).toBe('запуск расчёта');
  });
});

describe('раздел «Расчёты»: числа по загруженной странице', () => {
  it('считает долг, выплату и комиссию по строкам страницы', async () => {
    settlementsApi();
    renderSection(true);

    await screen.findByText(PAID.settlementNumber);

    // Долг — только PENDING: 200 000 минорных единиц.
    expect(within(tile('К выплате')).getByText(money(200_000))).toBeInTheDocument();
    expect(within(tile('К выплате')).getByText(/PENDING на странице: 1 расчёт/)).toBeInTheDocument();
    // Выплачено — только PAID.
    expect(within(tile('Выплачено')).getByText(money(100_000))).toBeInTheDocument();
    // Комиссия — по всем статусам страницы: 1 500 + 3 000.
    expect(within(tile('Комиссия платформы')).getByText(money(4_500))).toBeInTheDocument();
  });

  it('берёт период последнего расчёта у самой поздней строки страницы', async () => {
    settlementsApi();
    renderSection(true);

    await screen.findByText(PAID.settlementNumber);

    expect(within(tile('Период последнего расчёта')).getByText(formatDate(PENDING.periodEnd))).toBeInTheDocument();
    expect(within(tile('Период последнего расчёта')).getByText(/среди 2 расчётов/)).toBeInTheDocument();
  });

  it('на пустой странице не рисует диаграммы и честно говорит, что расчётов нет', async () => {
    stubFetch(() => jsonResponse(pageOf([])));
    renderSection(true);

    expect(await screen.findByText('Нечего показывать: на странице нет расчётов')).toBeInTheDocument();
    expect(screen.getByText('Расчётов нет')).toBeInTheDocument();
    expect(within(tile('Расчётов по фильтру')).getByText('0')).toBeInTheDocument();
    expect(within(tile('Период последнего расчёта')).getByText('—')).toBeInTheDocument();
  });
});

describe('раздел «Расчёты»: рейл статусов', () => {
  it('отбирает по загруженной странице и не отправляет status в сервис', async () => {
    const fetchMock = settlementsApi();
    const user = userEvent.setup();
    renderSection(true);

    await screen.findByText(PAID.settlementNumber);

    // Числа рейла — по странице: два расчёта, по одному в PENDING и PAID.
    expect((screen.getByRole('button', { name: /В обработке/ }).textContent ?? '')).toMatch(/В обработке\s*1/);
    expect((screen.getByRole('button', { name: /Оплачен/ }).textContent ?? '')).toMatch(/Оплачен\s*1/);
    expect((screen.getByRole('button', { name: /Ошибка/ }).textContent ?? '')).toMatch(/Ошибка\s*0/);
    expect(screen.getByText(/Числа в пилюлях — по загруженной странице/i)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /Ошибка/ }));

    expect(
      await screen.findByText(/На этой странице нет расчётов со статусом/i),
    ).toBeInTheDocument();
    expect(screen.queryByText(PAID.settlementNumber)).toBeNull();

    // Сервис параметр status не принимает: его не должно быть ни в одном запросе.
    expect(fetchMock.mock.calls.every(([url]) => !String(url).includes('status'))).toBe(true);
  });

  it('ищет по мерчанту на сервере после задержки ввода', async () => {
    const fetchMock = settlementsApi();
    const user = userEvent.setup();
    renderSection(true);

    await screen.findByText(PAID.settlementNumber);
    await user.type(screen.getByLabelText('Мерчант'), PAID.merchantId);

    await waitFor(
      () => {
        expect(
          fetchMock.mock.calls.some(([url]) => String(url).includes(`merchantId=${PAID.merchantId}`)),
        ).toBe(true);
      },
      { timeout: 3_000 },
    );
  });
});

describe('раздел «Расчёты»: карточка расчёта', () => {
  it('открывается по клику на строку, показывает поля и покрывающие платежи без сумм', async () => {
    settlementsApi();
    const user = userEvent.setup();
    renderSection(true);

    await user.click((await screen.findByText(PAID.settlementNumber)).closest('tr')!);

    const fields = (await screen.findByText('Комиссия платформы (commissionMinor)')).closest('dl')!;
    expect(within(fields).getByText(PAID.merchantId)).toBeInTheDocument();
    expect(within(fields).getByText(PAID.ownerUserId)).toBeInTheDocument();
    // Строка поля: у расчёта grossMinor = netMinor, поэтому суммы сверяются по своей строке,
    // а не по всему списку полей.
    const field = (label: string) => screen.getByText(label).parentElement!;
    expect(within(field('Комиссия платформы (commissionMinor)')).getByText(money(PAID.commissionMinor))).toBeInTheDocument();
    expect(within(field('Стоимость товаров (grossMinor)')).getByText(money(PAID.grossMinor))).toBeInTheDocument();
    expect(within(field('К выплате мерчанту (netMinor)')).getByText(money(PAID.netMinor))).toBeInTheDocument();
    expect(within(field('Заплатил клиент (customerPaidMinor)')).getByText(money(PAID.customerPaidMinor))).toBeInTheDocument();
    expect(screen.getByText('Деньги выплачены на счёт мерчанта.')).toBeInTheDocument();

    // Покрывающие платежи: только идентификаторы, сумм в ответе нет.
    expect(screen.getByText('01M3PAYMENT000000000000001')).toBeInTheDocument();
    expect(screen.getByText(/Деталь расчёта отдаёт только идентификаторы платежей/i)).toBeInTheDocument();
  });

  it('объясняет пустой список покрывающих платежей, а не показывает ноль', async () => {
    stubFetch((url) => {
      if (/\/v1\/settlements\/[^?]+$/.test(url)) {
        return jsonResponse({ settlement: PAID, paymentIds: [] });
      }
      return jsonResponse(pageOf([PAID]));
    });
    const user = userEvent.setup();
    renderSection(true);

    await user.click((await screen.findByText(PAID.settlementNumber)).closest('tr')!);

    expect(
      await screen.findByText('Сервис не вернул ни одного платежа в этом расчёте'),
    ).toBeInTheDocument();
  });

  it('запускает расчёт только после подтверждения и показывает счётчики прогона', async () => {
    const fetchMock = settlementsApi();
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
    const user = userEvent.setup();
    renderSection(true);

    await user.click(await screen.findByRole('button', { name: /Запустить расчёт/i }));

    expect(await screen.findByText(/Прогон завершён/i)).toBeInTheDocument();
    expect(screen.getByText('Посчитано расчётов: 2')).toBeInTheDocument();
    expect(screen.getByText('Ждут счёт для выплаты: 1')).toBeInTheDocument();
    expect(confirmSpy).toHaveBeenCalled();

    const call = fetchMock.mock.calls.find(([url]) => String(url).endsWith('/v1/settlements/run'))!;
    // Тела и Idempotency-Key у прогона нет: их не принимает контроллер.
    expect(call[1]?.method).toBe('POST');
    expect(call[1]?.body).toBeUndefined();
  });
});

describe('раздел «Расчёты»: выгрузка загруженных строк', () => {
  it('собирает CSV из строк страницы в минорных единицах', () => {
    const csv = settlementsCsv([PENDING as unknown as Settlement]);
    const [header, row] = csv.split('\r\n');

    expect(header).toContain('settlementId');
    expect(header).toContain('netMinor');
    expect(row).toContain(`"${PENDING.settlementId}"`);
    expect(row).toContain('"200000"');
    expect(row).not.toContain('2 000,00');
  });
});
