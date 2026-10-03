import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { adminSectionById, densityOf } from '../sections';
import { jsonResponse, problemResponse, renderWithProviders, stubFetch, type MockResponse } from '../../test/utils';
import { resetPulseTextCache } from '../api/pulseMetrics';
import PulseSection, {
  formatBytes,
  formatClock,
  formatCount,
  formatDuration,
  formatMs,
  formatPercent,
} from './pulse';

/**
 * Раздел «Пульт».
 *
 * Проверяется ровно то, что обещано: экран плотный (плитки и панели посчитаны по
 * разметке, как в браузерной проверке), таблицы лежат в контейнере с `relative
 * overflow-x-auto`, коды ответов и задержки показывают настоящие числа из выдачи,
 * а недоступность одного запроса не гасит остальные панели. Словосочетания «только
 * для чтения» в разделе быть не должно — баннер рисует оболочка админки.
 *
 * Выдача метрик взята с живого шлюза: те же серии и числа, что в
 * `pulseMetrics.test.ts` (фикстуру приходится держать в двух файлах — общий файл с
 * тестовыми данными пришлось бы создавать вне разрешённых к правке путей).
 */
const SECTION = adminSectionById('pulse')!;

const SAMPLE = `
# HELP spring_cloud_gateway_requests_seconds
spring_cloud_gateway_requests_seconds_count{application="api-gateway",httpMethod="GET",httpStatusCode="200",outcome="SUCCESSFUL",routeId="account-service",routeUri="http://account-service:8081",status="OK"} 68
spring_cloud_gateway_requests_seconds_sum{application="api-gateway",httpMethod="GET",httpStatusCode="200",routeId="account-service"} 1.678975018
spring_cloud_gateway_requests_seconds_max{application="api-gateway",httpMethod="GET",httpStatusCode="200",routeId="account-service"} 0.02163394
spring_cloud_gateway_requests_seconds_count{application="api-gateway",httpMethod="GET",httpStatusCode="404",outcome="CLIENT_ERROR",routeId="account-service",routeUri="http://account-service:8081",status="NOT_FOUND"} 1
spring_cloud_gateway_requests_seconds_sum{application="api-gateway",httpMethod="GET",httpStatusCode="404",routeId="account-service"} 0.092516672
spring_cloud_gateway_requests_seconds_max{application="api-gateway",httpMethod="GET",httpStatusCode="404",routeId="account-service"} 0.0
spring_cloud_gateway_requests_seconds_count{application="api-gateway",httpMethod="GET",httpStatusCode="200",outcome="SUCCESSFUL",routeId="catalog-service",routeUri="http://catalog-service:8083",status="OK"} 29
spring_cloud_gateway_requests_seconds_sum{application="api-gateway",httpMethod="GET",httpStatusCode="200",routeId="catalog-service"} 1.359909487
spring_cloud_gateway_requests_seconds_max{application="api-gateway",httpMethod="GET",httpStatusCode="200",routeId="catalog-service"} 0.032229904
spring_cloud_gateway_requests_seconds_count{application="api-gateway",httpMethod="GET",httpStatusCode="405",outcome="CLIENT_ERROR",routeId="catalog-service",routeUri="http://catalog-service:8083",status="METHOD_NOT_ALLOWED"} 1
spring_cloud_gateway_requests_seconds_sum{application="api-gateway",httpMethod="GET",httpStatusCode="405",routeId="catalog-service"} 0.028728972
spring_cloud_gateway_requests_seconds_count{application="api-gateway",httpMethod="POST",httpStatusCode="403",outcome="CLIENT_ERROR",routeId="payment-service",routeUri="http://payment-service:8082",status="FORBIDDEN"} 2
spring_cloud_gateway_requests_seconds_sum{application="api-gateway",httpMethod="POST",httpStatusCode="403",routeId="payment-service"} 0.115113223
spring_cloud_gateway_requests_seconds_count{application="api-gateway",httpMethod="POST",httpStatusCode="500",outcome="SERVER_ERROR",routeId="payment-service",routeUri="http://payment-service:8082",status="INTERNAL_SERVER_ERROR"} 1
spring_cloud_gateway_requests_seconds_sum{application="api-gateway",httpMethod="POST",httpStatusCode="500",routeId="payment-service"} 0.5
spring_cloud_gateway_requests_seconds_max{application="api-gateway",httpMethod="POST",httpStatusCode="500",routeId="payment-service"} 0.75
spring_cloud_gateway_requests_seconds_count{application="api-gateway",routeId="qtime-service",routeUri="http://qtime-service:8088"} 5
spring_cloud_gateway_requests_seconds_sum{application="api-gateway",routeId="qtime-service"} 0.1
spring_cloud_gateway_routes_count{application="api-gateway"} 9.0
http_server_requests_seconds_count{application="api-gateway",method="GET",outcome="SUCCESS",status="200",uri="/actuator/health"} 350
http_server_requests_seconds_count{application="api-gateway",method="GET",outcome="SUCCESS",status="200",uri="/api/v1/payments/{id}"} 14
http_server_requests_seconds_count{application="api-gateway",method="GET",outcome="CLIENT_ERROR",status="404",uri="NOT_FOUND"} 14
http_server_requests_seconds_count{application="api-gateway",method="GET",outcome="CLIENT_ERROR",status="401",uri="UNKNOWN"} 1
http_client_requests_seconds_count{application="api-gateway",error="none",http_method="GET",http_status_code="200",spring_cloud_gateway_route_id="account-service",spring_cloud_gateway_route_uri="http://account-service:8081"} 68
http_client_requests_seconds_sum{application="api-gateway",error="none",http_method="GET",http_status_code="200",spring_cloud_gateway_route_id="account-service"} 1.5
http_client_requests_seconds_max{application="api-gateway",error="none",http_method="GET",http_status_code="200",spring_cloud_gateway_route_id="account-service"} 0.02
http_client_requests_seconds_count{application="api-gateway",error="none",http_method="POST",http_status_code="500",spring_cloud_gateway_route_id="payment-service",spring_cloud_gateway_route_uri="http://payment-service:8082"} 2
http_client_requests_seconds_sum{application="api-gateway",error="none",http_method="POST",http_status_code="500",spring_cloud_gateway_route_id="payment-service"} 0.4
jvm_memory_used_bytes{application="api-gateway",area="heap",id="G1 Eden Space"} 5.4525944E7
jvm_memory_used_bytes{application="api-gateway",area="heap",id="G1 Old Gen"} 3.9510528E7
jvm_memory_used_bytes{application="api-gateway",area="heap",id="G1 Survivor Space"} 928224.0
jvm_memory_used_bytes{application="api-gateway",area="nonheap",id="Metaspace"} 6.6959152E7
jvm_memory_committed_bytes{application="api-gateway",area="heap",id="G1 Eden Space"} 7.9691776E7
jvm_memory_committed_bytes{application="api-gateway",area="heap",id="G1 Old Gen"} 6.7108864E7
jvm_memory_committed_bytes{application="api-gateway",area="heap",id="G1 Survivor Space"} 4194304.0
jvm_memory_committed_bytes{application="api-gateway",area="nonheap",id="Metaspace"} 6.750208E7
jvm_memory_max_bytes{application="api-gateway",area="heap",id="G1 Eden Space"} -1.0
jvm_memory_max_bytes{application="api-gateway",area="heap",id="G1 Old Gen"} 6.132072448E9
jvm_memory_max_bytes{application="api-gateway",area="heap",id="G1 Survivor Space"} -1.0
jvm_memory_max_bytes{application="api-gateway",area="nonheap",id="Metaspace"} -1.0
jvm_gc_pause_seconds_count{application="api-gateway",cause="G1 Evacuation Pause",gc="G1 Young Generation"} 7
jvm_gc_pause_seconds_sum{application="api-gateway",cause="G1 Evacuation Pause",gc="G1 Young Generation"} 0.043
jvm_gc_pause_seconds_count{application="api-gateway",cause="Metadata GC Threshold",gc="G1 Young Generation"} 1
jvm_gc_pause_seconds_sum{application="api-gateway",cause="Metadata GC Threshold",gc="G1 Young Generation"} 0.006
jvm_threads_live_threads{application="api-gateway"} 43.0
jvm_threads_daemon_threads{application="api-gateway"} 41.0
jvm_threads_peak_threads{application="api-gateway"} 43.0
jvm_threads_states_threads{application="api-gateway",state="blocked"} 0.0
jvm_threads_states_threads{application="api-gateway",state="runnable"} 18.0
jvm_threads_states_threads{application="api-gateway",state="timed-waiting"} 4.0
jvm_threads_states_threads{application="api-gateway",state="waiting"} 21.0
process_uptime_seconds{application="api-gateway"} 3321.993
process_cpu_usage{application="api-gateway"} 0.001057749028701613
process_files_open_files{application="api-gateway"} 107.0
process_start_time_seconds{application="api-gateway"} 1.791021636279E9
system_cpu_count{application="api-gateway"} 12.0
system_cpu_usage{application="api-gateway"} 0.08764947371226584
system_load_average_1m{application="api-gateway"} 1.09375
disk_free_bytes{application="api-gateway",path="/app/."} 9.97883183104E11
disk_total_bytes{application="api-gateway",path="/app/."} 1.081101176832E12
logback_events_total{application="api-gateway",level="debug"} 0.0
logback_events_total{application="api-gateway",level="error"} 2.0
logback_events_total{application="api-gateway",level="info"} 46.0
logback_events_total{application="api-gateway",level="trace"} 0.0
logback_events_total{application="api-gateway",level="warn"} 1.0
lettuce_command_completion_seconds_count{application="api-gateway",command="EVALSHA",remote="redis/172.20.0.10:6379"} 434
lettuce_command_completion_seconds_sum{application="api-gateway",command="EVALSHA"} 0.572423388
lettuce_command_completion_seconds_max{application="api-gateway",command="EVALSHA"} 0.005278707
lettuce_command_completion_seconds_count{application="api-gateway",command="INFO",remote="redis/172.20.0.10:6379"} 350
lettuce_command_completion_seconds_sum{application="api-gateway",command="INFO"} 0.133217416
lettuce_command_completion_seconds_max{application="api-gateway",command="INFO"} 6.28038E-4
executor_active_threads{application="api-gateway",name="applicationTaskExecutor"} 0.0
executor_completed_tasks_total{application="api-gateway",name="applicationTaskExecutor"} 12.0
executor_pool_core_threads{application="api-gateway",name="applicationTaskExecutor"} 8.0
executor_pool_max_threads{application="api-gateway",name="applicationTaskExecutor"} 2.147483647E9
executor_pool_size_threads{application="api-gateway",name="applicationTaskExecutor"} 0.0
executor_queue_remaining_tasks{application="api-gateway",name="applicationTaskExecutor"} 2.147483647E9
executor_queued_tasks{application="api-gateway",name="applicationTaskExecutor"} 0.0
spring_security_http_secured_requests_seconds_count{application="api-gateway",error="none"} 859
spring_security_authorizations_seconds_count{application="api-gateway",error="none",spring_security_authorization_decision="true",spring_security_object="exchange"} 400
spring_security_authorizations_seconds_count{application="api-gateway",error="AccessDeniedException",spring_security_authorization_decision="false",spring_security_object="exchange"} 1
`;

