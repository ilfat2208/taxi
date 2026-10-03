/**
 * API-слой раздела «Справочники» админ-панели.
 *
 * Раздел стоит на пяти реальных ручках и не выдумывает ни одной своей. Ниже —
 * контроллеры, по которым сверены пути, параметры и поля (иначе тело запроса
 * разъедется с DTO, и это выяснится только на стеке):
 *
 *  1. `GET /api/v1/catalog/categories` — `CategoryController.categories`
 *     (catalog-service). Отвечает массивом строк, поэтому категории здесь — имена,
 *     а не объекты: счётчик товаров по категории сервис в этой ручке не отдаёт.
 *  2. `GET /api/v1/catalog/products` — `ProductController.search` (catalog-service).
 *     Параметры: `query`, `category`, `merchantId`, `minPriceMinor`, `maxPriceMinor`,
 *     `page`, `size`, `sort`. Счётчик товаров берётся из `totalElements` страницы
 *     `size=1`: сами строки для цифры не нужны.
 *  3. `GET /api/v1/qtime/companies` — `CompanyController.search` (qtime-service).
 *     Параметры: `query`, `category`, `city`, `page`, `size`.
 *  4. `GET /api/v1/qtime/companies/{companyId}` — `CompanyController.get`
 *     (qtime-service). Ответ `QtimeDtos.CompanyDetail`: услуги, мастера и `timezone`
 *     расписания — часов работы в карточке компании нет.
 *  5. `POST /api/v1/trips/quote` — `TripController.quote` (trip-service,
 *     `TripController.java`:71). Тело — `TripDtos.QuoteRequest`
 *     (`{pickup:{lat,lon,address}, dropoff:{lat,lon,address}, tariff}`), ответ —
 *     `TripDtos.QuoteResponse` с разбором цены `breakdown{baseMinor,distanceMinor,timeMinor}`.
 *     Ручка требует роль CUSTOMER (`TripAccess.requireRider`), см. `quoteFailureHint`.
 *
 * Чего в API нет — не додумано, а перечислено словами в `REFERENCE_API_GAPS`:
 * каталога тарифов, зон обслуживания, наценок (surge), городов как справочника и
 * управления ролями.
 */
import { fetchProducts } from '../../api/endpoints';
import { isApiError } from '../../api/errors';
import type {
  Category,
  ProductPage,
  QtimeCompany,
  QtimeCompanyDetail,
  TripQuote,
  TripQuoteRequest,
  TripTariff,
} from '../../api/types';

/* ------------------------------------------------------------------- ключи */

/**
 * Ключи запросов раздела.
 *
 * Объявлены локально, а не в `src/lib/queryKeys.ts`: общий реестр ключей правят
 * другие разделы, и добавление туда строки из этой задачи ломало бы их работу.
 * Общий префикс `['admin', 'reference']` — чтобы «Обновить» раздела гасило ровно
 * свои запросы и ничего лишнего.
 */
export const referenceKeys = {
  all: ['admin', 'reference'] as const,
  categories: () => [...referenceKeys.all, 'categories'] as const,
  catalogTotal: () => [...referenceKeys.all, 'catalog-total'] as const,
  categoryCount: (category: string) => [...referenceKeys.all, 'category-count', category] as const,
  products: (category: string | null, page: number) =>
    [...referenceKeys.all, 'products', category ?? 'ALL', page] as const,
  companies: (page: number) => [...referenceKeys.all, 'companies', page] as const,
  companySearch: (query: string) => [...referenceKeys.all, 'companies-search', query] as const,
  company: (companyId: string) => [...referenceKeys.all, 'company', companyId] as const,
  slots: (specialistId: string, serviceId: string, date: string) =>
    [...referenceKeys.all, 'slots', specialistId, serviceId, date] as const,
};

/* --------------------------------------------------------------- константы */

/** Товаров на странице: список читают глазами, 8 строк — это один экран таблицы. */
export const REFERENCE_PRODUCTS_PAGE_SIZE = 8;

/** Компаний на странице списка QTime. */
export const REFERENCE_COMPANIES_PAGE_SIZE = 5;

/** Сколько совпадений показывает поиск компаний: страниц у него нет (см. панель). */
export const REFERENCE_SEARCH_LIMIT = 10;

