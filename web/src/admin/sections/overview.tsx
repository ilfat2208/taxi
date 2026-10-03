/**
 * Раздел «Обзор» админ-панели: рабочее место дежурного, а не набор карточек.
 *
 * Что здесь есть и на чём это построено:
 *
 *  1. <b>Плитки</b> (`data-admin-kpi`) — счётчики сервисов. Числа берутся из
 *     `Page.totalElements` настоящих листингов: агрегатов у сервисов нет, но `totalElements` —
 *     это счёт сервера по всему набору, а не длина страницы. Плитка, у которой число взять
 *     негде, пишет «нет данных» и причину, а не ноль.
 *  2. <b>Очереди внимания</b> — не только счётчики, но и сами строки: короткий id, сумма,
 *     время и ссылка в раздел, где запись разбирают. Пустая очередь честно говорит, что пуста.
 *  3. <b>Карта сервисов</b> — маршруты шлюза из `/actuator/prometheus`: сколько через каждый
 *     прошло запросов, сколько из них с ошибкой и какой был максимум. Шлюз — единственная точка,
 *     через которую идут все вызовы, поэтому его счётчики и есть нагрузка на сервис.
 *  4. <b>Диаграммы без библиотек</b> — полосы нагрузки по маршрутам и кольцо распределения
 *     платежей по статусам (общие блоки из `../kit`). Истории у API нет, поэтому подписано, за
 *     какой отрезок цифры: счётчики шлюза копятся с его запуска, кольцо считается по загруженной
 *     странице выборки.
 *  5. <b>Лента событий</b> — последние платежи, поездки и записи в одном списке: тип события,
 *     id, сумма и `formatRelative`. Ни одного выдуманного события: только строки листингов.
 *  6. <b>Ресурсы шлюза</b> — heap, процессор, диск, время работы и сборки мусора.
 *  7. <b>Блок «Чего здесь нет»</b> — прямым текстом про Kafka/outbox/DLT, по-сервисные метрики,
 *     Grafana и историю: их в API нет, поэтому нет ни графиков за сутки, ни алертов.
 *
 * Правила, которые держат раздел честным:
 *
 *  - каждый блок живёт своим `useQuery` и своей ошибкой: упавший trip-service не гасит цифры
 *    платежей, а «нет данных» появляется ровно там, где сервис не ответил;
 *  - запросы обновляются сами раз в 30 секунд, кнопка «Обновить» перезапрашивает все блоки
 *    сразу, рядом видно время последнего ответа;
 *  - изменяющих действий у обзора нет вовсе, поэтому `data-admin-write` здесь не встречается;
 *  - ключи react-query локальные (`['admin','overview',…]`): общий `src/lib/queryKeys.ts` не
 *    трогаем, он принадлежит всему приложению.
 */
import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import {
  fetchBookings,
  fetchOrders,
  fetchPayments,
  fetchProducts,
  fetchQtimeCompanies,
  fetchTrips,
} from '../../api/endpoints';
import { humanMessage } from '../../api/errors';
import { formatMoney } from '../../api/money';
import type { Payment, QtimeBooking, Trip } from '../../api/types';
import { Alert, ErrorAlert } from '../../components/ui/Alerts';
import { Badge } from '../../components/ui/Badge';
import { Button, buttonClass } from '../../components/ui/Button';
import { CopyButton } from '../../components/ui/CopyButton';
import { EmptyState } from '../../components/ui/EmptyState';
import { SelectField } from '../../components/ui/Field';
import { Skeleton, SkeletonRows } from '../../components/ui/Skeleton';
import { cityDateTime, slotLabel } from '../../lib/cityTime';
import { cx } from '../../lib/cx';
import {
  formatAgeSeconds,
  formatDateTime,
  formatRelative,
  paymentTypeLabel,
  shortId,
  statusLabel,
  statusTone,
  type Tone,
} from '../../lib/format';
import { TRIP_ACTIVE_STATUSES, tariffLabel, tripStatusLabel } from '../../lib/trips';
import { fetchGatewayHealth } from '../api/gatewayHealth';
import { fetchGatewayMetrics, type LogEventCounts } from '../api/gatewayMetrics';
import { BarList, Chip, Donut, KpiTile, Panel, Toolbar } from '../kit';
import type { AdminSectionProps } from '../sections';

/* --------------------------------------------------------------- константы */

/**
 * Как часто раздел перезапрашивает сервисы.
 *
 * 30 секунд — верхняя граница обещанных 15–30 с, и выбрана она не случайно: у шлюза на каждый
 * маршрут свой `RequestRateLimiter` (см. `services/api-gateway/src/main/resources/application.yml`),
 * и у trip-service с payment-service бурст всего 20 запросов. Дашборд, который «обновляется
 * почаще», выедал бы лимит у самого оператора и получал 429 вместо данных.
 */
const REFETCH_INTERVAL_MS = 30_000;

/** Данные младше этого возраста повторно не запрашиваются при монтировании. */
const REFETCH_STALE_MS = 15_000;

/** Размер листингов для ленты: ровно `page=0&size=5`, как и описано в разделе. */
const FEED_ITEMS_SIZE = 5;

/** Сколько строк ленты показываем: три источника по пять записей — уже пятнадцать. */
const FEED_ROWS = 12;

/**
 * Глубина выборки для счётчиков, которых сервис не отдаёт агрегатом, и для кольца статусов.
 *
 * `Page.totalElements` от размера страницы не зависит — он всегда настоящий счёт сервера.
 * Меняется только то, по скольким загруженным строкам считаются доли, и раздел подписывает
 * это число рядом с диаграммой.
 */
const SAMPLE_DEPTH_OPTIONS = [25, 50, 100].map((value) => ({
  value: String(value),
  label: `${value} записей`,
}));

const DEFAULT_SAMPLE_DEPTH = 100;

/**
 * Маршруты шлюза: русское название и раздел, в котором эти данные разбирают.
 *
 * Ключ — `routeId` из выдачи Prometheus, то есть имя, которое маршруту дал сам шлюз
 * (`api-gateway/application.yml`). Незнакомый маршрут раздел покажет как есть, без ссылки:
 * придумывать ему раздел было бы догадкой.
 */
const ROUTE_INFO: Record<string, { title: string; to: string }> = {
  'account-service': { title: 'Счета и леджер', to: '/admin/accounts' },
  'payment-service': { title: 'Платежи и возвраты', to: '/admin/payments' },
  'settlement-api': { title: 'Расчёты с мерчантами', to: '/admin/settlements' },
  'catalog-service': { title: 'Магазины, товары и сток', to: '/admin/catalog' },
  'order-service': { title: 'Заказы', to: '/admin/orders' },
  'driver-service': { title: 'Парк и диспетчерская', to: '/admin/fleet' },
  'dispatch-service': { title: 'Парк и диспетчерская', to: '/admin/fleet' },
  'trip-service': { title: 'Поездки', to: '/admin/trips' },
  'qtime-service': { title: 'Записи QTime', to: '/admin/bookings' },
};

/** Статусы, которые принимает `GET /payments?status=`: enum `PaymentStatus`. */
const PAYMENT_FAILED = 'FAILED';
const PAYMENT_PENDING = 'PENDING';

/** Статус записи QTime, который принимает `GET /qtime/bookings?status=`. */
const BOOKING_CANCELLED_BY_COMPANY = 'CANCELLED_BY_COMPANY';

/**
 * Статус заказа, который принимает `GET /orders?status=`.
 *
 * Список сверен с живым сервисом, а не с макетом: `CREATED`, `PROCESSING`, `SHIPPED`
 * order-service отвергает с 400, поэтому в фильтры обзора они не попадают.
 */
const ORDER_CANCELLED = 'CANCELLED';

/**
 * Подписи статусов записи QTime.
 *
 * `statusLabel` из `lib/format.ts` знает статусы платежей и товаров, но не записи: для
 * `CANCELLED_BY_COMPANY` он вернул бы код. В разделе «Записи QTime» для этого есть свой
 * словарь; здесь повторены только те значения, которые показывает обзор, чтобы не тянуть
 * чужой раздел целиком.
 */
const BOOKING_STATUS_LABELS: Record<string, string> = {
  CONFIRMED: 'Подтверждена · окно занято',
  COMPLETED: 'Визит состоялся',
  CANCELLED_BY_CLIENT: 'Отменена клиентом',
  CANCELLED_BY_COMPANY: 'Отменена компанией',
  NO_SHOW: 'Клиент не пришёл',
};

function bookingStatusLabel(status: string | null | undefined): string {
  if (!status) {
    return '—';
  }
  return BOOKING_STATUS_LABELS[status] ?? status;
}

/** Уровни журнала шлюза: `logback_events_total{level=…}`. */
const LOG_LEVELS: Array<{ key: keyof LogEventCounts; label: string; tone: Tone }> = [
  { key: 'error', label: 'Ошибки (error)', tone: 'danger' },
  { key: 'warn', label: 'Предупреждения (warn)', tone: 'warning' },
  { key: 'info', label: 'Сведения (info)', tone: 'info' },
  { key: 'debug', label: 'Отладка (debug)', tone: 'neutral' },
  { key: 'trace', label: 'Трассировка (trace)', tone: 'neutral' },
];

