/**
 * Раздел админ-панели «Пульт»: рабочее место оператора по API-шлюзу.
 *
 * Что здесь есть: живые числа шлюза из одной выдачи `/actuator/prometheus` — нагрузка по
 * маршрутам, коды ответов, топ путей, ресурсы JVM и хоста, Redis лимитера, пулы потоков,
 * журнал по уровням, вызовы шлюза к сервисам и живость самого шлюза. Экран намеренно
 * плотный: заказчик сравнил админку с обычной панелью оператора, где на одном экране
 * видно и итоги, и разбивку, и диаграммы, — поэтому здесь двенадцать плиток, десять
 * панелей с числами и три диаграммы, а не одна таблица на весь экран.
 *
 * Три правила, по которым раздел собран:
 *
 *  1. <b>Каждая цифра — из выдачи.</b> Ничего не дорисовывается: если серии нет, на её
 *     месте стоит «—» или честное объяснение, а не ноль. Что именно берётся из какой
 *     серии — написано в подписях под числами и в комментариях рядом с расчётом.
 *  2. <b>Каждая панель — свой запрос.</b> Пульт состоит из панелей, у каждой свой
 *     `useQuery` и своя ошибка: падение или пустота одной панели не гасит соседние. При
 *     этом выдача у них общая — `fetchPulseMetrics` склеивает одновременные обращения в
 *     один запрос, поэтому «свой запрос у каждой панели» не превращается в тринадцать
 *     загрузок по 70 КБ каждые 15 секунд.
 *  3. <b>Ничего не меняется.</b> У раздела нет изменяющих действий, поэтому нет и пометки
 *     `data-admin-write`; пометку «режим чтения» для роли SUPPORT рисует оболочка
 *     (`AdminLayout`), а не раздел.
 *
 * Истории метрик шлюз не отдаёт (ни Prometheus-сервера, ни Grafana в проекте нет),
 * поэтому все счётчики кумулятивные — «с момента старта шлюза» — и это подписано на
 * экране. Единственный ряд во времени собирает сам экран: раз в 15 секунд он запоминает
 * замер и показывает прирост между замерами.
 */
import { useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { humanMessage } from '../../api/errors';
import { Alert, ErrorAlert } from '../../components/ui/Alerts';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { DetailRow } from '../../components/ui/Card';
import { CheckboxField, TextField } from '../../components/ui/Field';
import { EmptyState } from '../../components/ui/EmptyState';
import { SkeletonRows } from '../../components/ui/Skeleton';
import { cx } from '../../lib/cx';
import { formatDateTime, formatRelative, roleLabel } from '../../lib/format';
import { fetchGatewayHealth, type GatewayHealth } from '../api/gatewayHealth';
import {
  appendPulseSample,
  fetchPulseMetrics,
  resetPulseTextCache,
  trendPoints,
  type PulseClientRow,
  type PulseMetrics,
  type PulsePool,
  type PulseRouteRow,
  type PulseSample,
  type PulseStatusRow,
  type PulseStatusTone,
} from '../api/pulseMetrics';
import { BarList, Chip, Donut, KpiTile, Panel, StatusRail, Toolbar, type KitTone } from '../kit';
import type { AdminSectionProps } from '../sections';

/* ---------------------------------------------------------------- настройки */

/** Пульт обновляется раз в 15 секунд: чаще шлюзу не нужно, реже оператор не увидит всплеск. */
const REFRESH_INTERVAL_MS = 15_000;

/** Путь выдачи метрик: показан на экране, чтобы было понятно, откуда числа. */
const PROMETHEUS_PATH = '/actuator/prometheus';

/* ------------------------------------------------------------- форматирование */

const BYTE_UNITS = ['Б', 'КБ', 'МБ', 'ГБ', 'ТБ'] as const;

/** Байты в Б/КБ/МБ/ГБ: 95,4 МБ, 997,9 ГБ. */
export function formatBytes(bytes: number | null | undefined): string {
  if (typeof bytes !== 'number' || !Number.isFinite(bytes) || bytes < 0) {
    return '—';
  }
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < BYTE_UNITS.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(unit === 0 ? 0 : 1).replace('.', ',')} ${BYTE_UNITS[unit]}`;
}

/** Миллисекунды: до секунды — «25,7 мс», дальше — «1,32 с». */
export function formatMs(ms: number | null | undefined): string {
  if (typeof ms !== 'number' || !Number.isFinite(ms) || ms < 0) {
    return '—';
  }
  if (ms >= 1000) {
    return `${(ms / 1000).toFixed(2).replace('.', ',')} с`;
  }
  return `${ms.toFixed(1).replace('.', ',')} мс`;
}

/**
 * Длительность: «42 с», «55 мин 21 с», «3 ч 5 мин», «2 сут 4 ч».
 *
 * Не `formatAgeSeconds` из `lib/format`, хотя формат похож: тот отбрасывает секунды
 * выше минуты, а по времени работы процесса видно, что шлюз перезапустился минуту
 * назад, — секунды здесь и есть самое важное.
 */
export function formatDuration(seconds: number | null | undefined): string {
  if (typeof seconds !== 'number' || !Number.isFinite(seconds) || seconds < 0) {
    return '—';
  }
  const total = Math.round(seconds);
  if (total < 60) {
    return `${total} с`;
  }
  const minutes = Math.floor(total / 60);
  if (minutes < 60) {
    return `${minutes} мин ${total % 60} с`;
  }
  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return `${hours} ч ${minutes % 60} мин`;
  }
  return `${Math.floor(hours / 24)} сут ${hours % 24} ч`;
}

/** Большие числа с разделителями: 12 345. */
export function formatCount(value: number | null | undefined): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return '—';
  }
  return value.toLocaleString('ru-RU');
}

/** Доля в процентах с одним знаком: 4,8 %. */
export function formatPercent(fraction: number | null | undefined, digits = 1): string {
  if (typeof fraction !== 'number' || !Number.isFinite(fraction)) {
    return '—';
  }
  return `${(fraction * 100).toFixed(digits).replace('.', ',')} %`;
}

/** Время с секундами: «обновлено в 14:32:05» — у `formatDateTime` секунд нет. */
const CLOCK_FORMAT = new Intl.DateTimeFormat('ru-KZ', {
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
});

export function formatClock(at: number): string {
  return typeof at === 'number' && Number.isFinite(at) && at > 0 ? CLOCK_FORMAT.format(new Date(at)) : '—';
}

/** Дата старта процесса: секунды epoch из метрики. */
function formatStartTime(startTimeSeconds: number | null): string {
  if (startTimeSeconds === null) {
    return '—';
  }
  const iso = new Date(startTimeSeconds * 1000).toISOString();
  return `${formatDateTime(iso)} (${formatRelative(iso)})`;
}

/* ------------------------------------------------------------------- цвета */

/**
 * Цвета полос — те же, что в ките (`TONE_FILL` оттуда не экспортируется, а тащить
 * ради двух строк правку общего файла хуже, чем повторить палитру).
 */
const BAR_FILL: Record<KitTone, string> = {
  neutral: 'bg-ink-400',
  brand: 'bg-brand-500',
  success: 'bg-success-500',
  warning: 'bg-warning-500',
  danger: 'bg-brand-600',
  info: 'bg-info-500',
};

/** Тон плитки кода ответа: успех — зелёный, отказ доступа — синий, ошибки — тёмные. */
const STATUS_TONE: Record<PulseStatusTone, KitTone> = {
  ok: 'success',
  auth: 'info',
  forbidden: 'warning',
  missing: 'neutral',
  method: 'brand',
  client: 'danger',
  server: 'danger',
  other: 'neutral',
};

/* ------------------------------------------------------------ мелкие детали */

/** Полоса доли внутри таблицы: 6 px, скруглённая, дорожка `bg-ink-100` — как в ките. */
function ShareBar({ value, max, tone = 'brand' }: { value: number; max: number; tone?: KitTone }) {
  const fraction = max > 0 ? Math.min(1, value / max) : 0;
  return (
    <span className="flex items-center gap-2">
      <span className="h-1.5 min-w-16 flex-1 overflow-hidden rounded-full bg-ink-100" aria-hidden="true">
        <span className={cx('block h-full rounded-full', BAR_FILL[tone])} style={{ width: `${fraction * 100}%` }} />
      </span>
      <span className="w-12 shrink-0 text-right text-xs tabular-nums text-ink-500">{formatPercent(fraction)}</span>
    </span>
  );
}

/** Легенда диаграммы: без неё цветные столбцы ничего не значат. */
function Legend({ items }: { items: Array<{ key: string; label: string; tone: KitTone }> }) {
  return (
    <ul className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-ink-600">
      {items.map((item) => (
        <li key={item.key} className="flex items-center gap-1.5">
          <span className={cx('h-2.5 w-2.5 rounded-full', BAR_FILL[item.tone])} aria-hidden="true" />
          {item.label}
        </li>
      ))}
    </ul>
  );
}

/** Маленькая карточка кода ответа: иконка, название и число в пилюле. */
function StatusCard({
  icon,
  title,
  requests,
  share,
  tone,
  hint,
}: {
  icon: string;
  title: string;
  requests: number;
  share: number | null;
  tone: KitTone;
  hint: string;
}) {
  return (
    <div className="rounded-xl border border-ink-200 p-3" title={hint}>
      <div className="flex items-center gap-2">
        <span
          aria-hidden="true"
          className={cx('grid h-8 w-8 shrink-0 place-items-center rounded-lg text-base', BAR_FILL_ICON[tone])}
        >
          {icon}
        </span>
        <span className="min-w-0 flex-1 truncate text-sm font-medium text-ink-700">{title}</span>
      </div>
      <p className="mt-2 flex flex-wrap items-baseline gap-2">
        <span className="text-2xl font-semibold tabular-nums text-ink-900">{formatCount(requests)}</span>
        {share !== null ? <Chip tone={tone}>{formatPercent(share)}</Chip> : null}
      </p>
    </div>
  );
}

const BAR_FILL_ICON: Record<KitTone, string> = {
  neutral: 'bg-ink-100 text-ink-600',
  brand: 'bg-brand-50 text-brand-700',
  success: 'bg-success-50 text-success-700',
  warning: 'bg-warning-50 text-warning-700',
  danger: 'bg-brand-50 text-brand-700',
  info: 'bg-info-50 text-info-700',
};

/** Мини-блок внутри панели ресурсов: подзаголовок и список «подпись — значение». */
function MiniStat({ title, children }: { title: string; children: ReactNode }) {
  return (
    // `min-w-0`: внутри бывают длинные имена метрик, и без этого элемент сетки
    // растягивает колонку по самому длинному слову.
    <div className="min-w-0 rounded-xl border border-ink-200 p-3">
      <h3 className="text-xs font-medium tracking-wide text-ink-500 uppercase">{title}</h3>
      <dl className="mt-2">{children}</dl>
    </div>
  );
}

/**
 * Столбцы нагрузки: каждый столбец — маршрут, внутри три доли (успешные, 4xx, 5xx).
 *
 * Столбцы переносятся по строкам, а не уезжают в горизонтальный скролл: маршрутов
 * девять, и «вторая страница» диаграммы была бы хуже второй строки.
 */
function RouteColumns({ rows }: { rows: PulseRouteRow[] }) {
  const max = Math.max(...rows.map((row) => row.requests), 1);
  return (
    <div className="flex flex-wrap items-end gap-3">
      {rows.map((row) => {
        const height = (row.requests / max) * 100;
        // Маршрут без запросов — тоже факт (маршрут объявлен, но по нему не ходили):
        // столбец остаётся пустым, а не получает нулевую высоту из деления на ноль.
        const segments =
          row.requests === 0
            ? []
            : [
                { key: 'ok', value: row.successes, tone: 'success' as KitTone },
                { key: '4xx', value: row.clientErrors, tone: 'warning' as KitTone },
                { key: '5xx', value: row.serverErrors, tone: 'danger' as KitTone },
                { key: 'none', value: row.uncoded, tone: 'neutral' as KitTone },
              ].filter((segment) => segment.value > 0);
        return (
          <div key={row.routeId} className="w-16 shrink-0 text-center">
            <div className="text-[11px] tabular-nums text-ink-600">{formatCount(row.requests)}</div>
            <div
              className="mt-1 flex h-28 flex-col justify-end overflow-hidden rounded-md bg-ink-100"
              title={
                row.requests === 0
                  ? `${row.routeId} · по маршруту не было ни одного запроса`
                  : `${row.routeId} · ${row.routeUri} · запросов ${row.requests}, 4xx ${row.clientErrors}, 5xx ${row.serverErrors}`
              }
            >
              {row.requests === 0 ? (
                <span className="grid h-full place-items-center text-xs text-ink-400">—</span>
              ) : (
                <div className="flex w-full flex-col justify-end" style={{ height: `${height}%` }}>
                  {segments.map((segment) => (
                    <div
                      key={segment.key}
                      className={cx('w-full', BAR_FILL[segment.tone])}
                      style={{ height: `${(segment.value / row.requests) * 100}%` }}
                    />
                  ))}
                </div>
              )}
            </div>
            <div className="mt-1 truncate text-[11px] text-ink-600" title={`${row.routeId} → ${row.routeUri}`}>
              {row.routeId}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/**
 * Столбцы прироста за интервал.
 *
 * Ряд короткий (до 40 замеров), но время по оси не сжимается: столбцы одинаковой
 * ширины в контейнере с собственным скроллом, иначе на телефоне график превратился бы
 * в кашу, а страница — в горизонтальную прокрутку.
 */
function TrendColumns({ points }: { points: Array<{ at: number; requests: number; errors: number; reset: boolean }> }) {
  const max = Math.max(...points.map((point) => point.requests), 1);
  return (
    <div className="relative overflow-x-auto">
      <div className="flex min-w-[30rem] items-end gap-1">
        {points.map((point) => {
          const ok = Math.max(0, point.requests - point.errors);
          return (
            <div
              key={point.at}
              className="flex h-24 w-3 shrink-0 flex-col justify-end overflow-hidden rounded-t bg-ink-100"
              title={`${formatClock(point.at)} · запросов ${point.requests}, ошибок ${point.errors}${
                point.reset ? ' · счётчики обнулились: шлюз перезапустился' : ''
              }`}
            >
              {point.errors > 0 ? (
                <div
                  className={cx('w-full', BAR_FILL.danger)}
                  style={{ height: `${(point.errors / max) * 100}%` }}
                />
              ) : null}
              <div className={cx('w-full', BAR_FILL.brand)} style={{ height: `${(ok / max) * 100}%` }} />
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** Кнопка копирования JSON: реальное действие, ничего не выдумывает. */
function CopyMetricsButton({ payload }: { payload: string }) {
  const [state, setState] = useState<'idle' | 'copied' | 'failed'>('idle');

  useEffect(() => {
    if (state === 'idle') {
      return;
    }
    const timer = window.setTimeout(() => setState('idle'), 2_000);
    return () => window.clearTimeout(timer);
  }, [state]);

  return (
    <Button
      variant="secondary"
      size="sm"
      disabled={payload === ''}
      onClick={() => {
        // `navigator.clipboard` недоступен вне защищённого контекста — тогда честно
        // говорим, что скопировать не вышло, вместо молчащего нажатия.
        const write = typeof navigator.clipboard?.writeText === 'function' ? navigator.clipboard.writeText(payload) : null;
        if (write === null) {
          setState('failed');
          return;
        }
        void write.then(
          () => setState('copied'),
          () => setState('failed'),
        );
      }}
    >
      {state === 'copied' ? 'JSON скопирован' : state === 'failed' ? 'Копирование недоступно' : 'Скопировать JSON метрик'}
    </Button>
  );
}

/* ------------------------------------------------------------------ запросы */

/**
 * Свой запрос на каждую панель.
 *
 * Ключ отличается, запрос — один и тот же: панели получают одну выдачу, но падают и
 * загружаются по отдельности, поэтому сломанная панель не превращает весь пульт в
 * сообщение об ошибке. `retry: 0` — потому что экран и так опрашивает шлюз каждые
 * 15 секунд, и повтор поверх опроса только добавляет шума.
 */
function usePulsePanelQuery(panel: string, intervalMs: number | false) {
  return useQuery({
    queryKey: ['admin', 'pulse', panel],
    queryFn: fetchPulseMetrics,
    refetchInterval: intervalMs,
    staleTime: 0,
    retry: 0,
  });
}

type PulseQuery = UseQueryResult<PulseMetrics, Error>;

/** Панель со своим состоянием: загрузка, ошибка с повтором, содержимое. */
function MetricsPanel({
  id,
  title,
  subtitle,
  action,
  query,
  skeletonRows = 3,
  className,
  children,
}: {
  id: string;
  title: string;
  subtitle?: ReactNode;
  action?: ReactNode;
  query: PulseQuery;
  skeletonRows?: number;
  className?: string;
  children: (metrics: PulseMetrics) => ReactNode;
}) {
  return (
    <Panel id={id} title={title} subtitle={subtitle} action={action} className={className}>
      {query.isPending ? <SkeletonRows count={skeletonRows} /> : null}
      {query.isError ? (
        <ErrorAlert
          error={query.error}
          title="Метрики шлюза не прочитаны"
          onRetry={() => void query.refetch()}
        />
      ) : null}
      {query.data !== undefined ? children(query.data) : null}
    </Panel>
  );
}

/* ------------------------------------------------------------ сам раздел */

export default function PulseSection({ role, canWrite }: AdminSectionProps) {
  // Остановка обновления — не «навсегда», а до возврата галочки: кнопка «Обновить»
  // работает в любом состоянии, поэтому один замер можно сделать и на паузе.
  const [live, setLive] = useState(true);
  const [routeFilter, setRouteFilter] = useState('');
  // Группа маршрутов из рейла: 'clean' | 'client' | 'server' | '' (все).
  const [routeGroup, setRouteGroup] = useState('');
  const [history, setHistory] = useState<PulseSample[]>([]);

  const interval = live ? REFRESH_INTERVAL_MS : false;

  const summary = usePulsePanelQuery('summary', interval);
  const kpis = usePulsePanelQuery('kpis', interval);
  const codes = usePulsePanelQuery('codes', interval);
  const routesChart = usePulsePanelQuery('routes-chart', interval);
  const routesTable = usePulsePanelQuery('routes-table', interval);
  const paths = usePulsePanelQuery('paths', interval);
  const resources = usePulsePanelQuery('resources', interval);
  const redisPanel = usePulsePanelQuery('redis', interval);
  const poolsPanel = usePulsePanelQuery('pools', interval);
  const logsPanel = usePulsePanelQuery('logs', interval);
  const trend = usePulsePanelQuery('trend', interval);
  const clientsPanel = usePulsePanelQuery('clients', interval);
  const healthPanel = useQuery({
    queryKey: ['admin', 'pulse', 'health'],
    queryFn: () => fetchGatewayHealth(),
    refetchInterval: interval,
    staleTime: 0,
    retry: 0,
  });

  /**
   * Ряд во времени собирает сам экран: шлюз отдаёт только кумулятивные счётчики, и
   * «сколько запросов было за последние 15 секунд» иначе не узнать. Замер с тем же
   * `dataUpdatedAt` не пишется дважды, поэтому перерисовки не растят ряд.
   */
  const trendData = trend.data;
  const trendUpdatedAt = trend.dataUpdatedAt;
  useEffect(() => {
    if (trendData === undefined || trendUpdatedAt === 0) {
      return;
    }
    setHistory((previous) =>
      appendPulseSample(previous, {
        at: trendUpdatedAt,
        requests: trendData.totals.requests,
        errors: trendData.totals.clientErrors + trendData.totals.serverErrors,
      }),
    );
  }, [trendData, trendUpdatedAt]);

  /**
   * Все запросы раздела в одном списке — для кнопки «Обновить» и для времени
   * последнего ответа. Список собирается на каждом рендере намеренно: объекты
   * результатов react-query и так новые, а `useMemo` здесь только запутал бы.
   */
  const allPanels = [
    summary,
    kpis,
    codes,
    routesChart,
    routesTable,
    paths,
    resources,
    redisPanel,
    poolsPanel,
    logsPanel,
    trend,
    clientsPanel,
    healthPanel,
  ];

  const refreshAll = () => {
    // Кэш общего текста сбрасывается до обновления: иначе нажатие «Обновить» в течение
    // секунды после автоматического опроса вернуло бы тот же самый ответ, и кнопка
    // выглядела бы сломанной. Тринадцать запросов при этом всё равно склеиваются в один
    // запрос к шлюзу — одновременные обращения панелей делят одну загрузку.
    resetPulseTextCache();
    void Promise.all(allPanels.map((panel) => panel.refetch()));
  };
  const refreshing = allPanels.some((panel) => panel.isFetching);
  const updatedAt = allPanels.reduce((latest, panel) => Math.max(latest, panel.dataUpdatedAt), 0);

  /** JSON для копирования: то же, что на экране, без выдуманных полей. */
  const jsonPayload = useMemo(() => {
    const metrics = summary.data;
    if (metrics === undefined) {
      return '';
    }
    return JSON.stringify(
      {
        source: PROMETHEUS_PATH,
        collectedAt: summary.dataUpdatedAt > 0 ? new Date(summary.dataUpdatedAt).toISOString() : null,
        samples: metrics.samples,
        totals: metrics.totals,
        routes: metrics.routes,
        statuses: metrics.statuses,
        serverStatuses: metrics.serverStatuses,
        topPaths: metrics.endpoints.slice(0, 10),
        memory: metrics.memory,
        jvm: metrics.jvm,
        threads: metrics.threads,
        process: metrics.process,
        system: metrics.system,
        redis: metrics.redis,
        pools: metrics.pools,
        clientCalls: metrics.clientCalls,
        security: metrics.security,
        logs: metrics.logs,
      },
      null,
      2,
    );
  }, [summary.data, summary.dataUpdatedAt]);

  const needle = routeFilter.trim().toLowerCase();

  /** Маршруты после обоих фильтров: рейл делит их на группы, поле ищет по имени и адресу. */
  const visibleRoutes = (rows: PulseRouteRow[]): PulseRouteRow[] =>
    rows.filter((row) => {
      const errors = row.clientErrors + row.serverErrors;
      const inGroup =
        routeGroup === ''
          ? true
          : routeGroup === 'clean'
            ? errors === 0
            : routeGroup === 'client'
              ? row.clientErrors > 0 && row.serverErrors === 0
              : row.serverErrors > 0;
      if (!inGroup) {
        return false;
      }
      if (needle === '') {
        return true;
      }
      return `${row.routeId} ${row.routeUri}`.toLowerCase().includes(needle);
    });

  /* ---- плитки: считаются из одной выдачи, но каждая со своей подписью-источником ---- */

  const metrics = kpis.data;
  const metricsFailed = kpis.isError;
  const value = (pick: (m: PulseMetrics) => string): string =>
    metrics !== undefined ? pick(metrics) : metricsFailed ? 'нет данных' : '—';
  /**
   * Подпись плитки оборачивается в `break-words`: в ней встречаются имена метрик
   * (`spring_cloud_gateway_requests_seconds_count`), а без переноса такое длинное слово
   * растягивает колонку сетки — и страница уезжает по горизонтали на телефоне.
   */
  const caption = (pick: (m: PulseMetrics) => string): ReactNode => (
    <span className="break-words">
      {metrics !== undefined ? pick(metrics) : metricsFailed ? humanMessage(kpis.error) : 'метрики загружаются…'}
    </span>
  );

  const codeRow = (rows: PulseStatusRow[], key: string): number =>
    rows.find((row) => row.key === key)?.requests ?? 0;

  return (
    <div className="space-y-5">
      {/*
        Тулбар: слева состояние экрана и фильтр по маршрутам, справа действия. Экспорт в
        файл здесь был бы обманом (метрики шлюза — не отчёт), поэтому вместо него
        копирование того же JSON, который видно на экране.
      */}
      <Toolbar
        right={
          <>
            <Button variant="secondary" size="sm" loading={refreshing} onClick={refreshAll}>
              Обновить
            </Button>
            <CheckboxField
              id="pulse-live"
              label="Остановить обновление"
              hint="Экран перестанет опрашивать шлюз; кнопка «Обновить» работает и на паузе."
              checked={!live}
              onChange={(event) => setLive(!event.target.checked)}
            />
            <CopyMetricsButton payload={jsonPayload} />
          </>
        }
      >
        {/* Фильтр первым, как в обычной админке: слева поиск, справа действия. */}
        <div className="w-full sm:w-60">
          <TextField
            id="pulse-route-filter"
            label="Фильтр по маршрутам"
            placeholder="routeId или адрес сервиса"
            value={routeFilter}
            hint="Фильтр по уже загруженной выдаче: у метрик шлюза параметра поиска нет."
            onChange={(event) => setRouteFilter(event.target.value)}
          />
        </div>
        <div className="text-xs text-ink-500">
          <p>
            Обновлено в <span className="tabular-nums text-ink-700">{formatClock(updatedAt)}</span>
            {updatedAt > 0 ? ` (${formatRelative(new Date(updatedAt).toISOString())})` : ''}
          </p>
          <p className="mt-0.5">
            Источник — <code className="font-mono">{PROMETHEUS_PATH}</code> шлюза: одна выдача на все панели.
          </p>
        </div>
        <Chip tone={live ? 'success' : 'warning'}>
          {live ? `Живое обновление каждые ${REFRESH_INTERVAL_MS / 1000} с` : 'Обновление остановлено'}
        </Chip>
      </Toolbar>

      {/* ---- ключевые числа ---- */}
      <Panel
        id="pulse-kpis"
        title="Ключевые числа шлюза"
        subtitle={`Счётчики кумулятивные — с момента старта шлюза, а не за последний час. Раздел ничего не меняет${
          canWrite ? ' (роль ADMIN — менять здесь всё равно нечего)' : ''
        }. Вы вошли как ${roleLabel(role)}.`}
        action={
          <Chip tone="neutral">
            {metrics !== undefined ? `серий метрик: ${formatCount(metrics.samples)}` : 'метрик нет'}
          </Chip>
        }
      >
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <KpiTile
            label="Запросов через шлюз"
            icon="🌐"
            tone="brand"
            loading={kpis.isPending}
            value={value((m) => formatCount(m.totals.requests))}
            caption={caption(
              (m) =>
                `маршрутов в счётчике: ${m.totals.observedRoutes} из ${m.totals.routeCount ?? '—'} объявленных · spring_cloud_gateway_requests_seconds_count`,
            )}
          />
          <KpiTile
            label="Ошибки 4xx+5xx"
            icon="⚠️"
            tone="warning"
            loading={kpis.isPending}
            value={value((m) => formatCount(m.totals.clientErrors + m.totals.serverErrors))}
            caption={caption(
              (m) =>
                `доля ${formatPercent(
                  m.totals.requests > 0 ? (m.totals.clientErrors + m.totals.serverErrors) / m.totals.requests : null,
                )} · 4xx: ${formatCount(m.totals.clientErrors)} · 5xx: ${formatCount(m.totals.serverErrors)}`,
            )}
          />
          <KpiTile
            label="Средняя задержка"
            icon="⏱️"
            tone="info"
            loading={kpis.isPending}
            value={value((m) => formatMs(m.totals.averageMs))}
            caption="Средняя по шлюзу целиком: сумма всех _sum на сумму всех _count. По каждому маршруту — в таблице ниже."
          />
          <KpiTile
            label="Максимум задержки"
            icon="🐢"
            tone="brand"
            loading={kpis.isPending}
            value={value((m) => formatMs(m.totals.maxMs))}
            caption="Максимум таймера: Micrometer держит его в скользящем окне (≈2 мин), поэтому это свежий пик, а не за всё время."
          />
          <KpiTile
            label="Память heap"
            icon="🧠"
            tone="brand"
            loading={kpis.isPending}
            value={value((m) =>
              m.memory.heap.maxBytes === null
                ? `${formatBytes(m.memory.heap.usedBytes)} из без предела`
                : `${formatBytes(m.memory.heap.usedBytes)} / ${formatBytes(m.memory.heap.maxBytes)}`,
            )}
            caption={caption(
              (m) =>
                `занято от максимума ${formatPercent(
                  m.memory.heap.maxBytes ? m.memory.heap.usedBytes / m.memory.heap.maxBytes : null,
                )} · nonheap занято ${formatBytes(m.memory.nonHeap.usedBytes)}`,
            )}
          />
          <KpiTile
            label="Время работы"
            icon="⏳"
            tone="success"
            loading={kpis.isPending}
            value={value((m) => formatDuration(m.process.uptimeSeconds))}
            caption={caption((m) => `process_uptime_seconds · запущен ${formatStartTime(m.process.startTimeSeconds)}`)}
          />
          <KpiTile
            label="Ошибки журнала"
            icon="🧾"
            tone="danger"
            loading={kpis.isPending}
            value={value((m) => formatCount(m.logs.error))}
            caption={caption(
              (m) => `logback_events_total{level="error"} · warn: ${formatCount(m.logs.warn)}, info: ${formatCount(m.logs.info)}`,
            )}
          />
          <KpiTile
            label="Маршрутов"
            icon="🛣️"
            tone="brand"
            loading={kpis.isPending}
            value={value((m) => formatCount(m.totals.routeCount ?? m.totals.observedRoutes))}
            caption={caption((m) =>
              m.totals.routeCount === null
                ? `счётчика маршрутов в выдаче нет — показано число маршрутов в счётчике запросов: ${m.totals.observedRoutes}`
                : `spring_cloud_gateway_routes_count · в счётчике запросов видно ${m.totals.observedRoutes}`,
            )}
          />
          <KpiTile
            label="Команд Redis"
            icon="🧮"
            tone="info"
            loading={kpis.isPending}
            value={value((m) => formatCount(m.redis.reduce((total, row) => total + row.count, 0)))}
            caption={caption((m) =>
              m.redis.length === 0
                ? 'lettuce_command_completion_seconds_*: серий нет'
                : `чаще всего: ${m.redis[0].command} (${formatCount(m.redis[0].count)}) · lettuce_command_completion_seconds_*`,
            )}
          />
          <KpiTile
            label="Отказов доступа"
            icon="🔐"
            tone="warning"
            loading={kpis.isPending}
            value={value((m) => (m.security.denied === null ? '—' : formatCount(m.security.denied)))}
            caption={caption((m) =>
              m.security.denied === null
                ? 'решений авторизации в выдаче нет'
                : `разрешено: ${formatCount(m.security.granted)} · spring_security_authorizations_seconds_count`,
            )}
          />
          <KpiTile
            label="Диск свободно"
            icon="💾"
            tone="neutral"
            loading={kpis.isPending}
            value={value((m) => formatBytes(m.system.diskFreeBytes))}
            caption={caption(
              (m) =>
                `disk_free_bytes из ${formatBytes(m.system.diskTotalBytes)} · свободно ${formatPercent(
                  m.system.diskTotalBytes ? (m.system.diskFreeBytes ?? 0) / m.system.diskTotalBytes : null,
                )}`,
            )}
          />
          <KpiTile
            label="Потоки JVM"
            icon="🧵"
            tone="neutral"
            loading={kpis.isPending}
            value={value((m) => formatCount(m.threads.live))}
            caption={caption(
              (m) => `jvm_threads_live_threads · демонов: ${formatCount(m.threads.daemon)}, пик: ${formatCount(m.threads.peak)}`,
            )}
          />
        </div>
      </Panel>

      {/* ---- коды ответов: карточки-статусы и кольцо ---- */}
      <MetricsPanel
        id="pulse-codes"
        title="Коды ответов"
        subtitle="Разбивка счётчика маршрутов по httpStatusCode. Коды, которых нет в выдаче, показаны нулём: счётчики кумулятивные, значит таких ответов с момента старта не было."
        query={codes}
        action={<Chip tone="neutral">{codes.data ? `ответов с кодом: ${formatCount(codes.data.statuses.coded)}` : '—'}</Chip>}
      >
        {(m) => (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
              <StatusCard
                icon="✅"
                title="200 — успех"
                tone="success"
                requests={codeRow(m.statuses.rows, '200')}
                share={m.statuses.coded > 0 ? codeRow(m.statuses.rows, '200') / m.statuses.coded : null}
                hint="Ответы, которые шлюз отдал с кодом 200"
              />
              <StatusCard
                icon="🔑"
                title="401 — без токена"
                tone="info"
                requests={codeRow(m.statuses.rows, '401')}
                share={m.statuses.coded > 0 ? codeRow(m.statuses.rows, '401') / m.statuses.coded : null}
                hint="Отказы до маршрутизации в счётчике маршрутов не видны — их число есть в блоке «Ответы шлюза целиком»"
              />
              <StatusCard
                icon="⛔"
                title="403 — нет прав"
                tone="warning"
                requests={codeRow(m.statuses.rows, '403')}
                share={m.statuses.coded > 0 ? codeRow(m.statuses.rows, '403') / m.statuses.coded : null}
                hint="Токен принят, но роли для операции не хватило"
              />
              <StatusCard
                icon="🧭"
                title="404 — нет пути"
                tone="neutral"
                requests={codeRow(m.statuses.rows, '404')}
                share={m.statuses.coded > 0 ? codeRow(m.statuses.rows, '404') / m.statuses.coded : null}
                hint="Путь не найден: чаще всего опечатка в адресе или устаревшая ссылка в клиенте"
              />
              <StatusCard
                icon="🚫"
                title="405 — метод"
                tone="brand"
                requests={codeRow(m.statuses.rows, '405')}
                share={m.statuses.coded > 0 ? codeRow(m.statuses.rows, '405') / m.statuses.coded : null}
                hint="Метод не разрешён для этого пути"
              />
              <StatusCard
                icon="📉"
                title="4xx всего"
                tone="warning"
                requests={m.totals.clientErrors}
                share={m.totals.requests > 0 ? m.totals.clientErrors / m.totals.requests : null}
                hint="Все ответы 4xx, включая 401/403/404/405 выше и прочие коды"
              />
              <StatusCard
                icon="🛑"
                title="5xx — ошибки"
                tone="danger"
                requests={m.totals.serverErrors}
                share={m.totals.requests > 0 ? m.totals.serverErrors / m.totals.requests : null}
                hint="Ошибки шлюза или сервиса: именно их разбирают первыми"
              />
              <StatusCard
                icon="📕"
                title="Ошибки журнала"
                tone="danger"
                requests={m.logs.error}
                share={null}
                hint="Это не код ответа, а счётчик logback_events_total{level=error} — записи журнала шлюза с момента старта"
              />
            </div>

            <div className="grid gap-4 xl:grid-cols-2">
              <Donut
                segments={m.statuses.rows
                  .filter((row) => row.requests > 0)
                  .map((row) => ({
                    key: row.key,
                    label: row.title,
                    value: row.requests,
                    tone: STATUS_TONE[row.tone],
                  }))}
                centerLabel="ответов с кодом"
                centerValue={formatCount(m.statuses.coded)}
              />

              <div className="space-y-3">
                <div>
                  <h3 className="text-xs font-medium tracking-wide text-ink-500 uppercase">
                    Ответы шлюза целиком
                  </h3>
                  <p className="mt-1 text-xs text-ink-500">
                    <code className="font-mono">http_server_requests</code> — сюда попадает всё, что шлюз ответил
                    сам: служебные <code className="font-mono">/actuator/*</code> (в том числе эта страница) и отказы
                    до маршрутизации, которых в счётчике маршрутов нет вовсе.
                  </p>
                </div>
                <ul className="divide-y divide-ink-100">
                  {m.serverStatuses.map((row) => (
                    <li key={row.status} className="flex items-center justify-between gap-3 py-1.5 text-sm">
                      <span className="text-ink-700">{`код ${row.status}`}</span>
                      <span className="tabular-nums font-medium text-ink-900">{formatCount(row.requests)}</span>
                    </li>
                  ))}
                  {m.serverStatuses.length === 0 ? (
                    <li className="py-2 text-sm text-ink-500">Серий http_server_requests в выдаче нет.</li>
                  ) : null}
                </ul>
                {m.statuses.uncoded > 0 ? (
                  <p className="text-xs text-ink-500">
                    {`Ещё ${formatCount(m.statuses.uncoded)} ответов пришли сериями без метки httpStatusCode — их нельзя отнести ни к одному коду, поэтому они не показаны ни здесь, ни в кольце.`}
                  </p>
                ) : null}
              </div>
            </div>
          </div>
        )}
      </MetricsPanel>

      {/* ---- диаграмма нагрузки по маршрутам ---- */}
      <MetricsPanel
        id="pulse-route-chart"
        title="Нагрузка по маршрутам"
        subtitle="Накоплено с момента старта шлюза: истории метрик шлюз не отдаёт, поэтому столбцы — это суммарные запросы, а не «за час»."
        query={routesChart}
        skeletonRows={2}
        action={
          <Legend
            items={[
              { key: 'ok', label: 'успешные', tone: 'success' },
              { key: '4xx', label: '4xx', tone: 'warning' },
              { key: '5xx', label: '5xx', tone: 'danger' },
              { key: 'none', label: 'серии без кода', tone: 'neutral' },
            ]}
          />
        }
      >
        {(m) => {
          const rows = visibleRoutes(m.routes);
          const hidden = m.routes.length - rows.length;
          return (
            <div className="space-y-3">
              <RouteColumns rows={rows} />
              <p className="text-xs text-ink-500">
                {`Столбец — один маршрут шлюза (routeId), высота — всего запросов, внутри — исход ответа. Показано ${rows.length} из ${m.routes.length}${
                  hidden > 0 ? ` (остальные ${hidden} скрыты фильтром)` : ''
                }.`}
              </p>
            </div>
          );
        }}
      </MetricsPanel>

      {/* ---- таблица маршрутов с рейлом групп ---- */}
      <MetricsPanel
        id="pulse-routes"
        title="Маршруты: детали"
        subtitle="Средняя задержка считается по каждому маршруту отдельно: _sum этого маршрута делится на его же _count."
        query={routesTable}
        skeletonRows={4}
        action={
          routesTable.data ? (
            <Chip tone="neutral">
              {`показано ${visibleRoutes(routesTable.data.routes).length} из ${routesTable.data.routes.length}`}
            </Chip>
          ) : null
        }
      >
        {(m) => {
          const rows = visibleRoutes(m.routes);
          const railItems = [
            {
              value: 'clean',
              label: 'Без ошибок',
              count: m.routes.filter((row) => row.clientErrors + row.serverErrors === 0).length,
            },
            {
              value: 'client',
              label: 'Только 4xx',
              count: m.routes.filter((row) => row.clientErrors > 0 && row.serverErrors === 0).length,
            },
            {
              value: 'server',
              label: 'Есть 5xx',
              count: m.routes.filter((row) => row.serverErrors > 0).length,
            },
          ];
          return (
            <div className="space-y-4 lg:grid lg:grid-cols-[14rem_minmax(0,1fr)] lg:gap-4 lg:space-y-0">
              <div className="rounded-xl border border-ink-200 p-2">
                <StatusRail
                  items={railItems}
                  active={routeGroup}
                  onSelect={setRouteGroup}
                  allLabel="Все маршруты"
                  allCount={m.routes.length}
                  ariaLabel="Группы маршрутов по ошибкам"
                />
                <p className="mt-2 px-1 text-xs text-ink-500">
                  Группа и поле поиска в тулбаре действуют вместе: числа в рейле — по всей выдаче, а не по
                  отфильтрованным строкам.
                </p>
              </div>

              {rows.length === 0 ? (
                <EmptyState
                  title="Под фильтр ничего не подошло"
                  description="Ни один маршрут не попал в выбранную группу и поиск. Числа в рейле считаются по всей выдаче, поэтому очистить фильтр — самый быстрый способ вернуть строки."
                />
              ) : (
                <div className="relative overflow-x-auto">
                  <table className="w-full min-w-[46rem] border-collapse text-sm">
                  <caption className="sr-only">
                    Нагрузка по маршрутам шлюза: запросы, доля, ошибки 4xx и 5xx, средняя и максимальная задержка
                  </caption>
                  <thead>
                    <tr className="border-b border-ink-200 text-left text-xs text-ink-500">
                      <th scope="col" className="py-2 pr-3 font-medium">Сервис (маршрут)</th>
                      <th scope="col" className="py-2 pr-3 text-right font-medium">Запросов</th>
                      <th scope="col" className="py-2 pr-3 font-medium">Доля нагрузки</th>
                      <th scope="col" className="py-2 pr-3 text-right font-medium">4xx</th>
                      <th scope="col" className="py-2 pr-3 text-right font-medium">5xx</th>
                      <th scope="col" className="py-2 pr-3 text-right font-medium">Средняя</th>
                      <th scope="col" className="py-2 text-right font-medium">Максимум</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((row) => (
                      <tr key={row.routeId} className="border-b border-ink-100 align-top">
                        <td className="py-2 pr-3">
                          <span className="block text-ink-900">{row.routeId}</span>
                          <span className="mt-0.5 block font-mono text-xs break-all text-ink-400">
                            {row.routeUri === '' ? 'адрес в метке не пришёл' : row.routeUri}
                          </span>
                          {row.uncoded > 0 ? (
                            <span className="mt-0.5 block text-xs text-ink-500">
                              {`без кода ответа: ${formatCount(row.uncoded)}`}
                            </span>
                          ) : null}
                        </td>
                        <td className="py-2 pr-3 text-right tabular-nums text-ink-900">{formatCount(row.requests)}</td>
                        <td className="py-2 pr-3">
                          <ShareBar value={row.requests} max={m.totals.requests} />
                        </td>
                        <td className="py-2 pr-3 text-right tabular-nums text-ink-700">
                          {row.clientErrors > 0 ? formatCount(row.clientErrors) : '—'}
                        </td>
                        <td className="py-2 pr-3 text-right tabular-nums text-ink-700">
                          {row.serverErrors > 0 ? formatCount(row.serverErrors) : '—'}
                        </td>
                        <td className="py-2 pr-3 text-right tabular-nums text-ink-700">{formatMs(row.averageMs)}</td>
                        <td className="py-2 text-right tabular-nums text-ink-700">{formatMs(row.maxMs)}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="text-ink-900">
                      <td className="py-2 pr-3 font-medium">{`Итого: ${rows.length} из ${m.routes.length} маршрутов`}</td>
                      <td className="py-2 pr-3 text-right font-medium tabular-nums">
                        {formatCount(rows.reduce((total, row) => total + row.requests, 0))}
                      </td>
                      <td className="py-2 pr-3 text-xs text-ink-500">
                        {rows.length === m.routes.length ? 'доля от всех запросов через шлюз' : 'доля от всех запросов через шлюз (видны не все маршруты)'}
                      </td>
                      <td className="py-2 pr-3 text-right font-medium tabular-nums">
                        {formatCount(rows.reduce((total, row) => total + row.clientErrors, 0))}
                      </td>
                      <td className="py-2 pr-3 text-right font-medium tabular-nums">
                        {formatCount(rows.reduce((total, row) => total + row.serverErrors, 0))}
                      </td>
                      <td className="py-2 pr-3 text-right text-xs text-ink-500">{`по шлюзу: ${formatMs(m.totals.averageMs)}`}</td>
                      <td className="py-2 text-right text-xs text-ink-500">{formatMs(m.totals.maxMs)}</td>
                    </tr>
                  </tfoot>
                </table>
                </div>
              )}
            </div>
          );
        }}
      </MetricsPanel>

      {/* ---- топ путей ---- */}
      <MetricsPanel
        id="pulse-paths"
        title="Топ путей"
        subtitle="http_server_requests по шаблонам путей. Значения UNKNOWN и NOT_FOUND — не ошибка метрики: это ответы, которые шлюз не сопоставил с шаблоном (404 до маршрутизации, отказ без токена)."
        query={paths}
        skeletonRows={5}
        action={<Chip tone="neutral">первые 10 по количеству</Chip>}
      >
        {(m) => {
          const top = m.endpoints.slice(0, 10);
          return (
            <div className="relative overflow-x-auto">
              <table className="w-full min-w-[42rem] border-collapse text-sm">
                <caption className="sr-only">Самые нагруженные пути шлюза: метод, количество запросов и ошибки</caption>
                <thead>
                  <tr className="border-b border-ink-200 text-left text-xs text-ink-500">
                    <th scope="col" className="py-2 pr-3 font-medium">Метод</th>
                    <th scope="col" className="py-2 pr-3 font-medium">Путь</th>
                    <th scope="col" className="py-2 pr-3 text-right font-medium">Запросов</th>
                    <th scope="col" className="py-2 pr-3 text-right font-medium">4xx</th>
                    <th scope="col" className="py-2 pr-3 text-right font-medium">5xx</th>
                    <th scope="col" className="py-2 font-medium">Доля</th>
                  </tr>
                </thead>
                <tbody>
                  {top.map((row) => (
                    <tr key={`${row.method} ${row.uri}`} className="border-b border-ink-100">
                      <td className="py-2 pr-3 font-mono text-xs text-ink-600">{row.method === '' ? '—' : row.method}</td>
                      <td className="py-2 pr-3 font-mono text-xs break-all text-ink-800">{row.uri}</td>
                      <td className="py-2 pr-3 text-right tabular-nums text-ink-900">{formatCount(row.requests)}</td>
                      <td className="py-2 pr-3 text-right tabular-nums text-ink-700">
                        {row.clientErrors > 0 ? formatCount(row.clientErrors) : '—'}
                      </td>
                      <td className="py-2 pr-3 text-right tabular-nums text-ink-700">
                        {row.serverErrors > 0 ? formatCount(row.serverErrors) : '—'}
                      </td>
                      <td className="py-2">
                        <ShareBar value={row.requests} max={top[0]?.requests ?? 1} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="mt-2 text-xs text-ink-500">
                {`Показаны ${top.length} из ${m.endpoints.length} путей. Пути приходят шаблонами: /api/v1/payments/{id} — это все платежи сразу, а не один идентификатор.`}
              </p>
            </div>
          );
        }}
      </MetricsPanel>

      {/* ---- ресурсы ---- */}
      <MetricsPanel
        id="pulse-resources"
        title="Ресурсы шлюза и хоста"
        subtitle="JVM, сборка мусора, потоки, процессор и диск. Память показана по областям: heap ограничен максимумом, nonheap JVM обычно не ограничивает вовсе."
        query={resources}
        skeletonRows={4}
        action={resources.data ? <Chip tone="neutral">{`серий: ${formatCount(resources.data.samples)}`}</Chip> : null}
      >
        {(m) => {
          const averagePause = m.jvm.gcCollections > 0 ? m.jvm.gcPauseMs / m.jvm.gcCollections : null;
          return (
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
              <MiniStat title="Память JVM">
                <DetailRow label="Heap занято / максимум">
                  {`${formatBytes(m.memory.heap.usedBytes)} / ${
                    m.memory.heap.maxBytes === null ? 'без предела' : formatBytes(m.memory.heap.maxBytes)
                  }`}
                </DetailRow>
                <DetailRow label="Heap занято от максимума">
                  {formatPercent(m.memory.heap.maxBytes ? m.memory.heap.usedBytes / m.memory.heap.maxBytes : null)}
                </DetailRow>
                <DetailRow label="Heap выделено JVM">{formatBytes(m.memory.heap.committedBytes)}</DetailRow>
                <DetailRow label="Nonheap занято">{formatBytes(m.memory.nonHeap.usedBytes)}</DetailRow>
                <DetailRow label="Nonheap выделено">{formatBytes(m.memory.nonHeap.committedBytes)}</DetailRow>
                <DetailRow label="Nonheap максимум">
                  {m.memory.nonHeap.maxBytes === null ? 'без предела (JVM отдаёт −1)' : formatBytes(m.memory.nonHeap.maxBytes)}
                </DetailRow>
              </MiniStat>

              <MiniStat title="Сборка мусора">
                <DetailRow label="Сборок всего">{formatCount(m.jvm.gcCollections)}</DetailRow>
                <DetailRow label="Суммарная пауза">{formatMs(m.jvm.gcPauseMs)}</DetailRow>
                <DetailRow label="Средняя пауза">{formatMs(averagePause)}</DetailRow>
                <DetailRow label="Метрика">jvm_gc_pause_seconds_count / _sum</DetailRow>
              </MiniStat>

              <MiniStat title="Потоки">
                <DetailRow label="Живых">{formatCount(m.threads.live)}</DetailRow>
                <DetailRow label="Демонов">{formatCount(m.threads.daemon)}</DetailRow>
                <DetailRow label="Пик за время работы">{formatCount(m.threads.peak)}</DetailRow>
                {m.threads.states.map((state) => (
                  <DetailRow key={state.state} label={state.title}>{formatCount(state.threads)}</DetailRow>
                ))}
              </MiniStat>

              <MiniStat title="Процесс шлюза">
                <DetailRow label="Процессор процесса">{formatPercent(m.process.cpuUsage)}</DetailRow>
                <DetailRow label="Время работы">{formatDuration(m.process.uptimeSeconds)}</DetailRow>
                <DetailRow label="Открытых файлов">{formatCount(m.process.openFiles)}</DetailRow>
                <DetailRow label="Старт процесса">{formatStartTime(m.process.startTimeSeconds)}</DetailRow>
              </MiniStat>

              <MiniStat title="Хост">
                <DetailRow label="Процессор системы">{formatPercent(m.system.cpuUsage)}</DetailRow>
                <DetailRow label="Ядер">{formatCount(m.system.cpuCount)}</DetailRow>
                <DetailRow label="Load average 1m">
                  {m.system.loadAverage1m === null ? '—' : m.system.loadAverage1m.toFixed(2).replace('.', ',')}
                </DetailRow>
                <DetailRow label="Диск: свободно / всего">
                  {`${formatBytes(m.system.diskFreeBytes)} / ${formatBytes(m.system.diskTotalBytes)}`}
                </DetailRow>
                <DetailRow label="Свободно на диске">
                  {formatPercent(
                    m.system.diskTotalBytes && m.system.diskFreeBytes !== null
                      ? m.system.diskFreeBytes / m.system.diskTotalBytes
                      : null,
                  )}
                </DetailRow>
              </MiniStat>

              <div className="rounded-xl border border-dashed border-ink-200 p-3 text-xs leading-relaxed text-ink-500">
                <p className="font-medium text-ink-600">Как читать эти числа</p>
                <ul className="mt-1 list-disc space-y-1 pl-4">
                  <li>
                    Load average и процессор системы в контейнере считаются по хосту: загружен не только шлюз, но и
                    соседние сервисы.
                  </li>
                  <li>
                    Heap-максимум — то, что JVM разрешила себе взять. Занятые 2 % максимума означают, что памяти
                    хватает, а не что шлюз «простаивает».
                  </li>
                  <li>
                    Паузы сборки мусора — суммарные с момента старта; отдельной истории по интервалам шлюз не отдаёт.
                  </li>
                </ul>
              </div>
            </div>
          );
        }}
      </MetricsPanel>

      {/* ---- Redis и пулы ---- */}
      <div className="grid gap-4 xl:grid-cols-2">
        <MetricsPanel
          id="pulse-redis"
          title="Redis: лимитер шлюза"
          subtitle={
            <span className="break-words">
              lettuce_command_completion_seconds_* — команды, которые шлюз отправил в Redis, где живут лимиты.
              Максимум в скользящем окне: ноль при ненулевом количестве значит, что в последние минуты команда не
              выполнялась.
            </span>
          }
          query={redisPanel}
          skeletonRows={3}
          // Панель стоит в сетке рядом с таблицей пулов: без `min-w-0` таблица с
          // `min-w-[36rem]` растянула бы колонку и страница уехала бы по горизонтали.
          className="min-w-0"
        >
          {(m) => (
            <div className="relative overflow-x-auto">
              <table className="w-full border-collapse text-sm">
                <caption className="sr-only">Команды Redis: количество, средняя и максимальная задержка</caption>
                <thead>
                  <tr className="border-b border-ink-200 text-left text-xs text-ink-500">
                    <th scope="col" className="py-2 pr-3 font-medium">Команда</th>
                    <th scope="col" className="py-2 pr-3 text-right font-medium">Раз</th>
                    <th scope="col" className="py-2 pr-3 text-right font-medium">Средняя</th>
                    <th scope="col" className="py-2 text-right font-medium">Максимум</th>
                  </tr>
                </thead>
                <tbody>
                  {m.redis.map((row) => (
                    <tr key={row.command} className="border-b border-ink-100">
                      <td className="py-2 pr-3 font-mono text-xs text-ink-800">{row.command}</td>
                      <td className="py-2 pr-3 text-right tabular-nums text-ink-900">{formatCount(row.count)}</td>
                      <td className="py-2 pr-3 text-right tabular-nums text-ink-700">{formatMs(row.averageMs)}</td>
                      <td className="py-2 text-right tabular-nums text-ink-700">{formatMs(row.maxMs)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {m.redis.length === 0 ? (
                <p className="mt-2 text-sm text-ink-500">
                  Серий lettuce в выдаче нет: шлюз не ходил в Redis с момента старта либо лимитер выключен.
                </p>
              ) : null}
            </div>
          )}
        </MetricsPanel>

        <MetricsPanel
          id="pulse-pools"
          title="Пулы потоков"
          subtitle="executor_* — пулы, которые шлюз зарегистрировал у Micrometer. В живой выдаче их немного: реакторные пулы Reactor Netty своих executor-метрик не публикуют, а лимитер считает Redis, поэтому пула rate-limiter здесь нет."
          query={poolsPanel}
          skeletonRows={2}
          className="min-w-0"
        >
          {(m) => (
            <div className="relative overflow-x-auto">
              <table className="w-full min-w-[36rem] border-collapse text-sm">
                <caption className="sr-only">Пулы потоков шлюза: активные, в очереди, завершено, пределы</caption>
                <thead>
                  <tr className="border-b border-ink-200 text-left text-xs text-ink-500">
                    <th scope="col" className="py-2 pr-3 font-medium">Пул</th>
                    <th scope="col" className="py-2 pr-3 text-right font-medium">Активных</th>
                    <th scope="col" className="py-2 pr-3 text-right font-medium">В очереди</th>
                    <th scope="col" className="py-2 pr-3 text-right font-medium">Завершено</th>
                    <th scope="col" className="py-2 text-right font-medium">Предел пула</th>
                  </tr>
                </thead>
                <tbody>
                  {m.pools.map((pool: PulsePool) => (
                    <tr key={pool.pool} className="border-b border-ink-100">
                      <td className="py-2 pr-3">
                        <span className="block font-mono text-xs text-ink-800">{pool.pool}</span>
                        <span className="mt-0.5 block text-xs text-ink-500">
                          {`ядро ${formatCount(pool.core)} · потоков сейчас ${formatCount(pool.size)}`}
                        </span>
                      </td>
                      <td className="py-2 pr-3 text-right tabular-nums text-ink-900">{formatCount(pool.active)}</td>
                      <td className="py-2 pr-3 text-right tabular-nums text-ink-700">{formatCount(pool.queued)}</td>
                      <td className="py-2 pr-3 text-right tabular-nums text-ink-700">{formatCount(pool.completed)}</td>
                      <td className="py-2 text-right tabular-nums text-ink-700">{formatPoolLimit(pool.max)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {m.pools.length === 0 ? (
                <p className="mt-2 text-sm text-ink-500">Серий executor_* в выдаче нет.</p>
              ) : null}
            </div>
          )}
        </MetricsPanel>
      </div>

      {/* ---- журнал по уровням ---- */}
      <MetricsPanel
        id="pulse-logs"
        title="Журнал по уровням"
        subtitle="logback_events_total — счётчики записей журнала с момента старта шлюза, а не за последний час: истории шлюз не отдаёт, а при перезапуске счётчики начинаются с нуля."
        query={logsPanel}
        skeletonRows={3}
      >
        {(m) => {
          const events = m.logs.error + m.logs.warn + m.logs.info + m.logs.debug + m.logs.trace;
          const levels = [
            { key: 'error', label: 'error', value: m.logs.error, tone: 'danger' as KitTone },
            { key: 'warn', label: 'warn', value: m.logs.warn, tone: 'warning' as KitTone },
            { key: 'info', label: 'info', value: m.logs.info, tone: 'info' as KitTone },
            { key: 'debug', label: 'debug', value: m.logs.debug, tone: 'neutral' as KitTone },
            { key: 'trace', label: 'trace', value: m.logs.trace, tone: 'neutral' as KitTone },
          ];
          return (
            <div className="space-y-3">
              <BarList
                items={levels.map((level) => ({
                  key: level.key,
                  label: level.label,
                  value: level.value,
                  tone: level.tone,
                  hint: events > 0 ? `${formatPercent(level.value / events)} от всех записей` : 'записей нет',
                }))}
              />
              <p className="text-xs text-ink-500">
                {`Всего записей: ${formatCount(events)}. Полосы построены от самой частой записи, поэтому редкий уровень и выглядит редким. Текста самих записей здесь нет — метрика считает только количество; что именно упало, смотрите в логах контейнера шлюза.`}
              </p>
            </div>
          );
        }}
      </MetricsPanel>

      {/* ---- ряд за время открытия экрана ---- */}
      <MetricsPanel
        id="pulse-trend"
        title="Ряд за время открытия экрана"
        subtitle="Своей истории метрик шлюз не отдаёт, поэтому ряд собирает этот экран: раз в 15 секунд берётся замер, а столбец — это прирост между двумя соседними замерами."
        query={trend}
        skeletonRows={2}
        action={<Chip tone={live ? 'success' : 'warning'}>{live ? 'замер каждые 15 с' : 'замеры на паузе'}</Chip>}
      >
        {() => {
          const points = trendPoints(history);
          const resets = points.filter((point) => point.reset).length;
          const spanSeconds = history.length > 1 ? (history[history.length - 1].at - history[0].at) / 1000 : 0;
          const busiest = points.reduce((max, point) => Math.max(max, point.requests), 0);
          return (
            <div className="space-y-3">
              {points.length === 0 ? (
                <p className="text-sm text-ink-500">
                  {history.length === 0
                    ? 'Ряд начнётся с первого ответа шлюза: пока замеров нет.'
                    : 'Первый замер уже есть, но прирост считается между двумя: следующий столбец появится через 15 секунд (или после нажатия «Обновить»).'}
                </p>
              ) : (
                <>
                  <Legend
                    items={[
                      { key: 'ok', label: 'запросы за интервал', tone: 'brand' },
                      { key: '5xx', label: 'из них с ошибкой', tone: 'danger' },
                    ]}
                  />
                  <TrendColumns points={points} />
                </>
              )}
              <p className="text-xs text-ink-500">
                {points.length === 0
                  ? `Замеров сделано: ${history.length}.`
                  : `Замеров: ${history.length}, ряд собран этим экраном за ${formatDuration(spanSeconds)} · самый нагруженный интервал — ${formatCount(busiest)} запросов${
                      resets > 0
                        ? `. Счётчики обнулялись ${resets} раз: это перезапуск шлюза, прирост за такие интервалы неизвестен и показан нулём`
                        : ''
                    }.`}
              </p>
            </div>
          );
        }}
      </MetricsPanel>

      {/* ---- вызовы к сервисам и защита ---- */}
      <MetricsPanel
        id="pulse-clients"
        title="Шлюз → сервисы и защита"
        subtitle="http_client_requests_* — исходящие вызовы шлюза: сколько раз он сходил в сервис и чем это кончилось. Это взгляд шлюза, а не метрики сервиса: пути в этой серии нет, только маршрут и код."
        query={clientsPanel}
        skeletonRows={3}
      >
        {(m) => (
          <div className="space-y-4">
            <div className="relative overflow-x-auto">
              <table className="w-full min-w-[42rem] border-collapse text-sm">
                <caption className="sr-only">Исходящие вызовы шлюза к сервисам: количество, коды ошибок и задержки</caption>
                <thead>
                  <tr className="border-b border-ink-200 text-left text-xs text-ink-500">
                    <th scope="col" className="py-2 pr-3 font-medium">Маршрут</th>
                    <th scope="col" className="py-2 pr-3 text-right font-medium">Вызовов</th>
                    <th scope="col" className="py-2 pr-3 text-right font-medium">4xx</th>
                    <th scope="col" className="py-2 pr-3 text-right font-medium">5xx</th>
                    <th scope="col" className="py-2 pr-3 text-right font-medium">Средняя</th>
                    <th scope="col" className="py-2 text-right font-medium">Максимум</th>
                  </tr>
                </thead>
                <tbody>
                  {m.clientCalls.map((row: PulseClientRow) => (
                    <tr key={row.routeId} className="border-b border-ink-100">
                      <td className="py-2 pr-3">
                        <span className="block text-ink-900">{row.routeId}</span>
                        <span className="mt-0.5 block font-mono text-xs break-all text-ink-400">
                          {row.routeUri === '' ? '—' : row.routeUri}
                        </span>
                      </td>
                      <td className="py-2 pr-3 text-right tabular-nums text-ink-900">{formatCount(row.calls)}</td>
                      <td className="py-2 pr-3 text-right tabular-nums text-ink-700">
                        {row.clientErrors > 0 ? formatCount(row.clientErrors) : '—'}
                      </td>
                      <td className="py-2 pr-3 text-right tabular-nums text-ink-700">
                        {row.serverErrors > 0 ? formatCount(row.serverErrors) : '—'}
                      </td>
                      <td className="py-2 pr-3 text-right tabular-nums text-ink-700">{formatMs(row.averageMs)}</td>
                      <td className="py-2 text-right tabular-nums text-ink-700">{formatMs(row.maxMs)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {m.clientCalls.length === 0 ? (
                <p className="mt-2 text-sm text-ink-500">Серий http_client_requests в выдаче нет.</p>
              ) : null}
            </div>

            <div className="grid gap-4 sm:grid-cols-3">
              <MiniStat title="Через фильтр безопасности">
                <DetailRow label="Запросов">{formatCount(m.security.securedRequests)}</DetailRow>
                <DetailRow label="Метрика">
                  {/* Имя метрики длинное и без пробелов — иначе оно растягивает колонку сетки. */}
                  <span className="break-all">spring_security_http_secured_requests_seconds_count</span>
                </DetailRow>
              </MiniStat>
              <MiniStat title="Решения авторизации">
                <DetailRow label="Разрешено">{formatCount(m.security.granted)}</DetailRow>
                <DetailRow label="Отклонено">{formatCount(m.security.denied)}</DetailRow>
              </MiniStat>
              <div className="rounded-xl border border-dashed border-ink-200 p-3 text-xs leading-relaxed text-ink-500">
                <p className="font-medium text-ink-600">Оговорка про эти числа</p>
                <p className="mt-1">
                  У серии защищённых запросов нет метки со статусом — только общее количество, поэтому разбить её на
                  401 и 403 нельзя. Разбивка по кодам есть выше, в блоке «Ответы шлюза целиком».
                </p>
              </div>
            </div>
          </div>
        )}
      </MetricsPanel>

      {/* ---- живость шлюза ---- */}
      <Panel
        id="pulse-health"
        title="Жив ли шлюз"
        subtitle="GET /actuator/health — единственный публичный health платформы. Это отдельный запрос: если метрики закрыты токеном, состояние шлюза всё равно видно."
        action={
          <Button
            variant="secondary"
            size="sm"
            loading={healthPanel.isFetching}
            onClick={() => void healthPanel.refetch()}
          >
            Проверить снова
          </Button>
        }
      >
        {healthPanel.isPending ? <SkeletonRows count={2} /> : null}
        {healthPanel.isError ? (
          <ErrorAlert
            error={healthPanel.error}
            title="Состояние шлюза не получено"
            onRetry={() => void healthPanel.refetch()}
          />
        ) : null}
        {healthPanel.data ? <HealthBody health={healthPanel.data} checkedAt={healthPanel.dataUpdatedAt} /> : null}
      </Panel>

      {/* ---- чего здесь нет ---- */}
      <Panel
        id="pulse-gaps"
        title="Чего в этой выдаче нет"
        subtitle="Границы раздела: лучше сказать прямо, что сюда не попадает, чем показать выдуманное число."
      >
        <Alert tone="info" title="Что смотреть в других местах">
          <ul className="list-disc space-y-1.5 pl-5">
            <li>
              <b>Метрик Kafka, outbox и DLT нет ни одной серии.</b> Шлюз публикует метрики о себе и о своих вызовах,
              а не о брокере: в выдаче 85 серий, и все они про шлюз, JVM и его зависимости.
            </li>
            <li>
              <b>Метрик отдельных сервисов здесь тоже нет.</b> Есть только{' '}
              <code className="font-mono">http_client_requests_*</code> — взгляд шлюза на свои вызовы к сервисам.
              Прометеевские метрики самих сервисов (payment-service, trip-service и остальных) через шлюз не
              публикуются.
            </li>
            <li>
              <b>Prometheus-сервера и Grafana в проекте нет.</b> Поэтому история метрик не хранится нигде: на экране
              только текущие кумулятивные счётчики с момента старта шлюза, а ряд во времени собирает сам экран, пока
              он открыт.
            </li>
            <li>
              <b>Перцентилей (p95, p99) нет.</b> Гистограмму шлюз не включает — в выдаче нет ни одной серии{' '}
              <code className="font-mono">_bucket</code>, поэтому задержка показана средней и максимумом.
            </li>
            <li>
              <b>Текста журнала нет:</b> <code className="font-mono">logback_events_total</code> — это счётчики по
              уровням. Что именно упало, видно в логах контейнера шлюза.
            </li>
            <li>
              <b>Ошибки конкретных денег и поездок — не здесь.</b> Пульт отвечает на вопрос «жив ли шлюз и как он
              нагружен», а не «почему не прошёл конкретный платёж»: разбирать их удобнее в разделах{' '}
              <Link className="font-medium text-brand-700 hover:underline" to="/admin/payments">
                Платежи и возвраты
              </Link>
              ,{' '}
              <Link className="font-medium text-brand-700 hover:underline" to="/admin/trips">
                Поездки
              </Link>{' '}
              и{' '}
              <Link className="font-medium text-brand-700 hover:underline" to="/admin/orders">
                Заказы
              </Link>
              .
            </li>
          </ul>
        </Alert>
      </Panel>
    </div>
  );
}

/* --------------------------------------------------------------- мелочи внизу */

/** Предел пула: `Integer.MAX_VALUE` — это «без предела», а не два миллиарда потоков. */
function formatPoolLimit(max: number | null): string {
  if (max === null) {
    return '—';
  }
  return max >= 1_000_000_000 ? 'без предела' : formatCount(max);
}

/** Состояние шлюза: статус, HTTP-код и проверки, если шлюз их отдал. */
function HealthBody({ health, checkedAt }: { health: GatewayHealth; checkedAt: number }) {
  const tone: KitTone =
    health.status.toUpperCase() === 'UP' ? 'success' : health.status.toUpperCase() === 'DOWN' ? 'danger' : 'warning';

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone={tone}>{health.status}</Badge>
        <span className="text-sm text-ink-600">
          {health.status.toUpperCase() === 'UP'
            ? 'шлюз отвечает'
            : health.status.toUpperCase() === 'DOWN'
              ? 'шлюз сообщает, что его зависимость лежит'
              : `состояние «${health.status}»`}
        </span>
        <span className="text-xs text-ink-500">{`HTTP ${health.httpStatus}`}</span>
        {checkedAt > 0 ? (
          <span className="text-xs text-ink-500">{`· проверено в ${formatClock(checkedAt)}`}</span>
        ) : null}
      </div>

      {health.components.length > 0 ? (
        <ul className="divide-y divide-ink-100">
          {health.components.map((component) => (
            <li key={component.name} className="flex items-center justify-between gap-3 py-2 text-sm">
              <span className="font-mono text-xs text-ink-600">{component.name}</span>
              <Badge tone={component.status.toUpperCase() === 'UP' ? 'success' : 'danger'}>{component.status}</Badge>
            </li>
          ))}
        </ul>
      ) : (
        <EmptyState
          title="Шлюз ответил без детализации"
          description="В ответе пришёл только итоговый статус, без списка проверок: детали закрыты настройкой management.endpoint.health.show-details. По этому ответу нельзя сказать, какая именно зависимость шлюза лежит, — видно только, что он жив."
        />
      )}
    </div>
  );
}