function prometheusResponse(text: string, status = 200): MockResponse {
  return { ok: status >= 200 && status < 300, status, headers: new Headers(), text: async () => text };
}

/** Обычная платформа: метрики шлюза отвечают, здоровье — UP. */
function platform({ health }: { health?: MockResponse } = {}) {
  return stubFetch((url): MockResponse => {
    if (url.startsWith('/actuator/prometheus')) {
      return prometheusResponse(SAMPLE);
    }
    if (url.startsWith('/actuator/health')) {
      return health ?? jsonResponse({ status: 'UP' });
    }
    return problemResponse({ code: 'NOT_FOUND', detail: 'нет такого пути' }, 404);
  });
}

function renderPulse(canWrite = true) {
  return renderWithProviders(<PulseSection section={SECTION} role={canWrite ? 'ADMIN' : 'SUPPORT'} canWrite={canWrite} />);
}

/** Панель по её идентификатору: числа ищем внутри своей панели, а не по всему экрану. */
function panel(id: string): HTMLElement {
  const element = document.querySelector<HTMLElement>(`#${id}`);
  if (element === null) {
    throw new Error(`панель ${id} не найдена`);
  }
  return element;
}

beforeEach(() => {
  resetPulseTextCache();
});

describe('пульт: форматирование чисел', () => {
  it('показывает байты, миллисекунды, длительность, проценты и большие числа по-русски', () => {
    expect(formatBytes(94_964_696)).toBe('90,6 МБ');
    expect(formatBytes(6_132_072_448)).toBe('5,7 ГБ');
    expect(formatBytes(512)).toBe('512 Б');
    expect(formatBytes(null)).toBe('—');

    expect(formatMs(25.6738)).toBe('25,7 мс');
    expect(formatMs(750)).toBe('750,0 мс');
    expect(formatMs(1320)).toBe('1,32 с');

    expect(formatDuration(42)).toBe('42 с');
    expect(formatDuration(3321.993)).toBe('55 мин 22 с');
    expect(formatDuration(7380)).toBe('2 ч 3 мин');

    expect(formatPercent(0.0483)).toBe('4,8 %');
    expect(formatPercent(null)).toBe('—');

    expect(formatCount(1234).replace(/\u00a0|\u202f/g, ' ')).toBe('1 234');
    expect(formatCount(null)).toBe('—');
  });

  it('печатает время с секундами', () => {
    expect(formatClock(0)).toBe('—');
    expect(formatClock(Date.UTC(2026, 0, 2, 14, 32, 5))).toMatch(/^\d{2}:\d{2}:05$/);
  });
});

