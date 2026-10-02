import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import * as L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import type { DispatchCandidate, DispatchDriver } from '../api/types';
import { useAuth } from '../auth/AuthContext';
import { DISPATCH_ROLES, hasDispatchRole, useEffectiveRoles } from '../auth/dispatchRoles';
import { PageHeader } from '../components/layout/PageHeader';
import { Alert, ErrorAlert } from '../components/ui/Alerts';
import { Badge, StatusBadge } from '../components/ui/Badge';
import { Button, buttonClass } from '../components/ui/Button';
import { Card, CardBody, CardHeader, DetailRow } from '../components/ui/Card';
import { CopyButton } from '../components/ui/CopyButton';
import { EmptyState } from '../components/ui/EmptyState';
import { PageLoader, Spinner } from '../components/ui/Spinner';
import {
  DISPATCH_REFETCH_INTERVAL_MS,
  NEAREST_DEFAULT_LIMIT,
  NEAREST_DEFAULT_RADIUS_M,
  useDispatchDrivers,
  useNearestDrivers,
} from '../hooks/useDispatch';
import {
  formatAgeSeconds,
  formatDateTime,
  formatDistanceMeters,
  roleLabel,
  statusLabel,
} from '../lib/format';

/**
 * Dispatcher console (phase Ф1): the live fleet on a map.
 *
 * Leaflet is driven imperatively through a `ref` — the markers are a projection of
 * the polled payload, and reconciling them by hand (keyed by `driverId`) keeps the
 * map quiet between polls: nothing flickers, and the user's pan/zoom survives a
 * refresh. That is also why the REST payload, not a WebSocket, is the source of
 * truth here: two seconds of latency is acceptable for manual assignment, while a
 * socket would add a second truth to reconcile.
 */

const PAGE_TITLE = 'Диспетчерская';
const PAGE_SUBTITLE = 'Живая карта водителей на линии';

/** Шымкент, центр города — пилотный город ORTA (см. docs/orta.md). */
const CITY_CENTER: L.LatLngTuple = [42.3155, 69.5867];
const DEFAULT_ZOOM = 13;

const OSM_TILE_URL = 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png';
const OSM_ATTRIBUTION = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>';

const FRESH_COLOR = '#1f5fa9'; // brand-500: тот же синий, что в клиенте ORTA
const STALE_COLOR = '#94a3b8'; // ink-400
const CANDIDATE_COLOR = '#0e7c7b'; // TaxiTeal: «ближайшие к выбранному» не путать со свежими (brand blue)
const SELECTED_RING = '#0f172a'; // ink-900
const MARKER_SIZE = 26;
const CANDIDATE_SIZE = 14;

/**
 * The dev identity provider accepts any `+7XXXXXXXXXX` with the code `0000` and
 * mints the requested roles. This is the same affordance the login screen exposes,
 * placed where the console needs it.
 */
const DEV_DISPATCHER_PHONE = '+77001234567';
const DEV_DISPATCHER_CODE = '0000';
const DEV_DISPATCHER_NAME = 'Диспетчер';

function hasPosition(point: { lat: number; lon: number }): boolean {
  return Number.isFinite(point.lat) && Number.isFinite(point.lon);
}

/* ------------------------------------------------------------------- map */

/** Marker body is built from numbers only — no server string reaches `innerHTML`. */
function markerHtml(color: string, ring: string, opacity: number, heading: number): string {
  return (
    `<span style="display:flex;align-items:center;justify-content:center;width:100%;height:100%;` +
    `box-sizing:border-box;border-radius:9999px;background:${color};border:2px solid ${ring};opacity:${opacity};` +
    `box-shadow:0 1px 4px rgba(15,23,42,.45)">` +
    `<svg viewBox="0 0 24 24" width="12" height="12" fill="#ffffff" aria-hidden="true" ` +
    `style="transform:rotate(${Math.round(heading)}deg)"><path d="M12 2 19 21 12 17 5 21Z"/></svg>` +
    `</span>`
  );
}

