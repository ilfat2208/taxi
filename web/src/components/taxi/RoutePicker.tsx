import { Button } from '../ui/Button';
import { Card, CardBody, CardHeader } from '../ui/Card';
import { TextField } from '../ui/Field';
import { Alert } from '../ui/Alerts';
import { cx } from '../../lib/cx';
import { describePoint, type TaxiPointKind } from './TaxiMap';

/**
 * Point А / point Б selection.
 *
 * Addresses are typed by hand: ORTA has no geocoder yet, so a click on the map
 * yields coordinates only and the field stays empty until the rider writes the
 * street. The demo addresses below are hard-coded Shymkent landmarks — they are
 * labelled as demo data so nobody mistakes them for a search result.
 */

export interface DemoAddress {
  /** What the button says. */
  label: string;
  /** What lands in the address field. */
  address: string;
  lat: number;
  lon: number;
}

/**
 * Three pinned points of the pilot city: the central square, a street in the
 * centre and the airport. The coordinates come from the quote example in the API
 * contract (`42.3155, 69.5867`) and from the public city landmarks; the wording
 * next to the buttons says they are demo values, not a geocoder answer.
 */
export const SHYMKENT_DEMO_POINTS: DemoAddress[] = [
  { label: 'пр. Тауке хана, 60', address: 'пр. Тауке хана, 60', lat: 42.3155, lon: 69.5867 },
  { label: 'пр. Республики, 12', address: 'пр. Республики, 12', lat: 42.3, lon: 69.6 },
  { label: 'Аэропорт Шымкент', address: 'Аэропорт Шымкент', lat: 42.3642, lon: 69.4789 },
];

const NO_GEOCODER_HINT = 'Адрес подписывается вручную — геокодер появится позже';

export interface RoutePointFields {
  /** Coordinates of the point; `null` until the rider places it. */
  coordinates: { lat: number; lon: number } | null;
  /** Text of the address field — editable even before a point exists. */
  address: string;
}

export interface RoutePickerProps {
  active: TaxiPointKind;
  onActiveChange: (kind: TaxiPointKind) => void;
  pickup: RoutePointFields;
  dropoff: RoutePointFields;
  onAddressChange: (kind: TaxiPointKind, address: string) => void;
  onDemoPick: (kind: TaxiPointKind, demo: DemoAddress) => void;
  onUseMyLocation: (kind: TaxiPointKind) => void;
  locationPending: boolean;
  /** Honest line about the last action (point moved, geolocation refused…). */
  notice: string | null;
  noticeTone: 'info' | 'warning';
}

function coordinatesLine(fields: RoutePointFields): string {
  return describePoint(
    fields.coordinates ? { ...fields.coordinates, address: fields.address } : null,
  );
}

export function RoutePicker({
  active,
  onActiveChange,
  pickup,
  dropoff,
  onAddressChange,
  onDemoPick,
  onUseMyLocation,
  locationPending,
  notice,
  noticeTone,
}: RoutePickerProps) {
  const activeLabel = active === 'pickup' ? 'А' : 'Б';

  return (
    <Card>
      <CardHeader
        title="Маршрут"
        subtitle={`Клик по карте ставит точку ${activeLabel}`}
        action={
          <div className="flex gap-1" role="group" aria-label="Какая точка ставится кликом">
            {(['pickup', 'dropoff'] as TaxiPointKind[]).map((kind) => (
              <button
                key={kind}
                type="button"
                aria-pressed={active === kind}
                onClick={() => onActiveChange(kind)}
                className={cx(
                  'rounded-full px-3 py-1 text-xs font-medium ring-1 ring-inset transition-colors',
                  active === kind
                    ? 'bg-brand-500 text-white ring-brand-500'
                    : 'bg-white text-ink-600 ring-ink-200 hover:bg-ink-100',
                )}
              >
                Точка {kind === 'pickup' ? 'А' : 'Б'}
              </button>
            ))}
          </div>
        }
      />
      <CardBody className="space-y-4">
        <div>
          <TextField
            id="taxi-pickup-address"
            label="Адрес точки А"
            value={pickup.address}
            placeholder="Например: пр. Тауке хана, 60"
            hint={NO_GEOCODER_HINT}
            onChange={(event) => onAddressChange('pickup', event.target.value)}
          />
          <p className="tnum mt-1 text-xs text-ink-500">Координаты: {coordinatesLine(pickup)}</p>
        </div>

        <div>
          <TextField
            id="taxi-dropoff-address"
            label="Адрес точки Б"
            value={dropoff.address}
            placeholder="Например: пр. Республики, 12"
            hint={NO_GEOCODER_HINT}
            onChange={(event) => onAddressChange('dropoff', event.target.value)}
          />
          <p className="tnum mt-1 text-xs text-ink-500">Координаты: {coordinatesLine(dropoff)}</p>
        </div>

        {notice ? (
          <Alert tone={noticeTone} title={noticeTone === 'warning' ? 'Нужно уточнение' : undefined}>
            {notice}
          </Alert>
        ) : null}

        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="secondary"
            size="sm"
            loading={locationPending}
            onClick={() => onUseMyLocation(active)}
          >
            Моё местоположение
          </Button>
          <span className="text-xs text-ink-500">
            Заполнит точку {activeLabel} координатами браузера, если он их даст.
          </span>
        </div>

        <div>
          <p className="text-xs font-medium text-ink-700">Демо-адреса Шымкента (точка {activeLabel})</p>
          <div className="mt-1.5 flex flex-wrap gap-2">
            {SHYMKENT_DEMO_POINTS.map((demo) => (
              <button
                key={demo.label}
                type="button"
                onClick={() => onDemoPick(active, demo)}
                className="rounded-full bg-ink-100 px-3 py-1.5 text-xs font-medium text-ink-700 hover:bg-ink-200"
              >
                {demo.label}
              </button>
            ))}
          </div>
          <p className="mt-1.5 text-xs text-ink-500">
            Координаты этих трёх точек зашиты в клиент для демонстрации: геокодера и поиска адресов в
            сервисе пока нет.
          </p>
        </div>
      </CardBody>
    </Card>
  );
}
