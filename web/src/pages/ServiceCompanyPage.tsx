import { useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { formatMoney } from '../api/money';
import { isApiError } from '../api/errors';
import type { QtimeBooking, QtimeService, QtimeSlot, QtimeSpecialist } from '../api/types';
import { PageHeader } from '../components/layout/PageHeader';
import { DateStrip, SlotGrid } from '../components/services/SlotGrid';
import { Alert, ErrorAlert } from '../components/ui/Alerts';
import { Badge } from '../components/ui/Badge';
import { Button, buttonClass } from '../components/ui/Button';
import { Card, CardBody, CardHeader, DetailRow } from '../components/ui/Card';
import { EmptyState } from '../components/ui/EmptyState';
import { TextAreaField } from '../components/ui/Field';
import { SkeletonRows } from '../components/ui/Skeleton';
import { PageLoader } from '../components/ui/Spinner';
import { useCreateBooking, useQtimeCompany, useQtimeSlots } from '../hooks/useQtime';
import {
  BOOKING_DAYS_AHEAD,
  CITY_TIME_LABEL,
  cityDate,
  cityTime,
  formatDurationMinutes,
  formatFiveStarBp,
  upcomingDays,
} from '../lib/cityTime';
import { cx } from '../lib/cx';
import { transferSignature, useIdempotencyKey } from '../lib/idempotency';

/**
 * `/services/:companyId` — book one visit.
 *
 * The flow is three dependent choices (specialist -> service -> window) followed by
 * a confirmation, which is why they live on one screen with one request behind each
 * step: the window belongs to a `specialistId + serviceId` pair, and the duration of
 * the service decides how many windows fit into a day.
 *
 * A booking is a money path, so it goes out with an `Idempotency-Key` minted for its
 * exact payload; changing the specialist, the service, the window or the comment
 * mints a new one (see `lib/idempotency.ts`).
 */

function SpecialistOption({
  specialist,
  selected,
  onSelect,
}: {
  specialist: QtimeSpecialist;
  selected: boolean;
  onSelect: () => void;
}) {
  const rating = formatFiveStarBp(specialist.ratingBp);
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onSelect}
      className={cx(
        'w-full rounded-card border p-3 text-left transition-colors',
        selected ? 'border-brand-500 bg-brand-50 ring-1 ring-brand-500' : 'border-ink-200 bg-white hover:bg-ink-50',
      )}
    >
      <span className="flex items-center justify-between gap-2">
        <span className="text-sm font-medium text-ink-900">{specialist.name}</span>
        {rating ? <span className="text-xs text-ink-600">★ {rating}</span> : null}
      </span>
      {specialist.specialization ? (
        <span className="block text-xs text-ink-500">{specialist.specialization}</span>
      ) : null}
      {specialist.experienceYears !== null ? (
        <span className="block text-xs text-ink-500">стаж: {specialist.experienceYears} лет</span>
      ) : null}
    </button>
  );
}

function ServiceOption({
  service,
  selected,
  onSelect,
}: {
  service: QtimeService;
  selected: boolean;
  onSelect: () => void;
}) {
  const duration = formatDurationMinutes(service.durationMinutes);
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onSelect}
      className={cx(
        'flex w-full items-center justify-between gap-3 rounded-card border p-3 text-left transition-colors',
        selected ? 'border-brand-500 bg-brand-50 ring-1 ring-brand-500' : 'border-ink-200 bg-white hover:bg-ink-50',
      )}
    >
      <span className="min-w-0">
        <span className="block text-sm font-medium text-ink-900">{service.name}</span>
        {duration ? <span className="block text-xs text-ink-500">{duration}</span> : null}
      </span>
      {service.priceMinor !== null ? (
        <span className="tnum shrink-0 text-sm font-semibold text-ink-900">
          {formatMoney(service.priceMinor, service.currency)}
        </span>
      ) : null}
    </button>
  );
}

