import { useCallback, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { formatMoney } from '../api/money';
import type { TripPoint, TripTariff } from '../api/types';
import { PageHeader } from '../components/layout/PageHeader';
import { RoutePicker, type DemoAddress } from '../components/taxi/RoutePicker';
import { TariffPicker } from '../components/taxi/TariffPicker';
import { TaxiMap, type TaxiPointKind } from '../components/taxi/TaxiMap';
import { TripHistory } from '../components/taxi/TripHistory';
import { TripStatusCard } from '../components/taxi/TripStatusCard';
import { Alert, ErrorAlert } from '../components/ui/Alerts';
import { Badge } from '../components/ui/Badge';
import { Button, buttonClass } from '../components/ui/Button';
import { Card, CardBody, CardHeader } from '../components/ui/Card';
import { TextAreaField } from '../components/ui/Field';
import { useDebouncedValue } from '../hooks/useDebouncedValue';
import { useCreateTrip, useTrip, useTripQuotes, useTrips } from '../hooks/useTrips';
import { CITY_TIME_LABEL } from '../lib/cityTime';
import { transferSignature, useIdempotencyKey } from '../lib/idempotency';
import { TRIP_ACTIVE_STATUSES } from '../lib/trips';

/**
 * `/taxi` — order a ride.
 *
 * Three blocks on one screen, in the order a rider uses them: the map with point А
 * and point Б, the two tariff cards fed by real quotes, and the live state of the
 * ride (plus the history) below them.
 *
 * Two honest constraints shape the screen:
 *
 *  - рейсы котируются по одному тарифу за вызов, so two prices mean two quotes;
 *  - the contract has no ETA and the driver's position is not sent, so the screen
 *    explains the stage instead of counting down minutes it does not have.
 */

const HISTORY_LIMIT = 5;

interface Coordinates {
  lat: number;
  lon: number;
}

function pointOf(coordinates: Coordinates | null, address: string): TripPoint | null {
  if (!coordinates || !Number.isFinite(coordinates.lat) || !Number.isFinite(coordinates.lon)) {
    return null;
  }
  return { lat: coordinates.lat, lon: coordinates.lon, address: address.trim() };
}

export function TaxiPage() {
  const navigate = useNavigate();

  const [pickupCoordinates, setPickupCoordinates] = useState<Coordinates | null>(null);
  const [pickupAddress, setPickupAddress] = useState('');
  const [dropoffCoordinates, setDropoffCoordinates] = useState<Coordinates | null>(null);
  const [dropoffAddress, setDropoffAddress] = useState('');
  const [active, setActive] = useState<TaxiPointKind>('pickup');

  const [tariff, setTariff] = useState<TripTariff>('ECONOMY');
  const [comment, setComment] = useState('');
  const [formError, setFormError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [noticeTone, setNoticeTone] = useState<'info' | 'warning'>('info');
  const [locationPending, setLocationPending] = useState(false);

  // Memoised on the coordinates and the address text: a point object keeps its
  // identity between renders, which is what lets the debounce below settle.
  const pickup = useMemo(
    () => pointOf(pickupCoordinates, pickupAddress),
    [pickupCoordinates, pickupAddress],
  );
  const dropoff = useMemo(
    () => pointOf(dropoffCoordinates, dropoffAddress),
    [dropoffCoordinates, dropoffAddress],
  );

  // The quote follows the *points*, with a debounce so a burst of map clicks (or a
  // fast address typist) produces one priced request instead of a dozen.
  const debouncedPickup = useDebouncedValue(pickup, 400);
  const debouncedDropoff = useDebouncedValue(dropoff, 400);
  const quotes = useTripQuotes(debouncedPickup, debouncedDropoff);
  const selectedQuote = tariff === 'ECONOMY' ? quotes.economy.data : quotes.comfort.data;

  const createTrip = useCreateTrip();
  const history = useTrips({ page: 0, size: HISTORY_LIMIT });
  const trips = useMemo(() => history.data?.items ?? [], [history.data]);
  const activeTrip = useMemo(
    () => trips.find((trip) => TRIP_ACTIVE_STATUSES.includes(trip.status)) ?? null,
    [trips],
  );
  // The banner is its own query so it keeps polling at 2 s even when the list is
  // served from cache.
  const liveTrip = useTrip(activeTrip?.tripId, { poll: true });

  const signature = transferSignature({
    quoteId: selectedQuote?.quoteId ?? '',
    comment: comment.trim(),
  });
  const idempotency = useIdempotencyKey(signature);

  const handlePick = useCallback((coordinates: Coordinates) => {
    if (active === 'pickup') {
      setPickupCoordinates(coordinates);
      // The address described the previous point; keeping it would be a lie.
      setPickupAddress('');
    } else {
      setDropoffCoordinates(coordinates);
      setDropoffAddress('');
    }
    setNotice('Точка поставлена по клику на карте — подпишите адрес вручную, геокодера пока нет.');
    setNoticeTone('info');
    setFormError(null);
  }, [active]);

  const handleDemoPick = (kind: TaxiPointKind, demo: DemoAddress) => {
    if (kind === 'pickup') {
      setPickupCoordinates({ lat: demo.lat, lon: demo.lon });
      setPickupAddress(demo.address);
    } else {
      setDropoffCoordinates({ lat: demo.lat, lon: demo.lon });
      setDropoffAddress(demo.address);
    }
    setActive(kind === 'pickup' ? 'dropoff' : 'pickup');
    setNotice(null);
    setFormError(null);
  };

  const handleUseMyLocation = (kind: TaxiPointKind) => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      setNotice('Браузер не умеет отдавать координаты — поставьте точку на карте.');
      setNoticeTone('warning');
      return;
    }
    setLocationPending(true);
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setLocationPending(false);
        const coordinates = { lat: position.coords.latitude, lon: position.coords.longitude };
        if (kind === 'pickup') {
          setPickupCoordinates(coordinates);
          setPickupAddress('');
        } else {
          setDropoffCoordinates(coordinates);
          setDropoffAddress('');
        }
        setNotice('Координаты пришли от браузера — подпишите адрес вручную.');
        setNoticeTone('info');
      },
      (failure) => {
        setLocationPending(false);
        setNotice(`Браузер не дал координаты: ${failure.message}. Поставьте точку на карте.`);
        setNoticeTone('warning');
      },
      { enableHighAccuracy: true, timeout: 10_000 },
    );
  };

  const submit = () => {
    if (!pickup || !dropoff) {
      setFormError('Поставьте обе точки на карте: без них сервис не посчитает маршрут.');
      return;
    }
    if (!selectedQuote) {
      setFormError('Котировка ещё не получена — дождитесь цены или обновите расчёт.');
      return;
    }
    setFormError(null);
    createTrip.mutate(
      {
        body: {
          quoteId: selectedQuote.quoteId,
          ...(comment.trim() === '' ? {} : { comment: comment.trim() }),
        },
        idempotencyKey: idempotency.acquire(),
      },
      {
        onSuccess: (accepted) => navigate(`/taxi/${encodeURIComponent(accepted.tripId)}`),
      },
    );
  };

  const canOrder = pickup !== null && dropoff !== null && selectedQuote !== undefined;
  const orderHint = !canOrder
    ? 'Кнопка станет активной, когда обе точки заданы и сервис вернёт котировку.'
    : null;

  return (
    <>
      <PageHeader
        title="Такси"
        subtitle="Заказ поездки по Шымкенту: точки А и Б, тариф из котировки, живой статус"
        actions={
          <>
            <Badge tone="warning">Ф2 · trip-service</Badge>
            <Link to="/services" className={buttonClass({ variant: 'secondary', size: 'sm' })}>
              Услуги рядом
            </Link>
          </>
        }
      />

      {liveTrip.data ? (
        <div className="mb-4">
          <TripStatusCard
            trip={liveTrip.data}
            variant="compact"
            action={
              <Link
                to={`/taxi/${encodeURIComponent(liveTrip.data.tripId)}`}
                className={buttonClass({ variant: 'secondary', size: 'sm' })}
              >
                Открыть поездку
              </Link>
            }
          />
        </div>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_26rem]">
        <Card className="overflow-hidden">
          <CardHeader
            title="Карта маршрута"
            subtitle="Клик по карте ставит активную точку · линия между точками прямая, дорожный маршрут сервис пока не считает"
          />
          {/* No `CardBody`: the map must touch the card edges. */}
          <TaxiMap
            pickup={pickupCoordinates}
            dropoff={dropoffCoordinates}
            active={active}
            onPick={handlePick}
          />
        </Card>

        <div className="space-y-4">
          <RoutePicker
            active={active}
            onActiveChange={setActive}
            pickup={{ coordinates: pickupCoordinates, address: pickupAddress }}
            dropoff={{ coordinates: dropoffCoordinates, address: dropoffAddress }}
            onAddressChange={(kind, value) => {
              if (kind === 'pickup') {
                setPickupAddress(value);
              } else {
                setDropoffAddress(value);
              }
            }}
            onDemoPick={handleDemoPick}
            onUseMyLocation={handleUseMyLocation}
            locationPending={locationPending}
            notice={notice}
            noticeTone={noticeTone}
          />

          <Card>
            <CardHeader
              title="Заказ"
              subtitle={pickup && dropoff ? 'Обе точки заданы' : 'Нужны обе точки маршрута'}
            />
            <CardBody className="space-y-3">
              <TariffPicker quotes={quotes} selected={tariff} onSelect={setTariff} />

              {quotes.isError ? (
                <ErrorAlert
                  error={quotes.error}
                  title="Не удалось получить котировку"
                  onRetry={quotes.refetch}
                />
              ) : null}

              <TextAreaField
                id="taxi-comment"
                label="Комментарий водителю"
                value={comment}
                hint="Необязательно"
                placeholder="Например: подождите у второго подъезда"
                onChange={(event) => setComment(event.target.value)}
              />

              {formError ? (
                <Alert tone="warning" title="Заказ пока нельзя отправить">
                  {formError}
                </Alert>
              ) : null}

              {createTrip.isError ? (
                <ErrorAlert
                  error={createTrip.error}
                  title="Не удалось создать поездку"
                  onRetry={submit}
                  retryLabel="Повторить отправку"
                />
              ) : null}

              <Button
                size="lg"
                block
                loading={createTrip.isPending}
                // Blocked until the order can actually be placed — the same condition
                // the hint below spells out, so the button and the wording agree.
                disabled={createTrip.isPending || !canOrder}
                onClick={submit}
              >
                {selectedQuote
                  ? `Заказать поездку · ${formatMoney(selectedQuote.priceMinor, selectedQuote.currency)}`
                  : 'Заказать поездку'}
              </Button>

              <p className="text-xs text-ink-500">
                Заявка уходит один раз: кнопка блокируется на время запроса, а повторная отправка
                того же расчёта идёт с тем же ключом идемпотентности. Время — {CITY_TIME_LABEL}.
              </p>
              <p className="text-xs text-ink-500">
                Оплата — со счёта ORTA в тенге: отдельного поля «способ оплаты» в контракте поездки
                пока нет, а холд ставит сервис при назначении водителя.
              </p>
              {orderHint ? <p className="text-xs text-ink-500">{orderHint}</p> : null}
            </CardBody>
          </Card>
        </div>
      </div>

      <div className="mt-4">
        <TripHistory
          trips={trips}
          isPending={history.isPending}
          isError={history.isError}
          error={history.error}
          onRetry={() => void history.refetch()}
          limit={HISTORY_LIMIT}
        />
      </div>
    </>
  );
}
