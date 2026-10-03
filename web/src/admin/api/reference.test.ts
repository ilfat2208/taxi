import { describe, expect, it } from 'vitest';
import { ApiError } from '../../api/errors';
import {
  MAX_CATEGORY_COUNTS,
  REFERENCE_API_GAPS,
  REFERENCE_TARIFFS,
  buildQuoteRequest,
  categoryCountNote,
  commissionPercent,
  fetchCatalogProductTotal,
  fetchCategoryProductCount,
  formatDurationSeconds,
  initialQuoteForm,
  parseCoordinate,
  quoteFailureHint,
  ratingOfFive,
  referenceKeys,
  referenceSnapshotJson,
  surgeLabel,
  tariffLabel,
  tariffOptions,
} from './reference';
import { jsonResponse, stubFetch } from '../../test/utils';

/**
 * API-слой раздела «Справочники».
 *
 * Проверяется то, что нельзя увидеть глазами и что дороже всего в отладке: тело
 * запроса котировки совпадает с `TripDtos.QuoteRequest` из trip-service, счётчики
 * берутся именно из `totalElements` страницы `size=1`, а перевод кодов отказа
 * говорит правду про роль CUSTOMER.
 */

function productPage(totalElements: number) {
  return {
    items: [],
    page: 0,
    size: 1,
    totalElements,
    totalPages: totalElements,
    hasNext: totalElements > 1,
  };
}

describe('ключи запросов раздела', () => {
  it('все ключи начинаются с общего префикса раздела', () => {
    const keys = [
      referenceKeys.categories(),
      referenceKeys.catalogTotal(),
      referenceKeys.categoryCount('Красота'),
      referenceKeys.products(null, 0),
      referenceKeys.products('Красота', 2),
      referenceKeys.companies(1),
      referenceKeys.companySearch('Лотос'),
      referenceKeys.company('C-1'),
      referenceKeys.slots('S-1', 'SV-1', '2026-10-04'),
    ];

    expect(referenceKeys.all).toEqual(['admin', 'reference']);
    for (const key of keys) {
      expect(key.slice(0, 2)).toEqual(['admin', 'reference']);
    }
  });
});

describe('координаты и тело запроса котировки', () => {
  it('принимает запятую как десятичный разделитель', () => {
    expect(parseCoordinate('42,3155', 'lat')).toEqual({ ok: true, value: 42.3155 });
    expect(parseCoordinate(' -69.5867 ', 'lon')).toEqual({ ok: true, value: -69.5867 });
  });

  it('объясняет, что не так с координатой', () => {
    expect(parseCoordinate('', 'lat')).toEqual({ ok: false, message: 'Широта не указана' });
    expect(parseCoordinate('юг', 'lat')).toEqual({ ok: false, message: 'Только число' });
    expect(parseCoordinate('999', 'lat')).toEqual({ ok: false, message: 'Широта — от -90 до 90' });
    expect(parseCoordinate('181', 'lon')).toEqual({ ok: false, message: 'Долгота — от -180 до 180' });
  });

  it('собирает тело ровно в форме TripDtos.QuoteRequest', () => {
    const check = buildQuoteRequest({
      ...initialQuoteForm('COMFORT'),
      pickupAddress: '  проспект Абая, 150  ',
      dropoffAddress: '',
    });

    expect(check.ok).toBe(true);
    if (!check.ok) {
      return;
    }
    expect(check.errors).toEqual({});
    expect(check.body).toEqual({
      pickup: { lat: 42.3155, lon: 69.5867, address: 'проспект Абая, 150' },
      dropoff: { lat: 42.3355, lon: 69.6067, address: '' },
      tariff: 'COMFORT',
    });
  });

  it('не отправляет запрос с плохой координатой и подписывает поле', () => {
    const check = buildQuoteRequest({ ...initialQuoteForm(), dropoffLat: '95', pickupLon: '' });

    expect(check.ok).toBe(false);
    expect(check.errors.dropoffLat).toBe('Широта — от -90 до 90');
    expect(check.errors.pickupLon).toBe('Долгота не указана');
    expect(check.errors.pickupLat).toBeUndefined();
  });

  it('заранее отказывает в адресе длиннее 256 символов', () => {
    const check = buildQuoteRequest({
      ...initialQuoteForm(),
      pickupAddress: 'а'.repeat(257),
    });

    expect(check.ok).toBe(true);
    expect(check.errors.pickupAddress).toBe('Адрес длиннее 256 символов сервис не примет');
  });
});

