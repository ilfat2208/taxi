/**
 * Метрики API-шлюза для разделов «Пульт» и «Обзор».
 *
 * Источник — `/actuator/prometheus` шлюза: одна выдача, в которой лежат ВСЕ серии сразу.
 * Через `/actuator/metrics/{name}` пришлось бы делать десятки запросов (по одному на каждый
 * набор тегов: `routeId`, `status`, `uri`), и всё равно не было бы видно разбивку по кодам.
 * Текст Prometheus разбирается здесь же, потому что это чистая функция: её можно проверить
 * юнит-тестом на настоящем фрагменте выдачи, а не на живом шлюзе.
 *
 * Путь `/actuator` живёт вне префикса `/api`, поэтому у этого модуля свой `fetch`, как и у
 * `gatewayHealth.ts`. Метрики требуют токен: без него шлюз отвечает 401, и раздел честно
 * скажет, что метрики закрыты, вместо нулей.
 */
import { API_BASE_URL, CORRELATION_HEADER } from '../../api/client';
import { toApiError } from '../../api/errors';
import { getAccessToken } from '../../auth/session';

/** Путь выдачи Prometheus: префикс `/actuator` проксируется отдельно от `/api`. */
export const GATEWAY_PROMETHEUS_PATH = '/actuator/prometheus';

/** Серия Prometheus: имя, метки и значение. */
export interface PrometheusSample {
  name: string;
  labels: Record<string, string>;
  value: number;
}

/**
 * Разбирает текстовый формат Prometheus.
 *
 * Строки `# HELP` и `# TYPE` пропускаются, `_sum`/`_count`/`_bucket` остаются как есть —
 * из них складываются средние и максимумы. Значение берётся последним полем, как в формате:
 * `name{labels} 12.5`, причём метка может содержать `}` и кавычки, поэтому метки разбираются
 * по кавычкам, а не по запятым.
 */
export function parsePrometheus(text: string): PrometheusSample[] {
  const samples: PrometheusSample[] = [];
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (trimmed === '' || trimmed.startsWith('#')) {
      continue;
    }
    const brace = trimmed.indexOf('{');
    const close = trimmed.lastIndexOf('}');
    let name: string;
    let labels: Record<string, string> = {};
    let rest: string;
    if (brace !== -1 && close > brace) {
      name = trimmed.slice(0, brace).trim();
      labels = parseLabels(trimmed.slice(brace + 1, close));
      rest = trimmed.slice(close + 1).trim();
    } else {
      const space = trimmed.indexOf(' ');
      if (space === -1) {
        continue;
      }
      name = trimmed.slice(0, space);
      rest = trimmed.slice(space + 1).trim();
    }
    const value = Number.parseFloat(rest.split(/\s+/)[0] ?? '');
    if (!Number.isFinite(value)) {
      continue;
    }
    samples.push({ name, labels, value });
  }
  return samples;
}

function parseLabels(body: string): Record<string, string> {
  const labels: Record<string, string> = {};
  const pattern = /([a-zA-Z_][a-zA-Z0-9_]*)\s*=\s*"((?:[^"\\]|\\.)*)"/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(body)) !== null) {
    labels[match[1]] = match[2].replace(/\\"/g, '"').replace(/\\\\/g, '\\');
  }
  return labels;
}

/** Сумма значений всех серий с этим именем и подходящими метками. */
export function sumBy(
  samples: PrometheusSample[],
  name: string,
  labels: Record<string, string> = {},
): number {
  return samples
    .filter((sample) => matches(sample, name, labels))
    .reduce((total, sample) => total + sample.value, 0);
}

/** Значение единственной серии: `undefined`, если её нет — это не ноль, а «не измерено». */
export function valueOf(
  samples: PrometheusSample[],
  name: string,
  labels: Record<string, string> = {},
): number | undefined {
  const found = samples.find((sample) => matches(sample, name, labels));
  return found ? found.value : undefined;
}

function matches(sample: PrometheusSample, name: string, labels: Record<string, string>): boolean {
  if (sample.name !== name) {
    return false;
  }
  return Object.entries(labels).every(([key, value]) => sample.labels[key] === value);
}

