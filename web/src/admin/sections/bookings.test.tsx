import { describe, expect, it } from 'vitest';
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
 *  - отмена помечена `data-admin-write`, у SUPPORT её нет вовсе (по этой пометке роль
 *    проверяет `e2e/check-admin.mjs`);
 *  - отмена уходит с необязательным, но осмысленным `Idempotency-Key` — иначе повтор
 *    успешной отмены получил бы 409 `BOOKING_NOT_CANCELLABLE`;
 *  - форма отмены не предлагается для статусов, которые сервис всё равно отвергнет:
 *    окно занимает только CONFIRMED (`BookingStatus`);
 *  - отсутствие клиента в контракте названо прямо, а не добито выдуманным именем.
 */

const SECTION = adminSectionById('bookings')!;

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
  items?: unknown[];
  detail?: unknown;
  failList?: boolean;
}

/** Ответы qtime-service: страница (и выборка KPI), деталь, отмена. */
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
      return jsonResponse({
        items,
        page: 0,
        size: 20,
        totalElements: 42,
        totalPages: 3,
        hasNext: true,
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

describe('раздел «Записи QTime»: список и счётчики', () => {
  it('показывает записи из ответа сервиса и цены в минорных единицах', async () => {
    bookingsApi();
    renderSection(true);

    expect(await screen.findByText('QT-778812')).toBeInTheDocument();
    expect(screen.getByText('QT-778813')).toBeInTheDocument();
    expect(screen.getAllByText('Салон «Лотос»').length).toBe(2);
    expect(screen.getAllByText('Айгуль').length).toBe(2);
    // 450 000 минорных единиц = 4 500,00 ₸ — цена-снимок есть у обеих записей
    expect(screen.getAllByText(/4 500,00/)).toHaveLength(2);
    expect(screen.getAllByText('Подтверждена · окно занято').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Отменена клиентом').length).toBeGreaterThan(0);
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

    const total = (await screen.findByText('Всего по фильтру')).closest('section');
    // «Всего» — счёт сервера: Page.totalElements, а не длина выборки.
    expect(await within(total as HTMLElement).findByText('42')).toBeInTheDocument();

    const cancelled = screen.getByText('Отменено').closest('section');
    expect(await within(cancelled as HTMLElement).findByText('1')).toBeInTheDocument();

    expect(screen.getByText(/Агрегатов у qtime-service нет/)).toBeInTheDocument();
  });

  it('объясняет пустой список', async () => {
    bookingsApi({ items: [] });
    renderSection(true);

    expect(await screen.findByText('Записей нет')).toBeInTheDocument();
  });

  it('показывает ошибку загрузки', async () => {
    bookingsApi({ failList: true });
    renderSection(true);

    expect(await screen.findByText('Не удалось загрузить записи')).toBeInTheDocument();
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
  });
});

describe('раздел «Записи QTime»: отмена', () => {
  it('требует ID записи и причину, затем шлёт reason с ключом идемпотентности', async () => {
    const fetchMock = bookingsApi();
    renderSection(true);

    fireEvent.click(await screen.findByRole('button', { name: 'Подтвердить отмену' }));
    expect(await screen.findByText(/Сначала укажите ID записи/)).toBeInTheDocument();
    expect(posts(fetchMock)).toHaveLength(0);

    fireEvent.change(await screen.findByLabelText(/ID записи/), { target: { value: 'b-1' } });
    fireEvent.click(await screen.findByRole('button', { name: 'Подтвердить отмену' }));
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

    fireEvent.change(await screen.findByLabelText(/ID записи/), { target: { value: 'b-2' } });

    expect(await screen.findByText(/Отмена невозможна: статус «Отменена клиентом»/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Подтвердить отмену' })).toBeNull();
    expect(document.querySelectorAll('[data-admin-write]')).toHaveLength(0);
  });
});

describe('раздел «Записи QTime»: деталь', () => {
  it('показывает комментарий клиента и честно говорит, чего в контракте нет', async () => {
    bookingsApi();
    renderSection(true);

    fireEvent.change(await screen.findByLabelText(/ID записи/), { target: { value: 'b-1' } });

    expect(await screen.findByText('Запись QT-778812')).toBeInTheDocument();
    // Комментарий клиента — единственный его след в ответе QTime.
    expect(await screen.findByText('Прошу без лака')).toBeInTheDocument();
    expect(screen.getByText(/Отдельной истории переходов у QTime нет/)).toBeInTheDocument();
    // Цена-снимок подписана как снимок, а не как ссылка на прайс.
    expect(screen.getByText(/Цена — снимок, а не ссылка на прайс/)).toBeInTheDocument();
    expect(screen.getByText('Запись создана')).toBeInTheDocument();
  });

  it('объясняет отсутствие комментария и клиента в ответе', async () => {
    bookingsApi({ detail: BOOKING_CANCELLED });
    renderSection(true);

    fireEvent.change(await screen.findByLabelText(/ID записи/), { target: { value: 'b-2' } });

    expect(await screen.findByText(/Комментарий клиента при записи не оставлен/)).toBeInTheDocument();
    expect(screen.getByText('не смогу прийти')).toBeInTheDocument();
  });

  it('сообщает, что записи с таким идентификатором нет', async () => {
    stubFetch(() =>
      problemResponse(
        { status: 404, code: 'BOOKING_NOT_FOUND', title: 'Не найдено', detail: 'booking not found' },
        404,
      ),
    );
    renderSection(true);

    fireEvent.change(await screen.findByLabelText(/ID записи/), { target: { value: 'no-such-booking' } });

    expect(await screen.findByText('Запись не найдена')).toBeInTheDocument();
  });
});
