/**
 * Метрики раздела «Пульт»: числа, которых нет в общем разборе `gatewayMetrics.ts`.
 *
 * Источник тот же — одна выдача `/actuator/prometheus` шлюза (85 серий на живом
 * стеке). Отдельный модуль нужен по трём причинам, и все три — про честность цифр:
 *
 *  1. <b>Средняя задержка на маршрут.</b> `gatewayRouteMetrics` кладёт в `averageMs`
 *     одно значение на все маршруты: шлюз отдаёт `_sum` и `_count` по каждой серии, а
 *     функция складывает их все вместе, поэтому получается средняя по шлюзу целиком.
 *     В таблице «нагрузка по маршрутам» такая цифра вводила бы в заблуждение —
 *     у быстрого каталога и медленного платежа стояло бы одно и то же число. Здесь
 *     средняя считается по каждому маршруту: `_sum` этого маршрута делится на его же
 *     `_count`. Обе серии приходят с меткой `routeId`, поэтому деление корректно.
 *     Средняя по шлюзу тоже остаётся — но отдельным полем (`totals.averageMs`) и с
 *     подписью «средняя по шлюзу».
 *  2. <b>Числа, которых в `GatewayMetrics` нет:</b> количество маршрутов
 *     (`spring_cloud_gateway_routes_count`), коды ответов, память по областям вместе с
 *     committed/max, потоки по состояниям, вызовы шлюза к сервисам
 *     (`http_client_requests_*`, метка `spring_cloud_gateway_route_id`) и решения
 *     авторизации (`spring_security_authorizations_*`).
 *  3. <b>Один запрос на весь экран.</b> Панели пульта живут каждая своим `useQuery`
 *     (падение одной панели не гасит соседние), но выдача у них одна и та же:
 *     `fetchPulseText` склеивает одновременные обращения в один запрос и на секунду
 *     переиспользует только что полученный текст. Иначе двенадцать панелей тянули бы
 *     по 70 КБ каждая каждые 15 секунд.
 *
 * Разбор — чистые функции: их проверяют юнит-тесты на настоящем фрагменте выдачи
 * (`pulseMetrics.test.ts`), а не на живом шлюзе.
 */
import {
  executorMetrics,
  fetchPrometheusText,
  httpEndpointMetrics,
  jvmMemory,
  logEventCounts,
  parsePrometheus,
  processMetrics,
  redisCommandMetrics,
  sumBy,
  systemMetrics,
  valueOf,
  type ExecutorMetrics,
  type HttpEndpointMetrics,
  type JvmMemory,
  type LogEventCounts,
  type ProcessMetrics,
  type PrometheusSample,
  type RedisCommandMetrics,
  type SystemMetrics,
} from './gatewayMetrics';

/* ------------------------------------------------------------------- имена */

/** Таймер шлюза: нагрузка по маршрутам и коды ответов. */
const GATEWAY_REQUESTS = 'spring_cloud_gateway_requests_seconds';
/** Таймер исходящих вызовов шлюза к сервисам (взгляд шлюза на самого себя). */
const CLIENT_REQUESTS = 'http_client_requests_seconds';
/** Таймер ответов самого шлюза: сюда попадают и `/actuator`, и отказы до маршрутизации. */
const SERVER_REQUESTS = 'http_server_requests_seconds_count';

/* ------------------------------------------------------------- мелкие утилиты */

/** Код ответа из метки; `null` — метки нет или она не число (это не ноль). */
function statusCodeOf(sample: PrometheusSample, ...labels: string[]): number | null {
  for (const label of labels) {
    const raw = sample.labels[label];
    if (raw === undefined || raw === '') {
      continue;
    }
    const code = Number.parseInt(raw, 10);
    if (Number.isFinite(code)) {
      return code;
    }
  }
  return null;
}

function isClientError(code: number | null): boolean {
  return code !== null && code >= 400 && code < 500;
}

function isServerError(code: number | null): boolean {
  return code !== null && code >= 500;
}

