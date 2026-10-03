import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { adminSectionById, densityOf, type AdminSection } from '../sections';
import ReferenceSection from './reference';
import {
  bodyOf,
  createTestQueryClient,
  jsonResponse,
  problemResponse,
  stubFetch,
  type MockResponse,
} from '../../test/utils';

/**
 * Раздел «Справочники».
 *
 * Проверяется то, что ломается тише всего: плотность раздела (плитки и панели, по
 * которым его считает `e2e/check-admin.mjs`), фильтрация товаров кликом по
 * категории, поиск компаний, который не должен уходить на сервер с пустым полем,
 * карточка компании с услугами и мастерами и — главное — тело запроса котировки:
 * оно обязано совпадать с `TripDtos.QuoteRequest` из trip-service, иначе расчёт
 * цены просто не пройдёт на живом стеке.
 */

const section = adminSectionById('reference') as AdminSection;

/**
 * Плотность, которую реестр обещает разделу: `densityOf` подставляет минимум, если
 * поле не заполнено. Проверка сравнивается именно с ним — как это делает
 * `e2e/check-admin.mjs`, читающий тот же реестр.
 */
const density = densityOf(section);

const CATEGORIES = ['Электроника', 'Красота'];

/** Адрес компании в списке: уникальная строка, по ней удобно ждать загрузку списка. */
const COMPANY_PLACE = 'Шымкент · ул. Тауке хана, 83';

const BEAUTY_PRODUCT = {
  id: 'P-BEAUTY',
  merchantId: 'M-1',
  merchantName: 'Салон-магазин «Лотос»',
  sku: 'SKU-BEAUTY',
  title: 'Набор шампунь и бальзам Kerastase 250 мл',
  category: 'Красота',
  brand: 'Kerastase',
  status: 'ACTIVE',
  availableQuantity: 18,
  priceMinor: 1_450_000,
  currency: 'KZT',
};

const TECH_PRODUCT = {
  id: 'P-TECH',
  merchantId: 'M-2',
  merchantName: 'TechnoMart Store',
  sku: 'SKU-TECH',
  title: 'Робот-пылесос Xiaomi',
  category: 'Электроника',
  status: 'OUT_OF_STOCK',
  availableQuantity: 0,
  priceMinor: 8_990_000,
  currency: 'KZT',
};

const COMPANY = {
  companyId: 'C-LOTOS',
  name: 'Салон красоты «Лотос»',
  category: 'BEAUTY',
  city: 'Шымкент',
  address: 'ул. Тауке хана, 83',
  lat: 42.317,
  lon: 69.59,
  ratingBp: 48000,
  reviewsCount: 312,
  specialistsCount: 2,
  servicesCount: 2,
  minPriceMinor: 400_000,
};

const COMPANY_DETAIL = {
  ...COMPANY,
  timezone: 'Asia/Almaty',
  specialists: [
    {
      specialistId: 'SP-1',
      name: 'Айгуль Смагулова',
      specialization: 'мастер маникюра',
      ratingBp: 49000,
      experienceYears: 6,
    },
    {
      specialistId: 'SP-2',
      name: 'Динара Ахметова',
      specialization: null,
      ratingBp: 48200,
      experienceYears: 9,
    },
  ],
  services: [
    { serviceId: 'SV-1', name: 'Женская стрижка', durationMinutes: 60, priceMinor: 600_000, currency: 'KZT' },
    { serviceId: 'SV-2', name: 'Маникюр с покрытием', durationMinutes: 90, priceMinor: 450_000, currency: 'KZT' },
  ],
};

const SLOTS = {
  date: '2026-10-04',
  specialistId: 'SP-1',
  serviceId: 'SV-1',
  durationMinutes: 60,
  timezone: 'Asia/Almaty',
  slots: [
    { startsAt: '2026-10-04T05:00:00Z', endsAt: '2026-10-04T06:00:00Z', available: true, reason: null },
    { startsAt: '2026-10-04T06:00:00Z', endsAt: '2026-10-04T07:00:00Z', available: false, reason: 'занято' },
  ],
};

/** Ответ trip-service на настоящий запрос: 3,7 км по Шымкенту, класс ECONOMY. */
const QUOTE = {
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
};

function page<T>(items: T[], totalElements: number) {
  return {
    items,
    page: 0,
    size: Math.max(1, items.length),
    totalElements,
    totalPages: Math.max(1, Math.ceil(totalElements / Math.max(1, items.length))),
    hasNext: false,
  };
}

