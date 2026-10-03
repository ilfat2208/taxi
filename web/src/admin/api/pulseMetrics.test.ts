import { beforeEach, describe, expect, it } from 'vitest';
import { gatewayRouteMetrics, parsePrometheus } from './gatewayMetrics';
import {
  appendPulseSample,
  buildPulseMetrics,
  clientCallRows,
  fetchPulseMetrics,
  fetchPulseText,
  jvmThreads,
  memoryAreas,
  poolRows,
  pulseSecurity,
  pulseTotals,
  resetPulseTextCache,
  routeLoadRows,
  serverStatusRows,
  statusBreakdown,
  trendPoints,
  type PulseSample,
} from './pulseMetrics';
import { stubFetch, type MockResponse } from '../../test/utils';

/**
 * Разбор метрик пульта.
 *
 * Выдача взята с живого шлюза (`/actuator/prometheus`, 85 серий) и укорочена до
 * четырёх маршрутов, трёх кодов ответа, одной 5xx и служебных серий — так тест
 * остаётся читаемым, но числа в нём настоящие: подставлять выдуманные значения
 * здесь нельзя, иначе тест перестанет ловить ошибки разбора.
 *
 * Главное свойство, ради которого модуль и существует, проверяется первым тестом:
 * средняя задержка считается по каждому маршруту, а не одна на всех.
 */