/**
 * Предел числа категорий, для которых считаются счётчики.
 *
 * Каждая цифра — отдельный запрос `?category=…&size=1`, и на каталоге из сотни
 * категорий раздел устроил бы сотню параллельных запросов ради подписи в пилюле.
 * Всё, что выше предела, честно помечено в панели как непосчитанное.
 */
export const MAX_CATEGORY_COUNTS = 24;

/** Поля адреса сервис принимает длиной до 256 символов (`@Size(max = 256)`). */
export const MAX_ADDRESS_LENGTH = 256;

/** Точка по умолчанию — центр Шымкента, тот же, что в диспетчерской (`/dispatch`). */
export const DEFAULT_PICKUP = { lat: '42.3155', lon: '69.5867' } as const;
export const DEFAULT_DROPOFF = { lat: '42.3355', lon: '69.6067' } as const;

/** Тариф по умолчанию — тот же, что ставит мобильное приложение. */
export const DEFAULT_TARIFF: TripTariff = 'ECONOMY';

/* -------------------------------------------------------------- категории */

/**
 * Счётчик товаров одной категории.
 *
 * `size=1` — намеренно: нужен только `totalElements`, а страница из одного товара
 * дешевле страницы из двенадцати. Фильтр `category` — точное совпадение
 * (`ProductController.search`).
 */
export async function fetchCategoryProductCount(category: string): Promise<number> {
  const page = await fetchProducts({ category, page: 0, size: 1 });
  return page.totalElements;
}

/** Товаров в каталоге всего: тот же приём без фильтра по категории. */
export async function fetchCatalogProductTotal(): Promise<number> {
  const page = await fetchProducts({ page: 0, size: 1 });
  return page.totalElements;
}

/**
 * Что сказать, если категорий больше, чем мы готовы опросить счётчиками.
 * `null` — считать нечего, все категории посчитаны.
 */
export function categoryCountNote(total: number, counted: number): string | null {
  if (total <= counted) {
    return null;
  }
  return `Счётчики собраны для первых ${counted} категорий из ${total}: каждая цифра — отдельный запрос к каталогу, остальные показаны без числа.`;
}

/* ----------------------------------------------------------------- тарифы */

export interface ReferenceTariff {
  value: TripTariff;
  /** Как класс называется в коде сервиса (`Tariff`). */
  code: string;
  label: string;
}

/**
 * Классы поездки, которые сервис умеет считать.
 *
 * Список взят из enum `Tariff` в `trip-service` (ECONOMY, COMFORT) и совпадает с
 * типом `TripTariff` на клиенте. В API каталога тарифов нет: `GET /api/v1/trips/tariffs`
 * отвечает 404 (`TRIP_NOT_FOUND`, «trip tariffs not found»), а сами цены живут в
 * конфигурации `taxi.trip.tariffs` (`TripProperties`). Поэтому список здесь
 * зафиксирован кодом и подписан в интерфейсе как «из кода, а не из API».
 */
export const REFERENCE_TARIFFS: readonly ReferenceTariff[] = [
  { value: 'ECONOMY', code: 'ECONOMY', label: 'Эконом' },
  { value: 'COMFORT', code: 'COMFORT', label: 'Комфорт' },
];

export function tariffLabel(tariff: string | null | undefined): string {
  const found = REFERENCE_TARIFFS.find((item) => item.value === tariff || item.code === tariff);
  return found ? `${found.label} (${found.code})` : (tariff ?? '—');
}

/** Опции для `SelectField`: структурно это его `SelectOption`. */
export function tariffOptions(): Array<{ value: TripTariff; label: string }> {
  return REFERENCE_TARIFFS.map((tariff) => ({ value: tariff.value, label: `${tariff.label} · ${tariff.code}` }));
}

/* -------------------------------------------------------------- котировка */

export interface QuoteForm {
  pickupLat: string;
  pickupLon: string;
  pickupAddress: string;
  dropoffLat: string;
  dropoffLon: string;
  dropoffAddress: string;
  tariff: TripTariff;
}

export type QuoteField =
  | 'pickupLat'
  | 'pickupLon'
  | 'pickupAddress'
  | 'dropoffLat'
  | 'dropoffLon'
  | 'dropoffAddress';

export type QuoteFormErrors = Partial<Record<QuoteField, string>>;