describe('счётчики каталога', () => {
  it('берёт число товаров категории из totalElements страницы size=1', async () => {
    const fetchMock = stubFetch(() => jsonResponse(productPage(3)));

    await expect(fetchCategoryProductCount('Красота')).resolves.toBe(3);

    const url = String(fetchMock.mock.calls[0]?.[0]);
    expect(url).toContain('/api/v1/catalog/products');
    expect(url).toContain(`category=${encodeURIComponent('Красота')}`);
    expect(url).toContain('page=0');
    expect(url).toContain('size=1');
  });

  it('считает товары всего каталога тем же приёмом, без фильтра по категории', async () => {
    const fetchMock = stubFetch(() => jsonResponse(productPage(12)));

    await expect(fetchCatalogProductTotal()).resolves.toBe(12);

    const url = String(fetchMock.mock.calls[0]?.[0]);
    expect(url).toContain('/api/v1/catalog/products');
    expect(url).not.toContain('category=');
    expect(url).toContain('size=1');
  });

  it('предупреждает, когда категорий больше, чем считается счётчиков', () => {
    expect(categoryCountNote(4, 4)).toBeNull();
    expect(categoryCountNote(MAX_CATEGORY_COUNTS + 6, MAX_CATEGORY_COUNTS)).toContain(
      `для первых ${MAX_CATEGORY_COUNTS} категорий из ${MAX_CATEGORY_COUNTS + 6}`,
    );
  });
});

describe('подписи величин', () => {
  it('переводит секунды в минуты и часы', () => {
    expect(formatDurationSeconds(59)).toBe('59 с');
    expect(formatDurationSeconds(661)).toBe('11 мин 1 с');
    expect(formatDurationSeconds(600)).toBe('10 мин');
    expect(formatDurationSeconds(3600)).toBe('1 ч');
    expect(formatDurationSeconds(3720)).toBe('1 ч 2 мин');
    expect(formatDurationSeconds(null)).toBe('—');
  });

  it('считает рейтинг QTime по шкале 0..50000, а не по шкале мерчанта', () => {
    // 48000 bp — это 4,8 из 5 (check (rating_bp between 0 and 50000) в QTime).
    expect(ratingOfFive(48000)).toBe('4,8');
    expect(ratingOfFive(50000)).toBe('5,0');
    expect(ratingOfFive(0)).toBeNull();
    expect(ratingOfFive(null)).toBeNull();
  });

  it('называет наценку словами, а не только базисными пунктами', () => {
    expect(surgeLabel(0)).toBe('наценки нет (0 bp)');
    expect(surgeLabel(null)).toBe('наценки нет (0 bp)');
    expect(surgeLabel(1500)).toBe('×1,15 (1500 bp)');
  });

  it('переводит комиссию из базисных пунктов в проценты', () => {
    expect(commissionPercent(1200)).toBe('12,00 %');
    expect(commissionPercent(0)).toBe('0,00 %');
    expect(commissionPercent(null)).toBeNull();
  });

  it('подписывает класс поездки кодом сервиса', () => {
    expect(tariffLabel('ECONOMY')).toBe('Эконом (ECONOMY)');
    expect(tariffLabel('COMFORT')).toBe('Комфорт (COMFORT)');
    expect(tariffLabel('BUSINESS')).toBe('BUSINESS');
    expect(tariffOptions().map((option) => option.value)).toEqual(['ECONOMY', 'COMFORT']);
    expect(REFERENCE_TARIFFS).toHaveLength(2);
  });
});

