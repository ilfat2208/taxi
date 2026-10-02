import { useEffect, useRef } from 'react';
import * as L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import type { TripPoint } from '../../api/types';

/**
 * Route map for the rider screens.
 *
 * Same imperative approach as the dispatcher console: Leaflet owns the DOM inside
 * the container, React owns the two points, and the markers are reconciled by hand
 * so panning and zooming survive every re-render. The map instance is created once
 * and destroyed in the effect cleanup (`map.remove()`), which unbinds handlers and
 * clears `_leaflet_id` — without it a remount would throw "already initialized".
 *
 * There is no routing engine behind this: the dashed line joins the two chosen
 * points with a straight segment and the caption on the page says so. Drawing a
 * road-shaped curve would be an invention.
 */

/** Shymkent, city centre — the pilot city of ORTA (see `docs/orta.md`). */
export const TAXI_CITY_CENTER: L.LatLngTuple = [42.3155, 69.5867];
const DEFAULT_ZOOM = 13;

const OSM_TILE_URL = 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png';
const OSM_ATTRIBUTION = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>';

const PICKUP_COLOR = '#1f5fa9'; // brand-500: точка А
const DROPOFF_COLOR = '#0f172a'; // ink-900: точка Б, чтобы не путать с А
const ACTIVE_RING = '#f59e0b'; // amber-500: точка, которую поставит следующий клик
const MARKER_SIZE = 30;

export type TaxiPointKind = 'pickup' | 'dropoff';

export interface TaxiMapProps {
  pickup: { lat: number; lon: number } | null;
  dropoff: { lat: number; lon: number } | null;
  /** The point the next map click will place. */
  active?: TaxiPointKind;
  /**
   * Omitted on a read-only map (the ride screen): the points are facts there, not
   * something a click can move, so no handler is bound at all.
   */
  onPick?: (coordinates: { lat: number; lon: number }) => void;
  ariaLabel?: string;
}

function hasCoordinates(
  point: { lat: number; lon: number } | null,
): point is { lat: number; lon: number } {
  return point !== null && Number.isFinite(point.lat) && Number.isFinite(point.lon);
}

/** The letter is one of our two constants, never a server string. */
function pointIcon(letter: string, color: string, active: boolean): L.DivIcon {
  const size = active ? MARKER_SIZE + 4 : MARKER_SIZE;
  const html =
    `<span style="display:flex;align-items:center;justify-content:center;width:100%;height:100%;` +
    `box-sizing:border-box;border-radius:9999px;background:${color};` +
    `border:${active ? 3 : 2}px solid ${active ? ACTIVE_RING : '#ffffff'};color:#ffffff;` +
    `font:600 13px/1 'Inter','Segoe UI',system-ui,sans-serif;` +
    `box-shadow:0 1px 4px rgba(15,23,42,.45)">${letter}</span>`;
  return L.divIcon({
    className: `taxi-point-marker taxi-point-${letter === 'А' ? 'a' : 'b'}`,
    html,
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
  });
}

