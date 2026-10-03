import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { adminSectionById, type AdminSection } from '../sections';
import CatalogSection from './catalog';
import { createTestQueryClient, jsonResponse, problemResponse, stubFetch, type MockResponse } from '../../test/utils';

/**
 * Раздел «Магазины, товары и сток».
 *
 * Проверяются вещи, которые ломаются тише всего: точечный поиск не должен ходить на
 * сервер с пустым полем, 404 от сервиса — это честный «не найдено», а не пустая
 * карточка, остатки и причина отказа в покупке берутся из ответа как есть, а плитки
 * показывают «—» там, где запрос ещё не уходил. Отдельно проверяется плотность
 * разметки: плитки помечены `data-admin-kpi`, панели — `data-admin-panel`, а
 * `data-admin-write` в разделе нет, потому что все шесть ручек каталога — GET.
 */

const section = adminSectionById('catalog') as AdminSection;

const MERCHANT = {
  id: 'M-1',
  ownerUserId: 'U-1001',
  name: 'ИП «Аптека на Байтурсынова»',
  displayName: 'Аптека 24',
  phone: '+77012223344',
  email: 'shop@example.kz',
  city: 'Шымкент',
  status: 'ACTIVE',
  ratingBasisPoints: 480,
  payoutAccountId: 'ACC-MERCHANT-1',
  productCount: 2,
  createdAt: '2026-01-15T08:30:00Z',
};

const PRODUCT_ROW = {
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
};

const STOCK = {
  productId: 'P-1',
  merchantId: 'M-1',
  productStatus: 'DRAFT',
  sellable: false,
  onHand: 12,
  reserved: 3,
  available: 9,
  updatedAt: '2026-10-02T10:00:00Z',
  holds: [
    {
      id: 'R-1',
      orderId: 'O-1',
      productId: 'P-1',
      quantity: 3,
      status: 'ACTIVE',
      expiresAt: '2026-10-02T10:15:00Z',
      createdAt: '2026-10-02T10:00:00Z',
    },
  ],
};

function emptyPage() {
  return { items: [], page: 0, size: 10, totalElements: 0, totalPages: 0, hasNext: false };
}

/** Все шесть support-эндпоинтов каталога в одном месте. */
function catalogApi(
  overrides: {
    merchant?: MockResponse;
    product?: MockResponse;
    stock?: MockResponse;
    reservations?: MockResponse;
    products?: MockResponse;
  } = {},
): (url: string) => MockResponse {
  return (url) => {
    if (url.includes('/v1/support/merchants/by-owner/')) {
      return overrides.merchant ?? jsonResponse(MERCHANT);
    }
    if (url.includes('/v1/support/merchants/') && url.includes('/products')) {
      return (
        overrides.products ??
        jsonResponse({ ...emptyPage(), items: [PRODUCT_ROW], totalElements: 1, totalPages: 1 })
      );
    }
    if (url.includes('/stock')) {
      return overrides.stock ?? jsonResponse(STOCK);
    }
    if (url.includes('/v1/support/merchants/')) {
      return overrides.merchant ?? jsonResponse(MERCHANT);
    }
    if (url.includes('/v1/support/products/')) {
      return overrides.product ?? jsonResponse(PRODUCT_ROW);
    }
    if (url.includes('/v1/support/reservations/')) {
      return (
        overrides.reservations ??
        jsonResponse([{ id: 'R-1', orderId: 'O-1', productId: 'P-1', quantity: 3, status: 'ACTIVE' }])
      );
    }
    return jsonResponse(emptyPage());
  };
}

function renderCatalog(handler: (url: string) => MockResponse) {
  const fetchMock = stubFetch(handler);
  render(
    <QueryClientProvider client={createTestQueryClient()}>
      <MemoryRouter>
        <CatalogSection section={section} role="SUPPORT" canWrite={false} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return fetchMock;
}

/** Значение строки «ярлык → значение» в карточке. */
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
  return (value.textContent ?? '').trim();
}

/** Запросы к support-API каталога — не считая ничего постороннего. */
function supportCalls(fetchMock: { mock: { calls: unknown[][] } }): string[] {
  return fetchMock.mock.calls.map(([url]) => String(url)).filter((url) => url.includes('/v1/support/'));
}