interface Overrides {
  categories?: MockResponse;
  products?: MockResponse;
  companies?: MockResponse;
  company?: MockResponse;
  slots?: MockResponse;
  quote?: MockResponse;
}

/**
 * Все ручки раздела в одном месте: категории, товары (с фильтром и без), компании,
 * карточка компании, окна мастера и котировка.
 */
function referenceApi(overrides: Overrides = {}) {
  return (url: string, init?: RequestInit): MockResponse => {
    const parsed = new URL(url, 'http://localhost');
    const path = parsed.pathname;

    if (path === '/api/v1/catalog/categories') {
      return overrides.categories ?? jsonResponse(CATEGORIES);
    }

    if (path === '/api/v1/catalog/products') {
      const category = parsed.searchParams.get('category');
      if (category === 'Красота') {
        return overrides.products ?? jsonResponse(page([BEAUTY_PRODUCT], 3));
      }
      if (category === 'Электроника') {
        return jsonResponse(page([TECH_PRODUCT], 1));
      }
      return jsonResponse(page([BEAUTY_PRODUCT, TECH_PRODUCT], 4));
    }

    if (path === '/api/v1/qtime/companies') {
      return overrides.companies ?? jsonResponse(page([COMPANY], 2));
    }

    if (path.startsWith('/api/v1/qtime/companies/')) {
      return overrides.company ?? jsonResponse(COMPANY_DETAIL);
    }

    if (path.includes('/slots')) {
      return overrides.slots ?? jsonResponse(SLOTS);
    }

    if (path === '/api/v1/trips/quote') {
      return overrides.quote ?? jsonResponse(QUOTE);
    }

    throw new Error(`неожиданный запрос: ${init?.method ?? 'GET'} ${url}`);
  };
}