const SAMPLE = `
# HELP spring_cloud_gateway_requests_seconds
# TYPE spring_cloud_gateway_requests_seconds summary
spring_cloud_gateway_requests_seconds_count{application="api-gateway",httpMethod="GET",httpStatusCode="200",outcome="SUCCESSFUL",routeId="account-service",routeUri="http://account-service:8081",status="OK"} 68
spring_cloud_gateway_requests_seconds_sum{application="api-gateway",httpMethod="GET",httpStatusCode="200",outcome="SUCCESSFUL",routeId="account-service",routeUri="http://account-service:8081",status="OK"} 1.678975018
spring_cloud_gateway_requests_seconds_max{application="api-gateway",httpMethod="GET",httpStatusCode="200",outcome="SUCCESSFUL",routeId="account-service",routeUri="http://account-service:8081",status="OK"} 0.02163394
spring_cloud_gateway_requests_seconds_count{application="api-gateway",httpMethod="GET",httpStatusCode="404",outcome="CLIENT_ERROR",routeId="account-service",routeUri="http://account-service:8081",status="NOT_FOUND"} 1
spring_cloud_gateway_requests_seconds_sum{application="api-gateway",httpMethod="GET",httpStatusCode="404",outcome="CLIENT_ERROR",routeId="account-service",routeUri="http://account-service:8081",status="NOT_FOUND"} 0.092516672
spring_cloud_gateway_requests_seconds_max{application="api-gateway",httpMethod="GET",httpStatusCode="404",outcome="CLIENT_ERROR",routeId="account-service",routeUri="http://account-service:8081",status="NOT_FOUND"} 0.0
spring_cloud_gateway_requests_seconds_count{application="api-gateway",httpMethod="GET",httpStatusCode="200",outcome="SUCCESSFUL",routeId="catalog-service",routeUri="http://catalog-service:8083",status="OK"} 29
spring_cloud_gateway_requests_seconds_sum{application="api-gateway",httpMethod="GET",httpStatusCode="200",outcome="SUCCESSFUL",routeId="catalog-service",routeUri="http://catalog-service:8083",status="OK"} 1.359909487
spring_cloud_gateway_requests_seconds_max{application="api-gateway",httpMethod="GET",httpStatusCode="200",outcome="SUCCESSFUL",routeId="catalog-service",routeUri="http://catalog-service:8083",status="OK"} 0.032229904
spring_cloud_gateway_requests_seconds_count{application="api-gateway",httpMethod="GET",httpStatusCode="405",outcome="CLIENT_ERROR",routeId="catalog-service",routeUri="http://catalog-service:8083",status="METHOD_NOT_ALLOWED"} 1
spring_cloud_gateway_requests_seconds_sum{application="api-gateway",httpMethod="GET",httpStatusCode="405",outcome="CLIENT_ERROR",routeId="catalog-service",routeUri="http://catalog-service:8083",status="METHOD_NOT_ALLOWED"} 0.028728972
spring_cloud_gateway_requests_seconds_max{application="api-gateway",httpMethod="GET",httpStatusCode="405",outcome="CLIENT_ERROR",routeId="catalog-service",routeUri="http://catalog-service:8083",status="METHOD_NOT_ALLOWED"} 0.0
spring_cloud_gateway_requests_seconds_count{application="api-gateway",httpMethod="POST",httpStatusCode="403",outcome="CLIENT_ERROR",routeId="payment-service",routeUri="http://payment-service:8082",status="FORBIDDEN"} 2
spring_cloud_gateway_requests_seconds_sum{application="api-gateway",httpMethod="POST",httpStatusCode="403",outcome="CLIENT_ERROR",routeId="payment-service",routeUri="http://payment-service:8082",status="FORBIDDEN"} 0.115113223
spring_cloud_gateway_requests_seconds_max{application="api-gateway",httpMethod="POST",httpStatusCode="403",outcome="CLIENT_ERROR",routeId="payment-service",routeUri="http://payment-service:8082",status="FORBIDDEN"} 0.0
spring_cloud_gateway_requests_seconds_count{application="api-gateway",httpMethod="POST",httpStatusCode="500",outcome="SERVER_ERROR",routeId="payment-service",routeUri="http://payment-service:8082",status="INTERNAL_SERVER_ERROR"} 1
spring_cloud_gateway_requests_seconds_sum{application="api-gateway",httpMethod="POST",httpStatusCode="500",outcome="SERVER_ERROR",routeId="payment-service",routeUri="http://payment-service:8082",status="INTERNAL_SERVER_ERROR"} 0.5
spring_cloud_gateway_requests_seconds_max{application="api-gateway",httpMethod="POST",httpStatusCode="500",outcome="SERVER_ERROR",routeId="payment-service",routeUri="http://payment-service:8082",status="INTERNAL_SERVER_ERROR"} 0.75
spring_cloud_gateway_requests_seconds_count{application="api-gateway",routeId="qtime-service",routeUri="http://qtime-service:8088"} 5
spring_cloud_gateway_requests_seconds_sum{application="api-gateway",routeId="qtime-service",routeUri="http://qtime-service:8088"} 0.1
spring_cloud_gateway_requests_seconds_max{application="api-gateway",routeId="qtime-service",routeUri="http://qtime-service:8088"} 0.05
spring_cloud_gateway_routes_count{application="api-gateway"} 9.0
http_server_requests_seconds_count{application="api-gateway",method="GET",outcome="SUCCESS",status="200",uri="/actuator/health"} 350
http_server_requests_seconds_count{application="api-gateway",method="GET",outcome="SUCCESS",status="200",uri="UNKNOWN"} 14
http_server_requests_seconds_count{application="api-gateway",method="GET",outcome="CLIENT_ERROR",status="404",uri="/**"} 1
http_server_requests_seconds_count{application="api-gateway",method="GET",outcome="CLIENT_ERROR",status="404",uri="NOT_FOUND"} 14
http_server_requests_seconds_count{application="api-gateway",method="GET",outcome="CLIENT_ERROR",status="401",uri="UNKNOWN"} 1
http_client_requests_seconds_count{application="api-gateway",error="none",http_method="GET",http_status_code="200",spring_cloud_gateway_route_id="account-service",spring_cloud_gateway_route_uri="http://account-service:8081"} 68
http_client_requests_seconds_sum{application="api-gateway",error="none",http_method="GET",http_status_code="200",spring_cloud_gateway_route_id="account-service",spring_cloud_gateway_route_uri="http://account-service:8081"} 1.5
http_client_requests_seconds_max{application="api-gateway",error="none",http_method="GET",http_status_code="200",spring_cloud_gateway_route_id="account-service",spring_cloud_gateway_route_uri="http://account-service:8081"} 0.02
http_client_requests_seconds_count{application="api-gateway",error="none",http_method="POST",http_status_code="500",spring_cloud_gateway_route_id="payment-service",spring_cloud_gateway_route_uri="http://payment-service:8082"} 2
http_client_requests_seconds_sum{application="api-gateway",error="none",http_method="POST",http_status_code="500",spring_cloud_gateway_route_id="payment-service",spring_cloud_gateway_route_uri="http://payment-service:8082"} 0.4
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
jvm_gc_pause_seconds_count{action="end of minor GC",application="api-gateway",cause="G1 Evacuation Pause",gc="G1 Young Generation"} 7
jvm_gc_pause_seconds_sum{action="end of minor GC",application="api-gateway",cause="G1 Evacuation Pause",gc="G1 Young Generation"} 0.043
jvm_gc_pause_seconds_count{action="end of minor GC",application="api-gateway",cause="Metadata GC Threshold",gc="G1 Young Generation"} 1
jvm_gc_pause_seconds_sum{action="end of minor GC",application="api-gateway",cause="Metadata GC Threshold",gc="G1 Young Generation"} 0.006
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
lettuce_command_completion_seconds_count{application="api-gateway",command="EVALSHA",local="local:any",remote="redis/172.20.0.10:6379"} 434
lettuce_command_completion_seconds_sum{application="api-gateway",command="EVALSHA",local="local:any",remote="redis/172.20.0.10:6379"} 0.572423388
lettuce_command_completion_seconds_max{application="api-gateway",command="EVALSHA",local="local:any",remote="redis/172.20.0.10:6379"} 0.005278707
lettuce_command_completion_seconds_count{application="api-gateway",command="INFO",local="local:any",remote="redis/172.20.0.10:6379"} 350
lettuce_command_completion_seconds_sum{application="api-gateway",command="INFO",local="local:any",remote="redis/172.20.0.10:6379"} 0.133217416
lettuce_command_completion_seconds_max{application="api-gateway",command="INFO",local="local:any",remote="redis/172.20.0.10:6379"} 6.28038E-4
executor_active_threads{application="api-gateway",name="applicationTaskExecutor"} 0.0
executor_completed_tasks_total{application="api-gateway",name="applicationTaskExecutor"} 0.0
executor_pool_core_threads{application="api-gateway",name="applicationTaskExecutor"} 8.0
executor_pool_max_threads{application="api-gateway",name="applicationTaskExecutor"} 2.147483647E9
executor_pool_size_threads{application="api-gateway",name="applicationTaskExecutor"} 0.0
executor_queue_remaining_tasks{application="api-gateway",name="applicationTaskExecutor"} 2.147483647E9
executor_queued_tasks{application="api-gateway",name="applicationTaskExecutor"} 0.0
spring_security_http_secured_requests_seconds_count{application="api-gateway",error="none"} 859
spring_security_authorizations_seconds_count{application="api-gateway",error="none",spring_security_authentication_type="JwtAuthenticationToken",spring_security_authorization_decision="true",spring_security_object="exchange"} 400
spring_security_authorizations_seconds_count{application="api-gateway",error="AccessDeniedException",spring_security_authentication_type="n/a",spring_security_authorization_decision="false",spring_security_object="exchange"} 1
`;

