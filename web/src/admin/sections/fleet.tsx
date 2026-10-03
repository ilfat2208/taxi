/**
 * Раздел админ-панели «Парк и диспетчерская».
 *
 * Раздел собран как рабочее место диспетчера, а не как одна таблица на весь экран:
 * тулбар с числами и действиями, цветные плитки парка, слева — боковой рейл статусов
 * и таблица водителей, справа — поиск ближайших к точке, ссылка на живую карту и
 * честный перечень того, чего в API нет. Блоки берутся из общего набора `admin/kit`
 * (`KpiTile`, `Panel`, `StatusRail`, `Toolbar`), поэтому раздел выглядит так же, как
 * соседние разделы панели.
 *
 * Что здесь есть: кто на линии, сколько машин занято, свободно, в поездке и не на
 * линии, у кого вообще есть позиция, насколько свежие отчёты и кто ближе всех к
 * заданной точке. Что здесь сознательно отсутствует: карта. Живая карта уже сделана
 * на `/dispatch` (Leaflet), и вторая карта в панели была бы вторым ответом на тот же
 * вопрос — вместо неё таблица, честные цифры и ссылка на диспетчерскую.
 *
 * Данные: `GET /api/v1/dispatch/drivers` и `GET /api/v1/dispatch/nearest`
 * (`services/dispatch-service/.../api/DispatchController.java`, ответы
 * `DispatchDtos.FleetResponse` / `DispatchDtos.NearestResponse`; на клиенте —
 * `fetchDispatchDrivers` / `fetchNearestDrivers` из `src/api/endpoints.ts`).
 * Обе ручки только читают: назначить машину вручную из этого раздела нельзя,
 * поэтому кнопок изменения здесь нет ни у ADMIN, ни у SUPPORT, а `data-admin-write`
 * в разметке не встречается вовсе. Кнопка «CSV» выгружает в буфер обмена уже
 * загруженные строки — это действие браузера, а не запись на сервере.
 *
 * Числа честно разделены на две группы, и это подписано на экране: `onDuty` и
 * `withPosition` — поля ответа сервиса, всё остальное (статусы, свежесть, рейл)
 * посчитано по уже загруженному списку, потому что фильтра по статусу у ручки нет.
 */
import { useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { fetchDispatchDrivers, fetchNearestDrivers } from '../../api/endpoints';
import type { DispatchDriver } from '../../api/types';
import { Alert, ErrorAlert } from '../../components/ui/Alerts';
import { Badge, StatusBadge } from '../../components/ui/Badge';
import { Button, buttonClass } from '../../components/ui/Button';
import { DetailRow } from '../../components/ui/Card';
import { CopyButton } from '../../components/ui/CopyButton';
import { EmptyState } from '../../components/ui/EmptyState';
import { SelectField, TextField } from '../../components/ui/Field';
import { SkeletonRows } from '../../components/ui/Skeleton';
import {
  formatAgeSeconds,
  formatDateTime,
  formatDistanceMeters,
  roleLabel,
  shortId,
  statusLabel,
} from '../../lib/format';
import { KpiTile, Panel, StatusRail, Toolbar } from '../kit';
import type { AdminSectionProps } from '../sections';

/* ------------------------------------------------------------------ константы */

/** Локальные ключи запросов: реестр `src/lib/queryKeys.ts` другими разделами не трогаем. */
const FLEET_KEY = ['admin', 'fleet'] as const;

/** Диспетчерская опрашивает флот каждые 2 с (`useDispatch`); здесь хватит 15 с. */
const FLEET_REFETCH_INTERVAL_MS = 15_000;

const REFRESH_OPTIONS = [
  { value: String(FLEET_REFETCH_INTERVAL_MS), label: `каждые ${FLEET_REFETCH_INTERVAL_MS / 1000} с` },
  { value: '0', label: 'вручную, без автообновления' },
];

const NEAREST_RADIUS_M = 3000;
const NEAREST_LIMIT = 10;

/** Статусы, в которых машина уже занята заказом (`DriverStatus` в dispatch-service). */
const BUSY_STATUSES = ['BUSY', 'ON_TRIP'];

/**
 * Статусы водителя для рейла (`DriverStatus` в dispatch-service).
 *
 * Справочника статусов в API нет: это ровно те коды, которые сервис кладёт в ответ.
 * Статус, которого здесь нет, рейл всё равно покажет — отдельной строкой с кодом,
 * а не молча выкинет.
 */
const DRIVER_RAIL_STATUSES = ['ONLINE', 'BUSY', 'ON_TRIP', 'OFFLINE', 'BLOCKED'] as const;

/** Значение рейла «все» совпадает с соглашением набора блоков: пустая строка. */
const RAIL_ALL = '';
/** Пункт рейла, которого нет среди статусов сервиса: машины без координат. */
const RAIL_NO_POSITION = '__no_position__';

const DISPATCH_PATH = '/dispatch';

interface NearestPoint {
  lat: number;
  lon: number;
  radiusM: number;
}

interface RailItem {
  value: string;
  label: string;
  count: number;
}

function hasPosition(driver: DispatchDriver): boolean {
  return Number.isFinite(driver.lat) && Number.isFinite(driver.lon);
}

function isBusy(driver: DispatchDriver): boolean {
  return BUSY_STATUSES.includes(driver.status);
}

/** Как показать момент: без ответа — прочерк, а не «только что». */
function stampOf(ms: number): string {
  return ms > 0 ? formatDateTime(new Date(ms).toISOString()) : '—';
}

function coordinates(driver: DispatchDriver): string {
  return hasPosition(driver) ? `${driver.lat.toFixed(5)}, ${driver.lon.toFixed(5)}` : 'нет координат';
}

/**
 * Ошибка запроса: подпись говорит, что именно не получилось, а `ErrorAlert` — почему.
 *
 * Свой `title` в `ErrorAlert` не передаём намеренно: без него заголовком становится
 * `humanMessage(error)` — перевод кода сервиса, а не только его `detail`.
 */
function RequestError({
  label,
  error,
  onRetry,
}: {
  label: string;
  error: unknown;
  onRetry: () => void;
}) {
  return (
    <div className="space-y-2">
      <p className="text-sm font-medium text-ink-700">{label}</p>
      <ErrorAlert error={error} onRetry={onRetry} />
    </div>
  );
}

/**
 * Путь эндпоинта внутри текста: моноширинно и без обратных кавычек, которые
 * иначе попадали бы на экран как есть.
 */
function Endpoint({ children }: { children: ReactNode }) {
  return <code className="font-mono text-xs">{children}</code>;
}

/** Иконка плитки: набор блоков даёт цветной квадрат 40×40, сюда приходит только знак. */
function Icon({ children }: { children: ReactNode }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-5 w-5"
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

/**
 * Кнопка «CSV»: выгружает уже загруженные строки в буфер обмена.
 *
 * Это действие над данными в браузере, а не изменение на сервере: у ручек раздела
 * нет ни одной мутации. Поэтому пометки `data-admin-write` здесь нет и быть не должно.
 */
function CsvButton({ rows, name }: { rows: string[][]; name: string }) {
  const [state, setState] = useState<'idle' | 'ok' | 'fail'>('idle');

  useEffect(() => {
    if (state === 'idle') {
      return;
    }
    const timer = window.setTimeout(() => setState('idle'), 2_000);
    return () => window.clearTimeout(timer);
  }, [state]);

  const copy = async () => {
    const csv = rows
      .map((row) => row.map((cell) => `"${cell.replace(/"/g, '""')}"`).join(';'))
      .join('\r\n');
    try {
      await navigator.clipboard.writeText(csv);
      setState('ok');
    } catch {
      // Буфер обмена недоступен (небезопасный контекст, отказ в правах) — так и говорим.
      setState('fail');
    }
  };

  return (
    <Button
      variant="secondary"
      size="sm"
      // Одна строка — это только заголовок CSV: выгружать нечего.
      disabled={rows.length <= 1}
      title={`Скопировать CSV загруженных строк: ${name}`}
      onClick={() => void copy()}
    >
      <span aria-live="polite">
        {state === 'ok' ? 'CSV скопирован' : state === 'fail' ? 'CSV недоступен' : 'CSV'}
      </span>
    </Button>
  );
}

/* ----------------------------------------------------------------- таблица */

function DriverTable({ drivers }: { drivers: DispatchDriver[] }) {
  return (
    <div className="relative overflow-x-auto">
      <table className="w-full min-w-[44rem] border-collapse text-sm">
        <caption className="sr-only">Водители на линии и свежесть их позиций</caption>
        <thead>
          <tr className="border-b border-ink-200 text-left text-xs text-ink-500 uppercase">
            <th scope="col" className="py-2 pr-3 font-medium">Водитель</th>
            <th scope="col" className="py-2 pr-3 font-medium">Статус</th>
            <th scope="col" className="py-2 pr-3 font-medium">Позиция</th>
            <th scope="col" className="py-2 pr-3 font-medium">Свежесть отчёта</th>
            <th scope="col" className="py-2 pr-3 font-medium">Скорость</th>
            <th scope="col" className="py-2 font-medium">Карта</th>
          </tr>
        </thead>
        <tbody>
          {drivers.map((driver) => (
            <tr key={driver.driverId} className="border-b border-ink-100 align-top">
              <td className="py-2 pr-3">
                <span className="block text-ink-900">{driver.displayName}</span>
                <span className="mt-0.5 flex items-center gap-1 font-mono text-xs text-ink-500">
                  {shortId(driver.driverId)}
                  <CopyButton value={driver.driverId} />
                </span>
                {driver.phone ? <span className="tnum block text-xs text-ink-500">{driver.phone}</span> : null}
              </td>
              <td className="py-2 pr-3">
                <StatusBadge status={driver.status} />
              </td>
              <td className="tnum py-2 pr-3 text-ink-700">{coordinates(driver)}</td>
              <td className="py-2 pr-3">
                {hasPosition(driver) ? (
                  <span className="flex flex-wrap items-center gap-2">
                    <span className="tnum text-ink-700">{formatAgeSeconds(driver.ageSeconds)} назад</span>
                    {driver.stale ? <Badge tone="warning">устарела</Badge> : <Badge tone="success">свежая</Badge>}
                  </span>
                ) : (
                  // Врать «0 с назад» про машину без геопозиции нельзя — так и пишем.
                  <span className="text-ink-500">позиция ещё не приходила</span>
                )}
              </td>
              <td className="tnum py-2 pr-3 text-ink-700">{`${Math.round(driver.speedKph)} км/ч`}</td>
              <td className="py-2">
                {/*
                  Диспетчерская не принимает параметр «выделить водителя» — глубокой
                  ссылки на конкретную машину в приложении нет, поэтому ссылка ведёт
                  на карту целиком (id выше можно скопировать и найти глазами).
                */}
                <Link
                  to={DISPATCH_PATH}
                  className="text-sm font-medium text-brand-700 hover:underline"
                  title="Открыть живую карту водителей"
                >
                  Открыть карту
                </Link>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ------------------------------------------------------- ближайшие к точке */

function NearestResult({ point }: { point: NearestPoint }) {
  const query = useQuery({
    queryKey: ['admin', 'fleet', 'nearest', point],
    queryFn: () =>
      fetchNearestDrivers({
        lat: point.lat,
        lon: point.lon,
        radiusM: point.radiusM,
        limit: NEAREST_LIMIT,
      }),
    staleTime: FLEET_REFETCH_INTERVAL_MS,
  });

  if (query.isPending) {
    return <SkeletonRows count={3} className="mt-3" />;
  }

  if (query.isError) {
    return (
      <div className="mt-3">
        <RequestError
          label="Не удалось получить ближайших водителей"
          error={query.error}
          onRetry={() => void query.refetch()}
        />
      </div>
    );
  }

  const candidates = query.data?.candidates ?? [];

  if (candidates.length === 0) {
    return (
      <EmptyState
        className="mt-3"
        title="Машин рядом нет"
        description={`В радиусе ${formatDistanceMeters(query.data?.radiusM ?? point.radiusM)} от точки ${point.lat.toFixed(5)}, ${point.lon.toFixed(5)} машин нет. Увеличьте радиус — сервис вернул пустой список, а не ошибку.`}
      />
    );
  }

  return (
    <>
      <p className="mt-3 flex flex-wrap items-center gap-2 text-xs text-ink-500">
        <Badge tone="neutral">{`кандидатов: ${candidates.length}`}</Badge>
        <span className="tnum">ответ от {formatDateTime(query.data?.generatedAt)}</span>
      </p>
      <ul className="mt-2 divide-y divide-ink-100">
        {candidates.map((candidate) => (
          <li key={candidate.driverId} className="flex flex-wrap items-center justify-between gap-2 py-2">
            <span className="min-w-0">
              <span className="block text-sm text-ink-900">{candidate.displayName}</span>
              <span className="block font-mono text-xs text-ink-500">{shortId(candidate.driverId)}</span>
            </span>
            <span className="tnum text-right text-sm text-ink-700">
              {formatDistanceMeters(candidate.distanceM)}
              <span className="ml-2 text-xs text-ink-500">
                отчёт {formatAgeSeconds(candidate.ageSeconds)} назад
              </span>
            </span>
          </li>
        ))}
      </ul>
    </>
  );
}

type ParsedField = { ok: true; value: number } | { ok: false; message: string };

function parseNumber(raw: string, min: number, max: number): ParsedField {
  const text = raw.trim().replace(',', '.');
  if (text === '') {
    return { ok: false, message: 'Укажите число' };
  }
  const value = Number(text);
  if (!Number.isFinite(value)) {
    return { ok: false, message: 'Только число' };
  }
  if (value < min || value > max) {
    return { ok: false, message: `Допустимо от ${min} до ${max}` };
  }
  return { ok: true, value };
}

function NearestCard() {
  const [latText, setLatText] = useState('42.3155');
  const [lonText, setLonText] = useState('69.5867');
  const [radiusText, setRadiusText] = useState(String(NEAREST_RADIUS_M));
  const [errors, setErrors] = useState<{ lat?: string; lon?: string; radiusM?: string }>({});
  // Запрос уходит только по кнопке: без этого набор «4», «42», «42.3» в поле широты
  // отправлял бы запрос на каждый символ.
  const [point, setPoint] = useState<NearestPoint | null>(null);

  const submit = () => {
    const lat = parseNumber(latText, -90, 90);
    const lon = parseNumber(lonText, -180, 180);
    const radiusM = parseNumber(radiusText, 100, 50_000);

    if (!lat.ok || !lon.ok || !radiusM.ok) {
      setErrors({
        lat: lat.ok ? undefined : lat.message,
        lon: lon.ok ? undefined : lon.message,
        radiusM: radiusM.ok ? undefined : radiusM.message,
      });
      return;
    }

    setErrors({});
    setPoint({ lat: lat.value, lon: lon.value, radiusM: radiusM.value });
  };

  return (
    <Panel
      title="Ближайшие к точке"
      subtitle={
        <>
          <Endpoint>GET /api/v1/dispatch/nearest</Endpoint> — радиус до 50 км, не больше {NEAREST_LIMIT} записей,
          ближайшая первой
        </>
      }
    >
      <form
        className="grid gap-3 sm:grid-cols-2"
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        <TextField
          id="fleet-lat"
          label="Широта"
          inputMode="decimal"
          value={latText}
          error={errors.lat}
          hint="-90 … 90"
          onChange={(event) => setLatText(event.target.value)}
        />
        <TextField
          id="fleet-lon"
          label="Долгота"
          inputMode="decimal"
          value={lonText}
          error={errors.lon}
          hint="-180 … 180"
          onChange={(event) => setLonText(event.target.value)}
        />
        <TextField
          id="fleet-radius"
          label="Радиус, м"
          inputMode="numeric"
          value={radiusText}
          error={errors.radiusM}
          hint="100 … 50 000"
          onChange={(event) => setRadiusText(event.target.value)}
        />
        <div className="flex items-end">
          <Button type="submit" block>
            Найти ближайших
          </Button>
        </div>
      </form>

      {point ? (
        <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-xs text-ink-500">
          <span className="tnum">
            Точка поиска: {point.lat}, {point.lon} · радиус {formatDistanceMeters(point.radiusM)}
          </span>
          <Button variant="ghost" size="sm" onClick={() => setPoint(null)}>
            Убрать результат
          </Button>
        </div>
      ) : (
        <p className="mt-3 text-sm text-ink-500">
          Укажите точку и радиус — сервис вернёт машины на линии, отсортированные по расстоянию. Значения по
          умолчанию — центр Шымкента.
        </p>
      )}

      {point ? <NearestResult point={point} /> : null}
    </Panel>
  );
}

/* --------------------------------------------------------- что не отдаётся */

function MissingPanel() {
  return (
    <Panel title="Чего в API нет" subtitle="Чтобы не искать в интерфейсе то, чего сервис не отдаёт.">
      <div className="space-y-2 text-sm text-ink-600">
        <p>
          <strong className="text-ink-800">Серверного поиска водителей нет.</strong> У{' '}
          <Endpoint>GET /api/v1/dispatch/drivers</Endpoint> нет параметров фильтра: список приходит целиком, а
          поиск по имени, телефону и id работает по уже загруженным строкам и подписан как клиентский.
        </p>
        <p>
          <strong className="text-ink-800">Машин и госномеров в ответе нет.</strong>{' '}
          <Endpoint>DispatchDtos.FleetResponse</Endpoint> отдаёт водителя, статус, координаты, курс, скорость и
          свежесть позиции — ни модели, ни номера, ни класса машины в нём нет, поэтому колонки «Машина» в
          таблице не появится.
        </p>
        <p>
          <strong className="text-ink-800">Глубокой ссылки на водителя нет.</strong> Диспетчерская открывается
          как <Endpoint>/dispatch</Endpoint> без параметров — «показать этого водителя» адресом не выражается.
          Ссылка «Открыть карту» ведёт на карту целиком, а id водителя рядом можно скопировать и найти глазами.
        </p>
        <p>
          <strong className="text-ink-800">Истории позиций тоже нет.</strong> Видна только последняя точка:
          трек, пробег и число поездок за смену пришлось бы собирать самим, а не брать из ответа.
        </p>
        <p>
          <strong className="text-ink-800">Зон и городов у диспетчерской нет.</strong> Ни{' '}
          <Endpoint>/dispatch/drivers</Endpoint>, ни <Endpoint>/dispatch/nearest</Endpoint> не принимают
          «город» или «зону»: выбор контекста вида «все зоны» ставить не из чего, поэтому в тулбаре стоит
          период автообновления, а не фильтр территории.
        </p>
      </div>
    </Panel>
  );
}

/* ------------------------------------------------------------ сам раздел */

export default function FleetSection({ role, canWrite }: AdminSectionProps) {
  // `section` не читаем намеренно: заголовок, описание и список эндпоинтов уже
  // нарисовала оболочка (`AdminPage`), дублировать их в разделе нечего.
  const [filter, setFilter] = useState('');
  const [railFilter, setRailFilter] = useState(RAIL_ALL);
  const [refreshMs, setRefreshMs] = useState(FLEET_REFETCH_INTERVAL_MS);

  const query = useQuery({
    queryKey: FLEET_KEY,
    queryFn: fetchDispatchDrivers,
    refetchInterval: refreshMs > 0 ? refreshMs : false,
    staleTime: FLEET_REFETCH_INTERVAL_MS,
  });

  const data = query.data;
  const drivers = useMemo(() => data?.drivers ?? [], [data]);

  const busy = drivers.filter(isBusy).length;
  const onTrip = drivers.filter((driver) => driver.status === 'ON_TRIP').length;
  const offline = drivers.filter((driver) => driver.status === 'OFFLINE').length;
  /** Свободен = `ONLINE`: единственный статус, в котором машину можно назначить. */
  const free = drivers.filter((driver) => driver.status === 'ONLINE').length;
  const withPosition = drivers.filter(hasPosition).length;
  const staleCount = drivers.filter((driver) => driver.stale).length;

  const oldestFix = useMemo(() => {
    const ages = drivers.filter(hasPosition).map((driver) => driver.ageSeconds);
    return ages.length === 0 ? null : Math.max(...ages);
  }, [drivers]);

  const railItems = useMemo<RailItem[]>(() => {
    const items: RailItem[] = DRIVER_RAIL_STATUSES.map((status) => ({
      value: status,
      label: statusLabel(status),
      count: drivers.filter((driver) => driver.status === status).length,
    }));

    // Статус, которого нет в справочнике выше, показываем отдельной строкой, а не прячем.
    const known = new Set<string>(DRIVER_RAIL_STATUSES);
    for (const status of [...new Set(drivers.map((driver) => driver.status))].sort()) {
      if (!known.has(status)) {
        items.push({
          value: status,
          label: `Прочий статус: ${status}`,
          count: drivers.filter((driver) => driver.status === status).length,
        });
      }
    }

    items.push({
      value: RAIL_NO_POSITION,
      label: 'Без позиции',
      count: drivers.filter((driver) => !hasPosition(driver)).length,
    });
    return items;
  }, [drivers]);

  const byRail = useMemo(() => {
    if (railFilter === RAIL_ALL) {
      return drivers;
    }
    if (railFilter === RAIL_NO_POSITION) {
      return drivers.filter((driver) => !hasPosition(driver));
    }
    return drivers.filter((driver) => driver.status === railFilter);
  }, [drivers, railFilter]);

  const needle = filter.trim().toLowerCase();
  const visible = useMemo(() => {
    if (needle === '') {
      return byRail;
    }
    return byRail.filter((driver) =>
      [driver.displayName, driver.driverId, driver.phone, driver.status]
        .join(' ')
        .toLowerCase()
        .includes(needle),
    );
  }, [byRail, needle]);

  const firstLoad = query.isPending;
  const hardError = query.isError && data === undefined;
  const softError = query.isError && data !== undefined;
  const lastResponse = stampOf(query.dataUpdatedAt);

  const railLabel =
    railFilter === RAIL_ALL
      ? 'все водители'
      : railFilter === RAIL_NO_POSITION
        ? 'без позиции'
        : statusLabel(railFilter);

  /** CSV по загруженным (и отфильтрованным) строкам: то, что видно в таблице. */
  const csvRows = useMemo(
    () => [
      ['driverId', 'имя', 'телефон', 'статус', 'широта', 'долгота', 'возраст_с', 'устарела', 'скорость_кмч'],
      ...visible.map((driver) => [
        driver.driverId,
        driver.displayName,
        driver.phone,
        driver.status,
        hasPosition(driver) ? String(driver.lat) : '',
        hasPosition(driver) ? String(driver.lon) : '',
        String(driver.ageSeconds),
        driver.stale ? 'да' : 'нет',
        String(Math.round(driver.speedKph)),
      ]),
    ],
    [visible],
  );

  return (
    <div className="space-y-4">
      <Alert tone="info" title="Раздел ничего не меняет">
        У <Endpoint>GET /api/v1/dispatch/drivers</Endpoint> и <Endpoint>GET /api/v1/dispatch/nearest</Endpoint>{' '}
        нет изменяющих операций: назначение машины вручную живёт на странице поездок. Поэтому кнопок изменения
        здесь нет ни у ADMIN, ни у SUPPORT
        {canWrite ? ' (у вас роль ADMIN — менять в этом разделе всё равно нечего)' : ''}. Вы вошли как{' '}
        {roleLabel(role)}.
      </Alert>

      <Toolbar
        right={
          <>
            <div className="w-56">
              <SelectField
                id="fleet-refresh"
                label="Автообновление"
                value={String(refreshMs)}
                options={REFRESH_OPTIONS}
                onChange={(event) => setRefreshMs(Number(event.target.value))}
              />
            </div>
            <Button variant="secondary" size="sm" loading={query.isFetching} onClick={() => void query.refetch()}>
              Обновить
            </Button>
            <CsvButton rows={csvRows} name="водители на линии" />
          </>
        }
      >
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone="brand">{`на линии: ${data ? data.onDuty : '—'}`}</Badge>
          <Badge tone="neutral">{`в списке: ${data ? drivers.length : '—'}`}</Badge>
          <Badge tone={staleCount > 0 ? 'warning' : 'success'}>{`устаревших позиций: ${staleCount}`}</Badge>
        </div>
      </Toolbar>

      <p className="tnum -mt-2 mb-4 text-xs text-ink-500" aria-live="polite">
        {data ? `Снимок от ${formatDateTime(data.generatedAt)} · позиция старше ${formatAgeSeconds(data.staleAfterSeconds)} считается устаревшей · ` : ''}
        {refreshMs > 0 ? `автообновление каждые ${Math.round(refreshMs / 1000)} с` : 'автообновление выключено'} ·
        последний ответ {lastResponse}
        {query.isFetching ? ' · обновляем…' : ''}
      </p>

      {hardError ? (
        <RequestError
          label="Не удалось получить список водителей на линии"
          error={query.error}
          onRetry={() => void query.refetch()}
        />
      ) : null}

      {/* -------------------------------------------------- плитки парка */}
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <KpiTile
          label="На линии"
          value={data ? data.onDuty : '—'}
          loading={firstLoad}
          tone="brand"
          icon={
            <Icon>
              <circle cx="12" cy="8" r="3.5" />
              <path d="M4.5 20c0-3.6 3.4-5.6 7.5-5.6s7.5 2 7.5 5.6" />
            </Icon>
          }
          caption={
            data
              ? `поле ответа · в списке сейчас ${drivers.length}, с позицией ${data.withPosition}`
              : 'поле ответа DispatchDtos.FleetResponse'
          }
        />
        <KpiTile
          label="Свободны"
          value={data ? free : '—'}
          loading={firstLoad}
          tone="success"
          icon={
            <Icon>
              <path d="M4.5 12.5 9.5 17.5 19.5 6.5" />
            </Icon>
          }
          caption="статус ONLINE — машину можно назначить"
        />
        <KpiTile
          label="Заняты"
          value={data ? busy : '—'}
          loading={firstLoad}
          tone="warning"
          icon={
            <Icon>
              <path d="M4 16.5V12l1.8-4.2A2 2 0 0 1 7.6 6.5h8.8a2 2 0 0 1 1.8 1.3L20 12v4.5" />
              <path d="M4 12h16" />
              <circle cx="7.5" cy="16.8" r="1.6" />
              <circle cx="16.5" cy="16.8" r="1.6" />
            </Icon>
          }
          caption={`${BUSY_STATUSES.join(' / ')} — по загруженному списку`}
        />
        <KpiTile
          label="В поездке"
          value={data ? onTrip : '—'}
          loading={firstLoad}
          tone="info"
          icon={
            <Icon>
              <path d="M4 18c4-1 4-9 8-10s5-3 8-4" />
              <path d="M17 4h3v3" />
            </Icon>
          }
          caption="ON_TRIP: полностью загруженная машина"
        />
        <KpiTile
          label="Не активно"
          value={data ? offline : '—'}
          loading={firstLoad}
          tone="neutral"
          icon={
            <Icon>
              <circle cx="12" cy="12" r="8" />
              <path d="M8.5 12h7" />
            </Icon>
          }
          caption="статус OFFLINE — на смену не вышли"
        />
        <KpiTile
          label="С позицией"
          value={data ? data.withPosition : '—'}
          loading={firstLoad}
          tone="info"
          icon={
            <Icon>
              <path d="M12 21s6.5-6 6.5-11a6.5 6.5 0 1 0-13 0C5.5 15 12 21 12 21Z" />
              <circle cx="12" cy="10" r="2.2" />
            </Icon>
          }
          caption={
            data
              ? withPosition === data.withPosition
                ? 'поле ответа · координаты есть у всех в списке'
                : `поле ответа · координат в списке: ${withPosition}`
              : 'поле ответа DispatchDtos.FleetResponse'
          }
        />
        <KpiTile
          label="Самый старый отчёт позиции"
          value={data ? (oldestFix === null ? '—' : formatAgeSeconds(oldestFix)) : '—'}
          loading={firstLoad}
          tone="warning"
          icon={
            <Icon>
              <circle cx="12" cy="12" r="8" />
              <path d="M12 8v4.5l3 1.8" />
            </Icon>
          }
          caption={oldestFix === null ? 'ни у кого нет координат' : 'по загруженному списку'}
        />
        <KpiTile
          label="Устаревших позиций"
          value={data ? staleCount : '—'}
          loading={firstLoad}
          tone={staleCount > 0 ? 'warning' : 'success'}
          icon={
            <Icon>
              <path d="M12 4.5 21 19.5H3L12 4.5Z" />
              <path d="M12 10.5v4" />
              <path d="M12 17.2h.01" />
            </Icon>
          }
          caption={data ? `вердикт stale: позиция старше ${formatAgeSeconds(data.staleAfterSeconds)}` : 'вердикт сервиса stale'}
        />
      </div>
      <p className="text-xs text-ink-500">
        «На линии» и «С позицией» — поля ответа сервиса; статусы, свежесть и числа рейла посчитаны по
        загруженному списку, потому что фильтра по статусу у ручки нет.
      </p>

      {softError ? (
        <RequestError
          label="Обновление не удалось — данные могли устареть"
          error={query.error}
          onRetry={() => void query.refetch()}
        />
      ) : null}

      {/* ------------------------------------------ рейл статусов и таблица */}
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,21rem)]">
        <div className="grid items-start gap-4 lg:grid-cols-[13rem_minmax(0,1fr)]">
          <Panel title="Статусы" subtitle="первый пункт — все водители" bodyClassName="space-y-2 p-2">
            <StatusRail
              items={railItems}
              active={railFilter}
              onSelect={setRailFilter}
              allLabel="Все водители"
              allCount={drivers.length}
            />
            <p className="px-2 text-xs text-ink-500">
              Числа — по загруженному списку: у <Endpoint>/dispatch/drivers</Endpoint> нет фильтра по статусу.
              {query.isFetching ? ' Обновляем…' : ''}
            </p>
          </Panel>

          <Panel
            title="Водители на линии"
            subtitle={
              data
                ? `Показано ${visible.length} из ${drivers.length} загруженных строк · фильтр «${railLabel}»`
                : 'Список водителей на линии'
            }
            action={
              <Button variant="secondary" size="sm" loading={query.isFetching} onClick={() => void query.refetch()}>
                Обновить
              </Button>
            }
            bodyClassName="space-y-3"
          >
            {firstLoad ? <SkeletonRows count={4} /> : null}

            {hardError ? (
              <p className="text-sm text-ink-500">
                Список не загрузился — причина в сообщении выше. Пустой таблицы здесь нет намеренно: «нет строк»
                и «нет ответа» — разные утверждения.
              </p>
            ) : null}

            {data && drivers.length > 0 ? (
              <>
                <div className="flex flex-wrap items-end justify-between gap-3">
                  <div className="w-full sm:w-72">
                    <TextField
                      id="fleet-filter"
                      label="Поиск по водителю"
                      placeholder="имя, телефон или id"
                      value={filter}
                      hint="Фильтр по уже загруженному списку: у /dispatch/drivers нет параметра поиска."
                      onChange={(event) => setFilter(event.target.value)}
                    />
                  </div>
                  <div className="flex flex-wrap items-center gap-2 pb-1">
                    <Badge tone="info">клиентский фильтр</Badge>
                    <Badge tone="neutral">{`показано ${visible.length} из ${drivers.length}`}</Badge>
                  </div>
                </div>

                {visible.length === 0 ? (
                  <EmptyState
                    title="Никто не подходит под фильтр"
                    description={
                      needle === ''
                        ? `В статусе «${railLabel}» загруженных строк нет. Выберите «Все водители» в рейле слева.`
                        : `По запросу «${filter.trim()}» в загруженном списке водителей ничего нет. Очистите поле, чтобы увидеть всех.`
                    }
                  />
                ) : (
                  <DriverTable drivers={visible} />
                )}
              </>
            ) : data ? (
              <EmptyState
                title="На линии никого нет"
                description={
                  data.onDuty > 0
                    ? `Сервис отдал пустой список водителей, хотя на смене числится ${data.onDuty}. Ни таблицы, ни рейла по строкам не будет; искать ближайших к точке при этом всё ещё можно — ручка nearest ходит в сервис напрямую.`
                    : 'Сервис вернул пустой список: ни один водитель не вышел на смену. Пока это так, искать ближайших имеет смысл только для проверки самой ручки.'
                }
              />
            ) : null}
          </Panel>
        </div>

        <div className="space-y-4">
          <NearestCard />

          <Panel
            title="Живая карта"
            subtitle="Вторая карта внутри админки отвечала бы на тот же вопрос иначе, чем настоящая диспетчерская."
            action={
              <Link to={DISPATCH_PATH} className={buttonClass({ variant: 'secondary', size: 'sm' })}>
                Открыть /dispatch
              </Link>
            }
          >
            <dl>
              <DetailRow label="Карта">Leaflet: маркеры водителей, цвет зависит от свежести позиции</DetailRow>
              <DetailRow label="Обновление">
                опрос <Endpoint>GET /api/v1/dispatch/drivers</Endpoint> каждые 2 секунды
              </DetailRow>
              <DetailRow label="Роли">{`${roleLabel('DISPATCHER')}, ${roleLabel('SUPPORT')}, ${roleLabel('ADMIN')}`}</DetailRow>
            </dl>
          </Panel>

          <MissingPanel />
        </div>
      </div>
    </div>
  );
}
