import { describe, expect, it } from 'vitest';
import { screen, within } from '@testing-library/react';
import { adminSectionById, densityOf } from '../sections';
import { jsonResponse, problemResponse, renderWithProviders, stubFetch, type MockResponse } from '../../test/utils';
import OverviewSection from './overview';

/**
 * Раздел «Обзор».
 *
 * Здесь проверяются правила, которые заказчик видит на экране, а не устройство компонентов:
 *
 *  1. каждая цифра — ответ сервиса: счётчики берутся из `Page.totalElements`, а метрики шлюза
 *     (журнал, запросы, ресурсы) — из выдачи Prometheus;
 *  2. очереди внимания показывают настоящие строки и ведут в раздел; пустая очередь честно
 *     говорит, что пуста, а не прячется;
 *  3. недоступность одного сервиса не ломает дашборд: цифры остальных остаются, а у упавшего
 *     появляется «нет данных» с причиной;
 *  4. недоступные метрики шлюза — это «метрики недоступны», а не нули;
 *  5. плотность и «ничего не меняет» — те же требования, что проверяет браузерная проверка
 *     `web/e2e/check-admin.mjs`: плиток не меньше `density.kpis`, блоков — не меньше
 *     `density.panels`, и ни одного помеченного изменяющего действия (`data-admin-write`).
 */

const SECTION = adminSectionById('overview')!;

/**
 * Плитка по её подписи.
 *
 * Ищем по атрибуту, которым плитки считает браузерная проверка (`data-admin-kpi`), а не по
 * тексту: слова «Платежи» и «Поездки» встречаются ещё и в заголовках панелей и в ссылках, и
 * поиск по тексту поймал бы их вместо плитки.
 */
function tileOf(container: HTMLElement, label: string): HTMLElement {
  const tiles = Array.from(container.querySelectorAll<HTMLElement>('[data-admin-kpi]'));
  const found = tiles.find((node) => (node.textContent ?? '').includes(label));
  if (!found) {
    throw new Error(`Плитка «${label}» не найдена среди ${tiles.length} плиток раздела`);
  }
  return found;
}

/** Ответ листинга в том виде, в каком его отдаёт сервис. */
function page<T>(items: T[], totalElements = items.length) {
  return {
    items,
    page: 0,
    size: items.length === 0 ? 1 : items.length,
    totalElements,
    totalPages: 1,
    hasNext: false,
  };
}

/** Прометеев текст отдаётся как plain text, поэтому `jsonResponse` здесь не годится. */
function textResponse(body: string): MockResponse {
  return { ok: true, status: 200, headers: new Headers(), text: async () => body };
}

const minutesAgo = (minutes: number) => new Date(Date.now() - minutes * 60_000).toISOString();

const FAILED_PAYMENT = {
  paymentId: '01M3Y1M8WDY9QY8F3XW5H6RMJ0',
  paymentNumber: 'P01M3Y1M8WDY9QY8F3XW5H6RMJ1',
  type: 'P2P_TRANSFER',
  status: 'FAILED',
  amountMinor: 100_000,
  feeMinor: 0,
  totalMinor: 100_000,
  currency: 'KZT',
  failureCode: 'LIMIT_EXCEEDED',
  failureReason: 'account-service refused to reserve funds',
  createdAt: minutesAgo(12),
};

const OK_PAYMENT = {
  ...FAILED_PAYMENT,
  paymentId: '01M3Y1M5FA2RDB6YX5KM5FN0S4',
  paymentNumber: 'P01M3Y1M5FA2RDB6YX5KM5FN0S5',
  status: 'COMPLETED',
  failureCode: null,
  failureReason: null,
  createdAt: minutesAgo(30),
};

const NO_DRIVER_TRIP = {
  tripId: '01M3Y5H05V8TR5T2GST0DJF4SD',
  tripNumber: 'T01M3Y5H05V8TR5T2GST0DJF4SE',
  status: 'NO_DRIVERS_FOUND',
  tariff: 'ECONOMY',
  priceMinor: 70_524,
  currency: 'KZT',
  pickup: { lat: 43.2389, lon: 76.8897, address: 'Алматы, пр. Абая 150' },
  requestedAt: minutesAgo(45),
};

