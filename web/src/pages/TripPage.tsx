import { Link, useParams } from 'react-router-dom';
import { isApiError } from '../api/errors';
import { PageHeader } from '../components/layout/PageHeader';
import { CancelTripForm, RatingForm } from '../components/taxi/TripActions';
import { TaxiMap } from '../components/taxi/TaxiMap';
import { TripReceiptBlock } from '../components/taxi/TripReceiptBlock';
import { TripStatusCard } from '../components/taxi/TripStatusCard';
import { Alert, ErrorAlert } from '../components/ui/Alerts';
import { buttonClass } from '../components/ui/Button';
import { Card, CardHeader } from '../components/ui/Card';
import { EmptyState } from '../components/ui/EmptyState';
import { PageLoader } from '../components/ui/Spinner';
import { useTrip } from '../hooks/useTrips';
import { TRIP_ACTIVE_STATUSES, TRIP_CANCELLABLE_STATUSES } from '../lib/trips';

/** The route is drawn only from points the service actually sent. */
function hasPoint(point: { lat: number; lon: number } | null): boolean {
  return point !== null && Number.isFinite(point.lat) && Number.isFinite(point.lon);
}

/**
 * `/taxi/:tripId` — one ride in detail.
 *
 * The trip is polled every two seconds while it is still moving (`useTrip`), so the
 * status, the driver block and the timeline update without a reload. Actions are
 * shown only where the contract allows them: cancel needs a reason, rating is a
 * one-shot decision the service answers `409` to on a second attempt.
 */
export function TripPage() {
  const { tripId } = useParams<{ tripId: string }>();
  const query = useTrip(tripId);

  if (query.isPending) {
    return (
      <>
        <PageHeader title="Поездка" backTo="/taxi" backLabel="К такси" />
        <PageLoader label="Загружаем поездку…" />
      </>
    );
  }

  if (query.isError || !query.data) {
    const notFound = isApiError(query.error) && query.error.isNotFound;
    return (
      <>
        <PageHeader title="Поездка" backTo="/taxi" backLabel="К такси" />
        {notFound ? (
          <EmptyState
            title="Поездка не найдена"
            description="Проверьте ссылку или откройте историю поездок."
            action={
              <Link to="/taxi" className={buttonClass()}>
                К заказу такси
              </Link>
            }
          />
        ) : (
          <ErrorAlert
            error={query.error}
            title="Не удалось загрузить поездку"
            onRetry={() => void query.refetch()}
          />
        )}
      </>
    );
  }

  const trip = query.data;
  const cancellable = TRIP_CANCELLABLE_STATUSES.includes(trip.status);
  const inProgress = trip.status === 'IN_PROGRESS';
  const live = TRIP_ACTIVE_STATUSES.includes(trip.status);

  return (
    <>
      <PageHeader
        title={`Поездка № ${trip.tripNumber}`}
        subtitle="Статус, водитель, чек и история переходов"
        backTo="/taxi"
        backLabel="К такси"
        actions={
          live ? (
            <span className="text-xs text-ink-500">Статус обновляется каждые 2 секунды</span>
          ) : null
        }
      />

      <div className="space-y-4">
        {trip.status === 'NO_DRIVERS_FOUND' ? (
          <div className="rounded-card border border-ink-200 bg-white p-4">
            <EmptyState
              title="Свободных машин рядом нет"
              description="Заявка закрыта без списания денег. Котировка к этому моменту могла истечь — выберите точки заново и попробуйте снова."
              action={
                <Link to="/taxi" className={buttonClass()}>
                  Попробовать снова
                </Link>
              }
            />
          </div>
        ) : null}

        <TripStatusCard trip={trip} />

        {hasPoint(trip.pickup) && hasPoint(trip.dropoff) ? (
          <Card className="overflow-hidden">
            <CardHeader
              title="Маршрут поездки"
              subtitle="Точка А и точка Б из заявки · позицию машины сервис не присылает, линия между точками прямая"
            />
            <TaxiMap pickup={trip.pickup} dropoff={trip.dropoff} ariaLabel="Маршрут поездки" />
          </Card>
        ) : null}

        {cancellable ? <CancelTripForm tripId={trip.tripId} /> : null}

        {inProgress ? (
          <Alert tone="info" title="Отмена во время поездки из приложения недоступна">
            Пока машина едет, отменить заказ кнопкой нельзя — сервис такой переход не принимает.
            Свяжитесь с поддержкой, если поездку нужно прервать.
          </Alert>
        ) : null}

        {!cancellable && !inProgress && trip.status !== 'COMPLETED' ? (
          <Alert tone="info" title="Отмена больше недоступна">
            Поездка уже завершилась или была отменена — менять её состояние нельзя.
          </Alert>
        ) : null}

        <TripReceiptBlock trip={trip} />

        {trip.status === 'COMPLETED' ? <RatingForm trip={trip} /> : null}

        <p className="text-sm text-ink-500">
          Выплата водителю и комиссия платформы считаются сервисом: приложение только показывает то,
          что пришло в чеке.
        </p>
      </div>
    </>
  );
}