export function TaxiMap({
  pickup,
  dropoff,
  active = 'pickup',
  onPick,
  ariaLabel = 'Карта маршрута',
}: TaxiMapProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  const layerRef = useRef<L.LayerGroup | null>(null);
  const lineRef = useRef<L.Polyline | null>(null);
  const pickupMarkerRef = useRef<L.Marker | null>(null);
  const dropoffMarkerRef = useRef<L.Marker | null>(null);
  /**
   * The click handler is bound once, so it reads the current callback through a
   * ref instead of being re-registered on every render (which would leak a
   * listener per keystroke in the address field).
   */
  const onPickRef = useRef(onPick);
  onPickRef.current = onPick;

  useEffect(() => {
    const container = containerRef.current;
    if (!container) {
      return;
    }
    const map = L.map(container, {
      center: TAXI_CITY_CENTER,
      zoom: DEFAULT_ZOOM,
      zoomControl: true,
      attributionControl: true,
      worldCopyJump: true,
    });
    L.tileLayer(OSM_TILE_URL, { maxZoom: 19, attribution: OSM_ATTRIBUTION }).addTo(map);
    layerRef.current = L.layerGroup().addTo(map);
    mapRef.current = map;

    if (onPickRef.current) {
      map.on('click', (event: L.LeafletMouseEvent) => {
        const { lat, lng } = event.latlng;
        // jsdom has no layout, so a synthetic click can produce a non-finite point;
        // dropping it is better than putting a pin at NaN.
        if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
          return;
        }
        onPickRef.current?.({ lat, lon: lng });
      });
    }

    const observer = new ResizeObserver(() => map.invalidateSize());
    observer.observe(container);

    return () => {
      observer.disconnect();
      map.remove();
      mapRef.current = null;
      layerRef.current = null;
      lineRef.current = null;
      pickupMarkerRef.current = null;
      dropoffMarkerRef.current = null;
    };
  }, []);

  // Точка А
  useEffect(() => {
    const layer = layerRef.current;
    if (!layer || !hasCoordinates(pickup)) {
      pickupMarkerRef.current?.remove();
      pickupMarkerRef.current = null;
      return;
    }
    const icon = pointIcon('А', PICKUP_COLOR, active === 'pickup');
    if (!pickupMarkerRef.current) {
      pickupMarkerRef.current = L.marker([pickup.lat, pickup.lon], {
        icon,
        title: 'Точка А',
        zIndexOffset: active === 'pickup' ? 1000 : 0,
      }).addTo(layer);
      return;
    }
    pickupMarkerRef.current.setLatLng([pickup.lat, pickup.lon]);
    pickupMarkerRef.current.setIcon(icon);
    pickupMarkerRef.current.setZIndexOffset(active === 'pickup' ? 1000 : 0);
  }, [pickup, active]);

  // Точка Б
  useEffect(() => {
    const layer = layerRef.current;
    if (!layer || !hasCoordinates(dropoff)) {
      dropoffMarkerRef.current?.remove();
      dropoffMarkerRef.current = null;
      return;
    }
    const icon = pointIcon('Б', DROPOFF_COLOR, active === 'dropoff');
    if (!dropoffMarkerRef.current) {
      dropoffMarkerRef.current = L.marker([dropoff.lat, dropoff.lon], {
        icon,
        title: 'Точка Б',
        zIndexOffset: active === 'dropoff' ? 1000 : 0,
      }).addTo(layer);
      return;
    }
    dropoffMarkerRef.current.setLatLng([dropoff.lat, dropoff.lon]);
    dropoffMarkerRef.current.setIcon(icon);
    dropoffMarkerRef.current.setZIndexOffset(active === 'dropoff' ? 1000 : 0);
  }, [dropoff, active]);

  // Прямая линия между точками: маршрут по дорогам сервис пока не считает.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) {
      return;
    }
    if (!hasCoordinates(pickup) || !hasCoordinates(dropoff)) {
      lineRef.current?.remove();
      lineRef.current = null;
      return;
    }
    const latLngs: L.LatLngTuple[] = [
      [pickup.lat, pickup.lon],
      [dropoff.lat, dropoff.lon],
    ];
    if (lineRef.current) {
      lineRef.current.setLatLngs(latLngs);
      return;
    }
    lineRef.current = L.polyline(latLngs, {
      color: PICKUP_COLOR,
      weight: 3,
      dashArray: '8 6',
      opacity: 0.85,
    }).addTo(map);
  }, [pickup, dropoff]);

  return (
    <div
      ref={containerRef}
      role="region"
      aria-label={ariaLabel}
      data-testid="taxi-map"
      className="h-[52vh] min-h-[320px] w-full bg-ink-100"
    />
  );
}

/** Text helper shared by the page and its tests: a point is either placed or not. */
export function describePoint(point: TripPoint | null): string {
  if (!point || !Number.isFinite(point.lat) || !Number.isFinite(point.lon)) {
    return 'не выбрана';
  }
  const coordinates = `${point.lat.toFixed(5)}, ${point.lon.toFixed(5)}`;
  return point.address.trim() === '' ? coordinates : `${point.address.trim()} · ${coordinates}`;
}