const BOOKING = {
  bookingId: '01M3Y4QXCBS6HD1M2RB5PH6VCJ',
  code: 'QT-B5PH6VCJ',
  status: 'CONFIRMED',
  startsAt: new Date(Date.now() + 90 * 60_000).toISOString(),
  companyName: 'Салон красоты «Лотос»',
  serviceName: 'Педикюр',
  priceMinor: 550_000,
  currency: 'KZT',
};

/**
 * Выдача Prometheus: маршруты шлюза (нагрузка, ошибки, максимум), журнал по уровням, запросы
 * шлюза целиком, память JVM, процесс и хост. Числа подобраны так, чтобы производные значения
 * в тестах были однозначными: 200 запросов на 10 секунд таймера — это средние 50 мс.
 */
const PROMETHEUS = `# HELP spring_cloud_gateway_requests_seconds
spring_cloud_gateway_requests_seconds_count{application="api-gateway",httpStatusCode="200",routeId="payment-service",routeUri="http://payment-service:8082"} 50
spring_cloud_gateway_requests_seconds_count{application="api-gateway",httpStatusCode="500",routeId="payment-service",routeUri="http://payment-service:8082"} 1
spring_cloud_gateway_requests_seconds_sum{application="api-gateway",routeId="payment-service",routeUri="http://payment-service:8082"} 5
spring_cloud_gateway_requests_seconds_max{application="api-gateway",routeId="payment-service",routeUri="http://payment-service:8082"} 0.25
spring_cloud_gateway_requests_seconds_count{application="api-gateway",httpStatusCode="200",routeId="trip-service",routeUri="http://trip-service:8086"} 80
spring_cloud_gateway_requests_seconds_count{application="api-gateway",httpStatusCode="404",routeId="trip-service",routeUri="http://trip-service:8086"} 3
spring_cloud_gateway_requests_seconds_sum{application="api-gateway",routeId="trip-service",routeUri="http://trip-service:8086"} 3
spring_cloud_gateway_requests_seconds_count{application="api-gateway",httpStatusCode="200",routeId="qtime-service",routeUri="http://qtime-service:8088"} 66
spring_cloud_gateway_requests_seconds_sum{application="api-gateway",routeId="qtime-service",routeUri="http://qtime-service:8088"} 2
spring_cloud_gateway_requests_seconds_count{application="api-gateway",httpStatusCode="200",routeId="silent-service",routeUri="http://silent:8089"} 0
logback_events_total{application="api-gateway",level="error"} 2.0
logback_events_total{application="api-gateway",level="warn"} 4.0
logback_events_total{application="api-gateway",level="info"} 41.0
http_server_requests_seconds_count{application="api-gateway",method="GET",status="200",uri="/actuator/health"} 345
http_server_requests_seconds_count{application="api-gateway",method="GET",status="200",uri="/api/v1/payments"} 40
http_server_requests_seconds_count{application="api-gateway",method="GET",status="500",uri="/api/v1/payments"} 2
jvm_memory_used_bytes{application="api-gateway",area="heap"} 3.4E8
jvm_memory_max_bytes{application="api-gateway",area="heap"} 1.0E9
jvm_memory_used_bytes{application="api-gateway",area="nonheap"} 1.0E8
jvm_threads_live_threads{application="api-gateway"} 43.0
jvm_gc_pause_seconds_count{application="api-gateway",gc="G1 Young Generation"} 7
jvm_gc_pause_seconds_sum{application="api-gateway",gc="G1 Young Generation"} 0.043
process_uptime_seconds{application="api-gateway"} 7980.0
process_cpu_usage{application="api-gateway"} 0.009
process_files_open_files{application="api-gateway"} 77.0
system_cpu_count{application="api-gateway"} 12.0
system_cpu_usage{application="api-gateway"} 0.09
system_load_average_1m{application="api-gateway"} 0.67
disk_free_bytes{application="api-gateway",path="/app/."} 1.0E11
disk_total_bytes{application="api-gateway",path="/app/."} 2.0E11
`;

