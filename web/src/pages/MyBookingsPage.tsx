import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { formatMoney } from '../api/money';
import type { QtimeBooking } from '../api/types';
import { PageHeader } from '../components/layout/PageHeader';
import { Alert, ErrorAlert } from '../components/ui/Alerts';
import { Badge, StatusBadge } from '../components/ui/Badge';
import { Button, buttonClass } from '../components/ui/Button';
import { Card, CardBody, CardHeader } from '../components/ui/Card';
import { EmptyState } from '../components/ui/EmptyState';
import { SelectField, TextAreaField } from '../components/ui/Field';
import { Pagination } from '../components/ui/Pagination';
import { SkeletonRows } from '../components/ui/Skeleton';
import { useBookings, useCancelBooking } from '../hooks/useQtime';
import { CITY_TIME_LABEL, cityDateTime, formatDurationMinutes } from '../lib/cityTime';
import { statusLabel } from '../lib/format';

/**
 * `/services/bookings` — my QTime bookings.
 *
 * Cancelling asks for a reason first: the field is required, and an empty one stops
 * the request on the client, because a cancellation without a reason leaves the
 * company (and the specialist) without the information the service asks for.
 */

const PAGE_SIZE = 10;

function CancelBookingForm({
  booking,
  onDone,
}: {
  booking: QtimeBooking;
  onDone: () => void;
}) {
  const cancel = useCancelBooking();
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | undefined>(undefined);

  const submit = () => {
    if (reason.trim() === '') {
      setError('Укажите причину отмены');
      return;
    }
    setError(undefined);
    cancel.mutate({ bookingId: booking.bookingId, reason: reason.trim() }, { onSuccess: onDone });
  };

  return (
    <div className="mt-3 space-y-3 border-t border-ink-100 pt-3">
      <TextAreaField
        id={`booking-cancel-${booking.bookingId}`}
        label="Причина отмены"
        required
        value={reason}
        error={error}
        hint="Без причины отменить запись нельзя"
        placeholder="Например: не смогу прийти"
        onChange={(event) => setReason(event.target.value)}
      />

      {cancel.isError ? (
        <ErrorAlert error={cancel.error} title="Не удалось отменить запись" />
      ) : null}

      <div className="flex flex-wrap gap-2">
        <Button variant="danger" loading={cancel.isPending} disabled={cancel.isPending} onClick={submit}>
          Подтвердить отмену
        </Button>
        <Button variant="secondary" onClick={onDone}>
          Не отменять
        </Button>
      </div>
    </div>
  );
}

function BookingRow({ booking }: { booking: QtimeBooking }) {
  const [cancelling, setCancelling] = useState(false);
  const duration = formatDurationMinutes(booking.durationMinutes);
  const cancellable = booking.status !== 'CANCELLED' && booking.status !== 'COMPLETED';

  return (
    <li className="rounded-card border border-ink-200 bg-white p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="tnum text-sm font-semibold text-ink-900">
            {cityDateTime(booking.startsAt)}
            {duration ? ` · ${duration}` : ''}
          </p>
          <p className="text-xs text-ink-500">
            {[booking.companyName, booking.specialistName, booking.serviceName]
              .filter((part): part is string => Boolean(part))
              .join(' · ')}
          </p>
          <p className="mt-1 text-xs text-ink-500">
            Код записи: <span className="font-mono">{booking.code}</span> · {CITY_TIME_LABEL}
          </p>
          {booking.companyAddress ? (
            <p className="text-xs text-ink-500">{booking.companyAddress}</p>
          ) : null}
        </div>

        <div className="flex flex-col items-end gap-2">
          <StatusBadge status={booking.status} />
          {booking.priceMinor !== null ? (
            <span className="tnum text-sm font-semibold text-ink-900">
              {formatMoney(booking.priceMinor, booking.currency)}
            </span>
          ) : null}
          {cancellable && !cancelling ? (
            <Button variant="ghost" size="sm" onClick={() => setCancelling(true)}>
              Отменить
            </Button>
          ) : null}
        </div>
      </div>

      {cancelling && cancellable ? (
        <CancelBookingForm booking={booking} onDone={() => setCancelling(false)} />
      ) : null}
    </li>
  );
}

