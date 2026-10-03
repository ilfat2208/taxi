import { describe, expect, it, vi } from 'vitest';
import {
  fetchSupportMerchant,
  fetchSupportMerchantByOwner,
  fetchSupportMerchantProducts,
  fetchSupportProduct,
  fetchSupportReservations,
  fetchSupportStock,
  normalizeSupportMerchant,
  normalizeSupportProduct,
  normalizeSupportReservation,
  normalizeSupportStock,
} from './supportCatalog';
import { jsonResponse, stubFetch } from '../../test/utils';

/**
 * Каталог поддержки.
 *
 * Примеры тел ответов скопированы с DTO, которые отдаёт
 * `SupportCatalogController` (`SupportMerchantResponse`, `SupportProductResponse`,
 * `SupportStockResponse`, `SupportReservationResponse`), а проверки — про то, что
 * отсутствующее поле остаётся `null`, а не превращается в ноль, и что запрос уходит
 * именно на тот путь, который объявлен в контроллере.
 */

describe('normalizeSupportMerchant', () => {
  it('читает профиль магазина как SupportMerchantResponse', () => {
    const merchant = normalizeSupportMerchant({
      id: '01M3MERCHANT0000000000001',
      ownerUserId: 'U-1001',
      name: 'ИП «Аптека на Байтурсынова»',
      displayName: 'Аптека 24',
      phone: '+77012223344',
      email: 'shop@example.kz',
      city: 'Шымкент',
      status: 'ACTIVE',
      ratingBasisPoints: 480,
      payoutAccountId: 'ACC-MERCHANT-1',
      productCount: 42,
      createdAt: '2026-01-15T08:30:00Z',
    });

    expect(merchant.id).toBe('01M3MERCHANT0000000000001');
    expect(merchant.ownerUserId).toBe('U-1001');
    expect(merchant.displayName).toBe('Аптека 24');
    expect(merchant.status).toBe('ACTIVE');
    expect(merchant.ratingBasisPoints).toBe(480);
    expect(merchant.payoutAccountId).toBe('ACC-MERCHANT-1');
    expect(merchant.productCount).toBe(42);
  });

  it('не выдумывает счёт выплат и число товаров, если их нет', () => {
    const merchant = normalizeSupportMerchant({ id: 'M-2', name: 'Ларёк' });

    expect(merchant.payoutAccountId).toBeNull();
    expect(merchant.productCount).toBeNull();
    expect(merchant.phone).toBeNull();
    expect(merchant.ownerUserId).toBeNull();
  });
});

describe('normalizeSupportProduct', () => {
  it('переносит вердикт сервиса: sellable / buyable / причину отказа', () => {
    const product = normalizeSupportProduct({
      id: 'P-1',
      merchantId: 'M-1',
      merchantName: 'Аптека 24',
      sku: 'SKU-1',
      title: 'Парацетамол 500 мг',
      category: 'Лекарства',
      brand: 'Bosnalijek',
      status: 'DRAFT',
      sellable: false,
      archived: false,
      buyable: false,
      unavailableReason: 'STATUS_NOT_SELLABLE',
      priceMinor: 129_900,
      currency: 'KZT',
      onHand: 12,
      reserved: 3,
      available: 9,
    });

    expect(product.status).toBe('DRAFT');
    expect(product.sellable).toBe(false);
    expect(product.buyable).toBe(false);
    expect(product.unavailableReason).toBe('STATUS_NOT_SELLABLE');
    expect(product.priceMinor).toBe(129_900);
    expect(product.onHand).toBe(12);
    expect(product.reserved).toBe(3);
    expect(product.available).toBe(9);
    // `availableQuantity` публичной карточки сервис здесь не присылает: значение
    // выводится из `available`, а не выдумывается.
    expect(product.availableQuantity).toBe(9);
  });

  it('оставляет причину отказа пустой, когда товар покупаем', () => {
    const product = normalizeSupportProduct({
      id: 'P-2',
      title: 'Товар',
      status: 'ACTIVE',
      sellable: true,
      buyable: true,
      unavailableReason: null,
      priceMinor: 1000,
      currency: 'KZT',
      onHand: 5,
      reserved: 0,
      available: 5,
    });

    expect(product.buyable).toBe(true);
    expect(product.unavailableReason).toBeNull();
  });
});

