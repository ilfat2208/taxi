import { Link } from 'react-router-dom';
import { formatMoney } from '../../api/money';
import type { Trip } from '../../api/types';
import { ErrorAlert } from '../ui/Alerts';
import { Badge } from '../ui/Badge';
import { Card, CardBody, CardHeader } from '../ui/Card';
import { EmptyState } from '../ui/EmptyState';
import { SkeletonRows } from '../ui/Skeleton';
import { CITY_TIME_LABEL, cityDateTime } from '../../lib/cityTime';
import { tariffLabel, tripStatusLabel, tripStatusTone } from '../../lib/trips';

/**
 * Short ride history.
 *
 * A row is one trip: number, status, price and when it was requested. Rows link to
 * the trip screen, which is the only place that shows the receipt — the list must
 * stay a list.
 */

export interface TripHistoryProps {
  trips: Trip[];
  isPending: boolean;
  isError: boolean;
  error: unknown;
  onRetry: () => void;
  limit?: number;
}

export function TripHistoryRow({ trip }: { trip: Trip }) {
  return (
    <li>
      <Link
        to={`/taxi/${encodeURIComponent(trip.tripId)}`}
        className="flex items-center gap-3 rounded-xl border border-ink-100 p-3 hover:bg-ink-50"
      >
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium text-ink-900">
            № {trip.tripNumber}
          </span>
          <span className="tnum block text-xs text-ink-500">
            {cityDateTime(trip.requestedAt)} ({CITY_TIME_LABEL}) · {tariffLabel(trip.tariff)}
          </span>
        </span>
        <Badge tone={tripStatusTone(trip.status)}>{tripStatusLabel(trip.status)}</Badge>
        <span className="tnum w-28 shrink-0 text-right text-sm font-medium text-ink-900">
          {trip.priceMinor !== null ? formatMoney(trip.priceMinor, trip.currency) : '—'}
        </span>
      </Link>
    </li>
  );
}

export function TripHistory({ trips, isPending, isError, error, onRetry, limit }: TripHistoryProps) {
  return (
    <Card>
      <CardHeader
        title="Мои поездки"
        subtitle={limit ? `Последние ${limit} поездки` : 'Все поездки, начиная с последней'}
      />
      <CardBody className="space-y-2">
        {isPending ? <SkeletonRows count={3} /> : null}

        {isError ? (
          <ErrorAlert error={error} title="Не удалось загрузить историю поездок" onRetry={onRetry} />
        ) : null}

        {!isPending && !isError && trips.length === 0 ? (
          <EmptyState
            title="Поездок пока нет"
            description="Закажите первую поездку — она появится здесь вместе со статусом и суммой."
          />
        ) : null}

        {trips.length > 0 ? (
          <ul className="space-y-2">
            {trips.map((trip) => (
              <TripHistoryRow key={trip.tripId} trip={trip} />
            ))}
          </ul>
        ) : null}
      </CardBody>
    </Card>
  );
}