/** Сумма значений серий с этим именем или `null`, если серии в выдаче нет вовсе. */
function totalOrNull(samples: PrometheusSample[], name: string): number | null {
  return samples.some((sample) => sample.name === name) ? sumBy(samples, name) : null;
}

/* ------------------------------------------------------------ нагрузка по маршрутам */

/** Строка таблицы «нагрузка по маршрутам»: одна серия метрик на один сервис. */
export interface PulseRouteRow {
  routeId: string;
  routeUri: string;
  requests: number;
  /** Ответы младше 400: успешные и перенаправления. */
  successes: number;
  clientErrors: number;
  serverErrors: number;
  /**
   * Серии без кода ответа. Их нельзя записать ни в успешные, ни в ошибки, поэтому
   * считаем отдельно и, если такие есть, показываем это на экране.
   */
  uncoded: number;
  /** Средняя задержка этого маршрута, мс: его `_sum` делится на его `_count`. */
  averageMs: number | null;
  /**
   * Максимум таймера, мс. Micrometer держит максимум в скользящем окне (по умолчанию
   * около двух минут), поэтому это свежий пик, а не пик за всё время работы: `0` при
   * ненулевом количестве запросов означает «в последние минуты всплеска не было».
   */
  maxMs: number | null;
  /** Доля от всех запросов через шлюз, 0…1. */
  share: number;
}

interface RouteAccumulator extends Omit<PulseRouteRow, 'averageMs' | 'share'> {
  /** Суммарное время ответов маршрута, секунды (`_sum`). */
  seconds: number;
  /** Пришла ли серия `_sum`: без неё средняя не «ноль», а «не измерено». */
  hasSum: boolean;
}

/**
 * Общий аккумулятор для таймеров: у `spring_cloud_gateway_requests_seconds` метка
 * называется `routeId`, у `http_client_requests_seconds` — `spring_cloud_gateway_route_id`,
 * поэтому обе поддерживаются, а метка кода — `httpStatusCode` / `http_status_code`.
 */
function routeAccumulators(samples: PrometheusSample[], timer: string): Map<string, RouteAccumulator> {
  const rows = new Map<string, RouteAccumulator>();
  for (const sample of samples) {
    if (!sample.name.startsWith(timer)) {
      continue;
    }
    const routeId = sample.labels.routeId ?? sample.labels.spring_cloud_gateway_route_id ?? 'без маршрута';
    const routeUri = sample.labels.routeUri ?? sample.labels.spring_cloud_gateway_route_uri ?? '';
    let row = rows.get(routeId);
    if (!row) {
      row = {
        routeId,
        routeUri,
        requests: 0,
        successes: 0,
        clientErrors: 0,
        serverErrors: 0,
        uncoded: 0,
        maxMs: null,
        seconds: 0,
        hasSum: false,
      };
      rows.set(routeId, row);
    }
    if (row.routeUri === '' && routeUri !== '') {
      row.routeUri = routeUri;
    }

    // `_bucket` пропускаем: гистограмму шлюз не включает, а если включит — сумма по
    // бакетам посчитала бы один запрос столько раз, сколько бакетов он пересёк.
    if (sample.name.endsWith('_count')) {
      const code = statusCodeOf(sample, 'httpStatusCode', 'http_status_code');
      row.requests += sample.value;
      if (code === null) {
        row.uncoded += sample.value;
      } else if (isClientError(code)) {
        row.clientErrors += sample.value;
      } else if (isServerError(code)) {
        row.serverErrors += sample.value;
      } else {
        row.successes += sample.value;
      }
    } else if (sample.name.endsWith('_sum')) {
      row.seconds += sample.value;
      row.hasSum = true;
    } else if (sample.name.endsWith('_max')) {
      row.maxMs = Math.max(row.maxMs ?? 0, sample.value * 1000);
    }
  }
  return rows;
}

/**
 * Средняя на маршрут — его собственные `_sum` и `_count`, а не общие по шлюзу.
 *
 * Без серии `_sum` средняя остаётся `null`: количество запросов есть, а суммарное время
 * нет, и «0 мс» тут было бы враньём про мгновенные ответы.
 */