/** Одна строка таблицы «сколько запросов ушло в сервис и как быстро он отвечал». */
export interface GatewayRouteMetrics {
  routeId: string;
  routeUri: string;
  requests: number;
  /** Ответы 4xx: их считаем отдельно от 5xx — это разные истории. */
  clientErrors: number;
  serverErrors: number;
  /** Средняя длительность ответа в миллисекундах (по `_sum`/`_count` шлюза). */
  averageMs: number | null;
  /** Максимум по таймеру, мс. */
  maxMs: number | null;
  /** Разбивка по HTTP-кодам, по убыванию количества. */
  byStatus: Array<{ status: number; requests: number }>;
}

/**
 * Собирает таблицу по маршрутам шлюза из `spring_cloud_gateway_requests_seconds_*`.
 *
 * Шлюз — единственная точка, через которую идут все вызовы сервисов, поэтому его счётчики
 * честно показывают и нагрузку на сервис, и его ошибки: ничего досчитывать не нужно.
 */
export function gatewayRouteMetrics(samples: PrometheusSample[]): GatewayRouteMetrics[] {
  const rows = new Map<string, GatewayRouteMetrics>();
  const ensure = (routeId: string, routeUri: string): GatewayRouteMetrics => {
    const existing = rows.get(routeId);
    if (existing) {
      return existing;
    }
    const created: GatewayRouteMetrics = {
      routeId,
      routeUri,
      requests: 0,
      clientErrors: 0,
      serverErrors: 0,
      averageMs: null,
      maxMs: null,
      byStatus: [],
    };
    rows.set(routeId, created);
    return created;
  };

  let totalCount = 0;
  let totalTime = 0;

  for (const sample of samples) {
    if (!sample.name.startsWith('spring_cloud_gateway_requests_seconds')) {
      continue;
    }
    const routeId = sample.labels.routeId ?? 'без маршрута';
    const routeUri = sample.labels.routeUri ?? '';
    const row = ensure(routeId, routeUri);
    const statusCode = Number.parseInt(sample.labels.httpStatusCode ?? '', 10);

    if (sample.name.endsWith('_count')) {
      row.requests += sample.value;
      totalCount += sample.value;
      if (Number.isFinite(statusCode) && statusCode >= 400 && statusCode < 500) {
        row.clientErrors += sample.value;
      }
      if (Number.isFinite(statusCode) && statusCode >= 500) {
        row.serverErrors += sample.value;
      }
      if (Number.isFinite(statusCode)) {
        const bucket = row.byStatus.find((entry) => entry.status === statusCode);
        if (bucket) {
          bucket.requests += sample.value;
        } else {
          row.byStatus.push({ status: statusCode, requests: sample.value });
        }
      }
    }
    if (sample.name.endsWith('_sum')) {
      totalTime += sample.value;
    }
    if (sample.name.endsWith('_max')) {
      row.maxMs = Math.max(row.maxMs ?? 0, sample.value * 1000);
    }
  }

  // Среднее по времени считаем из общей суммы и общего количества: у таймера шлюза это
  // ровно то же, что `_sum`/`_count`, и не зависит от того, как разложены серии по меткам.
  const overallAverage = totalCount > 0 ? (totalTime / totalCount) * 1000 : null;
  for (const row of rows.values()) {
    row.averageMs = overallAverage;
    row.byStatus.sort((left, right) => right.requests - left.requests);
  }

  return [...rows.values()].sort((left, right) => right.requests - left.requests);
}

/** Строка таблицы «какой путь шлюза сколько раз спросили и с каким итогом». */
export interface HttpEndpointMetrics {
  uri: string;
  method: string;
  requests: number;
  clientErrors: number;
  serverErrors: number;
}

/** Разбивка `http_server_requests_seconds_count` по пути, методу и коду ответа. */
export function httpEndpointMetrics(samples: PrometheusSample[]): HttpEndpointMetrics[] {
  const rows = new Map<string, HttpEndpointMetrics>();
  for (const sample of samples) {
    if (sample.name !== 'http_server_requests_seconds_count') {
      continue;
    }
    const uri = sample.labels.uri ?? 'неизвестный путь';
    const method = sample.labels.method ?? '';
    const key = `${method} ${uri}`;
    const row = rows.get(key) ?? { uri, method, requests: 0, clientErrors: 0, serverErrors: 0 };
    const statusCode = Number.parseInt(sample.labels.status ?? '', 10);
    row.requests += sample.value;
    if (Number.isFinite(statusCode) && statusCode >= 400 && statusCode < 500) {
      row.clientErrors += sample.value;
    }
    if (Number.isFinite(statusCode) && statusCode >= 500) {
      row.serverErrors += sample.value;
    }
    rows.set(key, row);
  }
  return [...rows.values()].sort((left, right) => right.requests - left.requests);
}