function BookingSuccess({ booking }: { booking: QtimeBooking }) {
  return (
    <Card>
      <CardHeader
        title="Запись создана"
        subtitle={`Код записи: ${booking.code}`}
        action={<Badge tone="success">{booking.status}</Badge>}
      />
      <CardBody className="space-y-3">
        <Alert tone="success" title={`${cityDate(booking.startsAt)}, ${cityTime(booking.startsAt)}`}>
          Время визита — {CITY_TIME_LABEL}. Возьмите код с собой: по нему запись найдут в компании.
        </Alert>
        <dl>
          {booking.companyName ? <DetailRow label="Компания">{booking.companyName}</DetailRow> : null}
          {booking.companyAddress ? (
            <DetailRow label="Адрес">{booking.companyAddress}</DetailRow>
          ) : null}
          {booking.specialistName ? (
            <DetailRow label="Специалист">{booking.specialistName}</DetailRow>
          ) : null}
          {booking.serviceName ? <DetailRow label="Услуга">{booking.serviceName}</DetailRow> : null}
          {formatDurationMinutes(booking.durationMinutes) ? (
            <DetailRow label="Длительность">
              {formatDurationMinutes(booking.durationMinutes)}
            </DetailRow>
          ) : null}
          {booking.priceMinor !== null ? (
            <DetailRow label="Стоимость">
              <span className="tnum">{formatMoney(booking.priceMinor, booking.currency)}</span>
            </DetailRow>
          ) : null}
        </dl>
        <div className="flex flex-wrap gap-2">
          <Link to="/services/bookings" className={buttonClass()}>
            Мои записи
          </Link>
          <Link to="/services" className={buttonClass({ variant: 'secondary' })}>
            К списку компаний
          </Link>
        </div>
      </CardBody>
    </Card>
  );
}