function renderReference(
  handler: (url: string, init?: RequestInit) => MockResponse,
  props: { role?: 'ADMIN' | 'SUPPORT'; canWrite?: boolean } = {},
) {
  const fetchMock = stubFetch(handler);
  const view = render(
    <QueryClientProvider client={createTestQueryClient()}>
      <MemoryRouter>
        <ReferenceSection
          section={section}
          role={props.role ?? 'ADMIN'}
          canWrite={props.canWrite ?? true}
        />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return { fetchMock, ...view };
}

/**
 * Ждёт загрузки списка компаний по адресу из ответа: имя компании встречается
 * дважды (строка таблицы и вариант в селекторе контекста), а адрес — один раз.
 */
async function waitForCompanies() {
  await screen.findByText(COMPANY_PLACE);
}

/** Плитка по подписи: у кита `KpiTile` подпись — первая строка карточки. */
function kpi(label: string): HTMLElement {
  const tile = screen.getByText(label).closest('[data-admin-kpi]');
  if (!tile) {
    throw new Error(`нет плитки «${label}»`);
  }
  return tile as HTMLElement;
}

function urls(fetchMock: ReturnType<typeof stubFetch>): string[] {
  return fetchMock.mock.calls.map(([url]) => String(url));
}

describe('раздел «Справочники»', () => {
  it('показывает плитки и панели не меньше, чем обещает реестр', async () => {
    const { fetchMock } = renderReference(referenceApi());

    await waitForCompanies();

    const kpis = document.querySelectorAll('[data-admin-kpi]');
    const panels = document.querySelectorAll('[data-admin-panel]');
    expect(kpis.length).toBeGreaterThanOrEqual(density.kpis);
    expect(panels.length).toBeGreaterThanOrEqual(density.panels);

    // Числа плиток — из ответов сервисов, а не из констант.
    expect(kpi('Категорий в каталоге')).toHaveTextContent('2');
    expect(kpi('Товаров в каталоге')).toHaveTextContent('4');
    expect(kpi('Компаний QTime')).toHaveTextContent('2');
    // Компания ещё не выбрана — услуг показывать нечего, и «0» здесь был бы враньём.
    expect(kpi('Услуг у выбранной компании')).toHaveTextContent('—');

    // Оба листинга вызваны на своих путях.
    expect(urls(fetchMock)).toContain('/api/v1/catalog/categories');
    expect(urls(fetchMock).some((url) => url.startsWith('/api/v1/catalog/products'))).toBe(true);
    expect(urls(fetchMock).some((url) => url.startsWith('/api/v1/qtime/companies?'))).toBe(true);
  });

  it('считает товары по категориям и фильтрует таблицу кликом по рейлу', async () => {
    const { fetchMock } = renderReference(referenceApi());

    // Рейл: «Все категории» — серверный итог каталога, у категории — своё число.
    const beauty = await screen.findByRole('button', { name: /Красота/ });
    await waitForCompanies();
    expect(beauty).toHaveTextContent('3');
    expect(screen.getByRole('button', { name: /Электроника/ })).toHaveTextContent('1');
    expect(screen.getByRole('button', { name: /Все категории/ })).toHaveTextContent('4');

    // Счётчики взяты страницей из одного товара — лишних строк сервис не отдаёт.
    expect(urls(fetchMock).some((url) => url.includes('size=1') && url.includes('category='))).toBe(true);

    // В таблице пока обе категории.
    expect(await screen.findByText(TECH_PRODUCT.title)).toBeInTheDocument();

    fireEvent.click(beauty);

    await waitFor(() => {
      expect(
        urls(fetchMock).some(
          (url) => url.includes(`category=${encodeURIComponent('Красота')}`) && url.includes('size=8'),
        ),
      ).toBe(true);
    });
    await waitFor(() => {
      expect(screen.queryByText(TECH_PRODUCT.title)).not.toBeInTheDocument();
    });
    expect(screen.getByText(BEAUTY_PRODUCT.title)).toBeInTheDocument();
    expect(screen.getByText('Активен')).toBeInTheDocument();
  });

  it('не отправляет поиск компаний, пока в поле нет текста', async () => {
    const { fetchMock } = renderReference(referenceApi());

    const search = await screen.findByLabelText('Поиск компаний по названию');
    await waitForCompanies();

    // Пробелы — тоже пустое значение: запрос с query уходить не должен.
    fireEvent.change(search, { target: { value: '   ' } });
    await new Promise((resolve) => window.setTimeout(resolve, 600));
    expect(urls(fetchMock).some((url) => url.includes('query='))).toBe(false);

    fireEvent.change(search, { target: { value: 'Лотос' } });
    await waitFor(() => {
      expect(urls(fetchMock).some((url) => url.includes(`query=${encodeURIComponent('Лотос')}`))).toBe(true);
    });
  });

  it('открывает карточку компании: услуги, мастера и окно работы', async () => {
    const { fetchMock } = renderReference(referenceApi());

    await waitForCompanies();
    fireEvent.click(screen.getAllByRole('button', { name: 'Открыть' })[0]!);

    await waitFor(() => {
      expect(urls(fetchMock)).toContain('/api/v1/qtime/companies/C-LOTOS');
    });

    // Услуги: название, длительность и цена из ответа сервиса. Название встречается
    // дважды — строкой таблицы и вариантом в селекте окон, поэтому `findAllByText`.
    expect(await screen.findAllByText('Женская стрижка')).toHaveLength(2);
    expect(screen.getByText('1 ч')).toBeInTheDocument();
    expect(screen.getByText(/6\s*000,00/)).toBeInTheDocument();

    // Мастера: имя и специализация, если сервис её назвал.
    expect(screen.getAllByText('Айгуль Смагулова').length).toBeGreaterThan(0);
    expect(screen.getByText('мастер маникюра')).toBeInTheDocument();
    expect(screen.getAllByText('Динара Ахметова').length).toBeGreaterThan(0);
    expect(screen.getByText('опыт 9 лет')).toBeInTheDocument();

    expect(kpi('Услуг у выбранной компании')).toHaveTextContent('2');

    // Окна — по кнопке: у ручки три параметра, значит и запрос отдельный.
    expect(urls(fetchMock).some((url) => url.includes('/slots'))).toBe(false);

    fireEvent.click(screen.getByRole('button', { name: 'Показать окна' }));

    await waitFor(() => {
      expect(
        urls(fetchMock).some(
          (url) => url.includes('/api/v1/qtime/specialists/SP-1/slots') && url.includes('serviceId=SV-1'),
        ),
      ).toBe(true);
    });
    // 05:00 UTC — это 10:00 в зоне компании (Asia/Almaty).
    expect(await screen.findByText('10:00')).toBeInTheDocument();
    expect(screen.getByText(/свободно 1 из 2/)).toBeInTheDocument();
  });

  it('считает котировку телом TripDtos.QuoteRequest и показывает разбор цены', async () => {
    const { fetchMock } = renderReference(referenceApi());

    await waitForCompanies();
    fireEvent.click(screen.getByRole('button', { name: 'Рассчитать котировку' }));

    await waitFor(() => {
      expect(urls(fetchMock)).toContain('/api/v1/trips/quote');
    });

    const call = fetchMock.mock.calls.find(([url]) => String(url) === '/api/v1/trips/quote');
    expect(call?.[1]?.method).toBe('POST');
    expect(bodyOf(call?.[1])).toEqual({
      pickup: { lat: 42.3155, lon: 69.5867, address: '' },
      dropoff: { lat: 42.3355, lon: 69.6067, address: '' },
      tariff: 'ECONOMY',
    });

    expect(await screen.findByText('части цены складываются в итог')).toBeInTheDocument();
    expect(screen.getByText('Эконом (ECONOMY)')).toBeInTheDocument();
    expect(screen.getByText('3,7 км')).toBeInTheDocument();
    expect(screen.getByText('11 мин 1 с')).toBeInTheDocument();
    expect(screen.getByText(/1\s*098,08/)).toBeInTheDocument();
    expect(screen.getByText('наценки нет (0 bp)')).toBeInTheDocument();
    expect(screen.getByText(/12,00 %/)).toBeInTheDocument();
  });

  it('отказ 403 на котировке объясняет роль CUSTOMER, а не прячет причину', async () => {
    renderReference(
      referenceApi({
        quote: problemResponse(
          {
            status: 403,
            code: 'FORBIDDEN_TRIP_ACCESS',
            title: 'Forbidden',
            detail: 'user U-1 may not order rides: the CUSTOMER role is required',
          },
          403,
        ),
      }),
    );

    await waitForCompanies();
    fireEvent.click(screen.getByRole('button', { name: 'Рассчитать котировку' }));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('CUSTOMER');
    expect(alert).toHaveTextContent('экране входа');
    expect(alert).toHaveTextContent('FORBIDDEN_TRIP_ACCESS');
  });

  it('ошибку сервиса отдаёт в ErrorAlert с humanMessage, а не пустой таблицей', async () => {
    renderReference(
      referenceApi({
        companies: problemResponse(
          {
            status: 503,
            code: 'SERVICE_UNAVAILABLE',
            title: 'Service Unavailable',
            detail: 'qtime-service не отвечает',
          },
          503,
        ),
      }),
    );

    expect(await screen.findByText('Компании QTime не загрузились')).toBeInTheDocument();
    // Заголовок ErrorAlert — это humanMessage, то есть перевод кода сервиса.
    expect(await screen.findByText('Сервис временно недоступен, попробуйте позже')).toBeInTheDocument();
  });

  it('пустая страница компаний показывает EmptyState с объяснением', async () => {
    renderReference(referenceApi({ companies: jsonResponse(page([], 0)) }));

    expect(await screen.findByText('Компаний нет')).toBeInTheDocument();
    expect(screen.getByText(/активных компаний нет/)).toBeInTheDocument();
  });

  it('не рисует изменяющих действий и не называет себя «только для чтения»', async () => {
    const { container } = renderReference(referenceApi(), { role: 'SUPPORT', canWrite: false });

    await waitForCompanies();

    expect(document.querySelector('[data-admin-write]')).toBeNull();
    expect(container.textContent ?? '').not.toMatch(/только для чтения/i);
    // Плотность у SUPPORT та же: раздел ничего не меняет, поэтому блоков не убавляется.
    expect(document.querySelectorAll('[data-admin-kpi]').length).toBeGreaterThanOrEqual(density.kpis);
    expect(document.querySelectorAll('[data-admin-panel]').length).toBeGreaterThanOrEqual(density.panels);

    expect(screen.getByText('Раздел ничего не меняет')).toBeInTheDocument();
    expect(screen.getByText(/Вы вошли как Поддержка/)).toBeInTheDocument();

    // Отсутствующее в API названо словами, а не пустой вкладкой.
    expect(screen.getByText('Каталога тарифов нет')).toBeInTheDocument();
    expect(screen.getByText('Зон обслуживания нет')).toBeInTheDocument();
    expect(screen.getByText('Наценок (surge) как справочника нет')).toBeInTheDocument();
  });
});