export type QuoteFormCheck =
  | { ok: true; body: TripQuoteRequest; errors: QuoteFormErrors }
  | { ok: false; errors: QuoteFormErrors };

/** Форма с координатами центра Шымкента и выбранным тарифом. */
export function initialQuoteForm(tariff: TripTariff = DEFAULT_TARIFF): QuoteForm {
  return {
    pickupLat: DEFAULT_PICKUP.lat,
    pickupLon: DEFAULT_PICKUP.lon,
    pickupAddress: '',
    dropoffLat: DEFAULT_DROPOFF.lat,
    dropoffLon: DEFAULT_DROPOFF.lon,
    dropoffAddress: '',
    tariff,
  };
}

export type CoordinateCheck = { ok: true; value: number } | { ok: false; message: string };

/** Широта и долгота из текстового поля; запятая как десятичный разделитель — можно. */
export function parseCoordinate(raw: string, kind: 'lat' | 'lon'): CoordinateCheck {
  const limit = kind === 'lat' ? 90 : 180;
  const label = kind === 'lat' ? 'Широта' : 'Долгота';
  const text = raw.trim().replace(',', '.');
  if (text === '') {
    return { ok: false, message: `${label} не указана` };
  }
  const value = Number(text);
  if (!Number.isFinite(value)) {
    return { ok: false, message: 'Только число' };
  }
  if (value < -limit || value > limit) {
    return { ok: false, message: `${label} — от -${limit} до ${limit}` };
  }
  return { ok: true, value };
}

/**
 * Тело запроса котировки ровно в форме `TripDtos.QuoteRequest`.
 *
 * Адрес необязателен (`@Size(max = 256)` без `@NotBlank`): сервис его сохраняет и
 * возвращает, потому что диспетчеру нужен «Абая 150», а не пара координат. Пустой
 * адрес отправляется пустой строкой — это то, что человек и ввёл.
 */
export function buildQuoteRequest(form: QuoteForm): QuoteFormCheck {
  const pickupLat = parseCoordinate(form.pickupLat, 'lat');
  const pickupLon = parseCoordinate(form.pickupLon, 'lon');
  const dropoffLat = parseCoordinate(form.dropoffLat, 'lat');
  const dropoffLon = parseCoordinate(form.dropoffLon, 'lon');
  const pickupAddress = form.pickupAddress.trim();
  const dropoffAddress = form.dropoffAddress.trim();

  const errors: QuoteFormErrors = {};
  if (!pickupLat.ok) errors.pickupLat = pickupLat.message;
  if (!pickupLon.ok) errors.pickupLon = pickupLon.message;
  if (!dropoffLat.ok) errors.dropoffLat = dropoffLat.message;
  if (!dropoffLon.ok) errors.dropoffLon = dropoffLon.message;
  if (pickupAddress.length > MAX_ADDRESS_LENGTH) {
    errors.pickupAddress = `Адрес длиннее ${MAX_ADDRESS_LENGTH} символов сервис не примет`;
  }
  if (dropoffAddress.length > MAX_ADDRESS_LENGTH) {
    errors.dropoffAddress = `Адрес длиннее ${MAX_ADDRESS_LENGTH} символов сервис не примет`;
  }

  if (!pickupLat.ok || !pickupLon.ok || !dropoffLat.ok || !dropoffLon.ok) {
    return { ok: false, errors };
  }

  return {
    ok: true,
    errors,
    body: {
      pickup: { lat: pickupLat.value, lon: pickupLon.value, address: pickupAddress },
      dropoff: { lat: dropoffLat.value, lon: dropoffLon.value, address: dropoffAddress },
      tariff: form.tariff,
    },
  };
}

/**
 * Почему сервис отказал в котировке — своими словами.
 *
 * `null` означает «скажи это `humanMessage`»: придумывать объяснение для ошибки,
 * которой мы не знаем, хуже, чем показать ответ сервиса как есть.
 */
