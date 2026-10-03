import { describe, expect, it } from 'vitest';
import { screen } from '@testing-library/react';
import { adminSectionById } from '../sections';
import { jsonResponse, problemResponse, renderWithProviders, stubFetch, type MockResponse } from '../../test/utils';
import OverviewSection from './overview';

/**
 * Раздел «Обзор».
 *
 * Здесь важно ровно одно свойство: цифры приходят из листингов сервисов, а
 * недоступность одного сервиса не превращается в «обзор не загрузился». Поэтому
 * тесты проверяют два сценария — всё отвечает и один сервис лежит, — а также
 * честный `DOWN` от шлюза, который приходит с HTTP 503.
 */

const SECTION = adminSectionById('overview')!;

function page(totalElements: number) {
  return { items: [], page: 0, size: 1, totalElements, totalPages: 1, hasNext: false };
}

/** Ответы сервисов по счётчикам: платежи 120 (из них 3 с ошибкой), поездки 48, записи 7. */
function platform({ tripsFail = false, gateway = 'up' as 'up' | 'down' } = {}) {
  return stubFetch((url): MockResponse => {
    if (url.startsWith('/actuator/health')) {
      if (gateway === 'down') {
        return {
          ok: false,
          status: 503,
          headers: new Headers(),
          text: async () => JSON.stringify({ status: 'DOWN' }),
        };
      }
      return jsonResponse({ status: 'UP' });
    }

    const status = new URL(url, 'http://localhost').searchParams.get('status');

    if (url.startsWith('/api/v1/payments')) {
      return jsonResponse(page(status === 'FAILED' ? 3 : 120));
    }
    if (url.startsWith('/api/v1/trips')) {
      if (tripsFail) {
        return problemResponse(
          { code: 'SERVICE_UNAVAILABLE', detail: 'trip-service недоступен' },
          503,
          'corr-trips-1',
        );
      }
      if (status === 'NO_DRIVERS_FOUND') {
        return jsonResponse(page(2));
      }
      if (status === 'CANCELLED_BY_DRIVER') {
        return jsonResponse(page(1));
      }
      return jsonResponse(page(48));
    }
    if (url.startsWith('/api/v1/qtime/bookings')) {
      return jsonResponse(page(status === 'CANCELLED_BY_COMPANY' ? 1 : 7));
    }
    if (url.startsWith('/api/v1/catalog/products')) {
      return jsonResponse(page(30));
    }
    return problemResponse({ code: 'NOT_FOUND', detail: 'нет такого пути' }, 404);
  });
}

describe('обзор: счётчики и шлюз', () => {
  it('показывает totalElements сервисов и состояние шлюза', async () => {
    platform();

    renderWithProviders(<OverviewSection section={SECTION} role="ADMIN" canWrite />);

    expect(await screen.findByText('120')).toBeInTheDocument();
    expect(await screen.findByText('48')).toBeInTheDocument();
    expect(await screen.findByText('7')).toBeInTheDocument();
    // Платежи с ошибкой — отдельный запрос со своим status=FAILED: та же цифра
    // стоит и в карточке, и в строке «требует внимания», поэтому ищем все совпадения.
    expect((await screen.findAllByText('3')).length).toBeGreaterThanOrEqual(2);

    expect(await screen.findByText('UP')).toBeInTheDocument();
    expect(screen.getByText('работает')).toBeInTheDocument();

    // Детализацию шлюз не отдал — об этом сказано, а не нарисованы несуществующие проверки.
    expect(await screen.findByText('Шлюз ответил без детализации')).toBeInTheDocument();

    // Четыре вертикали, которые реально отвечают листингом.
    expect(screen.getAllByText('данные приходят')).toHaveLength(4);
    expect(screen.queryByText('нет данных')).toBeNull();
  });

  it('показывает DOWN как состояние шлюза, а не как сбой запроса', async () => {
    platform({ gateway: 'down' });

    renderWithProviders(<OverviewSection section={SECTION} role="ADMIN" canWrite />);

    expect(await screen.findByText('DOWN')).toBeInTheDocument();
    expect(screen.getByText('не работает')).toBeInTheDocument();
    expect(screen.getByText(/HTTP 503/)).toBeInTheDocument();
    // Шлюз лежит, но цифры сервисов, которые ответили, всё равно показываются.
    expect(await screen.findByText('120')).toBeInTheDocument();
  });
});

describe('обзор: недоступный сервис не ломает раздел', () => {
  it('оставляет цифры остальных сервисов и честно помечает упавший', async () => {
    platform({ tripsFail: true });

    renderWithProviders(<OverviewSection section={SECTION} role="ADMIN" canWrite />);

    expect(await screen.findByText('120')).toBeInTheDocument();
    expect(await screen.findByText('7')).toBeInTheDocument();

    // Поездки: счётчик, обе строки «требует внимания» и карта сервисов — все с ошибкой.
    expect(await screen.findAllByText('нет данных')).toHaveLength(4);
    expect(screen.getAllByText('Сервис временно недоступен, попробуйте позже').length).toBeGreaterThan(0);

    // Шлюз при этом продолжает отвечать — блок живёт своей ошибкой.
    expect(await screen.findByText('UP')).toBeInTheDocument();
    expect(screen.getAllByText('данные приходят')).toHaveLength(3);
  });

  it('говорит о недоступном шлюзе прямо', async () => {
    stubFetch((url) => {
      if (url.startsWith('/actuator/health')) {
        return {
          ok: false,
          status: 502,
          headers: new Headers(),
          text: async () => '<html>502 Bad Gateway</html>',
        };
      }
      return jsonResponse(page(1));
    });

    renderWithProviders(<OverviewSection section={SECTION} role="ADMIN" canWrite />);

    expect(await screen.findByText('Шлюз недоступен')).toBeInTheDocument();
    // Остальные блоки живут своей жизнью: цифры сервисов на экране остаются.
    expect((await screen.findAllByText('1')).length).toBeGreaterThan(0);
  });
});