const GATEWAY_TONES: Record<string, Tone> = {
  UP: 'success',
  DOWN: 'danger',
  OUT_OF_SERVICE: 'warning',
  UNKNOWN: 'warning',
};

const GATEWAY_LABELS: Record<string, string> = {
  UP: 'работает',
  DOWN: 'не работает',
  OUT_OF_SERVICE: 'выведен из обслуживания',
  UNKNOWN: 'состояние неизвестно',
};

function gatewayTone(status: string): Tone {
  return GATEWAY_TONES[status.toUpperCase()] ?? 'neutral';
}

function gatewayLabel(status: string): string {
  return GATEWAY_LABELS[status.toUpperCase()] ?? `состояние «${status}»`;
}

/** Тона, иконки и подписи типов событий в ленте. */
const FEED_TONES: Record<'payment' | 'trip' | 'booking', Tone> = {
  payment: 'brand',
  trip: 'info',
  booking: 'success',
};

const FEED_ICONS: Record<'payment' | 'trip' | 'booking', string> = {
  payment: '💳',
  trip: '🚕',
  booking: '📅',
};

const FEED_KIND_LABELS: Record<'payment' | 'trip' | 'booking', string> = {
  payment: 'платёж',
  trip: 'поездка',
  booking: 'запись',
};

/** Тона иконок: те же оттенки, что у квадратов в `../kit`, чтобы экран читался ровно. */
const ICON_TONES: Record<Tone, string> = {
  brand: 'bg-brand-50 text-brand-700',
  success: 'bg-success-50 text-success-700',
  warning: 'bg-warning-50 text-warning-700',
  danger: 'bg-brand-50 text-brand-700',
  info: 'bg-info-50 text-info-700',
  neutral: 'bg-ink-100 text-ink-600',
};

/* ------------------------------------------------------------ мелкие детали */

/**
 * Состояние одного блока.
 *
 * Блоки получают его по отдельности, а не общий `isLoading` раздела — иначе недоступность
 * одного сервиса выглядела бы как «обзор не загрузился».
 */
interface BlockState {
  isPending: boolean;
  isError: boolean;
  error: unknown;
}

function stateOf(query: BlockState): BlockState {
  return { isPending: query.isPending, isError: query.isError, error: query.error };
}

/** `5` из `18` -> «27,8%»; `null`, когда делить не на что (а не «0%»). */
function percent(part: number | null | undefined, total: number | null | undefined): string | null {
  if (
    typeof part !== 'number' ||
    typeof total !== 'number' ||
    !Number.isFinite(part) ||
    !Number.isFinite(total) ||
    total <= 0
  ) {
    return null;
  }
  return `${((part / total) * 100).toFixed(1).replace('.', ',')}%`;
}

/** Байты в человекочитаемый вид. Без библиотек: делим на 1024 и подписываем единицу. */
function formatBytes(bytes: number | null | undefined): string | null {
  if (typeof bytes !== 'number' || !Number.isFinite(bytes) || bytes < 0) {
    return null;
  }
  if (bytes >= 1024 ** 3) {
    return `${(bytes / 1024 ** 3).toFixed(1).replace('.', ',')} ГиБ`;
  }
  if (bytes >= 1024 ** 2) {
    return `${Math.round(bytes / 1024 ** 2)} МиБ`;
  }
  return `${Math.round(bytes / 1024)} КиБ`;
}

/** Доля 0..1 -> «9,1%». */
function fractionPercent(value: number | null | undefined): string | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return null;
  }
  return `${(value * 100).toFixed(1).replace('.', ',')}%`;
}

/**
 * Время события для ленты.
 *
 * Прошлое подписано `formatRelative` («12 мин назад»), а будущее — «через 5 мин»: у записи
 * QTime в ленте стоит время её окна, и назвать это «только что» было бы враньём, хотя
 * `formatRelative` именно так и отвечает на дату из будущего.
 */
function momentLabel(value: string | null | undefined): string {
  if (!value) {
    return '—';
  }
  const time = Date.parse(value);
  if (!Number.isFinite(time)) {
    return '—';
  }
  const diffSeconds = (time - Date.now()) / 1000;
  if (diffSeconds > 60 * 60 * 24 * 3) {
    return formatDateTime(value);
  }
  if (diffSeconds > 60) {
    return `через ${formatAgeSeconds(diffSeconds)}`;
  }
  return formatRelative(value);
}

/** Подпись плитки, когда данных нет: причина сервиса, а не пустое место. */
function failureCaption(error: unknown): string {
  return `Нет данных: ${humanMessage(error)}`;
}

/**
 * Второе число плитки («в работе», «с ошибкой», «ближайшее окно»).
 *
 * Пока запрос идёт, честнее написать «считаем», чем «нет данных»: это разные вещи, и путать
 * их — значит сообщать о недоступности сервиса, который просто ещё не ответил.
 */
function secondaryCaption(state: BlockState, what: string, ready: () => string): string {
  if (state.isPending) {
    return `${what}: считаем…`;
  }
  if (state.isError) {
    return `${what}: нет данных`;
  }
  return ready();
}

/** Полоса заполнения 6 px со скруглением — тот же размер, что у полос в `../kit`. */
function Meter({ share }: { share: number | null }) {
  if (share === null) {
    return null;
  }
  return (
    <span className="block h-1.5 w-full overflow-hidden rounded-full bg-ink-100">
      <span
        className="block h-full rounded-full bg-brand-500"
        style={{ width: `${Math.max(0, Math.min(100, share * 100))}%` }}
      />
    </span>
  );
}

/**
 * Строка ресурсов: подпись, значение и полоса заполнения, когда её есть из чего считать.
 *
 * Полоса появляется только там, где известен знаменатель: у времени работы и сборок мусора его
 * нет, поэтому у них полосы не будет — пустая полоса читалась бы как «ноль».
 */
function ResourceRow({
  label,
  text,
  share,
}: {
  label: string;
  text: ReactNode;
  share?: number | null;
}) {
  return (
    <div className="py-2">
      <div className="flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
        <dt className="text-sm text-ink-500">{label}</dt>
        <dd className="min-w-0 text-sm font-medium text-ink-900 sm:text-right">{text}</dd>
      </div>
      {share === undefined || share === null ? null : (
        <div className="mt-1.5">
          <Meter share={share} />
        </div>
      )}
    </div>
  );
}

/**
 * Маленькая карточка очереди: иконка, название и число в цветном чипе.
 *
 * Вся карточка — ссылка в раздел, где эти строки разбирают: смотреть на «5» без перехода
 * бессмысленно. Число берётся у того запроса, который ей передали, и вместо нуля при
 * недоступности сервиса стоит прочерк.
 */
function QueueCard({
  label,
  hint,
  icon,
  tone,
  to,
  count,
  state,
}: {
  label: string;
  hint: string;
  icon: string;
  tone: Tone;
  to: string;
  count: number | undefined;
  state: BlockState;
}) {
  return (
    <Link
      to={to}
      data-admin-kpi
      className="flex items-center gap-3 rounded-card border border-ink-200 bg-white p-3 shadow-sm transition-shadow hover:shadow"
    >
      <span
        aria-hidden="true"
        className={cx('grid h-10 w-10 shrink-0 place-items-center rounded-xl text-lg', ICON_TONES[tone])}
      >
        {icon}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-xs font-medium tracking-wide text-ink-500 uppercase">
          {label}
        </span>
        <span className="mt-0.5 block text-[11px] leading-snug break-words text-ink-500">{hint}</span>
      </span>
      {state.isPending ? <Skeleton className="h-6 w-10 shrink-0 rounded-full" /> : null}
      {!state.isPending && state.isError ? <Chip>—</Chip> : null}
      {!state.isPending && !state.isError ? (
        <Chip tone={count && count > 0 ? tone : 'neutral'}>
          <span className="tabular-nums">{count ?? '—'}</span>
        </Chip>
      ) : null}
    </Link>
  );
}

/** Строка очереди внимания: id, сумма, время — и всё это ссылкой в свой раздел. */
interface QueueRow {
  key: string;
  id: string;
  amount: string;
  time: string;
  note?: string;
}