export function ServiceCompanyPage() {
  const { companyId } = useParams<{ companyId: string }>();
  const companyQuery = useQtimeCompany(companyId);

  const days = useMemo(() => upcomingDays(BOOKING_DAYS_AHEAD), []);
  const [date, setDate] = useState(() => days[0]?.key ?? '');
  const [specialistId, setSpecialistId] = useState<string | null>(null);
  const [serviceId, setServiceId] = useState<string | null>(null);
  const [slot, setSlot] = useState<QtimeSlot | null>(null);
  const [comment, setComment] = useState('');
  const [formError, setFormError] = useState<string | null>(null);

  const slotsQuery = useQtimeSlots({ specialistId, serviceId, date });
  const createBooking = useCreateBooking();

  const company = companyQuery.data;
  const specialists = useMemo(() => company?.specialists ?? [], [company]);
  const services = useMemo(() => company?.services ?? [], [company]);
  const specialist = specialists.find((entry) => entry.specialistId === specialistId) ?? null;
  const service = services.find((entry) => entry.serviceId === serviceId) ?? null;

  const signature = transferSignature({
    specialistId: specialistId ?? '',
    serviceId: serviceId ?? '',
    startsAt: slot?.startsAt ?? '',
    comment: comment.trim(),
  });
  const idempotency = useIdempotencyKey(signature);

  if (companyQuery.isPending) {
    return (
      <>
        <PageHeader title="Компания" backTo="/services" backLabel="К услугам" />
        <PageLoader label="Загружаем компанию…" />
      </>
    );
  }

  if (companyQuery.isError || !company) {
    const notFound = isApiError(companyQuery.error) && companyQuery.error.isNotFound;
    return (
      <>
        <PageHeader title="Компания" backTo="/services" backLabel="К услугам" />
        {notFound ? (
          <EmptyState
            title="Компания не найдена"
            description="Возможно, компания больше не подключена к QTime."
            action={
              <Link to="/services" className={buttonClass()}>
                К списку компаний
              </Link>
            }
          />
        ) : (
          <ErrorAlert
            error={companyQuery.error}
            title="Не удалось загрузить компанию"
            onRetry={() => void companyQuery.refetch()}
          />
        )}
      </>
    );
  }

  const place = [company.city, company.address].filter((part): part is string => Boolean(part));
  const rating = formatFiveStarBp(company.ratingBp);
  const duration = formatDurationMinutes(slotsQuery.data?.durationMinutes ?? service?.durationMinutes ?? null);

  const submit = () => {
    if (!specialistId || !serviceId) {
      setFormError('Выберите специалиста и услугу.');
      return;
    }
    if (!slot) {
      setFormError('Выберите свободное окно.');
      return;
    }
    setFormError(null);
    createBooking.mutate({
      body: {
        specialistId,
        serviceId,
        startsAt: slot.startsAt,
        ...(comment.trim() === '' ? {} : { comment: comment.trim() }),
      },
      idempotencyKey: idempotency.acquire(),
    });
  };

  const booking = createBooking.data ?? null;
  const alreadyTaken = isApiError(createBooking.error) && createBooking.error.status === 409;

  return (
    <>
      <PageHeader
        title={company.name}
        subtitle={place.length > 0 ? place.join(' · ') : 'Компания в QTime'}
        backTo="/services"
        backLabel="К услугам"
        actions={
          <>
            {rating ? <Badge tone="warning">★ {rating}</Badge> : null}
            <Badge tone="brand">QTime</Badge>
          </>
        }
      />

      <div className="space-y-4">
        {booking ? <BookingSuccess booking={booking} /> : null}

        <Card>
          <CardHeader title="Компания" subtitle="Расписание приходит из QTime" />
          <CardBody>
            <dl>
              {company.category ? <DetailRow label="Категория">{company.category}</DetailRow> : null}
              {company.city ? <DetailRow label="Город">{company.city}</DetailRow> : null}
              {company.address ? <DetailRow label="Адрес">{company.address}</DetailRow> : null}
              {company.reviewsCount !== null ? (
                <DetailRow label="Отзывов">{company.reviewsCount}</DetailRow>
              ) : null}
              {company.specialistsCount !== null ? (
                <DetailRow label="Специалистов">{company.specialistsCount}</DetailRow>
              ) : null}
            </dl>
            <p className="mt-2 text-xs text-ink-500">
              Точка на карте не показана: у компании в контракте есть координаты, но карта на этом
              экране не нужна — окна и цены важнее.
            </p>
          </CardBody>
        </Card>

        <Card>
          <CardHeader
            title="Шаг 1. Специалист"
            subtitle={specialist ? `Выбран: ${specialist.name}` : 'Кому записаться'}
          />
          <CardBody className="space-y-2">
            {specialists.length === 0 ? (
              <EmptyState
                title="Специалистов нет"
                description="Компания ещё не завела расписание в QTime — записаться пока не к кому."
              />
            ) : (
              specialists.map((entry) => (
                <SpecialistOption
                  key={entry.specialistId}
                  specialist={entry}
                  selected={entry.specialistId === specialistId}
                  onSelect={() => {
                    setSpecialistId(entry.specialistId);
                    // The chosen window belonged to the previous pair.
                    setSlot(null);
                  }}
                />
              ))
            )}
          </CardBody>
        </Card>

        <Card>
          <CardHeader
            title="Шаг 2. Услуга"
            subtitle={service ? `Выбрана: ${service.name}` : 'Что нужно сделать'}
          />
          <CardBody className="space-y-2">
            {services.length === 0 ? (
              <EmptyState
                title="Услуг нет"
                description="У компании нет опубликованного прайса — записаться пока нельзя."
              />
            ) : (
              services.map((entry) => (
                <ServiceOption
                  key={entry.serviceId}
                  service={entry}
                  selected={entry.serviceId === serviceId}
                  onSelect={() => {
                    setServiceId(entry.serviceId);
                    setSlot(null);
                  }}
                />
              ))
            )}
          </CardBody>
        </Card>

        <Card>
          <CardHeader
            title="Шаг 3. Свободное окно"
            subtitle="Занятые окна видны, но выбрать их нельзя"
            action={<Badge tone="brand">QTime</Badge>}
          />
          <CardBody className="space-y-3">
            <DateStrip
              days={days}
              selected={date}
              onSelect={(dayKey) => {
                setDate(dayKey);
                setSlot(null);
              }}
            />

            {slotsQuery.isError ? (
              <ErrorAlert
                error={slotsQuery.error}
                title="Не удалось получить свободные окна"
                onRetry={() => void slotsQuery.refetch()}
              />
            ) : null}

            <SlotGrid
              slots={slotsQuery.data?.slots ?? []}
              selectedStartsAt={slot?.startsAt ?? null}
              onSelect={setSlot}
              isPending={slotsQuery.isPending && slotsQuery.fetchStatus !== 'idle'}
              isError={slotsQuery.isError}
              ready={Boolean(specialistId) && Boolean(serviceId) && date !== ''}
            />

            {slotsQuery.data?.timezone ? (
              <p className="text-xs text-ink-500">
                Часовой пояс расписания: {slotsQuery.data.timezone} — время показываем как{' '}
                {CITY_TIME_LABEL}.
              </p>
            ) : company.timezone ? (
              <p className="text-xs text-ink-500">
                Расписание компании в зоне {company.timezone}: время показываем как {CITY_TIME_LABEL}.
              </p>
            ) : (
              <p className="text-xs text-ink-500">Время показываем как {CITY_TIME_LABEL}.</p>
            )}
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Подтверждение записи" subtitle="Проверьте перед отправкой" />
          <CardBody className="space-y-3">
            {slot && specialist && service ? (
              <>
                <dl>
                  <DetailRow label="Специалист">{specialist.name}</DetailRow>
                  <DetailRow label="Услуга">{service.name}</DetailRow>
                  <DetailRow label="Дата и время">
                    <span className="tnum">
                      {cityDate(slot.startsAt)}, {cityTime(slot.startsAt)}
                    </span>
                  </DetailRow>
                  {duration ? <DetailRow label="Длительность">{duration}</DetailRow> : null}
                  {service.priceMinor !== null ? (
                    <DetailRow label="Стоимость">
                      <span className="tnum">{formatMoney(service.priceMinor, service.currency)}</span>
                    </DetailRow>
                  ) : null}
                  <DetailRow label="Компания">{company.name}</DetailRow>
                </dl>

                <TextAreaField
                  id="booking-comment"
                  label="Комментарий"
                  value={comment}
                  hint="Необязательно"
                  placeholder="Например: нужно свободное окно у окна"
                  onChange={(event) => setComment(event.target.value)}
                />

                {formError ? <Alert tone="warning">{formError}</Alert> : null}

                {alreadyTaken ? (
                  <Alert tone="warning" title="Это окно уже заняли">
                    Пока вы выбирали, время забронировал кто-то другой. Выберите другое окно — список
                    обновим.
                  </Alert>
                ) : createBooking.isError ? (
                  <ErrorAlert
                    error={createBooking.error}
                    title="Не удалось записаться"
                    onRetry={submit}
                    retryLabel="Повторить запись"
                  />
                ) : null}

                <Button
                  size="lg"
                  block
                  loading={createBooking.isPending}
                  disabled={createBooking.isPending}
                  onClick={submit}
                >
                  {service.priceMinor !== null
                    ? `Записаться · ${formatMoney(service.priceMinor, service.currency)}`
                    : 'Записаться'}
                </Button>
              </>
            ) : (
              <SkeletonRows count={2} />
            )}
          </CardBody>
        </Card>

        <p className="text-xs text-ink-500">
          Отмена записи — в разделе «Мои записи». Условия отмены (например, «бесплатно за 3 часа»)
          задаёт компания, и в контракте QTime они пока не приходят, поэтому мы их не обещаем.
        </p>
      </div>
    </>
  );
}