const samples = parsePrometheus(SAMPLE);

function prometheusResponse(text: string, status = 200): MockResponse {
  return { ok: status >= 200 && status < 300, status, headers: new Headers(), text: async () => text };
}

beforeEach(() => {
  resetPulseTextCache();
});

describe('пульт: средняя задержка на маршрут', () => {
  it('считает среднюю по каждому маршруту, а не одну общую на всех', () => {
    const rows = routeLoadRows(samples);
    const account = rows.find((row) => row.routeId === 'account-service');
    const catalog = rows.find((row) => row.routeId === 'catalog-service');

    // 1.7715 с на 69 запросов и 1.3886 с на 30 — это разные сервисы и разные задержки.
    expect(account?.averageMs).toBeCloseTo(25.67, 1);
    expect(catalog?.averageMs).toBeCloseTo(46.29, 1);
    expect(account?.averageMs).not.toBeCloseTo(catalog!.averageMs!, 0);

    // А готовая функция из `gatewayMetrics` отдаёт ОДНО значение на все маршруты:
    // шлюз складывает `_sum` и `_count` по всем сериям, и получается средняя по шлюзу.
    // Именно поэтому здесь свой расчёт, и эта проверка держит причину на виду.
    const shared = gatewayRouteMetrics(samples);
    expect(new Set(shared.map((row) => row.averageMs)).size).toBe(1);
    expect(shared[0].averageMs).toBeCloseTo(36.22, 1);
  });

  it('сортирует маршруты по нагрузке и считает долю от общего числа запросов', () => {
    const rows = routeLoadRows(samples);

    expect(rows.map((row) => row.routeId)).toEqual([
      'account-service',
      'catalog-service',
      'qtime-service',
      'payment-service',
    ]);
    expect(rows.map((row) => row.requests)).toEqual([69, 30, 5, 3]);

    const share = rows.reduce((total, row) => total + row.share, 0);
    expect(share).toBeCloseTo(1, 6);
    expect(rows[0].share).toBeCloseTo(0.645, 3);
    expect(rows[0].routeUri).toBe('http://account-service:8081');
  });

  it('раскладывает ответы маршрута на успешные, 4xx, 5xx и серии без кода', () => {
    const rows = routeLoadRows(samples);
    const payment = rows.find((row) => row.routeId === 'payment-service');
    const qtime = rows.find((row) => row.routeId === 'qtime-service');

    expect(payment).toMatchObject({ requests: 3, successes: 0, clientErrors: 2, serverErrors: 1, uncoded: 0 });
    expect(payment?.maxMs).toBeCloseTo(750, 3);
    // Серия без `httpStatusCode` — не успех и не ошибка: ей нельзя приписать исход.
    expect(qtime).toMatchObject({ requests: 5, successes: 0, clientErrors: 0, serverErrors: 0, uncoded: 5 });
    expect(qtime?.averageMs).toBeCloseTo(20, 1);
  });
});