export function quoteFailureHint(error: unknown): string | null {
  if (!isApiError(error)) {
    return null;
  }
  switch (error.code) {
    case 'FORBIDDEN_TRIP_ACCESS':
      return 'Котировку считает trip-service, и он требует роль CUSTOMER (TripAccess.requireRider): цена привязывается к кошельку, с которого поездка будет оплачена. Токен админ-панели несёт ADMIN/SUPPORT, поэтому сервис отказал. Добавьте роль CUSTOMER на экране входа и войдите заново — расчёт пойдёт по тем же полям.';
    case 'INVALID_TARIFF':
      return 'Такого класса поездки сервис не знает: список в форме собран из enum Tariff в коде trip-service, потому что каталога тарифов в API нет.';
    case 'INVALID_COORDINATES':
      return 'Сервис отказал в координатах: перед расчётом он проверяет, что точка лежит на Земле (GeoMath.requireValidCoordinates).';
    case 'QUOTE_NOT_FOUND':
    case 'QUOTE_EXPIRED':
      return 'Котировка сервисом не найдена или уже истекла: расчёт держится 5 минут (taxi.trip.quote-ttl). Посчитайте цену заново теми же полями.';
    default:
      return null;
  }
}

/* ------------------------------------------------------- формат и подписи */

/** `661` -> `"11 мин 1 с"`, `59` -> `"59 с"`, `3720` -> `"1 ч 2 мин"`. */
export function formatDurationSeconds(seconds: number | null | undefined): string {
  if (typeof seconds !== 'number' || !Number.isFinite(seconds) || seconds < 0) {
    return '—';
  }
  const total = Math.round(seconds);
  if (total < 60) {
    return `${total} с`;
  }
  const minutes = Math.floor(total / 60);
  if (minutes < 60) {
    const rest = total % 60;
    return rest === 0 ? `${minutes} мин` : `${minutes} мин ${rest} с`;
  }
  const hours = Math.floor(minutes / 60);
  const restMinutes = minutes % 60;
  return restMinutes === 0 ? `${hours} ч` : `${hours} ч ${restMinutes} мин`;
}

/**
 * Рейтинг QTime из базисных пунктов: `48000` -> `"4,8"`.
 *
 * Делим на 10 000, а не на 100: колонка `qtime.company.rating_bp` объявлена с
 * ограничением `check (rating_bp between 0 and 50000)` (`V1__init_qtime.sql`), то
 * есть 50 000 — это пять звёзд. Общий `formatRatingBp` из `src/lib/cityTime.ts`
 * делит на 100 (шкала мерчанта, 0..500) и на живых данных QTime напечатал бы
 * «480,0» вместо «4,8», поэтому здесь своя функция.
 */
export function ratingOfFive(ratingBp: number | null | undefined): string | null {
  if (typeof ratingBp !== 'number' || !Number.isFinite(ratingBp) || ratingBp <= 0) {
    return null;
  }
  return (ratingBp / 10_000).toFixed(1).replace('.', ',');
}

/** `0` -> «наценки нет (0 bp)», `1500` -> «×1,15 (1500 bp)». */
export function surgeLabel(surgeBp: number | null | undefined): string {
  if (typeof surgeBp !== 'number' || !Number.isFinite(surgeBp) || surgeBp <= 0) {
    return 'наценки нет (0 bp)';
  }
  return `×${(1 + surgeBp / 10_000).toFixed(2).replace('.', ',')} (${surgeBp} bp)`;
}

/** `1200` bp -> `"12,00 %"`; `null` — сервис комиссию не назвал. */
export function commissionPercent(commissionBp: number | null | undefined): string | null {
  if (typeof commissionBp !== 'number' || !Number.isFinite(commissionBp)) {
    return null;
  }
  return `${(commissionBp / 100).toFixed(2).replace('.', ',')} %`;
}

/* ----------------------------------------------------- снимок для буфера */

export interface ReferenceSnapshotInput {
  categories: Category[];
  categoryCounts: Record<string, number | null>;
  catalogTotal: number | null;
  category: string | null;
  products: ProductPage | null;
  companies: QtimeCompany[];
  companiesTotal: number | null;
  company: QtimeCompanyDetail | null;
  quote: TripQuote | null;
}

/**
 * JSON загруженного — для кнопки «Скопировать JSON».
 *
 * В снимок попадает ровно то, что раздел получил от API: без пересчётов, без
 * округлений и без полей, которых сервис не присылал. Подпись рядом с данными
 * говорит, какая ручка что отдала, — иначе снимок нечем проверить.
 */