describe('normalizeSupportStock и резервы', () => {
  it('читает остатки вместе с держащими их резервами', () => {
    const stock = normalizeSupportStock({
      productId: 'P-1',
      merchantId: 'M-1',
      productStatus: 'ACTIVE',
      sellable: true,
      onHand: 10,
      reserved: 4,
      available: 6,
      updatedAt: '2026-10-02T10:00:00Z',
      holds: [
        {
          id: 'R-1',
          orderId: 'O-1',
          productId: 'P-1',
          quantity: 4,
          status: 'ACTIVE',
          expiresAt: '2026-10-02T10:15:00Z',
          createdAt: '2026-10-02T10:00:00Z',
        },
      ],
    });

    expect(stock.available).toBe(6);
    expect(stock.sellable).toBe(true);
    expect(stock.updatedAt).toBe('2026-10-02T10:00:00Z');
    expect(stock.holds).toHaveLength(1);
    expect(stock.holds[0]?.status).toBe('ACTIVE');
    expect(stock.holds[0]?.quantity).toBe(4);
  });

  it('не придумывает резервы, если их не прислали', () => {
    const stock = normalizeSupportStock({ productId: 'P-9', onHand: 1, available: 1 });

    expect(stock.holds).toEqual([]);
    expect(stock.updatedAt).toBeNull();
    expect(stock.reserved).toBe(0);
    expect(stock.productStatus).toBe('UNKNOWN');
  });

  it('читает резерв и не подставляет даты, которых нет', () => {
    const reservation = normalizeSupportReservation({
      id: 'R-2',
      orderId: 'O-2',
      productId: 'P-2',
      quantity: 2,
      status: 'COMMITTED',
    });

    expect(reservation.expiresAt).toBeNull();
    expect(reservation.createdAt).toBeNull();
    expect(reservation.quantity).toBe(2);
  });
});

describe('пути запросов каталога поддержки', () => {
  it('ходит на точечные support-эндпоинты, объявленные в контроллере', async () => {
    const fetchMock = stubFetch(() => jsonResponse({ id: 'M-1', name: 'Магазин' }));
    const calls = () => fetchMock.mock.calls.map(([url]) => String(url));

    await fetchSupportMerchant('M-1');
    await fetchSupportMerchantByOwner('U-1');
    await fetchSupportProduct('P-1');
    await fetchSupportReservations('O-1');

    expect(calls()).toEqual([
      '/api/v1/support/merchants/M-1',
      '/api/v1/support/merchants/by-owner/U-1',
      '/api/v1/support/products/P-1',
      '/api/v1/support/reservations/O-1',
    ]);
  });

  it('передаёт флаг архивных и страницу списка товаров магазина', async () => {
    const fetchMock = stubFetch(() =>
      jsonResponse({ items: [], page: 0, size: 10, totalElements: 0, totalPages: 0, hasNext: false }),
    );

    const page = await fetchSupportMerchantProducts('M-1', { includeArchived: true, page: 2, size: 10 });

    expect(String(fetchMock.mock.calls[0]?.[0])).toBe(
      '/api/v1/support/merchants/M-1/products?includeArchived=true&page=2&size=10',
    );
    expect(page.items).toEqual([]);
    expect(page.totalElements).toBe(0);
  });

  it('кодирует идентификатор в пути вместо склейки строк', async () => {
    const fetchMock = stubFetch(() => jsonResponse({ productId: 'P 1' }));

    await fetchSupportStock('P 1');

    expect(String(fetchMock.mock.calls[0]?.[0])).toBe('/api/v1/support/products/P%201/stock');
  });

  it('читает конверт страницы товаров и разбирает каждый товар', async () => {
    stubFetch(() =>
      jsonResponse({
        items: [
          { id: 'P-1', title: 'Товар', status: 'ACTIVE', buyable: true, priceMinor: 500, currency: 'KZT' },
        ],
        page: 0,
        size: 10,
        totalElements: 1,
        totalPages: 1,
        hasNext: false,
      }),
    );

    const page = await fetchSupportMerchantProducts('M-1');

    expect(page.items[0]?.title).toBe('Товар');
    expect(page.items[0]?.buyable).toBe(true);
    expect(page.hasNext).toBe(false);
  });

  it('считает ошибку сервиса ошибкой, а не пустым ответом', async () => {
    stubFetch(() =>
      jsonResponse({ code: 'RESERVATION_NOT_FOUND', detail: 'no stock reservation for order O-9' }, 404),
    );

    await expect(fetchSupportReservations('O-9')).rejects.toMatchObject({
      status: 404,
      code: 'RESERVATION_NOT_FOUND',
    });
  });

  it('каждый запрос уходит со своим X-Correlation-Id', async () => {
    const fetchMock = stubFetch(() => jsonResponse({ id: 'M-1' }));

    await fetchSupportMerchant('M-1');

    const headers = fetchMock.mock.calls[0]?.[1]?.headers as Record<string, string> | undefined;
    expect(headers?.['X-Correlation-Id']).toBeTruthy();
    expect(vi.isMockFunction(fetchMock)).toBe(true);
  });
});