function driverIcon(driver: DispatchDriver, selected: boolean): L.DivIcon {
  const size = selected ? MARKER_SIZE + 6 : MARKER_SIZE;
  return L.divIcon({
    className: 'taxi-driver-marker',
    html: markerHtml(
      driver.stale ? STALE_COLOR : FRESH_COLOR,
      selected ? SELECTED_RING : '#ffffff',
      driver.stale ? 0.7 : 1,
      driver.stale ? 0 : driver.headingDeg,
    ),
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
  });
}

function candidateIcon(): L.DivIcon {
  return L.divIcon({
    className: 'taxi-candidate-marker',
    html: markerHtml(CANDIDATE_COLOR, '#ffffff', 0.9, 0),
    iconSize: [CANDIDATE_SIZE, CANDIDATE_SIZE],
    iconAnchor: [CANDIDATE_SIZE / 2, CANDIDATE_SIZE / 2],
  });
}

/** Tooltip bodies are DOM nodes: a driver's display name is never parsed as HTML. */
function tooltipNode(lines: string[]): HTMLElement {
  const root = document.createElement('div');
  root.className = 'text-xs';
  for (const line of lines) {
    const row = document.createElement('div');
    row.textContent = line;
    root.appendChild(row);
  }
  return root;
}

interface DriverMapProps {
  drivers: DispatchDriver[];
  candidates: DispatchCandidate[];
  selectedId: string | null;
  onSelect: (driverId: string) => void;
}

/**
 * The map itself: a raster OSM basemap plus one marker per driver.
 *
 * The container is given a real height by `DriverMap` itself (`h-[60vh]`): Leaflet
 * measures its box once, and a zero-height div renders an empty grey square.
 */
function DriverMap({ drivers, candidates, selectedId, onSelect }: DriverMapProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  const driverLayerRef = useRef<L.LayerGroup | null>(null);
  const candidateLayerRef = useRef<L.LayerGroup | null>(null);
  const markersRef = useRef(new Map<string, L.Marker>());
  /** Icon signature per driver: a marker is restyled only when it actually changed. */
  const signaturesRef = useRef(new Map<string, string>());

  useEffect(() => {
    const container = containerRef.current;
    if (!container) {
      return;
    }
    const map = L.map(container, {
      center: CITY_CENTER,
      zoom: DEFAULT_ZOOM,
      zoomControl: true,
      attributionControl: true,
      worldCopyJump: true,
    });
    L.tileLayer(OSM_TILE_URL, { maxZoom: 19, attribution: OSM_ATTRIBUTION }).addTo(map);
    driverLayerRef.current = L.layerGroup().addTo(map);
    candidateLayerRef.current = L.layerGroup().addTo(map);
    mapRef.current = map;

    // The console is one of several panes: keep Leaflet's metrics in sync when the
    // grid column changes size (sidebar collapse, window resize, DevTools docked).
    const observer = new ResizeObserver(() => map.invalidateSize());
    observer.observe(container);

    return () => {
      observer.disconnect();
      // `remove()` unbinds every handler and clears `_leaflet_id`, so a StrictMode
      // remount (or a fast route change) can safely initialise the same div again.
      map.remove();
      mapRef.current = null;
      driverLayerRef.current = null;
      candidateLayerRef.current = null;
      markersRef.current.clear();
      signaturesRef.current.clear();
    };
  }, []);

  useEffect(() => {
    const layer = driverLayerRef.current;
    const map = mapRef.current;
    if (!layer || !map) {
      return;
    }
    const seen = new Set<string>();

    for (const driver of drivers) {
      if (!hasPosition(driver)) {
        continue;
      }
      seen.add(driver.driverId);
      const selected = driver.driverId === selectedId;
      const signature = `${driver.stale}|${selected}|${Math.round(driver.headingDeg / 10)}`;
      const marker = markersRef.current.get(driver.driverId);

      if (!marker) {
        const created = L.marker([driver.lat, driver.lon], {
          icon: driverIcon(driver, selected),
          title: driver.displayName,
          riseOnHover: true,
          zIndexOffset: selected ? 1000 : 0,
        });
        created.bindTooltip(tooltipNode([driver.displayName, statusLabel(driver.status)]));
        created.on('click', () => {
          onSelect(driver.driverId);
          map.panTo([driver.lat, driver.lon]);
        });
        created.addTo(layer);
        markersRef.current.set(driver.driverId, created);
        signaturesRef.current.set(driver.driverId, signature);
        continue;
      }

      marker.setLatLng([driver.lat, driver.lon]);
      if (signaturesRef.current.get(driver.driverId) !== signature) {
        marker.setIcon(driverIcon(driver, selected));
        marker.setZIndexOffset(selected ? 1000 : 0);
        signaturesRef.current.set(driver.driverId, signature);
      }
    }

    // Drivers who went offline must leave the map, not freeze at their last point.
    for (const [driverId, marker] of markersRef.current) {
      if (seen.has(driverId)) {
        continue;
      }
      marker.remove();
      markersRef.current.delete(driverId);
      signaturesRef.current.delete(driverId);
    }
  }, [drivers, selectedId, onSelect]);

  useEffect(() => {
    const layer = candidateLayerRef.current;
    const map = mapRef.current;
    if (!layer || !map) {
      return;
    }
    layer.clearLayers();
    for (const candidate of candidates) {
      // The reference point is the selected driver, already on the map as himself.
      if (!hasPosition(candidate) || candidate.driverId === selectedId) {
        continue;
      }
      const marker = L.marker([candidate.lat, candidate.lon], {
        icon: candidateIcon(),
        zIndexOffset: -100,
      });
      marker.bindTooltip(
        tooltipNode([candidate.displayName, formatDistanceMeters(candidate.distanceM)]),
      );
      marker.on('click', () => {
        onSelect(candidate.driverId);
        map.panTo([candidate.lat, candidate.lon]);
      });
      marker.addTo(layer);
    }
  }, [candidates, selectedId, onSelect]);

  return (
    <div
      ref={containerRef}
      role="region"
      aria-label="Карта водителей"
      data-testid="dispatch-map"
      className="h-[60vh] min-h-[360px] w-full bg-ink-100"
    />
  );
}

