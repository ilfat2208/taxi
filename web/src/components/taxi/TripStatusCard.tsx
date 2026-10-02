import type { ReactNode } from 'react';
import { formatMoney } from '../../api/money';
import type { Trip } from '../../api/types';
import { Alert } from '../ui/Alerts';
import { Badge, StatusBadge } from '../ui/Badge';
import { Card, CardBody, CardHeader, DetailRow } from '../ui/Card';
import { CopyButton } from '../ui/CopyButton';
import { Timeline, type TimelineEntry } from '../ui/Timeline';
import { CITY_TIME_LABEL, cityDateTime, cityTime } from '../../lib/cityTime';
import { formatAgeSeconds, formatDistanceMeters, shortId } from '../../lib/format';
import { actorLabel, commissionBpLabel, tariffLabel, tripStageHint, tripStatusLabel } from '../../lib/trips';

/**
 * Live state of one ride: status, stage, driver, money and the transition history.
 *
 * Everything here is either in the contract or absent. No arrival countdown (the
 * trip view carries no ETA), no driver rating (not in the payload), no phone
 * button (the number is not sent) — each missing piece is either omitted or
 * explained in words, never filled with a plausible-looking default.
 */

function timelineEntries(trip: Trip): TimelineEntry[] {
  return trip.timeline.map((entry, index) => {
    const actor = actorLabel(entry.actor);
    return {
      key: `${entry.status}-${entry.at}-${index}`,
      status: entry.status,
      time: entry.at,
      note: actor ? `Кто: ${actor}` : null,
    };
  });
}

function statusTime(trip: Trip): string | null {
  switch (trip.status) {
    case 'COMPLETED':
      return trip.completedAt;
    case 'CANCELLED_BY_RIDER':
    case 'CANCELLED_BY_DRIVER':
      return trip.cancelledAt;
    case 'IN_PROGRESS':
      return trip.startedAt;
    case 'ARRIVED':
      return trip.arrivedAt;
    case 'ASSIGNED':
      return trip.assignedAt;
    default:
      return trip.requestedAt;
  }
}

function DriverCardBlock({ trip }: { trip: Trip }) {
  if (!trip.driverName && !trip.vehiclePlate) {
    return null;
  }
  return (
    <div className="rounded-card border border-ink-200 bg-ink-50 p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-ink-900">
            {trip.driverName ?? 'Водитель назначен'}
          </p>
          {trip.vehiclePlate ? (
            <p className="tnum text-sm text-ink-700">{trip.vehiclePlate}</p>
          ) : null}
        </div>
        <Badge tone="brand">{tariffLabel(trip.tariff)}</Badge>
      </div>
      <p className="mt-2 text-xs text-ink-600">
        Позиция машины, рейтинг водителя и его телефон в ответе сервиса не приходят — на карте
        показаны только точки маршрута, позвонить из приложения пока нельзя.
      </p>
    </div>
  );
}

function MoneyRows({ trip }: { trip: Trip }) {
  const rows: { label: string; value: string }[] = [];
  if (trip.priceMinor !== null) {
    rows.push({ label: 'Стоимость', value: formatMoney(trip.priceMinor, trip.currency) });
  }
  const commission = commissionBpLabel(trip.commissionBp);
  if (trip.commissionMinor !== null) {
    rows.push({
      label: commission ? `Комиссия платформы ${commission}` : 'Комиссия платформы',
      value: formatMoney(trip.commissionMinor, trip.currency),
    });
  }
  if (trip.driverNetMinor !== null) {
    rows.push({ label: 'Начислено водителю', value: formatMoney(trip.driverNetMinor, trip.currency) });
  }
  if (rows.length === 0) {
    return null;
  }
  return (
    <dl>
      {rows.map((row) => (
        <DetailRow key={row.label} label={row.label}>
          <span className="tnum">{row.value}</span>
        </DetailRow>
      ))}
    </dl>
  );
}

export interface TripStatusCardProps {
  trip: Trip;
  /** Compact variant is used for the live banner on the order screen. */
  variant?: 'full' | 'compact';
  action?: ReactNode;
}

export function TripStatusCard({ trip, variant = 'full', action }: TripStatusCardProps) {
  const hint = tripStageHint(trip.status);
  const at = statusTime(trip);

  if (variant === 'compact') {
    return (
      <Card>
        <CardHeader
          title={`Поездка № ${trip.tripNumber}`}
          subtitle={
            at ? `${cityDateTime(at)} · ${CITY_TIME_LABEL}` : `Статус обновляется автоматически`
          }
          action={<StatusBadge status={tripStatusLabel(trip.status)} />}
        />
        <CardBody>
          {hint ? <p className="text-sm text-ink-600">{hint}</p> : null}
          <div className="mt-3 flex flex-wrap items-center gap-2">
            {trip.driverName ? <Badge tone="neutral">{trip.driverName}</Badge> : null}
            {trip.vehiclePlate ? <Badge tone="neutral">{trip.vehiclePlate}</Badge> : null}
            {trip.priceMinor !== null ? (
              <span className="tnum text-sm font-medium text-ink-900">
                {formatMoney(trip.priceMinor, trip.currency)}
              </span>
            ) : null}
            {action}
          </div>
        </CardBody>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader
        title={`Поездка № ${trip.tripNumber}`}
        subtitle={at ? `${cityDateTime(at)} · ${CITY_TIME_LABEL}` : 'Статус поездки'}
        action={<StatusBadge status={tripStatusLabel(trip.status)} />}
      />
      <CardBody className="space-y-4">
        {hint ? (
          <Alert tone={trip.status === 'NO_DRIVERS_FOUND' ? 'warning' : 'info'}>{hint}</Alert>
        ) : null}

        {trip.cancelReason ? (
          <Alert tone="warning" title="Причина отмены">
            {trip.cancelReason}
          </Alert>
        ) : null}

        <dl>
          <DetailRow label="Статус">{tripStatusLabel(trip.status)}</DetailRow>
          <DetailRow label="Тариф">{tariffLabel(trip.tariff)}</DetailRow>
          {trip.pickup?.address ? <DetailRow label="Точка А">{trip.pickup.address}</DetailRow> : null}
          {trip.dropoff?.address ? (
            <DetailRow label="Точка Б">{trip.dropoff.address}</DetailRow>
          ) : null}
          {trip.distanceM !== null ? (
            <DetailRow label="Расстояние">
              <span className="tnum">{formatDistanceMeters(trip.distanceM)}</span>
            </DetailRow>
          ) : null}
          {trip.durationS !== null ? (
            <DetailRow label="В пути">
              <span className="tnum">{formatAgeSeconds(trip.durationS)}</span>
            </DetailRow>
          ) : null}
          {trip.holdId ? (
            <DetailRow label="Резерв средств">
              <span className="inline-flex items-center gap-1">
                <span className="font-mono text-xs">{shortId(trip.holdId)}</span>
                <CopyButton value={trip.holdId} />
              </span>
            </DetailRow>
          ) : null}
          {trip.requestedAt ? (
            <DetailRow label="Заявка создана">
              <span className="tnum">{cityTime(trip.requestedAt)}</span>
            </DetailRow>
          ) : null}
        </dl>

        <MoneyRows trip={trip} />

        <DriverCardBlock trip={trip} />

        <div className="border-t border-ink-100 pt-3">
          <p className="mb-2 text-sm font-medium text-ink-800">История переходов</p>
          <Timeline entries={timelineEntries(trip)} />
        </div>
      </CardBody>
    </Card>
  );
}
