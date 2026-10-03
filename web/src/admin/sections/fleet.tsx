/**
 * Раздел админ-панели «Парк и диспетчерская».
 *
 * Что здесь есть: кто на линии, сколько машин занято, насколько свежие у них
 * позиции, и короткий список ближайших к точке поиска. Что здесь сознательно
 * отсутствует: карта. Живая карта уже сделана на `/dispatch` (Leaflet), и вторая
 * карта в панели была бы вторым ответом на тот же вопрос — вместо неё таблица,
 * честные цифры и ссылка на диспетчерскую.
 *
 * Данные: `GET /api/v1/dispatch/drivers` и `GET /api/v1/dispatch/nearest`
 * (`services/dispatch-service/.../api/DispatchController.java`, ответы
 * `DispatchDtos.FleetResponse` / `DispatchDtos.NearestResponse`; на клиенте —
 * `fetchDispatchDrivers` / `fetchNearestDrivers` из `src/api/endpoints.ts`).
 * Обе ручки только читают: назначить машину вручную из этого раздела нельзя,
 * поэтому кнопок изменения здесь нет ни у ADMIN, ни у SUPPORT.
 */
import { useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { fetchDispatchDrivers, fetchNearestDrivers } from '../../api/endpoints';
import type { DispatchDriver } from '../../api/types';
import { Alert, ErrorAlert } from '../../components/ui/Alerts';
import { Badge, StatusBadge } from '../../components/ui/Badge';
import { Button, buttonClass } from '../../components/ui/Button';
import { Card, CardBody, CardHeader, DetailRow } from '../../components/ui/Card';
import { CopyButton } from '../../components/ui/CopyButton';
import { EmptyState } from '../../components/ui/EmptyState';
import { TextField } from '../../components/ui/Field';
import { SkeletonRows } from '../../components/ui/Skeleton';
import {
  formatAgeSeconds,
  formatDateTime,
  formatDistanceMeters,
  roleLabel,
  shortId,
} from '../../lib/format';
import type { AdminSectionProps } from '../sections';

/** Локальные ключи запросов: реестр `src/lib/queryKeys.ts` другими разделами не трогаем. */
const FLEET_KEY = ['admin', 'fleet'] as const;

/** Диспетчерская опрашивает флот каждые 2 с (`useDispatch`); здесь хватит 15 с. */
const FLEET_REFETCH_INTERVAL_MS = 15_000;

const NEAREST_RADIUS_M = 3000;
const NEAREST_LIMIT = 10;

/** Статусы, в которых машина уже занята заказом (`DriverStatus` в dispatch-service). */
const BUSY_STATUSES = ['BUSY', 'ON_TRIP'];

const DISPATCH_PATH = '/dispatch';

interface NearestPoint {
  lat: number;
  lon: number;
  radiusM: number;
}

function hasPosition(driver: DispatchDriver): boolean {
  return Number.isFinite(driver.lat) && Number.isFinite(driver.lon);
}

function isBusy(driver: DispatchDriver): boolean {
  return BUSY_STATUSES.includes(driver.status);
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

function coordinates(driver: DispatchDriver): string {
  return hasPosition(driver) ? `${driver.lat.toFixed(5)}, ${driver.lon.toFixed(5)}` : 'нет координат';
}

/**
 * Путь эндпоинта внутри текста: моноширинно и без обратных кавычек, которые
 * иначе попадали бы на экран как есть.
 */
function Endpoint({ children }: { children: ReactNode }) {
  return <code className="font-mono text-xs">{children}</code>;
}

/* --------------------------------------------------------------------- KPI */

function KpiCard({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <Card className="px-4 py-3">
      <p className="text-xs text-ink-500">{label}</p>
      <p className="tnum text-xl font-semibold text-ink-900">{value}</p>
      {hint ? <p className="mt-0.5 text-xs text-ink-500">{hint}</p> : null}
    </Card>
  );
}

/* ----------------------------------------------------------------- таблица */

function DriverTable({ drivers }: { drivers: DispatchDriver[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[52rem] border-collapse text-sm">
        <caption className="sr-only">Водители на линии и свежесть их позиций</caption>
        <thead>
          <tr className="border-b border-ink-200 text-left text-xs text-ink-500">
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
      <p className="mt-3 rounded-xl border border-dashed border-ink-200 px-4 py-6 text-center text-sm text-ink-500">
        В радиусе {formatDistanceMeters(query.data?.radiusM ?? point.radiusM)} от точки{' '}
        {point.lat.toFixed(5)}, {point.lon.toFixed(5)} машин нет. Увеличьте радиус — сервис вернул пустой
        список, а не ошибку.
      </p>
    );
  }

  return (
    <ul className="mt-3 divide-y divide-ink-100">
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

function NearestSearch() {
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
    <Card>
      <CardHeader
        title="Ближайшие к точке"
        subtitle={`GET /api/v1/dispatch/nearest · радиус до 50 км, не больше ${NEAREST_LIMIT} записей, ближайшая первой`}
      />
      <CardBody>
        <form
          className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4"
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
            Укажите точку и радиус — сервис вернёт машины на линии, отсортированные по расстоянию.
            Значения по умолчанию — центр Шымкента.
          </p>
        )}

        {point ? <NearestResult point={point} /> : null}
      </CardBody>
    </Card>
  );
}

/* ------------------------------------------------------------ сам раздел */

export default function FleetSection({ role, canWrite }: AdminSectionProps) {
  // `section` не читаем намеренно: заголовок, описание и список эндпоинтов уже
  // нарисовала оболочка (`AdminPage`), дублировать их в разделе нечего.
  const [filter, setFilter] = useState('');

  const query = useQuery({
    queryKey: FLEET_KEY,
    queryFn: fetchDispatchDrivers,
    refetchInterval: FLEET_REFETCH_INTERVAL_MS,
    staleTime: FLEET_REFETCH_INTERVAL_MS,
  });

  const data = query.data;
  const drivers = useMemo(() => data?.drivers ?? [], [data]);

  const busy = drivers.filter(isBusy).length;
  const withPosition = drivers.filter(hasPosition).length;
  const staleCount = drivers.filter((driver) => driver.stale).length;

  const oldestFix = useMemo(() => {
    const ages = drivers.filter(hasPosition).map((driver) => driver.ageSeconds);
    return ages.length === 0 ? null : Math.max(...ages);
  }, [drivers]);

  const needle = filter.trim().toLowerCase();
  const visible = useMemo(() => {
    if (needle === '') {
      return drivers;
    }
    return drivers.filter((driver) =>
      [driver.displayName, driver.driverId, driver.phone, driver.status]
        .join(' ')
        .toLowerCase()
        .includes(needle),
    );
  }, [drivers, needle]);

  const firstLoad = query.isPending;
  const hardError = query.isError && data === undefined;
  const softError = query.isError && data !== undefined;

  return (
    <div className="space-y-4">
      <Alert tone="info" title="Раздел ничего не меняет">
        У <Endpoint>GET /api/v1/dispatch/drivers</Endpoint> и <Endpoint>GET /api/v1/dispatch/nearest</Endpoint>{' '}
        нет изменяющих операций: назначение машины вручную живёт на странице поездок. Поэтому кнопок
        изменения здесь нет ни у ADMIN, ни у SUPPORT
        {canWrite ? ' (у вас роль ADMIN — менять в этом разделе всё равно нечего)' : ''}. Вы вошли как{' '}
        {roleLabel(role)}.
      </Alert>

      {firstLoad ? (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <SkeletonRows count={1} />
          <SkeletonRows count={1} />
          <SkeletonRows count={1} />
          <SkeletonRows count={1} />
        </div>
      ) : null}

      {hardError ? (
        <RequestError
          label="Не удалось получить список водителей на линии"
          error={query.error}
          onRetry={() => void query.refetch()}
        />
      ) : null}

      {data ? (
        <>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <KpiCard
              label="На линии"
              value={String(data.onDuty)}
              hint={
                withPosition === data.withPosition
                  ? `в списке ${drivers.length} · с позицией ${data.withPosition}`
                  : `в списке ${drivers.length} · с позицией ${data.withPosition} (координат в списке: ${withPosition})`
              }
            />
            <KpiCard label="Заняты" value={String(busy)} hint={BUSY_STATUSES.join(' / ')} />
            <KpiCard label="Свободны" value={String(drivers.length - busy)} hint="по статусу из ответа" />
            <KpiCard
              label="Самый старый отчёт позиции"
              value={oldestFix === null ? '—' : formatAgeSeconds(oldestFix)}
              hint={
                oldestFix === null
                  ? 'ни у кого нет координат'
                  : `устаревших позиций ${staleCount} · устаревает через ${formatAgeSeconds(data.staleAfterSeconds)}`
              }
            />
          </div>

          <Card>
            <CardHeader
              title="Водители на линии"
              subtitle={
                <>
                  Снимок от {formatDateTime(data.generatedAt)} · позиция считается устаревшей старше{' '}
                  {formatAgeSeconds(data.staleAfterSeconds)}
                </>
              }
              action={
                <Button
                  variant="secondary"
                  size="sm"
                  loading={query.isFetching}
                  onClick={() => void query.refetch()}
                >
                  Обновить
                </Button>
              }
            />
            <CardBody className="space-y-3">
              {softError ? (
                <RequestError
                  label="Обновление не удалось — данные могли устареть"
                  error={query.error}
                  onRetry={() => void query.refetch()}
                />
              ) : null}

              {drivers.length > 0 ? (
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
                    <Badge tone="neutral">{`показано ${visible.length} из ${drivers.length}`}</Badge>
                  </div>

                  {visible.length === 0 ? (
                    <EmptyState
                      title="Никто не подходит под фильтр"
                      description={`По запросу «${filter.trim()}» в загруженном списке водителей ничего нет. Очистите поле, чтобы увидеть всех.`}
                    />
                  ) : (
                    <DriverTable drivers={visible} />
                  )}
                </>
              ) : (
                <EmptyState
                  title="На линии никого нет"
                  description="Сервис вернул пустой список: ни один водитель не вышел на смену. Пока это так, искать ближайших не имеет смысла."
                />
              )}
            </CardBody>
          </Card>
        </>
      ) : null}

      <NearestSearch />

      <Card>
        <CardHeader
          title="Живая карта — на отдельной странице"
          subtitle="Вторая карта внутри админки отвечала бы на тот же вопрос иначе, чем настоящая диспетчерская."
          action={
            <Link to={DISPATCH_PATH} className={buttonClass({ variant: 'secondary', size: 'sm' })}>
              Открыть /dispatch
            </Link>
          }
        />
        <CardBody>
          <dl>
            <DetailRow label="Карта">Leaflet: маркеры водителей, цвет зависит от свежести позиции</DetailRow>
            <DetailRow label="Обновление">
              опрос <Endpoint>GET /api/v1/dispatch/drivers</Endpoint> каждые 2 секунды
            </DetailRow>
            <DetailRow label="Роли">{`${roleLabel('DISPATCHER')}, ${roleLabel('SUPPORT')}, ${roleLabel('ADMIN')}`}</DetailRow>
          </dl>
        </CardBody>
      </Card>
    </div>
  );
}