describe('пульт: плотность и разметка', () => {
  it('показывает плитки и панели в объёме, который обещан браузерной проверке', async () => {
    platform();
    renderPulse();

    // Ждём первые числа, чтобы экран был в рабочем состоянии, а не в скелетонах.
    expect(await within(panel('pulse-kpis')).findByText('55 мин 22 с')).toBeInTheDocument();

    const kpis = document.querySelectorAll('[data-admin-kpi]');
    const panels = document.querySelectorAll('[data-admin-panel]');
    const promised = densityOf(SECTION);
    expect(kpis.length).toBeGreaterThanOrEqual(promised.kpis);
    expect(panels.length).toBeGreaterThanOrEqual(promised.panels);
    // Реестр обещает минимум, а раздел показывает больше: 12 плиток и 13 панелей.
    expect(kpis.length).toBe(12);
    expect(panels.length).toBe(13);
  });

  it('держит каждую таблицу в контейнере с собственной прокруткой', async () => {
    platform();
    renderPulse();

    expect(await within(panel('pulse-routes')).findByText('account-service')).toBeInTheDocument();

    const tables = Array.from(document.querySelectorAll('table'));
    expect(tables.length).toBeGreaterThanOrEqual(5);
    for (const table of tables) {
      // `relative` обязателен: без него sr-only-подпись таблицы растягивает документ
      // на телефоне, и это уже ловили в других разделах.
      expect(table.parentElement?.className).toContain('relative');
      expect(table.parentElement?.className).toContain('overflow-x-auto');
      expect(table.querySelector('caption.sr-only')).not.toBeNull();
    }
  });

  it('не пишет «только для чтения» и не помечает изменяющих действий', async () => {
    platform();
    renderPulse(false);

    expect(await within(panel('pulse-kpis')).findByText('55 мин 22 с')).toBeInTheDocument();

    // Баннер рисует оболочка админки (AdminLayout); раздел с таким текстом валит проверку.
    expect(document.body.textContent ?? '').not.toMatch(/только для чтения/i);
    expect(document.querySelectorAll('[data-admin-readonly-banner]')).toHaveLength(0);
    // Изменяющих действий у раздела нет вовсе.
    expect(document.querySelectorAll('[data-admin-write]')).toHaveLength(0);
  });
});