/* ---------------------------------------------------------------- legend */

function MapLegend() {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-ink-600">
      <span className="inline-flex items-center gap-2">
        <span className="h-3 w-3 rounded-full bg-brand-500 ring-2 ring-white" />
        Свежая позиция
      </span>
      <span className="inline-flex items-center gap-2">
        <span className="h-3 w-3 rounded-full bg-ink-400 opacity-70 ring-2 ring-white" />
        Устаревшая позиция
      </span>
      <span className="inline-flex items-center gap-2">
        <span className="h-2.5 w-2.5 rounded-full bg-info-500 ring-2 ring-white" />
        Ближайшие к выбранному
      </span>
      <span className="text-ink-400">Обновление каждые {DISPATCH_REFETCH_INTERVAL_MS / 1000} с</span>
    </div>
  );
}

/* ------------------------------------------------------- token dev stand */

/**
 * Dev stand: mint a dispatcher token without leaving the page.
 *
 * It goes through `useAuth().login`, so the session is written by the one piece of
 * code that owns the `taxi.session` contract — no bespoke storage format here.
 */
function DispatcherTokenGate({ reason }: { reason: 'no-session' | 'no-role' }) {
  const { login, roles } = useAuth();
  const [error, setError] = useState<unknown>(null);
  const [pending, setPending] = useState(false);

  const requestDevToken = () => {
    if (pending) {
      return;
    }
    setPending(true);
    setError(null);
    void login({
      phone: DEV_DISPATCHER_PHONE,
      code: DEV_DISPATCHER_CODE,
      displayName: DEV_DISPATCHER_NAME,
      roles: ['DISPATCHER'],
    })
      .catch((cause: unknown) => setError(cause))
      .finally(() => setPending(false));
  };

  return (
    <Card>
      <CardHeader
        title="Доступ к диспетчерской"
        subtitle={`Нужна одна из ролей: ${DISPATCH_ROLES.map(roleLabel).join(', ')}`}
      />
      <CardBody>
        <Alert
          tone="warning"
          title={reason === 'no-session' ? 'Сессия не найдена' : 'В вашем токене нет роли диспетчера'}
        >
          {reason === 'no-session' ? (
            <>Войдите, чтобы открыть карту водителей.</>
          ) : (
            <>
              Ваши роли: {roles.length > 0 ? roles.map(roleLabel).join(', ') : 'нет'}. Карта водителей
              и поиск ближайших доступны диспетчеру, поддержке и администратору.
            </>
          )}
        </Alert>

        <div className="mt-4 flex flex-wrap items-center gap-3">
          <Button size="lg" loading={pending} disabled={pending} onClick={requestDevToken}>
            Получить токен диспетчера
          </Button>
          <Link to="/login" className={buttonClass({ variant: 'secondary' })}>
            Войти другим номером
          </Link>
        </div>

        <p className="mt-3 text-xs text-ink-500">
          POST /api/v1/auth/token · {DEV_DISPATCHER_PHONE} · код {DEV_DISPATCHER_CODE} · роли
          ['DISPATCHER'] — демо-провайдер идентичности, в продакшене его нет.
        </p>

        {error ? (
          <ErrorAlert className="mt-4" error={error} title="Не удалось получить токен диспетчера" />
        ) : null}
      </CardBody>
    </Card>
  );
}