/** Память JVM по областям: heap и nonheap отдельно, потому что значат они разное. */
export interface JvmMemory {
  heapUsedBytes: number;
  heapMaxBytes: number | null;
  heapCommittedBytes: number | null;
  nonHeapUsedBytes: number;
  /** Счётчики сборок мусора: сколько раз и сколько времени, мс. */
  gcCollections: number;
  gcPauseMs: number;
  threadsLive: number | null;
}

export function jvmMemory(samples: PrometheusSample[]): JvmMemory {
  const heapUsed = samples
    .filter((s) => s.name === 'jvm_memory_used_bytes' && s.labels.area === 'heap')
    .reduce((total, s) => total + s.value, 0);
  const nonHeapUsed = samples
    .filter((s) => s.name === 'jvm_memory_used_bytes' && s.labels.area === 'nonheap')
    .reduce((total, s) => total + s.value, 0);
  const heapMax = samples
    .filter((s) => s.name === 'jvm_memory_max_bytes' && s.labels.area === 'heap')
    .reduce((max, s) => Math.max(max, s.value), 0);
  const heapCommitted = samples
    .filter((s) => s.name === 'jvm_memory_committed_bytes' && s.labels.area === 'heap')
    .reduce((total, s) => total + s.value, 0);

  const gcCount = sumBy(samples, 'jvm_gc_pause_seconds_count');
  const gcTime = sumBy(samples, 'jvm_gc_pause_seconds_sum');

  return {
    heapUsedBytes: heapUsed,
    heapMaxBytes: heapMax > 0 ? heapMax : null,
    heapCommittedBytes: heapCommitted > 0 ? heapCommitted : null,
    nonHeapUsedBytes: nonHeapUsed,
    gcCollections: gcCount,
    gcPauseMs: gcTime * 1000,
    threadsLive: valueOf(samples, 'jvm_threads_live_threads') ?? null,
  };
}

/** Процесс шлюза: время работы, процессорное время и загрузка, открытые файлы. */
export interface ProcessMetrics {
  uptimeSeconds: number | null;
  cpuUsage: number | null;
  openFiles: number | null;
  startTimeSeconds: number | null;
}

export function processMetrics(samples: PrometheusSample[]): ProcessMetrics {
  return {
    uptimeSeconds: valueOf(samples, 'process_uptime_seconds') ?? null,
    cpuUsage: valueOf(samples, 'process_cpu_usage') ?? null,
    openFiles: valueOf(samples, 'process_files_open_files') ?? null,
    startTimeSeconds: valueOf(samples, 'process_start_time_seconds') ?? null,
  };
}

/** Хост: сколько ядер, какая загрузка, сколько места на диске. */
export interface SystemMetrics {
  cpuCount: number | null;
  cpuUsage: number | null;
  diskFreeBytes: number | null;
  diskTotalBytes: number | null;
  loadAverage1m: number | null;
}

export function systemMetrics(samples: PrometheusSample[]): SystemMetrics {
  return {
    cpuCount: valueOf(samples, 'system_cpu_count') ?? null,
    cpuUsage: valueOf(samples, 'system_cpu_usage') ?? null,
    diskFreeBytes: valueOf(samples, 'disk_free_bytes') ?? null,
    diskTotalBytes: valueOf(samples, 'disk_total_bytes') ?? null,
    loadAverage1m: valueOf(samples, 'system_load_average_1m') ?? null,
  };
}

/** Записи журнала шлюза по уровням: `logback_events_total{level="error"}`. */
export interface LogEventCounts {
  error: number;
  warn: number;
  info: number;
  debug: number;
  trace: number;
}

export function logEventCounts(samples: PrometheusSample[]): LogEventCounts {
  const level = (name: string) => sumBy(samples, 'logback_events_total', { level: name });
  return {
    error: level('error'),
    warn: level('warn'),
    info: level('info'),
    debug: level('debug'),
    trace: level('trace'),
  };
}

/** Команды Redis: сколько раз и как долго ждали ответа (шлюз держит лимиты в Redis). */
export interface RedisCommandMetrics {
  command: string;
  count: number;
  averageMs: number | null;
  maxMs: number | null;
}