interface PlatformOptions {
  /** trip-service не отвечает: проверяем, что остальные блоки это переживают. */
  tripsFail?: boolean;
  /** Метрики шлюза закрыты токеном: 401, а не нули. */
  metricsClosed?: boolean;
  gateway?: 'up' | 'down' | 'unreachable';
  /** Записи, отменённые компанией: очередь пуста. */
  emptyCompanyQueue?: boolean;
}

/** Ответы сервисов платформы: платежи 120 (5 из них FAILED), поездки 48, записи 7, товаров 30. */
function platform({
  tripsFail = false,
  metricsClosed = false,
  gateway = 'up',
  emptyCompanyQueue = false,
}: PlatformOptions = {}) {
  return stubFetch((url): MockResponse => {
    if (url.startsWith('/actuator/health')) {
      if (gateway === 'unreachable') {
        return {
          ok: false,
          status: 502,
          headers: new Headers(),
          text: async () => '<html>502 Bad Gateway</html>',
        };
      }
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

    if (url.startsWith('/actuator/prometheus')) {
      if (metricsClosed) {
        return problemResponse({ code: 'UNAUTHORIZED', detail: 'метрики закрыты' }, 401);
      }
      return textResponse(PROMETHEUS);
    }

    const params = new URL(url, 'http://localhost').searchParams;
    const status = params.get('status');

    if (url.startsWith('/api/v1/payments')) {
      if (status === 'FAILED') {
        return jsonResponse(page([FAILED_PAYMENT], 5));
      }
      if (status === 'PENDING') {
        return jsonResponse(page([], 2));
      }
      return jsonResponse(page([FAILED_PAYMENT, OK_PAYMENT], 120));
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
        return jsonResponse(page([NO_DRIVER_TRIP], 2));
      }
      if (status === 'CANCELLED_BY_DRIVER') {
        return jsonResponse(page([], 1));
      }
      return jsonResponse(page([NO_DRIVER_TRIP], 48));
    }

    if (url.startsWith('/api/v1/qtime/bookings')) {
      if (status === 'CANCELLED_BY_COMPANY') {
        return emptyCompanyQueue ? jsonResponse(page([], 0)) : jsonResponse(page([{ ...BOOKING, status: 'CANCELLED_BY_COMPANY' }], 1));
      }
      return jsonResponse(page([BOOKING], 7));
    }

    if (url.startsWith('/api/v1/orders')) {
      return jsonResponse(page([], 0));
    }
    if (url.startsWith('/api/v1/catalog/products')) {
      return jsonResponse(page([], 30));
    }
    if (url.startsWith('/api/v1/qtime/companies')) {
      return jsonResponse(page([], 4));
    }
    return problemResponse({ code: 'NOT_FOUND', detail: 'нет такого пути' }, 404);
  });
}

