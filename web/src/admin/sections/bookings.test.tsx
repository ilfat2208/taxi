import { describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { IDEMPOTENCY_HEADER } from '../../api/client';
import {
  bodyOf,
  headerOf,
  jsonResponse,
  problemResponse,
  renderWithProviders,
  stubFetch,
} from '../../test/utils';
import { adminSectionById } from '../sections';
import BookingsSection from './bookings';

/**
 * Раздел админки «Записи QTime».
 *
 * Проверяются правила раздела:
 *  - данные берутся из ответов qtime-service, суммы — из минорных единиц;
 *  - «всего» — счёт сервера, а не длина выборки, и это подписано на экране;
 *  - числа рейла статусов — серверный `Page.totalElements` по каждому статусу;
 *  - отмена помечена `data-admin-write`, у SUPPORT её нет вовсе (по этой пометке роль
 *    проверяет `e2e/check-admin.mjs`);
 *  - отмена уходит с необязательным, но осмысленным `Idempotency-Key` — иначе повтор
 *    успешной отмены получил бы 409 `BOOKING_NOT_CANCELLABLE`;
 *  - форма отмены не предлагается для статусов, которые сервис всё равно отвергнет: окно
 *    занимает только CONFIRMED (`BookingStatus`);
 *  - отсутствие клиента в контракте названо прямо, а не добито выдуманным именем;
 *  - плотность раздела не ниже обещанной в реестре (`density`).
 */

const SECTION = adminSectionById('bookings')!;

/** Плотность из реестра: раздел обязан показать не меньше, иначе проверка в браузере падает. */
const DENSITY = SECTION.density ?? { kpis: 0, panels: 0 };

/** Как `QtimeDtos.BookingResponse` собирает `QtimeMapper.toBooking`. */
const BOOKING_CONFIRMED = {
  bookingId: 'b-1',
  code: 'QT-778812',
  status: 'CONFIRMED',
  startsAt: '2026-10-02T15:30:00+05:00',
  endsAt: '2026-10-02T17:00:00+05:00',
  companyId: 'c-1',
  companyName: 'Салон «Лотос»',
  companyAddress: 'ул. Байтурсынова, 12',
  specialistId: 'sp-1',
  specialistName: 'Айгуль',
  serviceId: 'sv-1',
  serviceName: 'Маникюр с покрытием',
  durationMinutes: 90,
  priceMinor: 450_000,
  currency: 'KZT',
  clientComment: 'Прошу без лака',
  cancelReason: null,
  createdAt: '2026-10-01T09:00:00Z',
};

const BOOKING_CANCELLED = {
  ...BOOKING_CONFIRMED,
  bookingId: 'b-2',
  code: 'QT-778813',
  status: 'CANCELLED_BY_CLIENT',
  clientComment: null,
  cancelReason: 'не смогу прийти',
};

interface BookingsApiOptions {
  items?: Array<Record<string, unknown>>;
  detail?: unknown;
  failList?: boolean;
}

/**
 * Ответы qtime-service: страница, выборка для сводки, счёт по каждому статусу, деталь и отмена.
 *
 * Счёт по статусу отдаётся по фильтру из запроса — так отвечает и сервис. «Всего по фильтру» для
 * страницы при этом больше длины страницы (42 против 2 строк): именно это различие и проверяет
 * подпись «счёт сервера».
 */
function bookingsApi(options: BookingsApiOptions = {}) {
  const items = options.items ?? [BOOKING_CONFIRMED, BOOKING_CANCELLED];
  const detail = options.detail ?? BOOKING_CONFIRMED;
  return stubFetch((url, init) => {
    if (init?.method === 'POST' && url.includes('/cancel')) {
      return jsonResponse({
        ...BOOKING_CONFIRMED,
        status: 'CANCELLED_BY_COMPANY',
        cancelReason: 'мастер заболел',
      });
    }
    if (url.startsWith('/api/v1/qtime/bookings')) {
      if (options.failList) {
        return problemResponse(
          { status: 500, code: 'INTERNAL_ERROR', title: 'Ошибка', detail: 'qtime-service недоступен' },
          500,
        );
      }
      // Деталь — путь без query: /api/v1/qtime/bookings/{id}
      if (!url.includes('?')) {
        return jsonResponse(detail);
      }
      const params = new URLSearchParams(url.slice(url.indexOf('?') + 1));
      const status = params.get('status');
      const size = Number(params.get('size') ?? '20');
      const page = status === null ? items : items.filter((item) => item.status === status);
      const serverTotal = size !== 1 && status === null ? 42 : page.length;
      return jsonResponse({
        items: page,
        page: 0,
        size,
        totalElements: serverTotal,
        totalPages: serverTotal > page.length ? 3 : 1,
        hasNext: serverTotal > page.length,
      });
    }
    return problemResponse({ code: 'NOT_FOUND', detail: url }, 404);
  });
}

function renderSection(canWrite: boolean) {
  return renderWithProviders(
    <BookingsSection section={SECTION} role={canWrite ? 'ADMIN' : 'SUPPORT'} canWrite={canWrite} />,
  );
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

/** Плитка сводки по её подписи: значения и подписи живут внутри `[data-admin-kpi]`. */
function kpiTile(label: string): HTMLElement {
  const tile = screen.getByText(label).closest('[data-admin-kpi]');
  expect(tile).not.toBeNull();
  return tile as HTMLElement;
}

/** Запись открывается кликом по строке — так же, как это делает человек. */
async function openBooking(code: string) {
  fireEvent.click(await screen.findByRole('button', { name: `Открыть запись ${code}` }));
  // «Окно (начало)» есть только в детали: по нему и видно, что она загрузилась.
  await screen.findByText('Окно (начало)');
}

describe('раздел «Записи QTime»: список и счётчики', () => {
  it('показывает записи из ответа сервиса и цены в минорных единицах', async () => {
    bookingsApi();
    renderSection(true);

    expect(await screen.findByText('QT-778812')).toBeInTheDocument();
    expect(screen.getByText('QT-778813')).toBeInTheDocument();
    // Компания видна прямо в списке — у обеих записей она одна и та же.
    expect(within(panel('admin-bookings-list')).getAllByText('Салон «Лотос»')).toHaveLength(2);
    // 450 000 минорных единиц = 4 500,00 ₸ — цена-снимок есть у обеих записей
    expect(screen.getAllByText(/4\s?500,00/)).toHaveLength(2);
    expect(screen.getAllByText('Подтверждена · окно занято').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Отменена клиентом').length).toBeGreaterThan(0);
    expect(screen.getAllByText('1 ч 30 мин')).toHaveLength(2);
  });

  it('называет отсутствие клиента в контракте вместо выдуманного имени', async () => {
    bookingsApi();
    renderSection(true);

    await screen.findByText('QT-778812');
    expect(screen.getByText(/Колонки «клиент» в таблице нет намеренно/)).toBeInTheDocument();
  });

  it('считает счётчики по выборке и подписывает это словами', async () => {
    bookingsApi();
    renderSection(true);

    // «Всего по фильтру» — счёт сервера: Page.totalElements (42), а не длина выборки.
    expect(await within(kpiTile('Всего по фильтру')).findByText('42')).toBeInTheDocument();
    expect(within(kpiTile('Подтверждено')).getByText('1')).toBeInTheDocument();
    expect(within(kpiTile('Завершено')).getByText('0')).toBeInTheDocument();
    expect(within(kpiTile('Отменено')).getByText('1')).toBeInTheDocument();
    expect(within(kpiTile('Неявки')).getByText('0')).toBeInTheDocument();
    // Сумма цен — по загруженной странице: 4 500,00 + 4 500,00 = 9 000,00 ₸.
    expect(within(kpiTile('Сумма цен на странице')).getByText(/9\s?000,00/)).toBeInTheDocument();

    expect(screen.getAllByText(/Агрегатов у qtime-service нет/).length).toBeGreaterThan(0);
    expect(screen.getByText(/GET \/api\/v1\/qtime\/bookings\?size=100/)).toBeInTheDocument();
  });

  it('показывает распределение по статусам по загруженной выборке', async () => {
    bookingsApi();
    renderSection(true);

    const distribution = (await screen.findByText('Распределение по статусам')).closest(
      '[data-admin-panel]',
    ) as HTMLElement;
    expect(distribution).not.toBeNull();
    expect(await within(distribution).findByText(/по загруженной выборке · строк: 2/)).toBeInTheDocument();
    expect(within(distribution).getByRole('img', { name: 'записей в выборке' })).toBeInTheDocument();
    expect(within(distribution).getAllByText('Клиент не пришёл').length).toBeGreaterThan(0);
  });

  it('рейл статусов показывает серверный счёт и фильтрует список', async () => {
    const fetchMock = bookingsApi();
    renderSection(true);

    const rail = await screen.findByRole('list', { name: 'Фильтр по статусу записи' });
    await waitFor(() =>
      expect(within(rail).getByRole('button', { name: /Все\s*2/ })).toBeInTheDocument(),
    );
    expect(
      within(rail).getByRole('button', { name: /Подтверждена · окно занято\s*1/ }),
    ).toBeInTheDocument();
    expect(within(rail).getByRole('button', { name: /Отменена клиентом\s*1/ })).toBeInTheDocument();
    expect(within(rail).getByRole('button', { name: /Клиент не пришёл\s*0/ })).toBeInTheDocument();

    fireEvent.click(within(rail).getByRole('button', { name: /Отменена клиентом/ }));

    await waitFor(() =>
      expect(
        fetchMock.mock.calls.some(
          ([url, init]) =>
            init?.method !== 'POST' &&
            String(url).includes('status=CANCELLED_BY_CLIENT') &&
            String(url).includes('size=20'),
        ),
      ).toBe(true),
    );
  });

  it('объясняет пустой список и пустую выборку', async () => {
    bookingsApi({ items: [] });
    renderSection(true);

    expect(await screen.findByText('Записей нет')).toBeInTheDocument();
    expect(screen.getByText('Данных не найдено')).toBeInTheDocument();
  });

  it('показывает ошибку загрузки', async () => {
    bookingsApi({ failList: true });
    renderSection(true);

    expect(await screen.findByText('Не удалось загрузить записи')).toBeInTheDocument();
  });

  it('отдаёт плотность не ниже обещанной в реестре разделов', async () => {
    bookingsApi();
    renderSection(true);
    await screen.findByText('QT-778812');

    expect(DENSITY.kpis).toBeGreaterThanOrEqual(5);
    expect(DENSITY.panels).toBeGreaterThanOrEqual(3);
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

    bookingsApi();
    renderSection(true);
    await screen.findByText('QT-778812');

    fireEvent.click(screen.getByRole('button', { name: 'Экспорт CSV' }));

    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));
    const csv = String(writeText.mock.calls[0]?.[0] ?? '');
    expect(csv.split('\r\n')[0]).toBe(
      'bookingId;code;status;startsAt;endsAt;companyId;companyName;specialistName;serviceName;durationMinutes;priceMinor;currency',
    );
    expect(csv).toContain('b-1;QT-778812;CONFIRMED');
    expect(await screen.findByText('скопировано строк: 2')).toBeInTheDocument();
  });
});

describe('раздел «Записи QTime»: право на запись', () => {
  it('помечает отмену data-admin-write у ADMIN и не рисует её у SUPPORT', async () => {
    bookingsApi();
    const { unmount } = renderSection(true);

    const marked = await waitFor(() => {
      const nodes = Array.from(document.querySelectorAll('[data-admin-write]'));
      expect(nodes).toHaveLength(1);
      return nodes;
    });
    expect(marked[0]?.getAttribute('data-admin-write')).toBe('отмена записи');

    unmount();

    bookingsApi();
    renderSection(false);
    expect(document.querySelectorAll('[data-admin-write]')).toHaveLength(0);
    expect(screen.queryByRole('button', { name: 'Подтвердить отмену' })).toBeNull();
    expect(screen.queryByLabelText(/Причина отмены/)).toBeNull();
    expect(screen.queryByText('Отмена записи')).toBeNull();

    // Даже после открытия записи формы не появляется.
    await openBooking('QT-778812');
    expect(document.querySelectorAll('[data-admin-write]')).toHaveLength(0);
    expect(document.querySelectorAll('[data-admin-panel]').length).toBeGreaterThanOrEqual(
      Math.max(1, DENSITY.panels - 1),
    );
  });
});

describe('раздел «Записи QTime»: отмена', () => {
  it('требует открытую запись и причину, затем шлёт reason с ключом идемпотентности', async () => {
    const fetchMock = bookingsApi();
    renderSection(true);

    fireEvent.click(await screen.findByRole('button', { name: 'Подтвердить отмену' }));
    expect(await screen.findByText(/Сначала откройте запись/)).toBeInTheDocument();
    expect(posts(fetchMock)).toHaveLength(0);

    await openBooking('QT-778812');
    fireEvent.click(screen.getByRole('button', { name: 'Подтвердить отмену' }));
    expect(await screen.findByText(/Укажите причину/)).toBeInTheDocument();
    expect(posts(fetchMock)).toHaveLength(0);

    fireEvent.change(await screen.findByLabelText(/Причина отмены/), {
      target: { value: 'мастер заболел' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Подтвердить отмену' }));

    await waitFor(() => expect(posts(fetchMock)).toHaveLength(1));
    const [url, init] = posts(fetchMock)[0] ?? [];
    expect(String(url)).toBe('/api/v1/qtime/bookings/b-1/cancel');
    expect(bodyOf(init)).toEqual({ reason: 'мастер заболел' });
    // Ключ необязателен, но осмыслен: повтор успешной отмены без него получил бы 409.
    expect(headerOf(init, IDEMPOTENCY_HEADER)).toBeTruthy();
  });

  it('не предлагает отмену для статуса, который сервис отвергнет', async () => {
    bookingsApi({ detail: BOOKING_CANCELLED });
    renderSection(true);

    await openBooking('QT-778813');

    expect(await screen.findByText(/Отмена невозможна: статус «Отменена клиентом»/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Подтвердить отмену' })).toBeNull();
    expect(document.querySelectorAll('[data-admin-write]')).toHaveLength(0);
  });
});

describe('раздел «Записи QTime»: деталь', () => {
  it('показывает компанию, мастера, услугу, окно и комментарий клиента', async () => {
    bookingsApi();
    renderSection(true);

    await openBooking('QT-778812');

    expect(within(panel('admin-bookings-detail')).getByText('Запись QT-778812')).toBeInTheDocument();
    expect(within(panel('admin-bookings-detail')).getByText('Салон «Лотос»')).toBeInTheDocument();
    expect(screen.getByText('Айгуль')).toBeInTheDocument();
    expect(screen.getByText('Маникюр с покрытием')).toBeInTheDocument();
    expect(screen.getByText('Окно (начало)')).toBeInTheDocument();
    expect(screen.getByText('Окно (конец)')).toBeInTheDocument();
    expect(screen.getByText('Цена-снимок')).toBeInTheDocument();
    // Комментарий клиента — единственный его след в ответе QTime.
    expect(screen.getByText('Прошу без лака')).toBeInTheDocument();
    // Хронология строится из времени создания и текущего статуса — так и подписана.
    expect(screen.getByText(/Отдельной истории переходов у QTime нет/)).toBeInTheDocument();
    expect(screen.getByText(/Цена — снимок, а не ссылка на прайс/)).toBeInTheDocument();
    expect(screen.getByText(/Запись создана: QTime заводит её сразу подтверждённой/)).toBeInTheDocument();
  });

  it('объясняет отсутствие комментария и клиента в ответе', async () => {
    bookingsApi({ detail: BOOKING_CANCELLED });
    renderSection(true);

    await openBooking('QT-778813');

    expect(await screen.findByText(/Комментарий клиента при записи не оставлен/)).toBeInTheDocument();
    expect(screen.getByText('не смогу прийти')).toBeInTheDocument();
  });

  it('открывает запись по ID из обращения — в том числе ролью без права записи', async () => {
    bookingsApi();
    renderSection(false);

    fireEvent.change(await screen.findByLabelText('Открыть запись по ID'), {
      target: { value: 'b-1' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Открыть' }));

    expect(await within(panel('admin-bookings-detail')).findByText('Запись QT-778812')).toBeInTheDocument();
  });

  it('до открытия записи показывает пустое состояние вместо пустой карточки', async () => {
    bookingsApi();
    renderSection(true);

    expect(await screen.findByText('Запись не выбрана')).toBeInTheDocument();
  });

  it('сообщает, что записи с таким идентификатором нет', async () => {
    stubFetch(() =>
      problemResponse(
        { status: 404, code: 'BOOKING_NOT_FOUND', title: 'Не найдено', detail: 'booking not found' },
        404,
      ),
    );
    renderSection(true);

    fireEvent.change(await screen.findByLabelText('Открыть запись по ID'), {
      target: { value: 'no-such-booking' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Открыть' }));

    expect(await screen.findByText('Запись не найдена')).toBeInTheDocument();
  });
});
