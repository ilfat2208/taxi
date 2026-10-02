import { expect, test } from '@playwright/test';
import {
  apiUrl,
  clearCart,
  fetchCatalog,
  fetchCategories,
  loginAsDemoUser,
  productCards,
  readCart,
  type Session,
} from './helpers';

/**
 * Marketplace storefront.
 *
 * The catalog *endpoint* is public (the README's anonymous-storefront guarantee),
 * while every `/market` route in this SPA sits behind the session guard — so the
 * first spec asserts the public contract, and the rest drive the UI signed in.
 *
 * The specs never hard-code the seeded product list: they compare the rendered
 * grid against `GET /api/v1/catalog/products`, which keeps them valid when the
 * demo stack already contains products published by earlier runs.
 */

/** `formatMoney(50000)` -> `"500,00 ₸"`; grouping uses a ru-KZ space. */
function money(minor: number): RegExp {
  const major = (minor / 100).toLocaleString('ru-KZ', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
    useGrouping: true,
  });
  const escaped = major.replace(/[\s\u00a0]/g, '[\\s\\u00a0]');
  return new RegExp(`^${escaped}[\\s\\u00a0]*₸$`);
}

test.describe('маркетплейс', () => {
  let session: Session;

  test.beforeEach(async ({ page, request }) => {
    // Fresh context per test, and an empty server-side cart: the badge assertion
    // below must not depend on what a previous test left in the cart.
    session = await loginAsDemoUser(page, request);
    await clearCart(request, session.accessToken);

    // Guard against a regression of the documented "anonymous storefront"
    // contract: the catalog endpoint must answer without any token.
    const anonymous = await request.get(apiUrl('/v1/catalog/products'), {
      params: { page: 0, size: 12 },
    });
    expect(anonymous.status(), 'anonymous GET /v1/catalog/products').toBe(200);
  });

  test('витрина каталога отдаёт товары продавцов', async ({ request }) => {
    const catalog = await fetchCatalog(request, { size: 12 });
    expect(catalog.totalElements).toBeGreaterThan(0);
    expect(catalog.items.length).toBeGreaterThan(0);
    for (const product of catalog.items) {
      expect(product.id).not.toBe('');
      expect(product.title).not.toBe('');
    }
  });

  test('поиск и фильтр по категории сужают список товаров', async ({ page, request }) => {
    await page.goto('/market');

    const cards = productCards(page);
    // The pagination bar has an `aria-live` region too, so match on the text.
    const summary = page.locator('main p[aria-live="polite"]', { hasText: 'Найдено товаров' });
    await expect(summary).toContainText('Найдено товаров:');
    await expect(cards.first()).toBeVisible();

    const initialText = await summary.innerText();
    const initialCount = Number(initialText.replace(/\D/g, ''));
    expect(initialCount).toBeGreaterThan(0);

    // --- free-text search -------------------------------------------------
    // The box is debounced (350 ms), so the assertion is on the settled state:
    // Playwright retries until the grid and the aria-live summary agree with the
    // gateway's own answer for the same query.
    await page.getByLabel('Поиск').fill('Кофе');

    const expected = await fetchCatalog(request, { query: 'Кофе' });
    expect(expected.totalElements).toBeGreaterThan(0);
    expect(expected.totalElements).toBeLessThan(initialCount);
    await expect(summary).toContainText(`Найдено товаров: ${expected.totalElements}`);
    await expect(cards).toHaveCount(expected.items.length);
    for (const title of await cards.locator('a[aria-label^="Открыть товар"]').allInnerTexts()) {
      expect(title.toLowerCase()).toContain('кофе');
    }

    // --- a query that matches nothing ------------------------------------
    await page.getByLabel('Поиск').fill('нет-такого-товара-9999');
    await expect(page.getByText('Ничего не найдено')).toBeVisible();
    await expect(cards).toHaveCount(0);
    await expect(page.getByText('Товары не найдены')).toBeVisible();

    // --- category rail ----------------------------------------------------
    await page.getByLabel('Поиск').fill('');
    await expect(cards.first()).toBeVisible();

    const categories = await fetchCategories(request);
    const category = categories.find((name) => name.includes('Электроника'));
    expect(category, 'seeded category «Электроника»').toBeTruthy();

    await page.getByLabel('Категория').selectOption({ label: category as string });

    const byCategory = await fetchCatalog(request, { category });
    expect(byCategory.totalElements).toBeGreaterThan(0);
    expect(byCategory.totalElements).toBeLessThan(initialCount);
    await expect(summary).toContainText(`Найдено товаров: ${byCategory.totalElements}`);
    await expect(cards).toHaveCount(byCategory.items.length);
  });

  test('карточка товара показывает цену и остаток, а добавление обновляет счётчик корзины', async ({
    page,
    request,
  }) => {
    await page.goto('/market');
    await expect(productCards(page).first()).toBeVisible();

    const inStock = page.locator('article:has(a[aria-label^="Открыть товар"])', {
      hasText: 'В наличии',
    });
    await expect(inStock.first()).toBeVisible();
    const card = inStock.first();

    // Navigate by the id in the tile's own link, never by the rendered title: a
    // title is a presentation detail, an id is the product resource.
    const productLink = card.locator('a[aria-label^="Открыть товар"]');
    const href = await productLink.getAttribute('href');
    expect(href).toMatch(/^\/market\/[0-9A-Za-z]+$/);
    const productId = (href as string).split('/').pop() as string;

    await productLink.click();
    await expect(page).toHaveURL(new RegExp(`/market/${productId}$`));

    // Price and stock come from the live product resource.
    const detail = await request.get(apiUrl(`/v1/catalog/products/${productId}`));
    expect(detail.status(), 'GET /v1/catalog/products/{id}').toBe(200);
    const product = (await detail.json()) as { priceMinor: number; availableQuantity: number };

    await expect(page.locator('dt', { hasText: 'Цена' }).locator('+ dd')).toContainText(
      money(product.priceMinor),
    );
    await expect(page.locator('dt', { hasText: 'В наличии' }).locator('+ dd')).toHaveText(
      `${product.availableQuantity} шт.`,
    );
    await expect(page.locator('dt', { hasText: 'ID товара' }).locator('+ dd')).toHaveText(productId);

    // --- add to cart ------------------------------------------------------
    const cartLink = page.locator('header a[aria-label^="Корзина"]');
    await expect(cartLink).toHaveAttribute('aria-label', 'Корзина');
    expect((await readCart(request, session.accessToken)).itemCount ?? 0).toBe(0);

    await page.getByRole('button', { name: 'Добавить в корзину' }).click();
    await expect(page.getByText('Товар в корзине')).toBeVisible();

    // The header badge reflects the server cart stored for this session.
    await expect(cartLink).toHaveAttribute('aria-label', 'Корзина, товаров: 1');
    await expect(cartLink.locator('span')).toHaveText('1');

    const cart = await readCart(request, session.accessToken);
    expect(cart.itemCount).toBe(1);
    expect(cart.items?.[0]?.productId).toBe(productId);

    // And the cart page lists the product that was just added (the line links
    // back to the product resource, which is what identifies it).
    await page.goto('/cart');
    await expect(page.locator(`a[href="/market/${productId}"]`).first()).toBeVisible();
    await expect(page.locator('span[aria-label="Количество: 1"]')).toBeVisible();
  });
});