describe('раздел «Магазины, товары и сток»', () => {
  it('не отправляет ни одного запроса support-API, пока поиск не запущен вручную', async () => {
    const fetchMock = renderCatalog(catalogApi());

    expect(await screen.findByText('Раздел ничего не меняет')).toBeInTheDocument();
    expect(supportCalls(fetchMock)).toHaveLength(0);

    // Плотность разметки: реестр обещает 3 плитки и 3 панели, у раздела их больше.
    expect(document.querySelectorAll('[data-admin-kpi]').length).toBeGreaterThanOrEqual(3);
    expect(document.querySelectorAll('[data-admin-panel]').length).toBeGreaterThanOrEqual(3);

    // Все формы поиска видны сразу и не прячутся за вкладками.
    expect(screen.getByLabelText('идентификатор магазина')).toBeInTheDocument();
    expect(screen.getByLabelText('Идентификатор товара')).toBeInTheDocument();
    expect(screen.getByLabelText('Идентификатор заказа')).toBeInTheDocument();

    // Плитки честно говорят «—» там, где сервис ещё ничего не отвечал.
    expect(kpiValue('Товаров у магазина')).toBe('—');
    expect(kpiValue('Найдено магазинов')).toBe('0');
  });

  it('ищет магазин по id и показывает владельца, статус, рейтинг и товары', async () => {
    const fetchMock = renderCatalog(catalogApi());

    fireEvent.change(await screen.findByLabelText('идентификатор магазина'), { target: { value: 'M-1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Найти магазин' }));

    expect(await screen.findByText('Аптека 24')).toBeInTheDocument();
    expect(detailRow('Владелец')).toHaveTextContent('U-1001');
    expect(screen.getByText('Активен')).toBeInTheDocument();
    expect(screen.getByText('ACC-MERCHANT-1')).toBeInTheDocument();
    expect(screen.getByText('4,8 из 5 (480 bp)')).toBeInTheDocument();
    expect(detailRow('Город')).toHaveTextContent('Шымкент');

    expect(supportCalls(fetchMock)).toContain('/api/v1/support/merchants/M-1');

    // Единственный список в этом API — товары магазина: он и загрузился.
    expect(await screen.findByText('Парацетамол 500 мг')).toBeInTheDocument();
    expect(screen.getByText('SKU-1')).toBeInTheDocument();
    expect(screen.getByText('не покупается')).toBeInTheDocument();
    // Категории собраны из товаров магазина, а не выданы сервисом как «категории магазина».
    expect(screen.getByText('Категории в этой странице товаров:')).toBeInTheDocument();
    expect(screen.getAllByText('Лекарства').length).toBeGreaterThan(1);

    // Счётчик страницы — серверный, и он же попал в плитку.
    expect(kpiValue('Товаров у магазина')).toBe('1');
  });

  it('ищет магазин по владельцу, когда выбран этот режим', async () => {
    const fetchMock = renderCatalog(catalogApi());

    fireEvent.change(await screen.findByLabelText('Что ищем'), { target: { value: 'owner' } });
    fireEvent.change(screen.getByLabelText('идентификатор владельца (userId)'), {
      target: { value: 'U-1001' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Найти магазин' }));

    await screen.findByText('Аптека 24');
    expect(supportCalls(fetchMock)).toContain('/api/v1/support/merchants/by-owner/U-1001');
  });

  it('смена смысла поля сбрасывает прежний результат, а не подменяет его', async () => {
    renderCatalog(catalogApi());

    fireEvent.change(await screen.findByLabelText('идентификатор магазина'), { target: { value: 'M-1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Найти магазин' }));
    await screen.findByText('Аптека 24');

    fireEvent.change(screen.getByLabelText('Что ищем'), { target: { value: 'owner' } });

    // Прежний ответ про магазин больше не висит на экране: искать «M-1» как владельца
    // и показывать при этом магазин — значит врать про то, что именно нашлось.
    await waitFor(() => {
      expect(screen.queryByText('Аптека 24')).not.toBeInTheDocument();
    });
    expect(screen.getByText(/Введите идентификатор магазина или его владельца/)).toBeInTheDocument();
  });

  it('404 MERCHANT_NOT_FOUND показывает EmptyState, а не пустую карточку', async () => {
    renderCatalog(
      catalogApi({
        merchant: problemResponse(
          { status: 404, code: 'MERCHANT_NOT_FOUND', title: 'Not Found', detail: 'merchant M-9 not found' },
          404,
        ),
      }),
    );

    fireEvent.change(await screen.findByLabelText('идентификатор магазина'), { target: { value: 'M-9' } });
    fireEvent.click(screen.getByRole('button', { name: 'Найти магазин' }));

    expect(await screen.findByText('Магазин не найден')).toBeInTheDocument();
    expect(screen.getByText(/404 MERCHANT_NOT_FOUND/)).toBeInTheDocument();
  });

  it('показывает причину отказа в покупке и остатки с держащими их резервами', async () => {
    renderCatalog(catalogApi());

    fireEvent.change(await screen.findByLabelText('Идентификатор товара'), { target: { value: 'P-1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Найти товар' }));

    const verdict = await screen.findByText('Товар нельзя купить');
    expect(verdict.closest('[role="status"]')).toHaveTextContent('Причина от сервиса: STATUS_NOT_SELLABLE');
    expect(screen.getByText('1 299,00 ₸')).toBeInTheDocument();
    // Три вердикта сервиса показаны словами, а не подразумеваются.
    expect(screen.getByText('sellable: нет')).toBeInTheDocument();
    expect(screen.getByText('archived: нет')).toBeInTheDocument();
    expect(screen.getByText('buyable: нет')).toBeInTheDocument();

    // Остатки приходят отдельной ручкой /stock и показаны вместе с держащими их резервами.
    expect(await screen.findByText('Остатки и резервы')).toBeInTheDocument();
    expect(detailRow('На складе')).toHaveTextContent('12');
    expect(detailRow('В резерве')).toHaveTextContent('3');
    expect(detailRow('Доступно к продаже')).toHaveTextContent('9');
    expect(screen.getByText('Последние резервы (до 20, новыми первыми)')).toBeInTheDocument();
    expect(screen.getByText('R-1')).toBeInTheDocument();

    // Плитки остатков взяты из того же ответа.
    expect(kpiValue('Единиц на складе')).toBe('12');
    expect(kpiValue('Единиц в резерве')).toBe('3');
  });

  it('404 товара и 404 резервов объясняются разными словами', async () => {
    renderCatalog(
      catalogApi({
        product: problemResponse(
          { status: 404, code: 'PRODUCT_NOT_FOUND', title: 'Not Found', detail: 'product P-9 not found' },
          404,
        ),
        reservations: problemResponse(
          { status: 404, code: 'RESERVATION_NOT_FOUND', title: 'Not Found', detail: 'no stock reservation' },
          404,
        ),
      }),
    );

    // Резервы по несуществующему заказу: каталог такой заказ не знает.
    fireEvent.change(await screen.findByLabelText('Идентификатор заказа'), { target: { value: 'O-9' } });
    fireEvent.click(screen.getByRole('button', { name: 'Показать резервы' }));
    expect(await screen.findByText('Каталог не резервировал сток по этому заказу')).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Идентификатор товара'), { target: { value: 'P-9' } });
    fireEvent.click(screen.getByRole('button', { name: 'Найти товар' }));
    expect(await screen.findByText('Товар не найден')).toBeInTheDocument();

    // Плитка товара при этом честно показывает 0, а не «нашли».
    expect(kpiValue('Найдено товаров')).toBe('0');
  });

  it('открывает карточку товара из списка магазина одним нажатием', async () => {
    const fetchMock = renderCatalog(catalogApi());

    fireEvent.change(await screen.findByLabelText('идентификатор магазина'), { target: { value: 'M-1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Найти магазин' }));

    fireEvent.click(await screen.findByRole('button', { name: 'Открыть карточку товара Парацетамол 500 мг' }));

    await waitFor(() => {
      expect(supportCalls(fetchMock)).toContain('/api/v1/support/products/P-1');
    });
    expect(screen.getByLabelText('Идентификатор товара')).toHaveValue('P-1');
    expect(document.querySelector('[data-admin-write]')).toBeNull();
  });

  it('флаг архивных и пагинация уходят в запрос товаров магазина', async () => {
    const fetchMock = renderCatalog((url) => {
      if (url.includes('/products')) {
        const page = Number(/[?&]page=(\d+)/.exec(url)?.[1] ?? '0');
        return jsonResponse({
          items: [{ ...PRODUCT_ROW, id: page === 1 ? 'P-2' : 'P-1', title: page === 1 ? 'Второй товар' : 'Первый товар' }],
          page,
          size: 10,
          totalElements: 2,
          totalPages: 2,
          hasNext: page === 0,
        });
      }
      return catalogApi()(url);
    });

    fireEvent.change(await screen.findByLabelText('идентификатор магазина'), { target: { value: 'M-1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Найти магазин' }));

    expect(await screen.findByText('Первый товар')).toBeInTheDocument();

    // Пагинация серверная: листает страницы ручки, а не загруженные строки.
    fireEvent.click(screen.getByRole('button', { name: 'Следующая страница' }));
    expect(await screen.findByText('Второй товар')).toBeInTheDocument();
    expect(supportCalls(fetchMock).some((url) => url.includes('page=1'))).toBe(true);

    // Архив сервис отдаёт только по флагу — галочка меняет запрос, а не вид таблицы.
    fireEvent.click(screen.getByLabelText('Показывать архивные'));
    await waitFor(() => {
      expect(supportCalls(fetchMock).some((url) => url.includes('includeArchived=true'))).toBe(true);
    });
  });

  it('выгружает CSV загруженных товаров только когда есть что выгружать', async () => {
    renderCatalog(catalogApi());

    const csv = await screen.findByRole('button', { name: /CSV/ });
    expect(csv).toBeDisabled();

    fireEvent.change(screen.getByLabelText('идентификатор магазина'), { target: { value: 'M-1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Найти магазин' }));
    await screen.findByText('Парацетамол 500 мг');

    const ready = screen.getByRole('button', { name: /CSV/ });
    expect(ready).toBeEnabled();

    // Буфера обмена в jsdom нет: кнопка честно говорит, что не смогла.
    fireEvent.click(ready);
    expect(await screen.findByText('CSV недоступен')).toBeInTheDocument();
  });

  it('сохраняет честный перечень того, чего в каталоге нет', async () => {
    renderCatalog(catalogApi());

    await screen.findByText('Раздел ничего не меняет');
    expect(screen.getByText('Массового поиска магазинов и товаров нет.')).toBeInTheDocument();
    expect(screen.getByText('Категорий у магазина в ответе нет.')).toBeInTheDocument();
    expect(document.querySelector('[data-admin-write]')).toBeNull();
  });
});
