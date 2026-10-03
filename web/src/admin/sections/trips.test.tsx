import { describe, expect, it } from 'vitest';
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
 *  - изменяющие действия помечены `data-admin-write`, и у SUPPORT их нет вовсе — по этой
 *    пометке `e2e/check-admin.mjs` проверяет роль в браузере;
 *  - форма не предлагается там, где сервис её отвергнет: назначение водителя живёт только
 *    в статусе SEARCHING (`TripSagaService.assign`), отмена — до ARRIVED
 *    (`TripStatus.isCancellable`);
 *  - пустой список, ошибка и отсутствие чека объясняются словами.
 *
 * Ни один изменяющий запрос не уходит «наугад»: каждый POST проверяется по телу, которое
 * собрал раздел.
 */

const SECTION = adminSectionById('trips')!;

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
  items?: unknown[];
  detail?: unknown;
  failList?: boolean;
}

/** Ответы trip-service: страница списка (и выборка KPI), деталь, назначение, отмена. */
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
      return jsonResponse({ items, page: 0, size: 20, totalElements: items.length, totalPages: 1, hasNext: false });
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

/** ID поездки вводится полем: после него раздел подгружает деталь. */
async function chooseTrip(tripId: string) {
  fireEvent.change(await screen.findByLabelText(/ID поездки/), { target: { value: tripId } });
}

describe('раздел «Поездки»: список и счётчики', () => {
  it('показывает поездки из ответа сервиса и суммы в минорных единицах', async () => {
    tripsApi();
    renderSection(true);

    expect(await screen.findByText('№ T-900')).toBeInTheDocument();
    expect(screen.getByText('№ T-901')).toBeInTheDocument();
    // 90 572 минорных единицы = 905,72 ₸
    expect(screen.getByText(/905,72/)).toBeInTheDocument();
    expect(screen.getByText(/1 326,00/)).toBeInTheDocument();
    // Имя клиента сервис не отдаёт — раздел говорит это прямо, а не выдумывает имя.
    expect(screen.getAllByText('имя клиента сервис не отдаёт')).toHaveLength(2);
    // «Ищем водителя» — и в фильтре, и в бейдже статуса строки.
    expect(screen.getAllByText('Ищем водителя').length).toBeGreaterThan(1);
  });

  it('считает счётчики по выборке и подписывает это словами', async () => {
    tripsApi();
    renderSection(true);

    const active = (await screen.findByText('В работе')).closest('section');
    expect(active).not.toBeNull();
    expect(await within(active as HTMLElement).findByText('1')).toBeInTheDocument();

    const completed = screen.getByText('Завершено').closest('section');
    expect(await within(completed as HTMLElement).findByText('1')).toBeInTheDocument();

    // Агрегатов у сервиса нет — это написано на экране, а не подразумевается.
    expect(screen.getByText(/Агрегатов у trip-service нет/)).toBeInTheDocument();
    expect(screen.getByText(/GET \/api\/v1\/trips\?size=100/)).toBeInTheDocument();
  });

  it('объясняет пустой список вместо пустой таблицы', async () => {
    tripsApi({ items: [] });
    renderSection(true);

    expect(await screen.findByText('Поездок нет')).toBeInTheDocument();
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
    // Роль SUPPORT: ни одного изменяющего элемента и ни одной формы действия.
    expect(document.querySelectorAll('[data-admin-write]')).toHaveLength(0);
    expect(screen.queryByRole('button', { name: 'Назначить водителя' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Отменить поездку' })).toBeNull();
  });
});

describe('раздел «Поездки»: назначение водителя', () => {
  it('требует ID поездки и driverId, затем шлёт тело AssignDriverRequest', async () => {
    const fetchMock = tripsApi();
    renderSection(true);

    fireEvent.click(await screen.findByRole('button', { name: 'Назначить водителя' }));
    expect(await screen.findByText(/Сначала укажите ID поездки/)).toBeInTheDocument();
    expect(posts(fetchMock)).toHaveLength(0);

    await chooseTrip('trip-search-1');
    fireEvent.click(await screen.findByRole('button', { name: 'Назначить водителя' }));
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
    // Сообщение об успехе ищем по телу ответа: «Водитель назначен» — это ещё и подпись
    // статуса ASSIGNED в фильтре, поэтому по одному заголовку элемент не опознать.
    expect(await screen.findByText(/· статус:/)).toBeInTheDocument();
  });

  it('не предлагает форму там, где сервис её отвергнет (статус не SEARCHING)', async () => {
    tripsApi({ detail: TRIP_COMPLETED });
    renderSection(true);

    await chooseTrip('trip-done-1');

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

    await chooseTrip('trip-search-1');
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
    tripsApi({ detail: TRIP_COMPLETED });
    renderSection(true);

    await chooseTrip('trip-done-1');

    expect(await screen.findByText('Поездка № T-901')).toBeInTheDocument();
    // Маршрут — адресами и координатами, без карты.
    expect(screen.getByText('пр. Тауке хана, 60')).toBeInTheDocument();
    expect(screen.getByText('42.31550, 69.58670')).toBeInTheDocument();
    expect(screen.getByText('пр. Республики, 12')).toBeInTheDocument();
    // История переходов: код статуса плюс русская расшифровка и автор перехода.
    expect(screen.getByText('Поездка завершена · кто: водитель')).toBeInTheDocument();
    // Чек пришёл вместе с деталью: разбивка и движение по счёту.
    expect(screen.getByText(/Чек пришёл вместе с деталью поездки/)).toBeInTheDocument();
    expect(screen.getByText('Итого списано')).toBeInTheDocument();
    expect(screen.getByText('trx-1')).toBeInTheDocument();
  });

  it('объясняет отсутствие чека у незавершённой поездки', async () => {
    tripsApi({ detail: TRIP_SEARCHING });
    renderSection(true);

    await chooseTrip('trip-search-1');

    expect(await screen.findByText(/Чек появляется только у завершённой поездки/)).toBeInTheDocument();
  });

  it('сообщает, что поездки с таким идентификатором нет', async () => {
    stubFetch(() =>
      problemResponse(
        { status: 404, code: 'TRIP_NOT_FOUND', title: 'Не найдено', detail: 'trip not found' },
        404,
      ),
    );
    renderSection(true);

    await chooseTrip('no-such-trip');

    expect(await screen.findByText('Поездка не найдена')).toBeInTheDocument();
  });
});