export function redisCommandMetrics(samples: PrometheusSample[]): RedisCommandMetrics[] {
  const rows = new Map<string, RedisCommandMetrics>();
  for (const sample of samples) {
    if (!sample.name.startsWith('lettuce_command_completion_seconds')) {
      continue;
    }
    const command = sample.labels.command ?? sample.labels.cmd ?? 'неизвестная';
    const row = rows.get(command) ?? { command, count: 0, averageMs: null, maxMs: null };
    if (sample.name.endsWith('_count')) {
      row.count += sample.value;
    }
    if (sample.name.endsWith('_sum')) {
      row.averageMs = sample.value * 1000;
    }
    if (sample.name.endsWith('_max')) {
      row.maxMs = Math.max(row.maxMs ?? 0, sample.value * 1000);
    }
    rows.set(command, row);
  }
  return [...rows.values()]
    .map((row) => ({
      ...row,
      averageMs: row.count > 0 && row.averageMs !== null ? row.averageMs / row.count : null,
    }))
    .sort((left, right) => right.count - left.count);
}

/** Пул потоков шлюза: активные, в очереди, всего. Значения без метки `state` не годятся. */
export interface ExecutorMetrics {
  pool: string;
  active: number | null;
  queued: number | null;
  completed: number | null;
  max: number | null;
}

export function executorMetrics(samples: PrometheusSample[]): ExecutorMetrics[] {
  const pools = new Set(
    samples.filter((s) => s.name.startsWith('executor_')).map((s) => s.labels.name ?? 'пул'),
  );
  return [...pools]
    .map((pool) => ({
      pool,
      active: valueOf(samples, 'executor_active_threads', { name: pool }) ?? null,
      queued: valueOf(samples, 'executor_queued_tasks', { name: pool }) ?? null,
      completed: valueOf(samples, 'executor_completed_tasks_total', { name: pool }) ?? null,
      max: valueOf(samples, 'executor_pool_max_threads', { name: pool }) ?? null,
    }))
    .sort((left, right) => left.pool.localeCompare(right.pool));
}

/** Адрес выдачи метрик: тот же разбор абсолютного и относительного `API_BASE_URL`. */
export function gatewayPrometheusUrl(): string {
  const base = API_BASE_URL.replace(/\/+$/, '');
  if (/^https?:\/\//i.test(base)) {
    return `${base.replace(/\/api$/i, '')}${GATEWAY_PROMETHEUS_PATH}`;
  }
  return GATEWAY_PROMETHEUS_PATH;
}

/**
 * Один запрос к `/actuator/prometheus`.
 *
 * Метрики закрыты для анонимных запросов, поэтому 401 — ожидаемый ответ без токена;
 * он превращается в `ApiError` с честным текстом, а раздел показывает «метрики закрыты».
 */
export async function fetchPrometheusText(signal?: AbortSignal): Promise<string> {
  const url = gatewayPrometheusUrl();
  const headers: Record<string, string> = { Accept: 'text/plain' };
  const token = getAccessToken();
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  const response = await fetch(url, { headers, signal, credentials: 'same-origin' });
  const text = await response.text();
  if (!response.ok) {
    throw toApiError(response.status, text, response.headers.get(CORRELATION_HEADER));
  }
  if (!text.includes('#')) {
    throw toApiError(response.status, text, response.headers.get(CORRELATION_HEADER));
  }
  return text;
}

/** Всё, что разделы берут из одной выдачи метрик. */
export interface GatewayMetrics {
  routes: GatewayRouteMetrics[];
  endpoints: HttpEndpointMetrics[];
  jvm: JvmMemory;
  process: ProcessMetrics;
  system: SystemMetrics;
  logs: LogEventCounts;
  redis: RedisCommandMetrics[];
  executors: ExecutorMetrics[];
  /** Сколько серий пришло: по нулю видно, что шлюз не отдал метрики. */
  samples: number;
}

export function buildGatewayMetrics(text: string): GatewayMetrics {
  const samples = parsePrometheus(text);
  return {
    routes: gatewayRouteMetrics(samples),
    endpoints: httpEndpointMetrics(samples),
    jvm: jvmMemory(samples),
    process: processMetrics(samples),
    system: systemMetrics(samples),
    logs: logEventCounts(samples),
    redis: redisCommandMetrics(samples),
    executors: executorMetrics(samples),
    samples: samples.length,
  };
}

/** Один запрос и полный разбор: раздел получает уже готовые таблицы. */
export async function fetchGatewayMetrics(signal?: AbortSignal): Promise<GatewayMetrics> {
  return buildGatewayMetrics(await fetchPrometheusText(signal));
}