describe('пульт: числа из выдачи', () => {
  it('показывает итоги шлюза в плитках', async () => {
    platform();
    renderPulse();

    const kpis = panel('pulse-kpis');
    expect(await within(kpis).findByText('107')).toBeInTheDocument();
    expect(within(kpis).getByText('36,2 мс')).toBeInTheDocument();
    expect(within(kpis).getByText('750,0 мс')).toBeInTheDocument();
    expect(within(kpis).getByText('90,6 МБ / 5,7 ГБ')).toBeInTheDocument();
    expect(within(kpis).getByText('55 мин 22 с')).toBeInTheDocument();
    expect(within(kpis).getByText('929,4 ГБ')).toBeInTheDocument();
    // Redis: 434 EVALSHA + 350 INFO.
    expect(within(kpis).getByText('784')).toBeInTheDocument();
    // Маршрутов: spring_cloud_gateway_routes_count = 9.
    expect(within(kpis).getByText('9')).toBeInTheDocument();
    // Подпись плитки прямо говорит, что счётчики кумулятивные.
    expect(within(kpis).getByText(/с момента старта шлюза/)).toBeInTheDocument();
  });

  it('показывает среднюю задержку по каждому маршруту, а не одну на всех', async () => {
    platform();
    renderPulse();

    const routes = panel('pulse-routes');
    expect(await within(routes).findByText('account-service')).toBeInTheDocument();

    // 1,7715 с на 69 запросов, 0,615 с на 3 — маршруты разные, и средние разные.
    expect(within(routes).getByText('25,7 мс')).toBeInTheDocument();
    expect(within(routes).getByText('46,3 мс')).toBeInTheDocument();
    expect(within(routes).getByText('205,0 мс')).toBeInTheDocument();
    // В подвале таблицы — общая средняя по шлюзу, и она подписана именно так.
    expect(within(routes).getByText('по шлюзу: 36,2 мс')).toBeInTheDocument();
    // Серия без кода ответа не приписана ни к успехам, ни к ошибкам.
    expect(within(routes).getByText('без кода ответа: 5')).toBeInTheDocument();
  });

  it('фильтрует маршруты рейлом и поиском', async () => {
    platform();
    const user = userEvent.setup();
    renderPulse();

    const routes = panel('pulse-routes');
    expect(await within(routes).findByText('account-service')).toBeInTheDocument();

    await user.click(within(routes).getByRole('button', { name: /Есть 5xx/ }));
    expect(within(routes).queryByText('account-service')).toBeNull();
    expect(within(routes).getByText('payment-service')).toBeInTheDocument();
    expect(within(routes).getByText(/Итого: 1 из 4 маршрутов/)).toBeInTheDocument();

    await user.click(within(routes).getByRole('button', { name: /Все маршруты/ }));
    await user.type(screen.getByLabelText(/Фильтр по маршрутам/), 'qtime');
    expect(within(routes).getByText('qtime-service')).toBeInTheDocument();
    expect(within(routes).queryByText('payment-service')).toBeNull();
  });

  it('раскладывает ответы по кодам и показывает коды, которых не было', async () => {
    platform();
    renderPulse();

    const codes = panel('pulse-codes');
    expect(await within(codes).findByText('200 — успех')).toBeInTheDocument();

    // Кольцо отдаёт свою легенду с числами, а в центре — сумма ответов с кодом.
    const donut = within(codes).getByRole('img', { name: 'ответов с кодом' });
    expect(donut).toBeInTheDocument();
    expect(within(codes).getByText('102')).toBeInTheDocument();
    expect(within(codes).getByText('200 — успешные ответы')).toBeInTheDocument();
    expect(within(codes).getByText(/5xx — ошибки шлюза или сервиса: 500/)).toBeInTheDocument();
    // 401 в счётчике маршрутов нет ни разу, но строка всё равно на месте.
    expect(within(codes).getByText('401 — без токена')).toBeInTheDocument();
    // Отказы до маршрутизации видны в ответах самого шлюза.
    expect(within(codes).getByText('код 401')).toBeInTheDocument();
    expect(within(codes).queryByText(/Серий http_server_requests/)).toBeNull();
  });

  it('показывает топ путей с оговоркой про шаблоны', async () => {
    platform();
    renderPulse();

    const paths = panel('pulse-paths');
    expect(await within(paths).findByText('/api/v1/payments/{id}')).toBeInTheDocument();
    expect(within(paths).getByText('UNKNOWN')).toBeInTheDocument();
    expect(within(paths).getByText(/Пути приходят шаблонами/)).toBeInTheDocument();
  });

  it('показывает ресурсы, Redis, пулы, журнал и защиты', async () => {
    platform();
    renderPulse();

    const resources = panel('pulse-resources');
    expect(await within(resources).findByText('Память JVM')).toBeInTheDocument();
    // Nonheap максимум JVM отдаёт как -1: это «без предела», а не минус один байт.
    expect(within(resources).getByText('без предела (JVM отдаёт −1)')).toBeInTheDocument();
    expect(within(resources).getByText('49,0 мс')).toBeInTheDocument();
    expect(within(resources).getByText('92,3 %')).toBeInTheDocument();

    const redis = panel('pulse-redis');
    expect(within(redis).getByText('EVALSHA')).toBeInTheDocument();
    expect(within(redis).getByText('434')).toBeInTheDocument();
    expect(within(redis).getByText('1,3 мс')).toBeInTheDocument();

    const pools = panel('pulse-pools');
    expect(within(pools).getByText('applicationTaskExecutor')).toBeInTheDocument();
    // Предел пула — Integer.MAX_VALUE, то есть «без предела».
    expect(within(pools).getByText('без предела')).toBeInTheDocument();

    const logs = panel('pulse-logs');
    expect(within(logs).getByText('error')).toBeInTheDocument();
    expect(within(logs).getByText(/Всего записей: 49/)).toBeInTheDocument();
    expect(within(logs).getByText(/а не за последний час/)).toBeInTheDocument();

    const clients = panel('pulse-clients');
    expect(within(clients).getByText('22,1 мс')).toBeInTheDocument();
    expect(within(clients).getByText('859')).toBeInTheDocument();
    expect(within(clients).getByText(/нет метки со статусом/)).toBeInTheDocument();
  });

  it('показывает состояние шлюза отдельным запросом', async () => {
    platform();
    renderPulse();

    const health = panel('pulse-health');
    expect(await within(health).findByText('UP')).toBeInTheDocument();
    expect(within(health).getByText('шлюз отвечает')).toBeInTheDocument();
    // Деталей шлюз не отдал — так и написано, без выдуманных проверок.
    expect(within(health).getByText('Шлюз ответил без детализации')).toBeInTheDocument();
  });

  it('прямо говорит, чего в метриках нет', async () => {
    platform();
    renderPulse();

    const gaps = panel('pulse-gaps');
    // Текст лежит внутри <b>, поэтому подходит и жирный фрагмент, и весь пункт списка.
    expect(within(gaps).getAllByText(/Метрик Kafka, outbox и DLT нет ни одной серии/).length).toBeGreaterThan(0);
    expect(within(gaps).getAllByText(/Prometheus-сервера и Grafana в проекте нет/).length).toBeGreaterThan(0);
    expect(within(gaps).getByRole('link', { name: 'Платежи и возвраты' })).toHaveAttribute(
      'href',
      '/admin/payments',
    );
  });
});