function averageOf(row: RouteAccumulator): number | null {
  return row.requests > 0 && row.hasSum ? (row.seconds / row.requests) * 1000 : null;
}

/** Таблица нагрузки: по одному ряду на маршрут, самые нагруженные сверху. */
export function routeLoadRows(samples: PrometheusSample[]): PulseRouteRow[] {
  const rows = [...routeAccumulators(samples, GATEWAY_REQUESTS).values()];
  const total = rows.reduce((sum, row) => sum + row.requests, 0);

  return rows
    .map((row) => ({
      routeId: row.routeId,
      routeUri: row.routeUri,
      requests: row.requests,
      successes: row.successes,
      clientErrors: row.clientErrors,
      serverErrors: row.serverErrors,
      uncoded: row.uncoded,
      averageMs: averageOf(row),
      maxMs: row.maxMs,
      share: total > 0 ? row.requests / total : 0,
    }))
    .sort((left, right) => right.requests - left.requests);
}

/* --------------------------------------------------------------- коды ответов */

/** Смысл кода ответа: от него зависит цвет плитки и пояснение под ней. */
export type PulseStatusTone = 'ok' | 'auth' | 'forbidden' | 'missing' | 'method' | 'client' | 'server' | 'other';

export interface PulseStatusRow {
  /** Код как строка (`200`) или группа (`5xx`). */
  key: string;
  /** Пояснение человеческим языком — что этот код значит для оператора. */
  title: string;
  requests: number;
  tone: PulseStatusTone;
}

export interface PulseStatusBreakdown {
  /**
   * Строки по возрастанию «важности»: сначала успех, потом отказы доступа, потом
   * «пути нет» и «метод не разрешён», прочие коды и в конце — сумма 5xx. Порядок
   * фиксирован, чтобы живой экран не переставлял строки между обновлениями.
   */
  rows: PulseStatusRow[];
  /** Сколько ответов попало в строки (серии с кодом в метке). */
  coded: number;
  /** Серии без кода ответа: их нельзя отнести ни к одной строке. */
  uncoded: number;
}

/** Коды, которые пульт показывает всегда — даже когда серии с ними в выдаче нет. */
const TRACKED_CODES: readonly number[] = [200, 401, 403, 404, 405];

const STATUS_TITLES: Record<number, string> = {
  200: '200 — успешные ответы',
  401: '401 — без токена или с просроченным',
  403: '403 — токен есть, прав нет',
  404: '404 — такого пути нет',
  405: '405 — метод не разрешён',
};

function statusToneFor(code: number): PulseStatusTone {
  if (code >= 500) {
    return 'server';
  }
  switch (code) {
    case 401:
      return 'auth';
    case 403:
      return 'forbidden';
    case 404:
      return 'missing';
    case 405:
      return 'method';
    default:
      break;
  }
  if (code >= 400) {
    return 'client';
  }
  return code < 300 ? 'ok' : 'other';
}

/**
 * Коды ответов на запросы, прошедшие маршрутизацию шлюза.
 *
 * Счётчики шлюза кумулятивные: серия появляется при первом ответе с этим кодом и
 * дальше только растёт. Поэтому отсутствие строки `401` означает «таких ответов с
 * момента старта не было», и ноль в этой строке — правда, а не пропуск данных.
 * Единственная оговорка — серии без метки кода: их считаем отдельно (`uncoded`).
 */