function AttentionQueue({
  title,
  hint,
  to,
  linkLabel,
  total,
  rows,
  state,
}: {
  title: string;
  hint: string;
  to: string;
  linkLabel: string;
  total: number | undefined;
  rows: QueueRow[];
  state: BlockState;
}) {
  const hasProblem = typeof total === 'number' && total > 0;
  return (
    <div className="flex flex-col rounded-card border border-ink-100 bg-ink-50/60 p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-ink-900">{title}</p>
          <p className="mt-0.5 text-xs text-ink-500">{hint}</p>
        </div>
        <div className="shrink-0">
          {state.isPending ? <Skeleton className="h-6 w-10" /> : null}
          {!state.isPending && state.isError ? (
            <span className="text-xs font-medium text-brand-700">нет данных</span>
          ) : null}
          {!state.isPending && !state.isError ? (
            <span
              className={cx(
                'text-lg font-semibold tabular-nums',
                hasProblem ? 'text-brand-700' : 'text-ink-500',
              )}
            >
              {total ?? '—'}
            </span>
          ) : null}
        </div>
      </div>

      {state.isError ? (
        <p className="mt-2 rounded-xl bg-white px-3 py-2 text-xs text-brand-700 ring-1 ring-ink-100">
          {humanMessage(state.error)}
        </p>
      ) : null}

      {!state.isError && rows.length > 0 ? (
        <ul className="mt-2 divide-y divide-ink-100 overflow-hidden rounded-xl bg-white ring-1 ring-ink-100">
          {rows.map((row) => (
            <li key={row.key}>
              <Link
                to={to}
                className="flex items-center justify-between gap-3 px-3 py-2 hover:bg-ink-50"
              >
                <span className="min-w-0">
                  <span className="block truncate font-mono text-xs text-ink-600">{row.id}</span>
                  {row.note ? (
                    <span className="mt-0.5 block truncate text-xs text-ink-500">{row.note}</span>
                  ) : null}
                </span>
                <span className="shrink-0 text-right">
                  <span className="block text-sm font-medium tabular-nums text-ink-900">
                    {row.amount}
                  </span>
                  <span className="block text-xs text-ink-500">{row.time}</span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      ) : null}

      {!state.isError && rows.length === 0 ? (
        <p className="mt-2 rounded-xl bg-white px-3 py-2 text-xs text-ink-500 ring-1 ring-ink-100">
          {hasProblem
            ? `Сервис сообщил ${total} записей, но выборка size=5 пришла пустой — откройте раздел, чтобы посмотреть их там.`
            : 'Очередь пуста: сервис не отдал ни одной записи с этим статусом.'}
        </p>
      ) : null}

      <div className="mt-2 pt-1">
        <Link to={to} className={buttonClass({ variant: 'ghost', size: 'sm' })}>
          {linkLabel}
        </Link>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ запросы */

/** Локальный ключ раздела: общий `src/lib/queryKeys.ts` не трогаем. */
function overviewKey(scope: string, params: Record<string, string | number> = {}) {
  return ['admin', 'overview', scope, params] as const;
}

/**
 * Один запрос обзора: свой ключ, свой `refetchInterval` и своя ошибка.
 *
 * Общего запроса у дашборда нет намеренно: упавший сервис должен оставить на экране цифры
 * остальных, а не превратить весь обзор в одну ошибку.
 */
function useOverviewQuery<T>(key: readonly unknown[], queryFn: () => Promise<T>) {
  return useQuery({
    queryKey: key,
    queryFn,
    refetchInterval: REFETCH_INTERVAL_MS,
    staleTime: REFETCH_STALE_MS,
  });
}

/* ------------------------------------------------------------------- раздел */

export default function OverviewSection({ section }: AdminSectionProps) {
  const [depth, setDepth] = useState<number>(DEFAULT_SAMPLE_DEPTH);

  // Платежи: свежая страница для ленты и плитки, глубокая выборка — для кольца статусов.
  const paymentsRecent = useOverviewQuery(
    overviewKey('payments', { size: FEED_ITEMS_SIZE }),
    () => fetchPayments({ page: 0, size: FEED_ITEMS_SIZE }),
  );
  const paymentsSample = useOverviewQuery(overviewKey('payments', { size: depth }), () =>
    fetchPayments({ page: 0, size: depth }),
  );
  const failedPayments = useOverviewQuery(
    overviewKey('payments', { status: PAYMENT_FAILED, size: FEED_ITEMS_SIZE }),
    () => fetchPayments({ page: 0, size: FEED_ITEMS_SIZE, status: PAYMENT_FAILED }),
  );
  const pendingPayments = useOverviewQuery(
    overviewKey('payments', { status: PAYMENT_PENDING, size: 1 }),
    () => fetchPayments({ page: 0, size: 1, status: PAYMENT_PENDING }),
  );

  // Поездки: свежая страница для ленты, глубокая выборка — для счёта «в работе».
  const tripsRecent = useOverviewQuery(overviewKey('trips', { size: FEED_ITEMS_SIZE }), () =>
    fetchTrips({ page: 0, size: FEED_ITEMS_SIZE }),
  );
  const tripsSample = useOverviewQuery(overviewKey('trips', { size: depth }), () =>
    fetchTrips({ page: 0, size: depth }),
  );
  const noDriverTrips = useOverviewQuery(
    overviewKey('trips', { status: 'NO_DRIVERS_FOUND', size: FEED_ITEMS_SIZE }),
    () => fetchTrips({ page: 0, size: FEED_ITEMS_SIZE, status: 'NO_DRIVERS_FOUND' }),
  );
  const driverCancelledTrips = useOverviewQuery(
    overviewKey('trips', { status: 'CANCELLED_BY_DRIVER', size: FEED_ITEMS_SIZE }),
    () => fetchTrips({ page: 0, size: FEED_ITEMS_SIZE, status: 'CANCELLED_BY_DRIVER' }),
  );

  // Записи QTime.
  const bookingsRecent = useOverviewQuery(overviewKey('bookings', { size: FEED_ITEMS_SIZE }), () =>
    fetchBookings({ page: 0, size: FEED_ITEMS_SIZE }),
  );
  const bookingsSample = useOverviewQuery(overviewKey('bookings', { size: depth }), () =>
    fetchBookings({ page: 0, size: depth }),
  );
  const companyCancelledBookings = useOverviewQuery(
    overviewKey('bookings', { status: BOOKING_CANCELLED_BY_COMPANY, size: FEED_ITEMS_SIZE }),
    () =>
      fetchBookings({ page: 0, size: FEED_ITEMS_SIZE, status: BOOKING_CANCELLED_BY_COMPANY }),
  );

  // Заказы: листинг есть (`GET /v1/orders`), фильтры — только те, что принимает сервис.
  const orders = useOverviewQuery(overviewKey('orders', { size: 1 }), () =>
    fetchOrders({ page: 0, size: 1 }),
  );
  const cancelledOrders = useOverviewQuery(
    overviewKey('orders', { status: ORDER_CANCELLED, size: 1 }),
    () => fetchOrders({ page: 0, size: 1, status: ORDER_CANCELLED }),
  );

  // Витрины и шлюз.
  const products = useOverviewQuery(overviewKey('catalog', { size: 1 }), () =>
    fetchProducts({ page: 0, size: 1 }),
  );
  const companies = useOverviewQuery(overviewKey('companies', { size: 1 }), () =>
    fetchQtimeCompanies({ page: 0, size: 1 }),
  );
  const health = useOverviewQuery(overviewKey('gateway', { scope: 'health' }), () =>
    fetchGatewayHealth(),
  );
  const metrics = useOverviewQuery(overviewKey('gateway', { scope: 'metrics' }), () =>
    fetchGatewayMetrics(),
  );

  /** Все запросы раздела: для кнопки «Обновить» и для времени последнего ответа. */
  const blocks = [
    paymentsRecent,
    paymentsSample,
    failedPayments,
    pendingPayments,
    tripsRecent,
    tripsSample,
    noDriverTrips,
    driverCancelledTrips,
    bookingsRecent,
    bookingsSample,
    companyCancelledBookings,
    orders,
    cancelledOrders,
    products,
    companies,
    health,
    metrics,
  ];

  const updatedAt = Math.max(0, ...blocks.map((block) => block.dataUpdatedAt));
  const isFetching = blocks.some((block) => block.isFetching);
  const refreshAll = () => {
    for (const block of blocks) {
      void block.refetch();
    }
  };

  /* ------------------------------------------------------------- производные */

  const routeMetrics = metrics.data?.routes ?? [];
  const clientErrors = routeMetrics.reduce((total, route) => total + route.clientErrors, 0);
  const serverErrors = routeMetrics.reduce((total, route) => total + route.serverErrors, 0);
  const gatewayRequests = (metrics.data?.endpoints ?? []).reduce(
    (total, endpoint) => total + endpoint.requests,
    0,
  );
  const endpointServerErrors = (metrics.data?.endpoints ?? []).reduce(
    (total, endpoint) => total + endpoint.serverErrors,
    0,
  );
  const endpointClientErrors = (metrics.data?.endpoints ?? []).reduce(
    (total, endpoint) => total + endpoint.clientErrors,
    0,
  );

  /**
   * Средняя длительность ответа шлюза.
   *
   * Модуль метрик кладёт в каждую строку одно и то же общее среднее (`_sum`/`_count` таймера
   * шлюза), разложить его по маршрутам выдача не даёт. Поэтому в плитке стоит общее среднее,
   * а в таблице маршрутов — только пер-маршрутный максимум, который действительно свой.
   */
  const gatewayAverageMs = routeMetrics.find((route) => route.averageMs !== null)?.averageMs ?? null;

  const activeTrips = useMemo(() => {
    const items = tripsSample.data?.items ?? [];
    return items.filter((trip) => TRIP_ACTIVE_STATUSES.includes(trip.status)).length;
  }, [tripsSample.data]);

  const tripsSampleSize = tripsSample.data?.items.length ?? 0;

  /** Ближайшее окно записи из загруженной выборки: видно, что сервис живёт не прошлым. */
  const nextBooking = useMemo(() => {
    const items = bookingsSample.data?.items ?? [];
    const upcoming = items
      .map((booking) => Date.parse(booking.startsAt))
      .filter((time) => Number.isFinite(time) && time > Date.now())
      .sort((left, right) => left - right);
    return upcoming[0] ?? null;
  }, [bookingsSample.data]);

  /** Распределение платежей по статусам — по загруженной странице, а не по всей платформе. */
  const paymentStatuses = useMemo(() => {
    const counts = new Map<string, number>();
    for (const payment of paymentsSample.data?.items ?? []) {
      counts.set(payment.status, (counts.get(payment.status) ?? 0) + 1);
    }
    return [...counts.entries()]
      .map(([status, value]) => ({
        key: status,
        label: statusLabel(status),
        value,
        tone: statusTone(status),
      }))
      .sort((left, right) => right.value - left.value);
  }, [paymentsSample.data]);

  /** Лента: три источника, отсортированные по времени, которое у каждого из них есть. */
  const feedEntries = useMemo(() => {
    const payments: Payment[] = paymentsRecent.data?.items ?? [];
    const trips: Trip[] = tripsRecent.data?.items ?? [];
    const bookings: QtimeBooking[] = bookingsRecent.data?.items ?? [];

    const entries = [
      ...payments.map((payment) => ({
        key: `payment-${payment.paymentId}`,
        kind: 'payment' as const,
        at: payment.createdAt,
        title: `${formatMoney(payment.totalMinor, payment.currency)} · ${paymentTypeLabel(payment.type)}`,
        detail: `${shortId(payment.paymentNumber, 12)} · ${statusLabel(payment.status)}${
          payment.failureCode ? ` · ${payment.failureCode}` : ''
        }`,
        to: '/admin/payments',
      })),
      ...trips.map((trip) => ({
        key: `trip-${trip.tripId}`,
        kind: 'trip' as const,
        at: trip.requestedAt ?? '',
        title:
          trip.priceMinor === null
            ? 'Цена в ответе не пришла'
            : `${formatMoney(trip.priceMinor, trip.currency)} · ${tariffLabel(trip.tariff)}`,
        detail: `${shortId(trip.tripNumber, 12)} · ${tripStatusLabel(trip.status)}`,
        to: '/admin/trips',
      })),
      ...bookings.map((booking) => ({
        key: `booking-${booking.bookingId}`,
        kind: 'booking' as const,
        at: booking.startsAt,
        title: `${booking.serviceName ?? 'Услуга не названа'}${
          booking.priceMinor === null ? '' : ` · ${formatMoney(booking.priceMinor, booking.currency)}`
        }`,
        detail: `${booking.code} · окно ${slotLabel(booking.startsAt)} · ${
          booking.companyName ?? 'компания не пришла'
        }`,
        to: '/admin/bookings',
      })),
    ];

    return entries
      .filter((entry) => entry.at !== '')
      .sort((left, right) => Date.parse(right.at) - Date.parse(left.at))
      .slice(0, FEED_ROWS);
  }, [paymentsRecent.data, tripsRecent.data, bookingsRecent.data]);

  /**
   * Пробы листингов, которые делает сам обзор.
   *
   * Это независимый от метрик источник ответа на вопрос «что не отвечает»: шлюз может быть жив,
   * а конкретный сервис — нет, и тогда видно именно здесь.
   */
  const probes = [
    { title: 'Платежи', endpoint: 'GET /api/v1/payments', state: stateOf(paymentsRecent) },
    { title: 'Поездки', endpoint: 'GET /api/v1/trips', state: stateOf(tripsRecent) },
    { title: 'Записи QTime', endpoint: 'GET /api/v1/qtime/bookings', state: stateOf(bookingsRecent) },
    { title: 'Заказы', endpoint: 'GET /api/v1/orders', state: stateOf(orders) },
    { title: 'Товары', endpoint: 'GET /api/v1/catalog/products', state: stateOf(products) },
    { title: 'Компании QTime', endpoint: 'GET /api/v1/qtime/companies', state: stateOf(companies) },
  ];
  const brokenProbes = probes.filter((probe) => probe.state.isError);

  const missingFeedSources = [
    { label: 'платежи', state: stateOf(paymentsRecent) },
    { label: 'поездки', state: stateOf(tripsRecent) },
    { label: 'записи QTime', state: stateOf(bookingsRecent) },
  ].filter((source) => source.state.isError);

  /** Нагрузка по маршрутам для `BarList`: длина полосы — от самого нагруженного маршрута. */
  const routeBars = routeMetrics.map((route) => {
    const info = ROUTE_INFO[route.routeId];
    const errors = route.clientErrors + route.serverErrors;
    return {
      key: route.routeId,
      label: (
        <span className="flex min-w-0 flex-col">
          <span className="truncate">{info ? info.title : route.routeId}</span>
          <span className="truncate font-mono text-[11px] text-ink-400">{route.routeId}</span>
        </span>
      ),
      value: route.requests,
      hint: `ошибок ${errors}${
        route.maxMs === null ? '' : ` · макс ${Math.round(route.maxMs)} мс`
      }`,
      tone: errors > 0 ? ('warning' as const) : ('brand' as const),
    };
  });

  /** Что отдать кнопке «Скопировать JSON сводок»: только то, что реально загружено. */
  const summaryJson = JSON.stringify(
    {
      обновлено: updatedAt > 0 ? new Date(updatedAt).toISOString() : null,
      глубинаВыборки: depth,
      счётчики: {
        платежи: paymentsRecent.data?.totalElements ?? null,
        платежиСОшибкой: failedPayments.data?.totalElements ?? null,
        поездки: tripsRecent.data?.totalElements ?? null,
        поездкиВРаботе: tripsSample.data ? activeTrips : null,
        записиQTime: bookingsRecent.data?.totalElements ?? null,
        заказы: orders.data?.totalElements ?? null,
        товары: products.data?.totalElements ?? null,
        компанииQTime: companies.data?.totalElements ?? null,
      },
      шлюз: health.data
        ? { статус: health.data.status, http: health.data.httpStatus }
        : { статус: 'нет данных' },
      метрики: metrics.data
        ? {
            серий: metrics.data.samples,
            запросовЧерезШлюз: gatewayRequests,
            ошибки4xx: endpointClientErrors,
            ошибки5xx: endpointServerErrors,
            журнал: metrics.data.logs,
          }
        : { статус: 'нет данных' },
    },
    null,
    2,
  );

  /* ------------------------------------------------------------------- рендер */

  return (
    <div className="space-y-5">
      <Toolbar
        right={
          <>
            <Button variant="secondary" size="sm" loading={isFetching} onClick={refreshAll}>
              Обновить
            </Button>
            <CopyButton value={summaryJson} label="Скопировать JSON сводок" />
          </>
        }
      >
        <div className="min-w-[16rem] flex-1">
          <p className="text-sm text-ink-700">
            Сводка собрана из ответов сервисов: платежи, поездки, записи, заказы, витрина и метрики
            шлюза. Каждый блок обновляется сам раз в 30 секунд и живёт своей ошибкой.
          </p>
          <p className="mt-0.5 text-xs text-ink-500">
            {updatedAt > 0
              ? `Последний ответ сервисов: ${formatRelative(
                  new Date(updatedAt).toISOString(),
                )} (${formatDateTime(new Date(updatedAt).toISOString())}).`
              : 'Ни один сервис ещё не ответил — ждём первый ответ.'}
          </p>
        </div>
        <div className="w-40">
          <SelectField
            id="overview-sample-depth"
            label="Глубина выборки"
            value={String(depth)}
            onChange={(event) => setDepth(Number(event.target.value))}
            options={SAMPLE_DEPTH_OPTIONS}
            hint="Размер страницы для долей и диаграмм"
          />
        </div>
      </Toolbar>

      {/* Плитки: числа сервисов, шлюза и журнала. */}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiTile
          label="Платежи"
          icon="💳"
          value={
            paymentsRecent.isError
              ? 'нет данных'
              : paymentsRecent.data?.totalElements.toLocaleString('ru-RU')
          }
          loading={paymentsRecent.isPending}
          caption={
            paymentsRecent.isError
              ? failureCaption(paymentsRecent.error)
              : `payment-service, Page.totalElements. ${secondaryCaption(
                  stateOf(failedPayments),
                  'Платежи с ошибкой',
                  () =>
                    `С ошибкой FAILED: ${failedPayments.data?.totalElements ?? '—'} (${
                      percent(failedPayments.data?.totalElements, paymentsRecent.data?.totalElements) ??
                      '—'
                    }).`,
                )}`
          }
        />
        <KpiTile
          label="Поездки"
          icon="🚕"
          tone="info"
          value={
            tripsRecent.isError ? 'нет данных' : tripsRecent.data?.totalElements.toLocaleString('ru-RU')
          }
          loading={tripsRecent.isPending}
          caption={
            tripsRecent.isError
              ? failureCaption(tripsRecent.error)
              : `trip-service, Page.totalElements. ${secondaryCaption(
                  stateOf(tripsSample),
                  'В работе',
                  () => `В работе ${activeTrips} из ${tripsSampleSize} (size=${depth}).`,
                )}`
          }
        />
        <KpiTile
          label="Записи QTime"
          icon="📅"
          tone="success"
          value={
            bookingsRecent.isError
              ? 'нет данных'
              : bookingsRecent.data?.totalElements.toLocaleString('ru-RU')
          }
          loading={bookingsRecent.isPending}
          caption={
            bookingsRecent.isError
              ? failureCaption(bookingsRecent.error)
              : `qtime-service, Page.totalElements. ${secondaryCaption(
                  stateOf(bookingsSample),
                  'Ближайшее окно',
                  () =>
                    nextBooking
                      ? `Ближайшее окно: ${cityDateTime(new Date(nextBooking).toISOString())}.`
                      : 'Окон впереди в выборке нет.',
                )}`
          }
        />
        <KpiTile
          label="Заказы"
          icon="📦"
          tone="warning"
          value={orders.isError ? 'нет данных' : orders.data?.totalElements.toLocaleString('ru-RU')}
          loading={orders.isPending}
          caption={
            orders.isError
              ? failureCaption(orders.error)
              : 'order-service, Page.totalElements (page=0&size=1).'
          }
        />
        <KpiTile
          label="Товары в каталоге"
          icon="🛍"
          tone="neutral"
          value={products.isError ? 'нет данных' : products.data?.totalElements.toLocaleString('ru-RU')}
          loading={products.isPending}
          caption={
            products.isError
              ? failureCaption(products.error)
              : 'catalog-service, Page.totalElements публичного листинга.'
          }
        />
        <KpiTile
          label="Компании QTime"
          icon="🏢"
          tone="neutral"
          value={companies.isError ? 'нет данных' : companies.data?.totalElements.toLocaleString('ru-RU')}
          loading={companies.isPending}
          caption={
            companies.isError
              ? failureCaption(companies.error)
              : 'qtime-service, Page.totalElements каталога компаний.'
          }
        />
        <KpiTile
          label="Шлюз"
          icon="🚦"
          tone={health.data ? gatewayTone(health.data.status) : 'neutral'}
          value={health.isError ? 'нет данных' : health.data?.status}
          loading={health.isPending}
          caption={
            health.isError
              ? failureCaption(health.error)
              : `GET /actuator/health: HTTP ${health.data?.httpStatus ?? '—'}, ${
                  health.data ? gatewayLabel(health.data.status) : 'статус не пришёл'
                }${
                  health.data && health.data.httpStatus !== 200
                    ? ' — это состояние, а не сбой запроса'
                    : ''
                }.`
          }
        />
        <KpiTile
          label="Ошибки в журнале шлюза"
          icon="🧾"
          tone={metrics.data && metrics.data.logs.error > 0 ? 'danger' : 'success'}
          value={
            metrics.isError ? 'нет данных' : metrics.data?.logs.error.toLocaleString('ru-RU')
          }
          loading={metrics.isPending}
          caption={
            metrics.isError
              ? failureCaption(metrics.error)
              : `logback_events_total{level="error"}: накоплено с запуска шлюза, не за сутки.`
          }
        />
        <KpiTile
          label="Запросы через шлюз"
          icon="🔀"
          tone="info"
          value={metrics.isError ? 'нет данных' : gatewayRequests.toLocaleString('ru-RU')}
          loading={metrics.isPending}
          caption={
            metrics.isError
              ? failureCaption(metrics.error)
              : `Сумма http_server_requests_seconds_count. 4xx: ${endpointClientErrors} · 5xx: ${endpointServerErrors}.`
          }
        />
        <KpiTile
          label="Средняя задержка шлюза"
          icon="⏱"
          tone="neutral"
          value={
            metrics.isError || gatewayAverageMs === null
              ? 'нет данных'
              : `${Math.round(gatewayAverageMs)} мс`
          }
          loading={metrics.isPending}
          caption={
            metrics.isError
              ? failureCaption(metrics.error)
              : 'Таймер шлюза _sum/_count: среднее по всем маршрутам сразу.'
          }
        />
      </div>

      {/* Очереди внимания: маленькие карточки статусов и сами проблемные строки. */}
      <Panel
        title="Очереди внимания"
        subtitle="Числа в карточках — это Page.totalElements сервиса по статусу, строки ниже — настоящие записи из выборки size=5"
        action={
          <Link to="/admin/payments" className={buttonClass({ variant: 'secondary', size: 'sm' })}>
            Все платежи
          </Link>
        }
      >
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <QueueCard
            label="Платежи с ошибкой"
            hint="FAILED: деньги не дошли, сервис записал код и причину отказа"
            icon="💳"
            tone="danger"
            to="/admin/payments"
            count={failedPayments.data?.totalElements}
            state={stateOf(failedPayments)}
          />
          <QueueCard
            label="Поездки без водителя"
            hint="NO_DRIVERS_FOUND: заявку клиента никто не принял"
            icon="🚕"
            tone="warning"
            to="/admin/trips"
            count={noDriverTrips.data?.totalElements}
            state={stateOf(noDriverTrips)}
          />
          <QueueCard
            label="Отменены водителем"
            hint="CANCELLED_BY_DRIVER: причина отмены записана в поездке"
            icon="🚕"
            tone="warning"
            to="/admin/trips"
            count={driverCancelledTrips.data?.totalElements}
            state={stateOf(driverCancelledTrips)}
          />
          <QueueCard
            label="Записи отменены компанией"
            hint="CANCELLED_BY_COMPANY: окно сняли на стороне компании, клиент пришёл бы"
            icon="📅"
            tone="warning"
            to="/admin/bookings"
            count={companyCancelledBookings.data?.totalElements}
            state={stateOf(companyCancelledBookings)}
          />
          <QueueCard
            label="Отменённые заказы"
            hint="CANCELLED у order-service: заказ закрыт до доставки"
            icon="📦"
            tone="neutral"
            to="/admin/orders"
            count={cancelledOrders.data?.totalElements}
            state={stateOf(cancelledOrders)}
          />
          <QueueCard
            label="Платежи в обработке"
            hint="PENDING: холд мог быть уже запрошен; статуса PENDING_PAYMENT payment-service не принимает (400)"
            icon="⏳"
            tone="info"
            to="/admin/payments"
            count={pendingPayments.data?.totalElements}
            state={stateOf(pendingPayments)}
          />
          <QueueCard
            label="Ошибки шлюза 5xx"
            hint="spring_cloud_gateway_requests_seconds_count с кодом 5xx, накоплено с запуска шлюза"
            icon="🌐"
            tone="danger"
            to="/admin/pulse"
            count={metrics.data ? serverErrors : undefined}
            state={stateOf(metrics)}
          />
          <QueueCard
            label="Ошибки в журнале"
            hint='logback_events_total{level="error"}: накопленный счётчик, а не за смену'
            icon="🧾"
            tone="danger"
            to="/admin/pulse"
            count={metrics.data?.logs.error}
            state={stateOf(metrics)}
          />
        </div>

        <div className="mt-4 grid gap-4 lg:grid-cols-2">
          <AttentionQueue
            title="Платежи со статусом FAILED"
            hint="Списание не прошло: у платежа есть код и причина отказа"
            to="/admin/payments"
            linkLabel="Разобрать в «Платежах»"
            total={failedPayments.data?.totalElements}
            state={stateOf(failedPayments)}
            rows={(failedPayments.data?.items ?? []).map((payment) => ({
              key: payment.paymentId,
              id: shortId(payment.paymentNumber, 14),
              amount: formatMoney(payment.totalMinor, payment.currency),
              time: formatRelative(payment.createdAt),
              note: payment.failureCode ?? payment.failureReason ?? undefined,
            }))}
          />
          <AttentionQueue
            title="Поездки NO_DRIVERS_FOUND"
            hint="Свободных машин рядом не нашлось — деньги не списаны"
            to="/admin/trips"
            linkLabel="Открыть поездки"
            total={noDriverTrips.data?.totalElements}
            state={stateOf(noDriverTrips)}
            rows={(noDriverTrips.data?.items ?? []).map((trip) => ({
              key: trip.tripId,
              id: shortId(trip.tripNumber, 14),
              amount:
                trip.priceMinor === null
                  ? 'цена не пришла'
                  : formatMoney(trip.priceMinor, trip.currency),
              time: formatRelative(trip.requestedAt),
              note: trip.pickup?.address || undefined,
            }))}
          />
          <AttentionQueue
            title="Поездки CANCELLED_BY_DRIVER"
            hint="Поездку отменил водитель: заявку можно оформить заново"
            to="/admin/trips"
            linkLabel="Открыть поездки"
            total={driverCancelledTrips.data?.totalElements}
            state={stateOf(driverCancelledTrips)}
            rows={(driverCancelledTrips.data?.items ?? []).map((trip) => ({
              key: trip.tripId,
              id: shortId(trip.tripNumber, 14),
              amount:
                trip.priceMinor === null
                  ? 'цена не пришла'
                  : formatMoney(trip.priceMinor, trip.currency),
              time: formatRelative(trip.cancelledAt ?? trip.requestedAt),
              note: trip.cancelReason ?? undefined,
            }))}
          />
          <AttentionQueue
            title="Записи CANCELLED_BY_COMPANY"
            hint="Клиент пришёл бы, но окно сняли на стороне компании"
            to="/admin/bookings"
            linkLabel="Открыть записи"
            total={companyCancelledBookings.data?.totalElements}
            state={stateOf(companyCancelledBookings)}
            rows={(companyCancelledBookings.data?.items ?? []).map((booking) => ({
              key: booking.bookingId,
              id: booking.code,
              amount:
                booking.priceMinor === null
                  ? 'цена не пришла'
                  : formatMoney(booking.priceMinor, booking.currency),
              time: `окно ${slotLabel(booking.startsAt)}`,
              note: `${bookingStatusLabel(booking.status)}${
                booking.companyName ? ` · ${booking.companyName}` : ''
              }`,
            }))}
          />
        </div>
      </Panel>

      {/* Карта сервисов и диаграммы: нагрузка шлюза по маршрутам и статусы платежей. */}
      <Panel
        title="Карта сервисов"
        subtitle="Маршруты шлюза по его собственной выдаче Prometheus: через шлюз идут все вызовы, поэтому его счётчики и есть нагрузка на сервис"
        action={
          <Link to="/admin/pulse" className={buttonClass({ variant: 'secondary', size: 'sm' })}>
            Пульт: живые метрики
          </Link>
        }
      >
        {metrics.isPending ? <SkeletonRows count={4} /> : null}

        {metrics.isError ? (
          <Alert tone="info" title="Метрики шлюза недоступны">
            {humanMessage(metrics.error)}. Метрики отдаёт <code>/actuator/prometheus</code> и только
            с токеном: без него шлюз отвечает 401. Поэтому карта маршрутов, ресурсы и счётчики
            журнала пусты — нули здесь были бы выдумкой, а не данными.
          </Alert>
        ) : null}

        {metrics.data && routeMetrics.length === 0 ? (
          <EmptyState
            title="Шлюз отдал метрики без маршрутов"
            description="Выдача Prometheus пришла, но серий spring_cloud_gateway_requests_seconds в ней нет: значит, через шлюз ещё не прошло ни одного вызова. Список маршрутов появится, как только сервисы начнут отвечать."
          />
        ) : null}

        {metrics.data && routeMetrics.length > 0 ? (
          <div className="space-y-4">
            <div className="grid gap-4 xl:grid-cols-2">
              <div className="rounded-card border border-ink-100 p-3">
                <p className="text-sm font-semibold text-ink-900">Нагрузка по маршрутам</p>
                <p className="mt-0.5 mb-2 text-xs text-ink-500">
                  Длина полосы — от самого нагруженного маршрута. Счётчики накоплены с запуска
                  шлюза: истории по дням выдача не отдаёт.
                </p>
                <BarList items={routeBars} empty="Шлюз не отдал ни одного маршрута." />
              </div>
              <div className="rounded-card border border-ink-100 p-3">
                <p className="text-sm font-semibold text-ink-900">Статусы платежей</p>
                <p className="mt-0.5 mb-2 text-xs text-ink-500">
                  По загруженной странице <code>size={depth}</code>, а не по всей платформе: доли
                  считаются на клиенте из тех строк, что пришли.
                </p>
                <Donut
                  segments={paymentStatuses}
                  centerLabel="всего"
                  centerValue={paymentsSample.data?.items.length ?? 0}
                />
                <p className="mt-2 text-xs text-ink-500">
                  Загружено {paymentsSample.data?.items.length ?? 0} платежей из{' '}
                  {paymentsSample.data?.totalElements ?? '—'}: агрегата «платежи по статусам» сервис
                  не отдаёт, поэтому доли считает клиент.
                </p>
              </div>
            </div>

            <div className="relative overflow-x-auto">
              <table className="w-full min-w-[720px] text-left text-sm">
                <thead>
                  <tr className="border-b border-ink-100 text-xs text-ink-500">
                    <th className="py-2 pr-3 font-medium">Маршрут шлюза</th>
                    <th className="py-2 pr-3 font-medium">Состояние</th>
                    <th className="py-2 pr-3 text-right font-medium">Запросов</th>
                    <th className="py-2 pr-3 text-right font-medium">4xx</th>
                    <th className="py-2 pr-3 text-right font-medium">5xx</th>
                    <th className="py-2 pr-3 text-right font-medium">Макс, мс</th>
                    <th className="py-2 pl-3 font-medium">Доля ошибок</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-ink-100">
                  {routeMetrics.map((route) => {
                    const info = ROUTE_INFO[route.routeId];
                    const errors = route.clientErrors + route.serverErrors;
                    const errorShare = route.requests > 0 ? errors / route.requests : null;
                    const topErrorStatus = route.byStatus.find((entry) => entry.status >= 400);
                    return (
                      <tr key={route.routeId} className="align-middle">
                        <td className="py-2 pr-3">
                          <span className="block font-medium text-ink-900">
                            {info ? (
                              <Link to={info.to} className="hover:text-brand-700">
                                {info.title}
                              </Link>
                            ) : (
                              route.routeId
                            )}
                          </span>
                          <span className="mt-0.5 block font-mono text-xs break-all text-ink-400">
                            {route.routeId} → {route.routeUri || 'адрес маршрута не пришёл'}
                          </span>
                        </td>
                        <td className="py-2 pr-3">
                          {route.requests > 0 ? (
                            <Badge tone="success">запросы есть</Badge>
                          ) : (
                            <Badge tone="neutral">запросов не было</Badge>
                          )}
                          {topErrorStatus ? (
                            <span className="mt-0.5 block text-xs text-ink-500">
                              в том числе код {topErrorStatus.status}
                            </span>
                          ) : null}
                        </td>
                        <td className="py-2 pr-3 text-right tabular-nums">{route.requests}</td>
                        <td className="py-2 pr-3 text-right tabular-nums">{route.clientErrors}</td>
                        <td className="py-2 pr-3 text-right tabular-nums">{route.serverErrors}</td>
                        <td className="py-2 pr-3 text-right tabular-nums">
                          {route.maxMs === null ? '—' : Math.round(route.maxMs)}
                        </td>
                        <td className="py-2 pl-3">
                          {errorShare === null ? (
                            <span className="text-xs text-ink-400">—</span>
                          ) : (
                            <span className="block w-32">
                              <span className="mb-1 block text-xs tabular-nums text-ink-500">
                                {errors} · {fractionPercent(errorShare)}
                              </span>
                              <Meter share={errorShare} />
                            </span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <dl className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <div className="rounded-card border border-ink-100 p-3">
                <dt className="text-xs text-ink-500">Запросов через шлюз</dt>
                <dd className="mt-0.5 text-xl font-semibold tabular-nums text-ink-900">
                  {gatewayRequests}
                </dd>
              </div>
              <div className="rounded-card border border-ink-100 p-3">
                <dt className="text-xs text-ink-500">Ответов 4xx</dt>
                <dd className="mt-0.5 text-xl font-semibold tabular-nums text-ink-900">
                  {clientErrors}
                </dd>
              </div>
              <div className="rounded-card border border-ink-100 p-3">
                <dt className="text-xs text-ink-500">Ответов 5xx</dt>
                <dd className="mt-0.5 text-xl font-semibold tabular-nums text-ink-900">
                  {serverErrors}
                </dd>
              </div>
              <div className="rounded-card border border-ink-100 p-3">
                <dt className="text-xs text-ink-500">Средняя длительность ответа</dt>
                <dd className="mt-0.5 text-xl font-semibold tabular-nums text-ink-900">
                  {gatewayAverageMs === null ? '—' : `${Math.round(gatewayAverageMs)} мс`}
                </dd>
              </div>
            </dl>
          </div>
        ) : null}
      </Panel>

      {/* Что не отвечает: маршруты с ошибками, молчащие маршруты и упавшие пробы листингов. */}
      <Panel
        title="Что не отвечает"
        subtitle="Два независимых источника: ошибки маршрутов из метрик шлюза и неудачные пробы листингов, которые делает сам обзор"
      >
        <div className="space-y-4">
          {metrics.isError ? (
            <Alert tone="info" title="Метрики шлюза недоступны">
              Список маршрутов сверять не с чем: {humanMessage(metrics.error)}. Ниже остаётся вторая
              проверка — по пробам листингов.
            </Alert>
          ) : null}

          {metrics.data ? (
            <div className="grid gap-4 lg:grid-cols-2">
              <div>
                <p className="text-sm font-semibold text-ink-900">Маршруты, ответившие ошибкой</p>
                {routeMetrics.some((route) => route.clientErrors + route.serverErrors > 0) ? (
                  <ul className="mt-2 divide-y divide-ink-100">
                    {routeMetrics
                      .filter((route) => route.clientErrors + route.serverErrors > 0)
                      .sort(
                        (left, right) =>
                          right.clientErrors +
                          right.serverErrors -
                          (left.clientErrors + left.serverErrors),
                      )
                      .map((route) => {
                        const info = ROUTE_INFO[route.routeId];
                        const topErrorStatus = route.byStatus.find((entry) => entry.status >= 400);
                        return (
                          <li
                            key={route.routeId}
                            className="flex items-start justify-between gap-3 py-2"
                          >
                            <span className="min-w-0 text-sm">
                              <span className="block font-medium text-ink-900">
                                {info ? info.title : route.routeId}
                              </span>
                              <span className="mt-0.5 block font-mono text-xs break-all text-ink-400">
                                {route.routeId}
                                {topErrorStatus ? ` · код ${topErrorStatus.status}` : ''}
                              </span>
                            </span>
                            <span className="shrink-0 text-right text-xs text-ink-600">
                              <span className="block tabular-nums">
                                4xx {route.clientErrors} · 5xx {route.serverErrors}
                              </span>
                              <span className="block tabular-nums text-ink-500">
                                из {route.requests} запросов
                              </span>
                            </span>
                          </li>
                        );
                      })}
                  </ul>
                ) : (
                  <p className="mt-2 rounded-xl bg-ink-50 px-3 py-2 text-xs text-ink-500 ring-1 ring-ink-100">
                    Ни один маршрут не ответил ошибкой: 4xx и 5xx в выдаче шлюза нет.
                  </p>
                )}
              </div>

              <div>
                <p className="text-sm font-semibold text-ink-900">Маршруты без запросов</p>
                {routeMetrics.some((route) => route.requests === 0) ? (
                  <ul className="mt-2 divide-y divide-ink-100">
                    {routeMetrics
                      .filter((route) => route.requests === 0)
                      .map((route) => (
                        <li key={route.routeId} className="py-2 text-sm">
                          <span className="block font-medium text-ink-900">{route.routeId}</span>
                          <span className="mt-0.5 block font-mono text-xs break-all text-ink-400">
                            {route.routeUri || 'адрес маршрута не пришёл'}
                          </span>
                        </li>
                      ))}
                  </ul>
                ) : (
                  <p className="mt-2 rounded-xl bg-ink-50 px-3 py-2 text-xs leading-relaxed text-ink-500 ring-1 ring-ink-100">
                    Молчащих маршрутов в выдаче нет. Важная оговорка: шлюз публикует серию только по
                    тому маршруту, через который уже прошёл хотя бы один вызов, поэтому маршрут,
                    который не отвечает вообще, здесь не появится — его видно по пробам листингов
                    ниже и по ошибкам 5xx.
                  </p>
                )}
              </div>
            </div>
          ) : null}

          <div>
            <p className="text-sm font-semibold text-ink-900">
              Пробы листингов, которые делает обзор
            </p>
            <ul className="mt-2 divide-y divide-ink-100">
              {probes.map((probe) => (
                <li key={probe.endpoint} className="flex items-start justify-between gap-3 py-2">
                  <span className="min-w-0 text-sm">
                    <span className="block font-medium text-ink-900">{probe.title}</span>
                    <span className="mt-0.5 block font-mono text-xs break-all text-ink-400">
                      {probe.endpoint}?page=0&amp;size=5
                    </span>
                    {probe.state.isError ? (
                      <span className="mt-0.5 block text-xs text-brand-700">
                        {humanMessage(probe.state.error)}
                      </span>
                    ) : null}
                  </span>
                  <span className="shrink-0">
                    {probe.state.isPending ? <Skeleton className="h-6 w-24" /> : null}
                    {!probe.state.isPending && probe.state.isError ? (
                      <Badge tone="danger">нет ответа</Badge>
                    ) : null}
                    {!probe.state.isPending && !probe.state.isError ? (
                      <Badge tone="success">ответил</Badge>
                    ) : null}
                  </span>
                </li>
              ))}
            </ul>
            {brokenProbes.length === 0 ? (
              <p className="mt-2 text-xs text-ink-500">
                Все шесть листингов ответили — со стороны обзора сервисы живы.
              </p>
            ) : (
              <p className="mt-2 text-xs text-brand-700">
                Не ответили: {brokenProbes.map((probe) => probe.title).join(', ')}. Остальные блоки
                дашборда при этом работают: у каждого свой запрос и своя ошибка.
              </p>
            )}
          </div>
        </div>
      </Panel>

      {/* Лента последних событий: платежи, поездки и записи в одном списке. */}
      <Panel
        title="Лента последних событий"
        subtitle="Последние пять платежей, поездок и записей, отсортированные по времени: платёж — по времени создания, поездка — по времени заявки, запись QTime — по началу окна (момент оформления записи в нормализованном ответе не приходит)"
        action={
          <>
            <Link to="/admin/payments" className={buttonClass({ variant: 'ghost', size: 'sm' })}>
              Платежи
            </Link>
            <Link to="/admin/trips" className={buttonClass({ variant: 'ghost', size: 'sm' })}>
              Поездки
            </Link>
            <Link to="/admin/bookings" className={buttonClass({ variant: 'ghost', size: 'sm' })}>
              Записи
            </Link>
          </>
        }
      >
        {paymentsRecent.isPending || tripsRecent.isPending || bookingsRecent.isPending ? (
          <SkeletonRows count={5} />
        ) : null}

        {!paymentsRecent.isPending && !tripsRecent.isPending && !bookingsRecent.isPending ? (
          <div>
            {feedEntries.length > 0 ? (
              <ol className="divide-y divide-ink-100">
                {feedEntries.map((entry) => (
                  <li key={entry.key}>
                    <Link to={entry.to} className="flex items-center gap-3 py-2.5 hover:bg-ink-50">
                      <span
                        aria-hidden="true"
                        className={cx(
                          'grid h-10 w-10 shrink-0 place-items-center rounded-xl text-lg',
                          ICON_TONES[FEED_TONES[entry.kind]],
                        )}
                      >
                        {FEED_ICONS[entry.kind]}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="flex flex-wrap items-center gap-2">
                          <span className="text-sm font-medium text-ink-900">{entry.title}</span>
                          <Chip tone={FEED_TONES[entry.kind]}>
                            {FEED_KIND_LABELS[entry.kind]}
                          </Chip>
                        </span>
                        <span className="mt-0.5 block text-xs break-words text-ink-500">
                          {entry.detail}
                        </span>
                      </span>
                      <span className="shrink-0 text-right text-xs text-ink-500">
                        {momentLabel(entry.at)}
                      </span>
                    </Link>
                  </li>
                ))}
              </ol>
            ) : (
              <EmptyState
                title="Событий нет"
                description="Платежей, поездок и записей в последних выборках не оказалось. Лента не выдумывает события: как только сервисы отдадут записи, они появятся здесь."
              />
            )}

            {missingFeedSources.length > 0 ? (
              <Alert tone="warning" className="mt-3" title="Лента неполная">
                Нет ответа по источникам:{' '}
                {missingFeedSources.map((source) => source.label).join(', ')}. Поэтому в списке
                только те события, которые сервисы успели отдать.
              </Alert>
            ) : null}
          </div>
        ) : null}
      </Panel>

      {/* Ресурсы шлюза. */}
      <Panel
        title="Ресурсы шлюза"
        subtitle="JVM, процесс и хост шлюза — единственного сервиса, чьи метрики открыты наружу"
        action={
          <Button
            variant="secondary"
            size="sm"
            loading={metrics.isFetching}
            onClick={() => void metrics.refetch()}
          >
            Обновить метрики
          </Button>
        }
      >
        {metrics.isPending ? <SkeletonRows count={4} /> : null}

        {metrics.isError ? (
          <Alert tone="info" title="Ресурсы недоступны">
            {humanMessage(metrics.error)}. Метрики отдаёт <code>/actuator/prometheus</code> с
            токеном; без него шлюз отвечает 401, и вместо нулей здесь стоит причина.
          </Alert>
        ) : null}

        {metrics.data ? (
          <dl className="divide-y divide-ink-100">
            <ResourceRow
              label="Память JVM (heap)"
              text={
                formatBytes(metrics.data.jvm.heapUsedBytes) === null
                  ? 'метрика не пришла'
                  : metrics.data.jvm.heapMaxBytes === null
                    ? `${formatBytes(metrics.data.jvm.heapUsedBytes)} — максимум JVM не сообщила`
                    : `${formatBytes(metrics.data.jvm.heapUsedBytes)} из ${formatBytes(
                        metrics.data.jvm.heapMaxBytes,
                      )} (${percent(
                        metrics.data.jvm.heapUsedBytes,
                        metrics.data.jvm.heapMaxBytes,
                      )})`
              }
              share={
                metrics.data.jvm.heapMaxBytes && metrics.data.jvm.heapMaxBytes > 0
                  ? metrics.data.jvm.heapUsedBytes / metrics.data.jvm.heapMaxBytes
                  : null
              }
            />
            <ResourceRow
              label="Память вне heap"
              text={formatBytes(metrics.data.jvm.nonHeapUsedBytes) ?? 'метрика не пришла'}
            />
            <ResourceRow
              label="Потоки JVM"
              text={
                metrics.data.jvm.threadsLive === null
                  ? 'метрика не пришла'
                  : `${metrics.data.jvm.threadsLive} живых`
              }
            />
            <ResourceRow
              label="Загрузка процессора (процесс шлюза)"
              text={fractionPercent(metrics.data.process.cpuUsage) ?? 'метрика не пришла'}
              share={metrics.data.process.cpuUsage}
            />
            <ResourceRow
              label="Загрузка хоста"
              text={`${fractionPercent(metrics.data.system.cpuUsage) ?? 'метрика не пришла'}${
                metrics.data.system.cpuCount === null
                  ? ''
                  : ` · ядер: ${metrics.data.system.cpuCount}`
              }${
                metrics.data.system.loadAverage1m === null
                  ? ''
                  : ` · load average 1 мин: ${metrics.data.system.loadAverage1m
                      .toFixed(2)
                      .replace('.', ',')}`
              }`}
              share={metrics.data.system.cpuUsage}
            />
            <ResourceRow
              label="Диск шлюза"
              text={
                metrics.data.system.diskTotalBytes === null ||
                metrics.data.system.diskFreeBytes === null
                  ? 'метрика не пришла'
                  : `свободно ${formatBytes(metrics.data.system.diskFreeBytes)} из ${formatBytes(
                      metrics.data.system.diskTotalBytes,
                    )}`
              }
              share={
                metrics.data.system.diskTotalBytes && metrics.data.system.diskFreeBytes !== null
                  ? (metrics.data.system.diskTotalBytes - metrics.data.system.diskFreeBytes) /
                    metrics.data.system.diskTotalBytes
                  : null
              }
            />
            <ResourceRow
              label="Время работы шлюза"
              text={
                metrics.data.process.uptimeSeconds === null
                  ? 'метрика не пришла'
                  : `работает ${formatAgeSeconds(metrics.data.process.uptimeSeconds)}`
              }
            />
            <ResourceRow
              label="Сборки мусора"
              text={`${metrics.data.jvm.gcCollections} сборок · суммарная пауза ${Math.round(
                metrics.data.jvm.gcPauseMs,
              )} мс`}
            />
            <ResourceRow
              label="Открытых файлов"
              text={
                metrics.data.process.openFiles === null
                  ? 'метрика не пришла'
                  : String(metrics.data.process.openFiles)
              }
            />
          </dl>
        ) : null}
      </Panel>

      {/* Health шлюза и его журнал. */}
      <Panel
        title="Шлюз: здоровье и журнал"
        subtitle="Ответ /actuator/health и уровни logback: видно, жив ли шлюз и что он записал в журнал с момента запуска"
        action={
          <Button
            variant="secondary"
            size="sm"
            loading={health.isFetching}
            onClick={() => void health.refetch()}
          >
            Проверить шлюз
          </Button>
        }
      >
        {health.isPending ? <SkeletonRows count={2} /> : null}

        {health.isError ? (
          <ErrorAlert
            error={health.error}
            title="Шлюз недоступен"
            onRetry={() => void health.refetch()}
          />
        ) : null}

        {health.data ? (
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <span
                aria-hidden="true"
                className={cx(
                  'grid h-10 w-10 place-items-center rounded-xl text-lg',
                  ICON_TONES[gatewayTone(health.data.status)],
                )}
              >
                🚦
              </span>
              <Badge tone={gatewayTone(health.data.status)}>{health.data.status}</Badge>
              <span className="text-sm text-ink-600">{gatewayLabel(health.data.status)}</span>
              <span className="text-xs text-ink-500">
                HTTP {health.data.httpStatus}
                {health.data.httpStatus !== 200
                  ? ' — так шлюз отвечает, когда его состояние DOWN, и это ответ, а не сбой запроса'
                  : ''}
              </span>
            </div>

            {health.data.components.length > 0 ? (
              <ul className="divide-y divide-ink-100">
                {health.data.components.map((component) => (
                  <li
                    key={component.name}
                    className="flex items-center justify-between gap-3 py-2 text-sm"
                  >
                    <span className="font-mono text-xs text-ink-600">{component.name}</span>
                    <Badge tone={gatewayTone(component.status)}>{component.status}</Badge>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="rounded-xl bg-ink-50 px-3 py-2 text-xs leading-relaxed text-ink-500 ring-1 ring-ink-100">
                Шлюз ответил без детализации: в теле пришёл только итоговый статус. Список проверок
                (база, Redis, диск) закрыт настройкой{' '}
                <code>management.endpoint.health.show-details</code>, поэтому по этому экрану нельзя
                сказать, какая именно зависимость шлюза лежит — видно только, жив шлюз или нет.
              </p>
            )}

            {metrics.data ? (
              <ul className="divide-y divide-ink-100">
                {LOG_LEVELS.map((level) => (
                  <li key={level.key} className="flex items-center justify-between gap-3 py-2">
                    <span className="text-sm text-ink-600">{level.label}</span>
                    <Badge
                      tone={metrics.data.logs[level.key] > 0 ? level.tone : 'neutral'}
                      className="tabular-nums"
                    >
                      {metrics.data.logs[level.key]}
                    </Badge>
                  </li>
                ))}
              </ul>
            ) : null}

            <p className="text-xs text-ink-500">
              Это накопленные счётчики logback с момента запуска шлюза, а не «за сутки»: выдача
              Prometheus отдаёт текущее значение счётчика, истории у неё нет. Серий в ответе:{' '}
              {metrics.data ? metrics.data.samples : 'нет данных'}.
            </p>
          </div>
        ) : null}
      </Panel>

      {/* Чего здесь нет — словами, а не пустыми графиками. */}
      <Panel
        title="Чего здесь нет"
        subtitle="Границы данных: то, чего в API действительно нет, поэтому и на экране этого не будет"
      >
        <ul className="space-y-3 text-sm text-ink-600">
          <li>
            <span className="font-medium text-ink-900">Метрик Kafka, outbox и DLT нет.</span> Шлюз
            публикует только свои серии: количество событий в топиках, лаг консьюмеров, размер
            outbox и письма в DLT наружу не отдаёт ни один сервис, поэтому ни «зависших событий»,
            ни «писем в DLT» на этом экране не будет.
          </li>
          <li>
            <span className="font-medium text-ink-900">
              По-сервисных метрик нет — только шлюз.
            </span>{' '}
            <code>/actuator/prometheus</code> открыт у самого шлюза; у payment-, trip-, order-,
            catalog- и qtime-service своих метрик через шлюз не видно вовсе. Поэтому карта сервисов
            построена на счётчиках шлюза: это нагрузка и ошибки маршрута, а не внутреннее состояние
            сервиса (пулы, очереди, кэши).
          </li>
          <li>
            <span className="font-medium text-ink-900">Grafana и истории нет.</span> Выдача
            Prometheus — это текущий срез счётчиков, а не временной ряд: API не отдаёт ни точек за
            прошлые периоды, ни агрегатов по часам. Поэтому здесь нет графиков «за сутки», нет
            трендов и нет алертов — сравнивать текущее значение можно только с самим собой, вручную.
          </li>
          <li>
            <span className="font-medium text-ink-900">Заказы видны только листингом.</span>{' '}
            <code>GET /api/v1/orders</code> отдаёт страницу заказов, поэтому счётчик настоящий, а вот
            истории переходов и платежа по заказу в обзоре нет: их показывает раздел «Заказы» по
            номеру или идентификатору.
          </li>
          <li>
            <span className="font-medium text-ink-900">
              Парк и диспетчерскую обзор не опрашивает.
            </span>{' '}
            «Живые» эндпоинты <code>/dispatch/drivers</code> и <code>/dispatch/nearest</code> отдают
            проекцию позиций, у которой есть срок годности; дублировать их здесь и показывать
            устаревшие машины было бы хуже, чем не показывать их вовсе. Свежесть позиций видно
            только в разделе «Парк и диспетчерская».
          </li>
          <li>
            <span className="font-medium text-ink-900">Кольцо статусов — по выборке.</span> Доли
            платежей считает клиент по загруженной странице (<code>size={depth}</code>), потому что
            агрегата «платежи по статусам» сервис не отдаёт. Число загруженных строк подписано рядом
            с диаграммой.
          </li>
          {section.endpoints.includes('/settlements') ? (
            <li>
              <span className="font-medium text-ink-900">Расчётов с мерчантами в обзоре нет.</span>{' '}
              Листинга расчётов в клиенте пока нет, поэтому цифр по ним здесь не появится — смотрите
              раздел «Расчёты с мерчантами».
            </li>
          ) : null}
        </ul>
      </Panel>
    </div>
  );
}