/* -------------------------------------------------------- nearest list */

/** Everything the shortlist panel needs, lifted so the map can draw the same set. */
interface NearestState {
  candidates: DispatchCandidate[];
  radiusM: number;
  isPending: boolean;
  isError: boolean;
  error: unknown;
  onRetry: () => void;
}

function NearestDrivers({ state, selectedId }: { state: NearestState; selectedId: string }) {
  const { candidates, radiusM, isPending, isError, error, onRetry } = state;

  return (
    <div className="mt-4 border-t border-ink-100 pt-3">
      <p className="text-sm font-medium text-ink-800">Ближайшие водители</p>
      <p className="mt-0.5 text-xs text-ink-500">
        Радиус {formatDistanceMeters(radiusM)} · до {NEAREST_DEFAULT_LIMIT} записей, первая — сам
        водитель
      </p>

      {isPending ? (
        <div className="flex items-center gap-2 py-3 text-sm text-ink-500">
          <Spinner className="h-4 w-4" />
          Ищем ближайших…
        </div>
      ) : null}

      {isError ? (
        <ErrorAlert
          className="mt-3"
          error={error}
          title="Не удалось получить ближайших водителей"
          onRetry={onRetry}
        />
      ) : null}

      {!isPending && !isError && candidates.length === 0 ? (
        <p className="py-3 text-sm text-ink-500">Никого рядом нет — попробуйте увеличить радиус.</p>
      ) : null}

      {candidates.length > 0 ? (
        <ul className="mt-2 divide-y divide-ink-100">
          {candidates.map((candidate) => (
            <li key={candidate.driverId} className="flex items-center gap-3 py-2">
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-2">
                  <span className="truncate text-sm text-ink-800">{candidate.displayName}</span>
                  {candidate.driverId === selectedId ? <Badge tone="brand">выбранный</Badge> : null}
                </span>
                <span className="tnum block text-xs text-ink-500">
                  {formatDistanceMeters(candidate.distanceM)} · позиция{' '}
                  {formatAgeSeconds(candidate.ageSeconds)} назад
                </span>
              </span>
              <span className="tnum shrink-0 text-right text-xs text-ink-500">
                {candidate.lat.toFixed(4)}, {candidate.lon.toFixed(4)}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------------ selection */

function SelectedDriverCard({
  driver,
  staleAfterSeconds,
  nearest,
  onClear,
}: {
  driver: DispatchDriver;
  staleAfterSeconds: number;
  nearest: NearestState;
  onClear: () => void;
}) {
  return (
    <Card>
      <CardHeader
        title={driver.displayName}
        subtitle={<span className="font-mono text-xs">{driver.driverId}</span>}
        action={<StatusBadge status={driver.status} />}
      />
      <CardBody>
        <dl>
          <DetailRow label="Телефон">
            {driver.phone ? (
              <span className="inline-flex items-center gap-1">
                <a className="hover:text-brand-600" href={`tel:${driver.phone}`}>
                  {driver.phone}
                </a>
                <CopyButton value={driver.phone} />
              </span>
            ) : (
              '—'
            )}
          </DetailRow>
          <DetailRow label="Статус">{statusLabel(driver.status)}</DetailRow>
          <DetailRow label="Скорость">{`${Math.round(driver.speedKph)} км/ч`}</DetailRow>
          <DetailRow label="Курс">{`${Math.round(driver.headingDeg)}°`}</DetailRow>
          <DetailRow label="Возраст позиции">{`${formatAgeSeconds(driver.ageSeconds)} назад`}</DetailRow>
          <DetailRow label="Координаты">
            <span className="tnum">
              {driver.lat.toFixed(5)}, {driver.lon.toFixed(5)}
            </span>
          </DetailRow>
        </dl>

        {driver.stale ? (
          <Alert className="mt-3" tone="warning" title="Позиция устарела">
            Последняя координата старше {formatAgeSeconds(staleAfterSeconds)} — водитель мог уехать
            или потерять связь. Перед назначением уточните по телефону.
          </Alert>
        ) : null}

        <NearestDrivers state={nearest} selectedId={driver.driverId} />

        <div className="mt-3">
          <Button variant="ghost" size="sm" onClick={onClear}>
            Снять выделение
          </Button>
        </div>
      </CardBody>
    </Card>
  );
}

/* ------------------------------------------------------------- the board */

function DispatchBoard() {
  const driversQuery = useDispatchDrivers();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectionNotice, setSelectionNotice] = useState<string | null>(null);

  const data = driversQuery.data ?? null;
  const drivers = useMemo(() => data?.drivers ?? [], [data]);
  const staleCount = useMemo(() => drivers.filter((driver) => driver.stale).length, [drivers]);
  const mappedCount = useMemo(() => drivers.filter(hasPosition).length, [drivers]);

  const selectedDriver = useMemo(
    () => drivers.find((driver) => driver.driverId === selectedId) ?? null,
    [drivers, selectedId],
  );

  // One query for the shortlist: the detail card lists it and the map draws it.
  const nearest = useNearestDrivers(selectedDriver, { radiusM: NEAREST_DEFAULT_RADIUS_M });
  const nearestState: NearestState = {
    candidates: nearest.data?.candidates ?? [],
    radiusM: nearest.data?.radiusM ?? NEAREST_DEFAULT_RADIUS_M,
    isPending: nearest.isPending,
    isError: nearest.isError,
    error: nearest.error,
    onRetry: () => void nearest.refetch(),
  };

  const handleSelect = useCallback((driverId: string) => {
    setSelectedId(driverId);
    setSelectionNotice(null);
  }, []);

  // A driver leaving the fleet must not leave a stale panel behind.
  useEffect(() => {
    if (selectedId !== null && driversQuery.isSuccess && selectedDriver === null) {
      setSelectedId(null);
      setSelectionNotice('Водитель больше не на линии — выделение снято.');
    }
  }, [selectedId, driversQuery.isSuccess, selectedDriver]);

  const firstLoad = driversQuery.isPending;
  const hardError = driversQuery.isError && data === null;
  const softError = driversQuery.isError && data !== null;

  return (
    <>
      <PageHeader
        title={PAGE_TITLE}
        subtitle={PAGE_SUBTITLE}
        actions={
          <>
            <Badge tone={softError ? 'warning' : 'success'}>
              {softError ? 'нет связи с сервисом' : `онлайн-опрос ${DISPATCH_REFETCH_INTERVAL_MS / 1000} с`}
            </Badge>
            <Button
              variant="secondary"
              size="sm"
              loading={driversQuery.isFetching}
              onClick={() => void driversQuery.refetch()}
            >
              Обновить
            </Button>
          </>
        }
      />

      {data ? (
        <div className="mb-4 grid gap-2 sm:grid-cols-3">
          <Card className="px-4 py-3">
            <p className="text-xs text-ink-500">На линии</p>
            <p className="tnum text-xl font-semibold text-ink-900">{data.onDuty}</p>
          </Card>
          <Card className="px-4 py-3">
            <p className="text-xs text-ink-500">С позицией</p>
            <p className="tnum text-xl font-semibold text-ink-900">{data.withPosition}</p>
          </Card>
          <Card className="px-4 py-3">
            <p className="text-xs text-ink-500">Устаревших позиций</p>
            <p className="tnum text-xl font-semibold text-ink-900">{staleCount}</p>
          </Card>
        </div>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <Card className="overflow-hidden">
          <CardHeader
            title="Карта водителей"
            subtitle={
              data
                ? `Данные на ${formatDateTime(data.generatedAt)} · устаревшими считаются позиции старше ${formatAgeSeconds(data.staleAfterSeconds)}`
                : 'Ожидаем первый ответ сервиса'
            }
            action={driversQuery.isFetching ? <Spinner className="h-4 w-4" /> : null}
          />
          {/* No `CardBody` here: the map must touch the card edges, and `p-4`/`p-0`
              would fight over one element. */}
          {firstLoad ? <PageLoader label="Загружаем водителей…" /> : null}

          {hardError ? (
            <div className="p-4">
              <ErrorAlert
                error={driversQuery.error}
                title="Не удалось загрузить карту водителей"
                onRetry={() => void driversQuery.refetch()}
              />
            </div>
          ) : null}

          {!firstLoad && !hardError ? (
            <>
              <DriverMap
                drivers={drivers}
                candidates={nearestState.candidates}
                selectedId={selectedId}
                onSelect={handleSelect}
              />
              <div className="border-t border-ink-100 p-3">
                <MapLegend />
              </div>
            </>
          ) : null}
        </Card>

        <div className="space-y-4">
          {softError ? (
            <ErrorAlert
              error={driversQuery.error}
              title="Обновление не удалось — данные могли устареть"
              onRetry={() => void driversQuery.refetch()}
            />
          ) : null}

          {selectionNotice ? (
            <Alert tone="info" title="Выделение снято">
              {selectionNotice}
            </Alert>
          ) : null}

          {selectedDriver ? (
            <SelectedDriverCard
              driver={selectedDriver}
              staleAfterSeconds={data?.staleAfterSeconds ?? 30}
              nearest={nearestState}
              onClear={() => setSelectedId(null)}
            />
          ) : null}

          {!selectedDriver && data && drivers.length === 0 ? (
            <EmptyState
              title="Нет водителей на линии"
              description="Как только водитель выйдет на линию, его позиция появится здесь — карта обновляется каждые 2 секунды."
            />
          ) : null}

          {!selectedDriver && drivers.length > 0 ? (
            <EmptyState
              title="Выберите водителя"
              description="Клик по маркеру на карте откроет карточку: телефон, статус, скорость и ближайшие машины."
            />
          ) : null}

          {data && drivers.length > 0 && mappedCount < drivers.length ? (
            <Alert tone="info" title="Часть водителей без координат">
              На линии {drivers.length}, на карте {mappedCount}: у остальных ещё нет ни одной
              геопозиции.
            </Alert>
          ) : null}
        </div>
      </div>
    </>
  );
}

/**
 * `/dispatch` — reachable by any signed-in user; the *content* is gated by role.
 *
 * The route guard deliberately stays role-agnostic: on this dev stand a customer
 * must be able to reach the screen that mints (and explains) a dispatcher token,
 * otherwise the role is impossible to obtain. The server still enforces the same
 * role list on `/dispatch/**`, so hiding the page is UX, not security.
 */
export function DispatchPage() {
  const { session } = useAuth();
  const roles = useEffectiveRoles();

  if (!session || !hasDispatchRole(roles)) {
    return (
      <>
        <PageHeader title={PAGE_TITLE} subtitle={PAGE_SUBTITLE} />
        <DispatcherTokenGate reason={session ? 'no-role' : 'no-session'} />
      </>
    );
  }

  return <DispatchBoard />;
}