export function statusBreakdown(samples: PrometheusSample[]): PulseStatusBreakdown {
  const byCode = new Map<number, number>();
  let uncoded = 0;
  for (const sample of samples) {
    if (sample.name !== `${GATEWAY_REQUESTS}_count`) {
      continue;
    }
    const code = statusCodeOf(sample, 'httpStatusCode');
    if (code === null) {
      uncoded += sample.value;
      continue;
    }
    byCode.set(code, (byCode.get(code) ?? 0) + sample.value);
  }

  const coded = [...byCode.values()].reduce((total, value) => total + value, 0);
  const rows: PulseStatusRow[] = TRACKED_CODES.map((code) => ({
    key: String(code),
    title: STATUS_TITLES[code] ?? `код ${code}`,
    requests: byCode.get(code) ?? 0,
    tone: statusToneFor(code),
  }));

  // Все остальные коды — своими строками, чтобы ни один ответ не потерялся молча.
  const others = [...byCode.entries()]
    .filter(([code]) => code < 500 && !TRACKED_CODES.includes(code))
    .sort((left, right) => right[1] - left[1]);
  for (const [code, requests] of others) {
    rows.push({ key: String(code), title: `код ${code}`, requests, tone: statusToneFor(code) });
  }

  // 5xx — одной строкой: оператору важно их общее число, а расшифровка кодов идёт в
  // пояснении, чтобы таблица не росла на каждый новый пятисотый ответ.
  const serverCodes = [...byCode.keys()].filter((code) => code >= 500).sort((left, right) => left - right);
  const serverTotal = serverCodes.reduce((total, code) => total + (byCode.get(code) ?? 0), 0);
  rows.push({
    key: '5xx',
    title:
      serverCodes.length > 0
        ? `5xx — ошибки шлюза или сервиса: ${serverCodes.join(', ')}`
        : '5xx — ошибки шлюза или сервиса',
    requests: serverTotal,
    tone: 'server',
  });

  return { rows, coded, uncoded };
}

/**
 * Ответы самого шлюза целиком (`http_server_requests`) — включая служебные
 * `/actuator/*` и отказы, которые шлюз отдал до маршрутизации: отказ без токена в
 * счётчике маршрутов не виден, а здесь виден.
 */
export function serverStatusRows(samples: PrometheusSample[]): Array<{ status: number; requests: number }> {
  const byStatus = new Map<number, number>();
  for (const sample of samples) {
    if (sample.name !== SERVER_REQUESTS) {
      continue;
    }
    const status = statusCodeOf(sample, 'status');
    if (status === null) {
      continue;
    }
    byStatus.set(status, (byStatus.get(status) ?? 0) + sample.value);
  }
  return [...byStatus.entries()]
    .map(([status, requests]) => ({ status, requests }))
    .sort((left, right) => right.requests - left.requests);
}

/* -------------------------------------------------------------------- ресурсы */

export interface PulseMemoryArea {
  usedBytes: number;
  committedBytes: number | null;
  maxBytes: number | null;
}

export interface PulseMemory {
  heap: PulseMemoryArea;
  nonHeap: PulseMemoryArea;
}

/**
 * Память по областям.
 *
 * Максимум `-1` у JVM означает «область не ограничена» (так отвечает nonheap и
 * G1 Eden Space), поэтому он превращается в `null` — показать вместо него «-1 байт»
 * было бы бессмыслицей, а ноль соврал бы про предел.
 */
export function memoryAreas(samples: PrometheusSample[]): PulseMemory {
  const area = (name: string): PulseMemoryArea => {
    const committed = sumBy(samples, 'jvm_memory_committed_bytes', { area: name });
    const maxes = samples
      .filter((sample) => sample.name === 'jvm_memory_max_bytes' && sample.labels.area === name)
      .map((sample) => sample.value);
    const max = maxes.length > 0 ? Math.max(...maxes) : 0;
    return {
      usedBytes: sumBy(samples, 'jvm_memory_used_bytes', { area: name }),
      committedBytes: committed > 0 ? committed : null,
      maxBytes: max > 0 ? max : null,
    };
  };
  return { heap: area('heap'), nonHeap: area('nonheap') };
}

/** Подписи состояний потоков JVM: английское `timed-waiting` на экране не нужно. */
const THREAD_STATE_TITLES: Record<string, string> = {
  runnable: 'работают',
  blocked: 'заблокированы',
  waiting: 'ждут',
  'timed-waiting': 'ждут с таймаутом',
  new: 'новые',
  terminated: 'завершены',
};