export function referenceSnapshotJson(input: ReferenceSnapshotInput): string {
  return JSON.stringify(
    {
      note: 'Снимок раздела «Справочники»: ответы API как есть, без правок интерфейса.',
      sources: {
        categories: 'GET /api/v1/catalog/categories',
        categoryProductCounts: 'GET /api/v1/catalog/products?category=…&page=0&size=1 → totalElements',
        catalogProductsTotal: 'GET /api/v1/catalog/products?page=0&size=1 → totalElements',
        productsPage: 'GET /api/v1/catalog/products?page=…&size=…',
        qtimeCompanies: 'GET /api/v1/qtime/companies?page=…&size=…',
        qtimeCompanyDetail: 'GET /api/v1/qtime/companies/{companyId}',
        tripQuote: 'POST /api/v1/trips/quote',
      },
      categories: input.categories,
      categoryProductCounts: input.categoryCounts,
      catalogProductsTotal: input.catalogTotal,
      selectedCategory: input.category,
      productsPage: input.products,
      qtimeCompanies: input.companies,
      qtimeCompaniesTotal: input.companiesTotal,
      qtimeCompanyDetail: input.company,
      tripQuote: input.quote,
    },
    null,
    2,
  );
}

/* ------------------------------------------------- чего в API нет вовсе */

export interface ReferenceApiGap {
  title: string;
  detail: string;
  /** Чем это проверено — чтобы утверждение можно было перепроверить, а не поверить. */
  checked: string;
}

/**
 * Справочники, которых в API нет.
 *
 * Раздел обязан сказать это словами: пустая вкладка «Тарифы» выглядела бы как
 * недоделанный раздел, а на самом деле таких данных не отдаёт ни один сервис.
 */
export const REFERENCE_API_GAPS: readonly ReferenceApiGap[] = [
  {
    title: 'Каталога тарифов нет',
    detail:
      'Тарифы живут в конфигурации trip-service (taxi.trip.tariffs → TripProperties), а не в API. GET /api/v1/trips/tariffs отвечает 404 TRIP_NOT_FOUND («trip tariffs not found»); без токена шлюз отвечает 401, потому что весь /v1/trips/** закрыт. Увидеть тариф можно только через котировку — она возвращает применённый класс и разбор цены.',
    checked: 'проверено на стеке: POST /v1/auth/token → GET /v1/trips/tariffs → 404 TRIP_NOT_FOUND',
  },
  {
    title: 'Зон обслуживания нет',
    detail:
      'Ни зоны, ни тарифа по зоне в платформе нет: ни одной ручки и ни одной сущности со словом zone. Подача ищет машину по радиусу (taxi.trip.search-radius-m = 5 км, GET /api/v1/dispatch/nearest), то есть по расстоянию, а не по границам района.',
    checked: 'проверено: в сервисах нет маппингов с zone; радиус подачи — параметр конфигурации',
  },
  {
    title: 'Наценок (surge) как справочника нет',
    detail:
      'Поле surgeBp приходит в котировке и в чеке, но управлять им нечем: ручки нет, таблицы правил нет, и в текущей версии наценка не реализована — всегда ноль (FareCalculator: «Surge is not implemented in Ф2»). В котировке это видно как «наценки нет (0 bp)».',
    checked: 'проверено на стеке: surgeBp = 0 в ответе POST /v1/trips/quote',
  },
  {
    title: 'Городов как справочника нет',
    detail:
      'Город есть только строкой в карточке компании QTime и в адресе доставки. Списка городов с зонами и тарифами не отдаёт ни один сервис, поэтому «Все зоны» из эталонной админки здесь заменить нечем — фильтр по городу можно построить только из городов уже загруженной страницы компаний.',
    checked: 'проверено: в сервисах нет маппингов с city/cities; QTime отдаёт city строкой в CompanySummary',
  },
  {
    title: 'Управления ролями нет',
    detail:
      'Роли выдаёт сам шлюз в dev-эндпоинте POST /api/v1/auth/token из тела запроса (AuthController.resolveRoles, роли приходят из токена). API, который меняет роли существующему пользователю, в платформе нет — и раздел поэтому не рисует кнопок «выдать роль».',
    checked: 'проверено: в сервисах нет маппингов с roles/users, кроме POST/GET /api/v1/auth/*',
  },
];