export function MyBookingsPage() {
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(0);

  const query = useBookings({
    status: status === '' ? undefined : status,
    page,
    size: PAGE_SIZE,
  });
  const items = useMemo(() => query.data?.items ?? [], [query.data]);

  // Same rule as the category filter of the catalogue: no dictionary endpoint
  // exists, so the options are the statuses that arrived, remembered across pages.
  const [statusOptions, setStatusOptions] = useState<string[]>([]);
  useEffect(() => {
    setStatusOptions((previous) => {
      const next = new Set(previous);
      let changed = false;
      for (const booking of items) {
        if (booking.status !== '' && !next.has(booking.status)) {
          next.add(booking.status);
          changed = true;
        }
      }
      return changed ? Array.from(next).sort((a, b) => a.localeCompare(b)) : previous;
    });
  }, [items]);

  const statusChoices = status !== '' && !statusOptions.includes(status)
    ? [status, ...statusOptions]
    : statusOptions;

  return (
    <>
      <PageHeader
        title="Мои записи"
        subtitle="Записи через QTime: дата, специалист, услуга и отмена"
        backTo="/services"
        backLabel="К услугам"
        actions={
          <Link to="/services" className={buttonClass({ variant: 'secondary', size: 'sm' })}>
            Записаться ещё
          </Link>
        }
      />

      <Card>
        <CardHeader
          title="Записи"
          subtitle={query.data ? `Найдено: ${query.data.totalElements}` : undefined}
          action={
            <div className="w-52">
              <SelectField
                id="bookings-status"
                label="Статус"
                value={status}
                placeholder="Все статусы"
                options={statusChoices.map((value) => ({ value, label: statusLabel(value) }))}
                onChange={(event) => {
                  setStatus(event.target.value);
                  setPage(0);
                }}
                hint="Список собран из полученных записей"
              />
            </div>
          }
        />

        <CardBody className="space-y-2">
          {query.isPending ? <SkeletonRows count={3} /> : null}

          {query.isError ? (
            <ErrorAlert
              error={query.error}
              title="Не удалось загрузить записи"
              onRetry={() => void query.refetch()}
            />
          ) : null}

          {query.data && items.length === 0 ? (
            <EmptyState
              title={status === '' ? 'Записей пока нет' : 'Записей с таким статусом нет'}
              description={
                status === ''
                  ? 'Выберите компанию и свободное окно — запись появится здесь вместе с кодом.'
                  : 'Снимите фильтр статуса, чтобы увидеть остальные записи.'
              }
              action={
                <Link to="/services" className={buttonClass()}>
                  К списку компаний
                </Link>
              }
            />
          ) : null}

          {items.length > 0 ? (
            <>
              <Alert tone="info" title="Отмена — по правилам компании">
                Сроки бесплатной отмены задаёт компания, и в контракте QTime они пока не приходят:
                приложение не обещает «бесплатно за 3 часа».
              </Alert>
              <ul className="space-y-3">
                {items.map((booking) => (
                  <BookingRow key={booking.bookingId} booking={booking} />
                ))}
              </ul>
            </>
          ) : null}

          {query.data ? (
            <Pagination
              page={query.data.page}
              totalPages={query.data.totalPages}
              hasNext={query.data.hasNext}
              totalElements={query.data.totalElements}
              isFetching={query.isFetching}
              onPageChange={setPage}
            />
          ) : null}
        </CardBody>
      </Card>

      <p className="mt-3 text-xs text-ink-500">
        Записи хранит QTime — один календарь на всю платформу. <Badge tone="brand">QTime</Badge>
      </p>
    </>
  );
}