export interface PulseThreads {
  live: number | null;
  daemon: number | null;
  peak: number | null;
  /** Потоки по состояниям: видно, стоят ли потоки в блокировке. */
  states: Array<{ state: string; title: string; threads: number }>;
}

export function jvmThreads(samples: PrometheusSample[]): PulseThreads {
  const states: PulseThreads['states'] = [];
  for (const [state, title] of Object.entries(THREAD_STATE_TITLES)) {
    const threads = valueOf(samples, 'jvm_threads_states_threads', { state });
    if (typeof threads === 'number') {
      states.push({ state, title, threads });
    }
  }
  return {
    live: valueOf(samples, 'jvm_threads_live_threads') ?? null,
    daemon: valueOf(samples, 'jvm_threads_daemon_threads') ?? null,
    peak: valueOf(samples, 'jvm_threads_peak_threads') ?? null,
    states,
  };
}

/** Пул потоков шлюза и его пределы (`executor_*`). */
export interface PulsePool extends ExecutorMetrics {
  core: number | null;
  size: number | null;
  /** Сколько задач ещё поместится в очередь — у безграничной очереди это огромное число. */
  queueRemaining: number | null;
}

/**
 * Пулы потоков: четыре обязательных числа берутся из готового `executorMetrics`, а
 * ядро пула, текущий размер и остаток очереди — из тех же серий (`executor_pool_*`),
 * которых в `ExecutorMetrics` нет.
 */
export function poolRows(samples: PrometheusSample[]): PulsePool[] {
  return executorMetrics(samples).map((pool) => ({
    ...pool,
    core: valueOf(samples, 'executor_pool_core_threads', { name: pool.pool }) ?? null,
    size: valueOf(samples, 'executor_pool_size_threads', { name: pool.pool }) ?? null,
    queueRemaining: valueOf(samples, 'executor_queue_remaining_tasks', { name: pool.pool }) ?? null,
  }));
}

/* ------------------------------------------------------- вызовы шлюза к сервисам */

/**
 * Строка «сколько раз шлюз сходил в сервис и чем это кончилось».
 *
 * Это взгляд шлюза на свои исходящие вызовы, а не метрики сервиса: путь в этой серии
 * не пишется (`http_client_requests_*` знает только маршрут и код ответа), поэтому
 * детализация — по маршрутам, а не по путям.
 */
export interface PulseClientRow {
  routeId: string;
  routeUri: string;
  calls: number;
  clientErrors: number;
  serverErrors: number;
  uncoded: number;
  averageMs: number | null;
  maxMs: number | null;
}

export function clientCallRows(samples: PrometheusSample[]): PulseClientRow[] {
  return [...routeAccumulators(samples, CLIENT_REQUESTS).values()]
    .map((row) => ({
      routeId: row.routeId,
      routeUri: row.routeUri,
      calls: row.requests,
      clientErrors: row.clientErrors,
      serverErrors: row.serverErrors,
      uncoded: row.uncoded,
      averageMs: averageOf(row),
      maxMs: row.maxMs,
    }))
    .sort((left, right) => right.calls - left.calls);
}

/* ----------------------------------------------------------------------- итоги */

export interface PulseTotals {
  requests: number;
  successes: number;
  clientErrors: number;
  serverErrors: number;
  uncoded: number;
  /** Средняя по шлюзу целиком: сумма всех `_sum` на сумму всех `_count`. */
  averageMs: number | null;
  /** Максимум по всем маршрутам (скользящее окно Micrometer), мс. */
  maxMs: number | null;
  /** `spring_cloud_gateway_routes_count` — сколько маршрутов объявлено в шлюзе. */
  routeCount: number | null;
  /** Сколько маршрутов реально видно в счётчике запросов. */
  observedRoutes: number;
}