describe('пульт: обновление и ошибки', () => {
  it('сообщает время последнего ответа и умеет останавливать обновление', async () => {
    platform();
    const user = userEvent.setup();
    renderPulse();

    // Пока данных нет, времени ответа тоже нет: ждём первые числа, потом смотрим на часы.
    expect(await within(panel('pulse-kpis')).findByText('55 мин 22 с')).toBeInTheDocument();
    expect(screen.getByText(/Живое обновление каждые 15 с/)).toBeInTheDocument();
    expect(screen.getByText(/^Обновлено в/)).toBeInTheDocument();
    expect(screen.getByText(/^\d{2}:\d{2}:\d{2}$/)).toBeInTheDocument();

    await user.click(screen.getByLabelText('Остановить обновление'));
    expect(screen.getByText('Обновление остановлено')).toBeInTheDocument();

    await user.click(screen.getByLabelText('Остановить обновление'));
    expect(screen.getByText(/Живое обновление каждые 15 с/)).toBeInTheDocument();
  });

  it('по кнопке «Обновить» делает ровно один запрос метрик и обновляет JSON', async () => {
    const fetches = platform();
    const user = userEvent.setup();
    renderPulse();

    expect(await within(panel('pulse-kpis')).findByText('55 мин 22 с')).toBeInTheDocument();
    const afterLoad = fetches.mock.calls.filter(([url]) => String(url).startsWith('/actuator/prometheus')).length;
    expect(afterLoad).toBe(1);

    await user.click(screen.getByRole('button', { name: 'Обновить' }));

    // Тринадцать панелей обновляются одним запросом: одновременные обращения склеиваются.
    const afterRefresh = fetches.mock.calls.filter(([url]) => String(url).startsWith('/actuator/prometheus')).length;
    expect(afterRefresh).toBe(2);
  });

  it('копирует JSON метрик в буфер', async () => {
    platform();
    // `userEvent.setup()` сам подменяет `navigator.clipboard`, поэтому свой стаб ставим
    // после него — иначе нажатие уходит в чужую реализацию и проверить нечего.
    const user = userEvent.setup();
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    renderPulse();

    expect(await within(panel('pulse-kpis')).findByText('55 мин 22 с')).toBeInTheDocument();
    const button = screen.getByRole('button', { name: 'Скопировать JSON метрик' });
    expect(button).toBeEnabled();
    await user.click(button);

    expect(writeText).toHaveBeenCalledTimes(1);
    const payload = JSON.parse(String(writeText.mock.calls[0][0])) as {
      source: string;
      totals: { requests: number };
      routes: unknown[];
    };
    expect(payload.source).toBe('/actuator/prometheus');
    expect(payload.totals.requests).toBe(107);
    expect(payload.routes).toHaveLength(4);
    expect(screen.getByRole('button', { name: 'JSON скопирован' })).toBeInTheDocument();
  });

  it('закрытые метрики не гасят панель живости шлюза', async () => {
    stubFetch((url): MockResponse => {
      if (url.startsWith('/actuator/prometheus')) {
        return prometheusResponse(JSON.stringify({ code: 'UNAUTHORIZED', detail: 'Требуется вход' }), 401);
      }
      if (url.startsWith('/actuator/health')) {
        return jsonResponse({ status: 'UP' });
      }
      return problemResponse({ code: 'NOT_FOUND', detail: 'нет такого пути' }, 404);
    });
    renderPulse();

    // Каждая метрическая панель живёт своей ошибкой и предлагает повтор…
    expect(await screen.findAllByText('Метрики шлюза не прочитаны')).toHaveLength(10);
    // …а плитки остаются на месте и честно говорят, что данных нет.
    expect(document.querySelectorAll('[data-admin-kpi]')).toHaveLength(12);
    expect(screen.getAllByText('нет данных').length).toBeGreaterThanOrEqual(12);
    expect(screen.getAllByText('Сессия истекла — войдите заново').length).toBeGreaterThan(0);

    // Шлюз при этом отвечает: отдельный запрос не зависит от метрик.
    expect(await screen.findByText('UP')).toBeInTheDocument();
    expect(document.querySelectorAll('[data-admin-panel]').length).toBeGreaterThanOrEqual(5);
  });

  it('недоступный health не мешает метрикам', async () => {
    platform({
      health: { ok: false, status: 502, headers: new Headers(), text: async () => '<html>502 Bad Gateway</html>' },
    });
    renderPulse();

    expect(await screen.findByText('Состояние шлюза не получено')).toBeInTheDocument();
    // Метрики пришли и показаны как обычно.
    expect(await within(panel('pulse-kpis')).findByText('55 мин 22 с')).toBeInTheDocument();
    expect(within(panel('pulse-kpis')).getByText('107')).toBeInTheDocument();
  });
});
