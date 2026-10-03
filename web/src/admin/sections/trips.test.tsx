import { describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import {
  bodyOf,
  jsonResponse,
  problemResponse,
  renderWithProviders,
  stubFetch,
} from '../../test/utils';
import { adminSectionById } from '../sections';
import TripsSection from './trips';

/**
 * Раздел админки «Поездки».
 *
 * Проверяются правила раздела, а не картинка:
 *  - данные берутся только из ответов сервиса, суммы печатаются из минорных единиц;
 *  - числа рейла статусов — счёт сервера (`Page.totalElements`) по каждому статусу, а сводка
 *    и диаграмма — по загруженной выборке, и это написано на экране;
 *  - изменяющие действия помечены `data-admin-write`, и у SUPPORT их нет вовсе — по этой
 *    пометке `e2e/check-admin.mjs` проверяет роль в браузере;
 *  - форма не предлагается там, где сервис её отвергнет: назначение водителя живёт только в
 *    статусе SEARCHING (`TripSagaService.assign`), отмена — до ARRIVED
 *    (`TripStatus.isCancellable`);
 *  - открытая поездка одна на весь раздел: и деталь, и формы действий работают по ней;
 *  - пустой список, ошибка и отсутствие чека объясняются словами;
 *  - плотность раздела не ниже обещанной в реестре (`density`): проверка считает плитки и
 *    блоки по `data-admin-kpi` / `data-admin-panel`, как это делает `e2e/check-admin.mjs`.
 *
 * Ни один изменяющий запрос не уходит «наугад»: каждый POST проверяется по телу, которое
 * собрал раздел.
 */

const SECTION = adminSectionById('trips')!;

/** Плотность из реестра: раздел обязан показать не меньше, иначе проверка в браузере падает. */
const DENSITY = SECTION.density ?? { kpis: 0, panels: 0 };

/** Как `TripDtos.TripResponse` для незанятой заявки. */
const TRIP_SEARCHING = {
  tripId: 'trip-search-1',
  tripNumber: 'T-900',
  status: 'SEARCHING',
  riderUserId: 'U-RIDER-1',
  driverId: null,
  driverName: null,
  vehiclePlate: null,
  tariff: 'ECONOMY',
  pickup: { lat: 42.3155, lon: 69.5867, address: 'пр. Тауке хана, 60' },
  dropoff: { lat: 42.3, lon: 69.6, address: 'пр. Республики, 12' },
  distanceM: 2756,
  durationS: 535,
  priceMinor: 90_572,
  currency: 'KZT',
  requestedAt: '2026-10-02T11:14:21Z',
  timeline: [{ status: 'SEARCHING', at: '2026-10-02T11:14:21Z', actor: 'RIDER' }],
  receipt: null,
};

const TRIP_COMPLETED = {
  ...TRIP_SEARCHING,
  tripId: 'trip-done-1',
  tripNumber: 'T-901',
  status: 'COMPLETED',
  driverId: 'D-9',
  driverName: 'Айдар Сериков',
  vehiclePlate: '123ABC02',
  priceMinor: 132_600,
  completedAt: '2026-10-02T11:40:00Z',
  timeline: [
    { status: 'SEARCHING', at: '2026-10-02T11:14:21Z', actor: 'RIDER' },
    { status: 'COMPLETED', at: '2026-10-02T11:40:00Z', actor: 'DRIVER' },
  ],
  // Чек приходит внутри детали завершённой поездки — отдельный запрос не нужен.
  receipt: {
    tripId: 'trip-done-1',
    priceMinor: 132_600,
    currency: 'KZT',
    completedAt: '2026-10-02T11:40:00Z',
    breakdown: { baseMinor: 40_000, distanceMinor: 60_000, timeMinor: 32_600 },
    transactionId: 'trx-1',
  },
};

interface TripsApiOptions {
  items?: Array<Record<string, unknown>>;
  detail?: unknown;
  failList?: boolean;
}

/**
 * Ответы trip-service: список, выборка для сводки, счёт по каждому статусу, деталь,
 * назначение и отмена.
 *
 * Счёт по статусу отдаётся честно — по фильтру `status` из запроса: именно так сервис и
 * отвечает (`Page.totalElements` для своего фильтра), и подменять это одинаковыми числами
 * значило бы проверять не то, что видит поддержка.
 */
function tripsApi(options: TripsApiOptions = {}) {
  const items = options.items ?? [TRIP_SEARCHING, TRIP_COMPLETED];
  const detail = options.detail ?? TRIP_SEARCHING;
  return stubFetch((url, init) => {
    if (init?.method === 'POST' && url.includes('/assign')) {
      return jsonResponse({ ...TRIP_SEARCHING, status: 'ASSIGNED', driverId: 'D-9' });
    }
    if (init?.method === 'POST' && url.includes('/cancel')) {
      return jsonResponse({ ...TRIP_SEARCHING, status: 'CANCELLED_BY_RIDER', cancelReason: 'тест' });
    }
    if (url.startsWith('/api/v1/trips')) {
      if (options.failList) {
        return problemResponse(
          { status: 500, code: 'INTERNAL_ERROR', title: 'Ошибка', detail: 'trip-service недоступен' },
          500,
        );
      }
      // Деталь — путь без query: /api/v1/trips/{id}
      if (!url.includes('?')) {
        return jsonResponse(detail);
      }
      const params = new URLSearchParams(url.slice(url.indexOf('?') + 1));
      const status = params.get('status');
      const page = status === null ? items : items.filter((item) => item.status === status);
      return jsonResponse({
        items: page,
        page: 0,
        size: page.length,
        totalElements: page.length,
        totalPages: 1,
        hasNext: false,
      });
    }
    return problemResponse({ code: 'NOT_FOUND', detail: url }, 404);
  });
}

function renderSection(canWrite: boolean, role: 'ADMIN' | 'SUPPORT' = canWrite ? 'ADMIN' : 'SUPPORT') {
  return renderWithProviders(<TripsSection section={SECTION} role={role} canWrite={canWrite} />);
}

function posts(fetchMock: ReturnType<typeof stubFetch>) {
  return fetchMock.mock.calls.filter(([, init]) => init?.method === 'POST');
}

/** Панель раздела по её id: у панелей кита он стабилен. */
function panel(id: string): HTMLElement {
  const node = document.getElementById(id);
  expect(node).not.toBeNull();
  return node as HTMLElement;
}

/**
 * Поездка открывается кликом по строке — так же, как это делает человек. Ждём маршрут: он есть
 * только в загруженной детали и встречается в разметке ровно один раз.
 */
async function openTrip(tripNumber: string) {
  fireEvent.click(await screen.findByRole('button', { name: `Открыть поездку № ${tripNumber}` }));
  await screen.findByText('Точка А (посадка)');
}

/** Плитка сводки по её подписи: значения и подписи живут внутри `[data-admin-kpi]`. */
function kpiTile(label: string): HTMLElement {
  const tile = screen.getByText(label).closest('[data-admin-kpi]');
  expect(tile).not.toBeNull();
  return tile as HTMLElement;
}

describe('раздел «Поездки»: список и счётчики', () => {
  it('показывает поездки из ответа сервиса и суммы в минорных единицах', async () => {
    tripsApi();
    renderSection(true);

    expect(await screen.findByText('№ T-900')).toBeInTheDocument();
    expect(screen.getByText('№ T-901')).toBeInTheDocument();
    // 90 572 минорных единицы = 905,72 ₸, 132 600 = 1 326,00 ₸
    expect(screen.getByText(/905,72/)).toBeInTheDocument();
    expect(screen.getByText(/1\s?326,00/)).toBeInTheDocument();
    // «Ищем водителя» — и в фильтре, и в бейдже статуса строки, и в рейле, и в распределении.
    expect(screen.getAllByText('Ищем водителя').length).toBeGreaterThan(1);
    // Водитель и номер машины видны прямо в списке.
    expect(screen.getByText('Айдар Сериков')).toBeInTheDocument();
    expect(screen.getByText('123ABC02')).toBeInTheDocument();
  });

  it('считает счётчики по выборке и подписывает это словами', async () => {
    tripsApi();
    renderSection(true);

    // «Всего по фильтру» — счёт сервера: Page.totalElements, а не длина выборки.
    expect(await within(kpiTile('Всего по фильтру')).findByText('2')).toBeInTheDocument();
    expect(within(kpiTile('В работе')).getByText('1')).toBeInTheDocument();
    expect(within(kpiTile('Завершено')).getByText('1')).toBeInTheDocument();
    expect(within(kpiTile('Отменено')).getByText('0')).toBeInTheDocument();
    // Сумма цен и средний чек: 905,72 + 1 326,00 = 2 231,72 ₸, среднее — 1 115,86 ₸.
    expect(within(kpiTile('Сумма цен')).getByText(/2\s?231,72/)).toBeInTheDocument();
    expect(within(kpiTile('Средний чек')).getByText(/1\s?115,86/)).toBeInTheDocument();

    // Агрегатов у сервиса нет — это написано на экране, а не подразумевается.
    expect(screen.getAllByText(/Агрегатов у trip-service нет/).length).toBeGreaterThan(0);
    expect(screen.getByText(/GET \/api\/v1\/trips\?size=100/)).toBeInTheDocument();
  });

  it('показывает распределение по статусам по загруженной выборке', async () => {
    tripsApi();
    renderSection(true);

    const distribution = (await screen.findByText('Распределение по статусам')).closest(
      '[data-admin-panel]',
    ) as HTMLElement;
    expect(distribution).not.toBeNull();
    expect(await within(distribution).findByText(/по загруженной выборке · строк: 2/)).toBeInTheDocument();
    // Полосы и кольцо строятся из одной и той же выборки: у COMPLETED — одна поездка.
    expect(
      within(distribution).getByRole('img', { name: 'поездок в выборке' }),
    ).toBeInTheDocument();
    expect(within(distribution).getAllByText('Поездка завершена').length).toBeGreaterThan(1);
  });

  it('рейл статусов показывает серверный счёт и фильтрует список', async () => {
    const fetchMock = tripsApi();
    renderSection(true);

    const rail = await screen.findByRole('list', { name: 'Фильтр по статусу поездки' });
    await waitFor(() =>
      expect(within(rail).getByRole('button', { name: /Все\s*2/ })).toBeInTheDocument(),
    );
    expect(within(rail).getByRole('button', { name: /Ищем водителя\s*1/ })).toBeInTheDocument();
    expect(within(rail).getByRole('button', { name: /Поездка завершена\s*1/ })).toBeInTheDocument();
    expect(
      within(rail).getByRole('button', { name: /Свободных машин рядом нет\s*0/ }),
    ).toBeInTheDocument();
    expect(screen.getAllByText(/Page\.totalElements/).length).toBeGreaterThan(0);

    fireEvent.click(within(rail).getByRole('button', { name: /Поездка завершена/ }));

    await waitFor(() =>
      expect(
        fetchMock.mock.calls.some(
          ([url, init]) =>
            init?.method !== 'POST' && String(url).includes('status=COMPLETED') && String(url).includes('size=20'),
        ),
      ).toBe(true),
    );
  });

  it('объясняет пустой список вместо пустой таблицы', async () => {
    tripsApi({ items: [] });
    renderSection(true);

    expect(await screen.findByText('Поездок нет')).toBeInTheDocument();
    // Пустое состояние есть и у диаграммы: «данных не найдено» вместо нулевого кольца.
    expect(screen.getByText('Данных не найдено')).toBeInTheDocument();
  });

  it('показывает ошибку загрузки и предлагает повторить', async () => {
    tripsApi({ failList: true });
    renderSection(true);

    expect(await screen.findByText('Не удалось загрузить поездки')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Повторить' }).length).toBeGreaterThan(0);
  });

  it('фильтр статуса уходит на сервер значениями enum TripStatus', async () => {
    const fetchMock = tripsApi();
    renderSection(true);

    fireEvent.change(await screen.findByLabelText('Статус'), { target: { value: 'COMPLETED' } });

    await waitFor(() =>
      expect(fetchMock.mock.calls.some(([url]) => String(url).includes('status=COMPLETED'))).toBe(true),
    );
  });

  it('отбор «только активные» работает по загруженным строкам и подписан честно', async () => {
    tripsApi();
    renderSection(true);
    await screen.findByText('№ T-900');

    fireEvent.click(screen.getByLabelText('Только активные'));

    // Завершённая поездка скрыта: сервер про «любой из живых статусов» не умеет.
    await waitFor(() => expect(screen.queryByText('№ T-901')).toBeNull());
    expect(screen.getByText('№ T-900')).toBeInTheDocument();
    expect(kpiTile('Активных в выборке')).toBeInTheDocument();
    expect(screen.getByText(/Фильтр «только активные» скрыл 1 из 2 строк этой страницы/)).toBeInTheDocument();
  });

  it('отдаёт плотность не ниже обещанной в реестре разделов', async () => {
    tripsApi();
    renderSection(true);
    await screen.findByText('№ T-900');

    expect(DENSITY.kpis).toBeGreaterThanOrEqual(5);
    expect(DENSITY.panels).toBeGreaterThanOrEqual(4);
    expect(document.querySelectorAll('[data-admin-kpi]').length).toBeGreaterThanOrEqual(DENSITY.kpis);
    expect(document.querySelectorAll('[data-admin-panel]').length).toBeGreaterThanOrEqual(
      DENSITY.panels,
    );
  });

  it('копирует загруженные строки в CSV, когда буфер обмена доступен', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    });

    tripsApi();
    renderSection(true);
    await screen.findByText('№ T-900');

    fireEvent.click(screen.getByRole('button', { name: 'Экспорт CSV' }));

    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));
    const csv = String(writeText.mock.calls[0]?.[0] ?? '');
    expect(csv.split('\r\n')[0]).toBe(
      'tripId;tripNumber;status;tariff;riderUserId;driverId;driverName;vehiclePlate;priceMinor;currency;requestedAt',
    );
    expect(csv).toContain('trip-search-1;T-900;SEARCHING');
    expect(csv).toContain('trip-done-1;T-901;COMPLETED');
    expect(await screen.findByText('скопировано строк: 2')).toBeInTheDocument();
  });
});