export function pulseTotals(samples: PrometheusSample[]): PulseTotals {
  let requests = 0;
  let successes = 0;
  let clientErrors = 0;
  let serverErrors = 0;
  let uncoded = 0;
  let seconds = 0;
  let hasSum = false;
  let maxMs: number | null = null;
  const routes = new Set<string>();

  for (const sample of samples) {
    if (!sample.name.startsWith(GATEWAY_REQUESTS)) {
      continue;
    }
    routes.add(sample.labels.routeId ?? 'без маршрута');
    if (sample.name.endsWith('_count')) {
      const code = statusCodeOf(sample, 'httpStatusCode');
      requests += sample.value;
      if (code === null) {
        uncoded += sample.value;
      } else if (isClientError(code)) {
        clientErrors += sample.value;
      } else if (isServerError(code)) {
        serverErrors += sample.value;
      } else {
        successes += sample.value;
      }
    } else if (sample.name.endsWith('_sum')) {
      seconds += sample.value;
      hasSum = true;
    } else if (sample.name.endsWith('_max')) {
      maxMs = Math.max(maxMs ?? 0, sample.value * 1000);
    }
  }

  return {
    requests,
    successes,
    clientErrors,
    serverErrors,
    uncoded,
    // Средняя по шлюзу целиком: сумма всех `_sum` на сумму всех `_count` — ровно то,
    // что показывает сам таймер шлюза. Если `_sum` не пришла вовсе, средняя неизвестна.
    averageMs: requests > 0 && hasSum ? (seconds / requests) * 1000 : null,
    maxMs,
    routeCount: valueOf(samples, 'spring_cloud_gateway_routes_count') ?? null,
    observedRoutes: routes.size,
  };
}

/** Что шлюз знает про безопасность: сколько запросов прошло фильтр и сколько решений. */
export interface PulseSecurity {
  /** Серия без метки статуса — только общее число запросов через фильтр безопасности. */
  securedRequests: number | null;
  granted: number | null;
  denied: number | null;
}

export function pulseSecurity(samples: PrometheusSample[]): PulseSecurity {
  const decision = (values: string[]): number | null => {
    const matched = samples.filter(
      (sample) =>
        sample.name === 'spring_security_authorizations_seconds_count' &&
        values.includes(sample.labels.spring_security_authorization_decision ?? ''),
    );
    return matched.length > 0 ? matched.reduce((total, sample) => total + sample.value, 0) : null;
  };

  return {
    securedRequests: totalOrNull(samples, 'spring_security_http_secured_requests_seconds_count'),
    granted: decision(['true', 'granted']),
    denied: decision(['false', 'denied']),
  };
}

/* ------------------------------------------------------------ всё вместе */

/** Всё, что пульт берёт из одной выдачи. */
export interface PulseMetrics {
  /** Сколько серий пришло: по нулю видно, что шлюз не отдал метрики. */
  samples: number;
  totals: PulseTotals;
  routes: PulseRouteRow[];
  statuses: PulseStatusBreakdown;
  serverStatuses: Array<{ status: number; requests: number }>;
  /** Топ путей шлюза (`http_server_requests`), самые нагруженные сверху. */
  endpoints: HttpEndpointMetrics[];
  memory: PulseMemory;
  jvm: JvmMemory;
  threads: PulseThreads;
  process: ProcessMetrics;
  system: SystemMetrics;
  redis: RedisCommandMetrics[];
  pools: PulsePool[];
  clientCalls: PulseClientRow[];
  security: PulseSecurity;
  logs: LogEventCounts;
}

export function buildPulseMetrics(text: string): PulseMetrics {
  const samples = parsePrometheus(text);
  return {
    samples: samples.length,
    totals: pulseTotals(samples),
    routes: routeLoadRows(samples),
    statuses: statusBreakdown(samples),
    serverStatuses: serverStatusRows(samples),
    endpoints: httpEndpointMetrics(samples),
    memory: memoryAreas(samples),
    jvm: jvmMemory(samples),
    threads: jvmThreads(samples),
    process: processMetrics(samples),
    system: systemMetrics(samples),
    redis: redisCommandMetrics(samples),
    pools: poolRows(samples),
    clientCalls: clientCallRows(samples),
    security: pulseSecurity(samples),
    logs: logEventCounts(samples),
  };
}

/* --------------------------------------------------- один запрос на весь экран */