describe('обзор: числа сервисов, шлюза и метрик', () => {
  it('берёт счётчики из Page.totalElements, а метрики — из выдачи шлюза', async () => {
    platform();

    const { container } = renderWithProviders(
      <OverviewSection section={SECTION} role="ADMIN" canWrite />,
    );

    // Счётчики сервисов: платежи 120, поездки 48, записи 7, товары 30, компании 4, заказы 0.
    expect(await screen.findByText(/С ошибкой FAILED: 5 \(4,2%\)/)).toBeInTheDocument();
    expect(within(tileOf(container, 'Платежи')).getByText('120')).toBeInTheDocument();
    expect(within(tileOf(container, 'Поездки')).getByText('48')).toBeInTheDocument();
    expect(within(tileOf(container, 'Записи QTime')).getByText('7')).toBeInTheDocument();
    expect(within(tileOf(container, 'Товары в каталоге')).getByText('30')).toBeInTheDocument();
    expect(within(tileOf(container, 'Компании QTime')).getByText('4')).toBeInTheDocument();
    expect(within(tileOf(container, 'Заказы')).getByText('0')).toBeInTheDocument();

    // Шлюз: состояние и код ответа.
    expect(within(tileOf(container, 'Шлюз')).getByText('UP')).toBeInTheDocument();
    expect(within(tileOf(container, 'Шлюз')).getByText(/HTTP 200, работает/)).toBeInTheDocument();

    // Метрики шлюза: журнал (logback error=2), запросы (345+40+2=387), средняя задержка 50 мс.
    expect(within(tileOf(container, 'Ошибки в журнале шлюза')).getByText('2')).toBeInTheDocument();
    expect(within(tileOf(container, 'Запросы через шлюз')).getByText('387')).toBeInTheDocument();
    expect(
      within(tileOf(container, 'Средняя задержка шлюза')).getByText('50 мс'),
    ).toBeInTheDocument();

    // Ресурсы шлюза: время работы из process_uptime_seconds (7980 с = 2 ч 13 мин).
    expect(await screen.findByText('работает 2 ч 13 мин')).toBeInTheDocument();
    expect(screen.getByText(/7 сборок/)).toBeInTheDocument();
    expect(screen.getByText('43 живых')).toBeInTheDocument();
    expect(screen.getByText('77')).toBeInTheDocument();

    // Маршруты шлюза: русские названия знакомых маршрутов и состояние по факту запросов.
    expect(screen.getAllByText('Платежи и возвраты').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Записи QTime').length).toBeGreaterThan(0);
    expect(screen.getByText('запросов не было')).toBeInTheDocument();
    // 4xx по маршруту trip-service: код 404 попал в разбор по кодам.
    expect(screen.getAllByText(/код 404/).length).toBeGreaterThan(0);
  });

  it('собирает ленту из платежей, поездок и записей и подписывает тип события', async () => {
    platform();

    renderWithProviders(<OverviewSection section={SECTION} role="ADMIN" canWrite />);

    expect(await screen.findByText(/Педикюр · 5\s500,00\s₸/)).toBeInTheDocument();
    expect(screen.getAllByText('платёж').length).toBeGreaterThan(0);
    expect(screen.getAllByText('поездка').length).toBeGreaterThan(0);
    expect(screen.getByText('запись')).toBeInTheDocument();
    // Событие записи показано временем окна, а не выдуманным «только что».
    expect(screen.getByText(/^через 1 ч \d+ мин$/)).toBeInTheDocument();
  });
});

describe('обзор: очереди внимания', () => {
  it('показывает настоящие строки проблемных записей и ведёт в раздел', async () => {
    platform();

    const { container } = renderWithProviders(
      <OverviewSection section={SECTION} role="ADMIN" canWrite />,
    );

    // Платёж FAILED: короткий id, сумма и время в строке очереди.
    expect((await screen.findAllByText(/^P01M3Y1M8WDY9/)).length).toBeGreaterThan(0);
    expect(screen.getByText(/^1\s000,00\s₸$/)).toBeInTheDocument();
    expect(screen.getByText('LIMIT_EXCEEDED')).toBeInTheDocument();

    // Поездка NO_DRIVERS_FOUND: номер, цена и адрес подачи.
    expect(screen.getAllByText(/^T01M3Y5H05V8TR/).length).toBeGreaterThan(0);
    expect(screen.getByText(/^705,24\s₸$/)).toBeInTheDocument();

    // Строки очередей — ссылки в свои разделы, а не текст.
    expect(container.querySelectorAll('a[href="/admin/payments"]').length).toBeGreaterThan(0);
    expect(container.querySelectorAll('a[href="/admin/trips"]').length).toBeGreaterThan(0);
    expect(container.querySelectorAll('a[href="/admin/bookings"]').length).toBeGreaterThan(0);
  });

  it('говорит, что очередь пуста, а не прячет пустую карточку', async () => {
    platform({ emptyCompanyQueue: true });

    renderWithProviders(<OverviewSection section={SECTION} role="ADMIN" canWrite />);

    expect(
      await screen.findByText('Очередь пуста: сервис не отдал ни одной записи с этим статусом.'),
    ).toBeInTheDocument();
    // Карточка статуса остаётся на месте и показывает ноль, а не исчезает.
    const card = screen.getByRole('link', { name: /Записи отменены компанией/ });
    expect(within(card).getByText('0')).toBeInTheDocument();
  });
});

describe('обзор: недоступный сервис не ломает раздел', () => {
  it('оставляет цифры остальных сервисов и честно помечает упавший', async () => {
    platform({ tripsFail: true });

    const { container } = renderWithProviders(
      <OverviewSection section={SECTION} role="ADMIN" canWrite />,
    );

    // Платежи и записи на месте.
    expect(await screen.findByText('120')).toBeInTheDocument();
    expect(within(tileOf(container, 'Записи QTime')).getByText('7')).toBeInTheDocument();

    // Поездки: плитка «нет данных» с причиной и «нет ответа» в списке проб.
    expect(within(tileOf(container, 'Поездки')).getByText('нет данных')).toBeInTheDocument();
    expect(screen.getAllByText(/Нет данных: Сервис временно недоступен/).length).toBeGreaterThan(0);
    expect(screen.getByText('нет ответа')).toBeInTheDocument();

    // Шлюз при этом продолжает отвечать — блок живёт своей ошибкой.
    expect(within(tileOf(container, 'Шлюз')).getByText('UP')).toBeInTheDocument();
  });

  it('показывает DOWN как состояние шлюза, а не как сбой запроса', async () => {
    platform({ gateway: 'down' });

    renderWithProviders(<OverviewSection section={SECTION} role="ADMIN" canWrite />);

    expect((await screen.findAllByText('DOWN')).length).toBeGreaterThan(0);
    expect(screen.getAllByText('не работает').length).toBeGreaterThan(0);
    expect(screen.getByText(/HTTP 503, не работает — это состояние, а не сбой запроса/)).toBeInTheDocument();
    // Цифры сервисов, которые ответили, остаются на экране.
    expect(await screen.findByText('120')).toBeInTheDocument();
  });

  it('говорит о недоступном шлюзе прямо', async () => {
    platform({ gateway: 'unreachable' });

    renderWithProviders(<OverviewSection section={SECTION} role="ADMIN" canWrite />);

    expect(await screen.findByText('Шлюз недоступен')).toBeInTheDocument();
    expect((await screen.findAllByText('120')).length).toBeGreaterThan(0);
  });

  it('не рисует нули вместо закрытых метрик шлюза', async () => {
    platform({ metricsClosed: true });

    renderWithProviders(<OverviewSection section={SECTION} role="ADMIN" canWrite />);

    // Две панели (карта сервисов и ресурсы) объясняют, почему метрик нет.
    expect((await screen.findAllByText('Метрики шлюза недоступны')).length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('Ресурсы недоступны')).toBeInTheDocument();
    expect(screen.getAllByText(/шлюз отвечает 401/).length).toBeGreaterThan(0);

    // Плитки метрик показывают «нет данных», а не 0 запросов и 0 задержку.
    const journal = screen.getByText('Ошибки в журнале шлюза').closest('[data-admin-kpi]');
    expect(journal).not.toBeNull();
    expect(within(journal as HTMLElement).getByText('нет данных')).toBeInTheDocument();  });
});

describe('обзор: плотность и отсутствие изменяющих действий', () => {
  it('показывает не меньше плиток и блоков, чем обещает реестр разделов', async () => {
    platform();

    const { container } = renderWithProviders(
      <OverviewSection section={SECTION} role="ADMIN" canWrite />,
    );

    await screen.findByText('120');

    const density = densityOf(SECTION);
    expect(container.querySelectorAll('[data-admin-kpi]').length).toBeGreaterThanOrEqual(
      density.kpis,
    );
    expect(container.querySelectorAll('[data-admin-panel]').length).toBeGreaterThanOrEqual(
      density.panels,
    );
  });

  it('ничего не меняет: изменяющих действий в разделе нет', async () => {
    platform();

    const { container } = renderWithProviders(
      <OverviewSection section={SECTION} role="SUPPORT" canWrite={false} />,
    );

    await screen.findByText('120');

    // Обзор одинаков для обеих ролей и не помечает ни одного действия как изменяющее.
    expect(container.querySelectorAll('[data-admin-write]').length).toBe(0);
  });
});
