import { useState } from 'react';
import { isApiError } from '../../api/errors';
import type { Trip } from '../../api/types';
import { useCancelTrip, useRateTrip } from '../../hooks/useTrips';
import { Alert, ErrorAlert } from '../ui/Alerts';
import { Button } from '../ui/Button';
import { Card, CardBody, CardHeader } from '../ui/Card';
import { TextAreaField } from '../ui/Field';
import { cx } from '../../lib/cx';

/**
 * The two things a rider can do to a trip: cancel it, and rate it.
 *
 * A cancellation always carries a reason — the field is validated on the client
 * *before* the request, because "отменить без причины" would leave the service
 * (and the driver) without the one piece of information they asked for.
 */

export interface CancelTripFormProps {
  tripId: string;
  onCanceled?: () => void;
}

export function CancelTripForm({ tripId, onCanceled }: CancelTripFormProps) {
  const cancel = useCancelTrip();
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | undefined>(undefined);

  const submit = () => {
    if (reason.trim() === '') {
      setError('Укажите причину отмены');
      return;
    }
    setError(undefined);
    cancel.mutate(
      { tripId, reason: reason.trim() },
      {
        onSuccess: () => {
          setReason('');
          onCanceled?.();
        },
      },
    );
  };

  return (
    <Card>
      <CardHeader title="Отмена поездки" subtitle="Причина уходит водителю и в поддержку" />
      <CardBody className="space-y-3">
        <TextAreaField
          id="trip-cancel-reason"
          label="Причина отмены"
          required
          value={reason}
          error={error}
          hint="Без причины отменить поездку нельзя"
          placeholder="Например: планы изменились"
          onChange={(event) => setReason(event.target.value)}
        />

        {cancel.isError ? (
          <ErrorAlert error={cancel.error} title="Не удалось отменить поездку" />
        ) : null}

        <Button
          variant="danger"
          loading={cancel.isPending}
          disabled={cancel.isPending}
          onClick={submit}
        >
          Отменить поездку
        </Button>
      </CardBody>
    </Card>
  );
}

export interface RatingFormProps {
  trip: Trip;
}

export function RatingForm({ trip }: RatingFormProps) {
  const rate = useRateTrip();
  const [stars, setStars] = useState(0);
  const [comment, setComment] = useState('');
  const [error, setError] = useState<string | undefined>(undefined);

  // The trip view carries the rating the rider already left: no second attempt,
  // and no chance to trip over the `409` the service would answer with. When the
  // rating was just submitted, the same block confirms it.
  if (trip.ratingStars !== null) {
    return (
      <Card>
        <CardHeader title="Оценка водителя" />
        <CardBody>
          {rate.isSuccess ? (
            <Alert tone="success" title="Спасибо, оценка отправлена">
              Оценку по этой поездке изменить нельзя — сервис принимает её один раз.
            </Alert>
          ) : (
            <Alert tone="success" title={`Вы оценили поездку на ${trip.ratingStars} из 5`}>
              Оценку по этой поездке изменить нельзя — сервис принимает её один раз.
            </Alert>
          )}
        </CardBody>
      </Card>
    );
  }

  const alreadyRated = isApiError(rate.error) && rate.error.status === 409;

  const submit = () => {
    if (stars < 1 || stars > 5) {
      setError('Поставьте оценку от 1 до 5 звёзд');
      return;
    }
    setError(undefined);
    rate.mutate({ tripId: trip.tripId, stars, comment });
  };

  return (
    <Card>
      <CardHeader title="Оцените водителя" subtitle="Оценка влияет на распределение заказов" />
      <CardBody className="space-y-3">
        <div className="flex items-center gap-1" role="group" aria-label="Оценка поездки">
          {[1, 2, 3, 4, 5].map((value) => (
            <button
              key={value}
              type="button"
              aria-label={`Оценить на ${value}`}
              aria-pressed={stars === value}
              onClick={() => {
                setStars(value);
                setError(undefined);
              }}
              className={cx(
                'h-10 w-10 rounded-full text-lg ring-1 ring-inset transition-colors',
                value <= stars
                  ? 'bg-warning-50 text-warning-700 ring-amber-300'
                  : 'bg-white text-ink-400 ring-ink-200 hover:bg-ink-100',
              )}
            >
              ★
            </button>
          ))}
          <span className="ml-2 text-sm text-ink-600">
            {stars === 0 ? 'Оценка не выбрана' : `${stars} из 5`}
          </span>
        </div>
        {error ? (
          <p role="alert" className="text-xs font-medium text-brand-600">
            {error}
          </p>
        ) : null}

        <TextAreaField
          id="trip-rating-comment"
          label="Комментарий"
          value={comment}
          hint="Необязательно"
          placeholder="Что понравилось или что стоит поправить"
          onChange={(event) => setComment(event.target.value)}
        />

        {alreadyRated ? (
          <Alert tone="warning" title="Оценка уже отправлена">
            Сервис принимает оценку поездки один раз и отвечает <code>409</code> на повторную.
          </Alert>
        ) : rate.isError ? (
          <ErrorAlert error={rate.error} title="Не удалось отправить оценку" />
        ) : null}

        {rate.isSuccess ? <Alert tone="success" title="Спасибо, оценка отправлена" /> : null}

        <Button loading={rate.isPending} disabled={rate.isPending} onClick={submit}>
          Отправить оценку
        </Button>
      </CardBody>
    </Card>
  );
}