/** Сколько живёт уже полученный текст, чтобы соседние панели не спросили его второй раз. */
const REUSE_WINDOW_MS = 1_000;

let cachedText: { text: string; at: number } | null = null;
let inFlight: Promise<string> | null = null;

/**
 * Выдача метрик, общая для всех панелей пульта.
 *
 * Панели просят её каждая сама (у каждой свой `useQuery` и своя ошибка), но запрос
 * один: пока он в полёте, соседи ждут его же, а секунду после ответа берут готовый
 * текст. Сигнал отмены сюда не передаётся намеренно — отмена одной панелью убила бы
 * запрос, который ждут остальные; вместо этого react-query просто перестаёт
 * использовать пришедший ответ, если панель уже размонтирована.
 */
export function fetchPulseText(): Promise<string> {
  const now = Date.now();
  if (cachedText !== null && now - cachedText.at < REUSE_WINDOW_MS) {
    return Promise.resolve(cachedText.text);
  }
  if (inFlight === null) {
    inFlight = fetchPrometheusText()
      .then((text) => {
        cachedText = { text, at: Date.now() };
        return text;
      })
      .finally(() => {
        inFlight = null;
      });
  }
  return inFlight;
}

/** Разбор одной выдачи: раздел получает уже готовые таблицы и плитки. */
export async function fetchPulseMetrics(): Promise<PulseMetrics> {
  return buildPulseMetrics(await fetchPulseText());
}

/**
 * Забыть закэшированный текст.
 *
 * Нужно тестам: кэш живёт в модуле, то есть переживает и перерисовку, и следующий
 * тест того же файла — без сброса второй тест получил бы выдачу первого.
 */
export function resetPulseTextCache(): void {
  cachedText = null;
  inFlight = null;
}

/* --------------------------------------------- ряд, собранный самим экраном */

/** Сколько замеров держим: 60 замеров по 15 секунд — четверть часа. */
export const HISTORY_LIMIT = 60;

/** Замер пульта: момент и кумулятивные счётчики на этот момент. */
export interface PulseSample {
  /** Момент замера, мс epoch (берётся из `dataUpdatedAt` react-query). */
  at: number;
  requests: number;
  errors: number;
}

/**
 * Добавить замер в ряд.
 *
 * Замер с тем же моментом не пишется второй раз: react-query отдаёт новый объект
 * данных на каждую перерисовку, а ряд должен показывать ответы шлюза, а не рендеры.
 */
export function appendPulseSample(
  history: PulseSample[],
  sample: PulseSample,
  limit: number = HISTORY_LIMIT,
): PulseSample[] {
  const last = history[history.length - 1];
  if (last !== undefined && last.at === sample.at) {
    return history;
  }
  const next = [...history, sample];
  return next.length > limit ? next.slice(next.length - limit) : next;
}

export interface PulseTrendPoint {
  at: number;
  /** Сколько запросов прибавилось с прошлого замера. */
  requests: number;
  errors: number;
  /** Счётчик уменьшился — шлюз перезапустился, прирост за этот интервал неизвестен. */
  reset: boolean;
}

/**
 * Прирост между замерами.
 *
 * Счётчики шлюза кумулятивные, своей истории он не отдаёт, поэтому «сколько запросов
 * было за последние 15 секунд» — это разница двух соседних замеров, сделанных этим
 * экраном. Перезапуск шлюза обнуляет счётчик: прирост тогда неизвестен, и точка
 * помечается `reset`, а не рисуется отрицательным числом.
 */
export function trendPoints(history: PulseSample[]): PulseTrendPoint[] {
  const points: PulseTrendPoint[] = [];
  for (let index = 1; index < history.length; index += 1) {
    const previous = history[index - 1];
    const current = history[index];
    const reset = current.requests < previous.requests;
    points.push({
      at: current.at,
      requests: reset ? 0 : current.requests - previous.requests,
      errors: reset ? 0 : Math.max(0, current.errors - previous.errors),
      reset,
    });
  }
  return points;
}