describe('пульт: коды ответов', () => {
  it('показывает отслеживаемые коды всегда, а 5xx — одной суммой', () => {
    const breakdown = statusBreakdown(samples);

    expect(breakdown.rows.map((row) => row.key)).toEqual(['200', '401', '403', '404', '405', '5xx']);
    expect(breakdown.rows.map((row) => row.requests)).toEqual([97, 0, 2, 1, 1, 1]);
    // 401 в выдаче нет ни разу: счётчики кумулятивные, значит таких ответов не было.
    expect(breakdown.rows[1].title).toContain('401');
    // В строке 5xx видно, из каких именно кодов она сложилась.
    expect(breakdown.rows[5].title).toContain('500');
    expect(breakdown.coded).toBe(102);
    expect(breakdown.uncoded).toBe(5);
  });

  it('суммирует ответы самого шлюза по коду, а не по пути', () => {
    const rows = serverStatusRows(samples);

    expect(rows).toEqual([
      { status: 200, requests: 364 },
      { status: 404, requests: 15 },
      { status: 401, requests: 1 },
    ]);
  });

  it('отличает «серия не пришла» от нуля', () => {
    // Счётчика маршрутов в выдаче нет: это не «ноль маршрутов», а «не измерено»,
    // поэтому итог честно остаётся пустым, а не превращается в 0. Суммы времени тоже
    // нет — значит и средней нет: «0 мс» означало бы мгновенные ответы.
    const totals = pulseTotals(
      parsePrometheus('spring_cloud_gateway_requests_seconds_count{routeId="trip-service"} 4\n'),
    );

    expect(totals.requests).toBe(4);
    expect(totals.routeCount).toBeNull();
    expect(totals.observedRoutes).toBe(1);
    expect(totals.averageMs).toBeNull();
  });

  it('строит полный набор чисел из одной выдачи', () => {
    const metrics = buildPulseMetrics(SAMPLE);

    expect(metrics.samples).toBeGreaterThan(50);
    expect(metrics.totals).toMatchObject({
      requests: 107,
      successes: 97,
      clientErrors: 4,
      serverErrors: 1,
      uncoded: 5,
      routeCount: 9,
      observedRoutes: 4,
    });
    expect(metrics.totals.averageMs).toBeCloseTo(36.22, 1);
    expect(metrics.totals.maxMs).toBeCloseTo(750, 3);
    expect(metrics.logs).toEqual({ error: 2, warn: 1, info: 46, debug: 0, trace: 0 });
  });
});

describe('пульт: ресурсы, Redis и пулы', () => {
  it('складывает память по областям и не выдаёт -1 за предел', () => {
    const memory = memoryAreas(samples);

    expect(memory.heap.usedBytes).toBe(94_964_696);
    expect(memory.heap.committedBytes).toBe(150_994_944);
    expect(memory.heap.maxBytes).toBe(6_132_072_448);
    // У nonheap максимум `-1`: JVM его не ограничивает — это «предела нет», а не «ноль».
    expect(memory.nonHeap.usedBytes).toBe(66_959_152);
    expect(memory.nonHeap.maxBytes).toBeNull();
  });

  it('показывает потоки и их состояния', () => {
    const threads = jvmThreads(samples);

    expect(threads).toMatchObject({ live: 43, daemon: 41, peak: 43 });
    expect(threads.states).toEqual([
      { state: 'runnable', title: 'работают', threads: 18 },
      { state: 'blocked', title: 'заблокированы', threads: 0 },
      { state: 'waiting', title: 'ждут', threads: 21 },
      { state: 'timed-waiting', title: 'ждут с таймаутом', threads: 4 },
    ]);
  });

  it('дополняет пул потоков ядром, размером и остатком очереди', () => {
    const pools = poolRows(samples);

    expect(pools).toHaveLength(1);
    expect(pools[0]).toMatchObject({
      pool: 'applicationTaskExecutor',
      active: 0,
      queued: 0,
      completed: 0,
      core: 8,
      size: 0,
    });
    // Верхняя граница пула — Integer.MAX_VALUE, то есть «без предела», а не 2 млрд потоков.
    expect(pools[0].max).toBe(2_147_483_647);
    expect(pools[0].queueRemaining).toBe(2_147_483_647);
  });

  it('считает вызовы шлюза к сервисам по маршрутам и кодам', () => {
    const rows = clientCallRows(samples);

    expect(rows.map((row) => row.routeId)).toEqual(['account-service', 'payment-service']);
    expect(rows[0]).toMatchObject({ calls: 68, clientErrors: 0, serverErrors: 0 });
    expect(rows[0].averageMs).toBeCloseTo(22.06, 1);
    expect(rows[0].routeUri).toBe('http://account-service:8081');
    // У исходящих вызовов метка кода называется `http_status_code` — её тоже надо понять.
    expect(rows[1]).toMatchObject({ calls: 2, clientErrors: 0, serverErrors: 2, uncoded: 0 });
  });

  it('показывает решения авторизации и число запросов через фильтр безопасности', () => {
    expect(pulseSecurity(samples)).toEqual({ securedRequests: 859, granted: 400, denied: 1 });
  });
});