describe('объяснение отказа котировки', () => {
  const forbidden = new ApiError({
    status: 403,
    code: 'FORBIDDEN_TRIP_ACCESS',
    title: 'Forbidden',
    detail: 'user U-1 may not order rides: the CUSTOMER role is required',
  });

  it('на 403 говорит про роль CUSTOMER и что с этим делать', () => {
    const hint = quoteFailureHint(forbidden);

    expect(hint).toContain('CUSTOMER');
    expect(hint).toContain('экране входа');
  });

  it('на неизвестный класс поездки ссылается на enum Tariff в коде', () => {
    const hint = quoteFailureHint(
      new ApiError({ status: 400, code: 'INVALID_TARIFF', title: 'Bad Request', detail: 'unknown tariff' }),
    );

    expect(hint).toContain('enum Tariff');
  });

  it('для незнакомой ошибки молчит, чтобы её объяснил humanMessage', () => {
    expect(quoteFailureHint(new Error('boom'))).toBeNull();
    expect(
      quoteFailureHint(
        new ApiError({ status: 503, code: 'SERVICE_UNAVAILABLE', title: 'Unavailable', detail: 'down' }),
      ),
    ).toBeNull();
  });
});

describe('снимок загруженного', () => {
  it('кладёт в JSON только ответы API и подписывает источник каждой части', () => {
    const json = referenceSnapshotJson({
      categories: [{ name: 'Красота', slug: 'Красота' }],
      categoryCounts: { Красота: 3 },
      catalogTotal: 12,
      category: 'Красота',
      products: {
        items: [],
        page: 0,
        size: 8,
        totalElements: 3,
        totalPages: 1,
        hasNext: false,
      },
      companies: [],
      companiesTotal: 4,
      company: null,
      quote: {
        quoteId: 'Q-1',
        tariff: 'ECONOMY',
        distanceM: 3734,
        durationS: 661,
        priceMinor: 109_808,
        currency: 'KZT',
        commissionBp: 1200,
        commissionMinor: 13_177,
        driverNetMinor: 96_631,
        surgeBp: 0,
        breakdown: { baseMinor: 35_000, distanceMinor: 44_808, timeMinor: 30_000 },
        expiresAt: '2026-10-03T11:00:51Z',
      },
    });

    const parsed = JSON.parse(json) as Record<string, any>;

    expect(parsed.note).toContain('Справочники');
    expect(parsed.sources.tripQuote).toBe('POST /api/v1/trips/quote');
    expect(parsed.catalogProductsTotal).toBe(12);
    expect(parsed.categoryProductCounts).toEqual({ Красота: 3 });
    expect(parsed.selectedCategory).toBe('Красота');
    expect(parsed.tripQuote.priceMinor).toBe(109_808);
    expect(parsed.qtimeCompanyDetail).toBeNull();
  });
});

describe('список того, чего в API нет', () => {
  it('у каждого пункта есть объяснение и проверка', () => {
    expect(REFERENCE_API_GAPS.length).toBeGreaterThanOrEqual(5);

    for (const gap of REFERENCE_API_GAPS) {
      expect(gap.title.trim()).not.toBe('');
      expect(gap.detail.trim().length).toBeGreaterThan(40);
      expect(gap.checked.trim()).not.toBe('');
    }
  });

  it('называет отсутствующими тарифы, зоны, наценки, города и роли', () => {
    const titles = REFERENCE_API_GAPS.map((gap) => gap.title).join(' | ');

    expect(titles).toMatch(/тариф/i);
    expect(titles).toMatch(/зон/i);
    expect(titles).toMatch(/surge|нацен/i);
    expect(titles).toMatch(/город/i);
    expect(titles).toMatch(/рол/i);
  });
});