describe('раздел «Поездки»: право на запись', () => {
  it('помечает изменяющие действия data-admin-write у ADMIN и не рисует их у SUPPORT', async () => {
    tripsApi();
    const { unmount } = renderSection(true);

    const marked = await waitFor(() => {
      const nodes = Array.from(document.querySelectorAll('[data-admin-write]'));
      expect(nodes).toHaveLength(2);
      return nodes;
    });
    expect(marked.map((node) => node.getAttribute('data-admin-write'))).toEqual([
      'назначение водителя',
      'отмена поездки',
    ]);

    unmount();

    tripsApi();
    renderSection(false);
    // Роль SUPPORT: ни одного изменяющего элемента, ни одной формы действия и ни одного блока
    // действий — раздел честно объясняет, что менять данные может только Администратор.
    expect(document.querySelectorAll('[data-admin-write]')).toHaveLength(0);
    expect(screen.queryByRole('button', { name: 'Назначить водителя' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Отменить поездку' })).toBeNull();
    expect(screen.queryByText('Действия по поездке')).toBeNull();
    // Даже после открытия поездки форм не появляется.
    await openTrip('T-900');
    expect(document.querySelectorAll('[data-admin-write]')).toHaveLength(0);
    expect(screen.queryByLabelText('Причина отмены')).toBeNull();
  });

  it('показывает блоков не меньше обещанного реестром и у роли без права записи', async () => {
    tripsApi();
    renderSection(false);
    await screen.findByText('№ T-900');

    // У SUPPORT нет блока действий — на один блок меньше, как и считает e2e-проверка.
    expect(document.querySelectorAll('[data-admin-panel]').length).toBeGreaterThanOrEqual(
      Math.max(1, DENSITY.panels - 1),
    );
  });
});

describe('раздел «Поездки»: назначение водителя', () => {
  it('требует открытую поездку и driverId, затем шлёт тело AssignDriverRequest', async () => {
    const fetchMock = tripsApi();
    renderSection(true);

    fireEvent.click(await screen.findByRole('button', { name: 'Назначить водителя' }));
    expect(await screen.findByText(/Сначала откройте поездку/)).toBeInTheDocument();
    expect(posts(fetchMock)).toHaveLength(0);

    await openTrip('T-900');
    fireEvent.click(screen.getByRole('button', { name: 'Назначить водителя' }));
    expect(await screen.findByText(/Укажите driverId/)).toBeInTheDocument();
    expect(posts(fetchMock)).toHaveLength(0);

    fireEvent.change(await screen.findByLabelText(/driverId/), { target: { value: 'D-9' } });
    fireEvent.change(screen.getByLabelText('Имя водителя'), { target: { value: 'Айдар Сериков' } });
    fireEvent.change(screen.getByLabelText('Номер машины'), { target: { value: '123ABC02' } });
    fireEvent.click(screen.getByRole('button', { name: 'Назначить водителя' }));

    await waitFor(() => expect(posts(fetchMock)).toHaveLength(1));
    const [url, init] = posts(fetchMock)[0] ?? [];
    expect(String(url)).toBe('/api/v1/trips/trip-search-1/assign');
    expect(bodyOf(init)).toEqual({
      driverId: 'D-9',
      driverName: 'Айдар Сериков',
      vehiclePlate: '123ABC02',
    });
    // Сообщение об успехе ищем по телу ответа: «Водитель назначен» — это ещё и подпись статуса
    // ASSIGNED в фильтре, поэтому по одному заголовку элемент не опознать.
    expect(await screen.findByText(/· статус:/)).toBeInTheDocument();
  });

  it('не предлагает форму там, где сервис её отвергнет (статус не SEARCHING)', async () => {
    tripsApi({ detail: TRIP_COMPLETED });
    renderSection(true);

    await openTrip('T-901');

    expect(await screen.findByText('Назначение водителя недоступно')).toBeInTheDocument();
    expect(screen.getByText('Отмена недоступна')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Назначить водителя' })).toBeNull();
    expect(document.querySelectorAll('[data-admin-write]')).toHaveLength(0);
  });
});

describe('раздел «Поездки»: отмена', () => {
  it('требует причину и шлёт reason вместе с cancelledBy', async () => {
    const fetchMock = tripsApi();
    renderSection(true);

    await openTrip('T-900');
    const reason = await screen.findByLabelText(/Причина отмены/);

    fireEvent.click(screen.getByRole('button', { name: 'Отменить поездку' }));
    expect(await screen.findByText(/Причина обязательна/)).toBeInTheDocument();
    expect(posts(fetchMock)).toHaveLength(0);

    fireEvent.change(reason, { target: { value: 'водитель не выехал' } });
    fireEvent.change(screen.getByLabelText('Чья сторона отменяет'), { target: { value: 'DRIVER' } });
    fireEvent.click(screen.getByRole('button', { name: 'Отменить поездку' }));

    await waitFor(() => expect(posts(fetchMock)).toHaveLength(1));
    const [url, init] = posts(fetchMock)[0] ?? [];
    expect(String(url)).toBe('/api/v1/trips/trip-search-1/cancel');
    expect(bodyOf(init)).toEqual({ reason: 'водитель не выехал', cancelledBy: 'DRIVER' });
    expect(await screen.findByText('Поездка отменена')).toBeInTheDocument();
  });
});

describe('раздел «Поездки»: деталь', () => {
  it('показывает маршрут точками, историю переходов и встроенный чек', async () => {
    tripsApi({ detail: { ...TRIP_COMPLETED, riderUserId: null } });
    renderSection(true);

    await openTrip('T-901');

    expect(within(panel('admin-trips-detail')).getByText('Поездка № T-901')).toBeInTheDocument();
    // Маршрут — адресами и координатами, без карты, шаги пронумерованы.
    expect(screen.getByText('пр. Тауке хана, 60')).toBeInTheDocument();
    expect(screen.getByText('42.31550, 69.58670')).toBeInTheDocument();
    expect(screen.getByText('пр. Республики, 12')).toBeInTheDocument();
    expect(screen.getByText('Точка А (посадка)')).toBeInTheDocument();
    expect(screen.getByText('Точка Б (высадка)')).toBeInTheDocument();
    // Клиента в ответе нет — раздел говорит это прямо, а не выдумывает имя.
    expect(screen.getByText(/имя клиента сервис не отдаёт/)).toBeInTheDocument();
    // История переходов: код статуса плюс русская расшифровка и автор перехода.
    expect(screen.getByText('Поездка завершена · кто: водитель')).toBeInTheDocument();
    // Чек пришёл вместе с деталью: разбивка и движение по счёту.
    expect(screen.getByText(/Чек пришёл вместе с деталью поездки/)).toBeInTheDocument();
    expect(screen.getByText('Итого списано')).toBeInTheDocument();
    expect(screen.getByText('trx-1')).toBeInTheDocument();
  });

  it('открывает поездку по ID из обращения — в том числе ролью без права записи', async () => {
    tripsApi();
    renderSection(false);

    fireEvent.change(await screen.findByLabelText('Открыть поездку по ID'), {
      target: { value: 'trip-search-1' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Открыть' }));

    expect(await within(panel('admin-trips-detail')).findByText('Поездка № T-900')).toBeInTheDocument();
  });

  it('объясняет отсутствие чека у незавершённой поездки', async () => {
    tripsApi({ detail: TRIP_SEARCHING });
    renderSection(true);

    await openTrip('T-900');

    expect(await screen.findByText('Чека ещё нет')).toBeInTheDocument();
    expect(screen.getByText(/TRIP_NOT_COMPLETED/)).toBeInTheDocument();
  });

  it('сообщает, что поездки с таким идентификатором нет', async () => {
    stubFetch(() =>
      problemResponse(
        { status: 404, code: 'TRIP_NOT_FOUND', title: 'Не найдено', detail: 'trip not found' },
        404,
      ),
    );
    renderSection(true);

    fireEvent.change(await screen.findByLabelText('Открыть поездку по ID'), {
      target: { value: 'no-such-trip' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Открыть' }));

    expect(await screen.findByText('Поездка не найдена')).toBeInTheDocument();
  });

  it('до открытия поездки показывает пустое состояние вместо пустой карточки', async () => {
    tripsApi();
    renderSection(true);

    expect(await screen.findByText('Поездка не выбрана')).toBeInTheDocument();
  });
});