describe('пульт: один запрос метрик на весь экран', () => {
  it('склеивает одновременные обращения панелей в один запрос', async () => {
    const fetches = stubFetch(() => prometheusResponse(SAMPLE));

    const [first, second, third] = await Promise.all([fetchPulseText(), fetchPulseText(), fetchPulseText()]);

    expect(fetches).toHaveBeenCalledTimes(1);
    expect(first).toBe(SAMPLE);
    expect(second).toBe(SAMPLE);
    expect(third).toBe(SAMPLE);
  });

  it('переиспользует только что полученную выдачу и умеет её забывать', async () => {
    const fetches = stubFetch(() => prometheusResponse(SAMPLE));

    await fetchPulseText();
    await fetchPulseText();
    expect(fetches).toHaveBeenCalledTimes(1);

    resetPulseTextCache();
    await fetchPulseText();
    expect(fetches).toHaveBeenCalledTimes(2);
  });

  it('отдаёт готовые таблицы из одной выдачи', async () => {
    stubFetch(() => prometheusResponse(SAMPLE));

    const metrics = await fetchPulseMetrics();
    expect(metrics.totals.requests).toBe(107);
  });

  it('пробрасывает 401 без токена: метрики закрыты, а не пусты', async () => {
    stubFetch(() =>
      prometheusResponse(JSON.stringify({ code: 'UNAUTHORIZED', detail: 'Требуется вход' }), 401),
    );

    await expect(fetchPulseMetrics()).rejects.toMatchObject({ status: 401 });
  });

  it('не считает метриками ответ без единой серии', async () => {
    // Пустое тело — это не «ноль серий», а не тот ответ: шлюз отдал не метрики.
    stubFetch(() => prometheusResponse('', 200));

    await expect(fetchPulseMetrics()).rejects.toBeTruthy();
  });
});

describe('пульт: ряд за время открытия экрана', () => {
  it('не пишет один и тот же ответ дважды и держит только последние замеры', () => {
    const history: PulseSample[] = [{ at: 1_000, requests: 10, errors: 1 }];

    expect(appendPulseSample(history, { at: 1_000, requests: 10, errors: 1 })).toBe(history);

    const grown = appendPulseSample(history, { at: 2_000, requests: 14, errors: 1 }, 2);
    expect(grown.map((sample) => sample.at)).toEqual([1_000, 2_000]);

    const capped = appendPulseSample(grown, { at: 3_000, requests: 20, errors: 2 }, 2);
    expect(capped.map((sample) => sample.at)).toEqual([2_000, 3_000]);
  });

  it('считает прирост между замерами и помечает перезапуск шлюза', () => {
    const points = trendPoints([
      { at: 1_000, requests: 100, errors: 3 },
      { at: 2_000, requests: 140, errors: 5 },
      // Счётчик упал: шлюз перезапустился, за этот интервал прирост неизвестен.
      { at: 3_000, requests: 40, errors: 1 },
      { at: 4_000, requests: 60, errors: 2 },
    ]);

    expect(points).toEqual([
      { at: 2_000, requests: 40, errors: 2, reset: false },
      { at: 3_000, requests: 0, errors: 0, reset: true },
      { at: 4_000, requests: 20, errors: 1, reset: false },
    ]);
  });
});
