import { formatMoney } from '../../api/money';
import type { Trip, TripReceipt } from '../../api/types';
import { useTripReceipt } from '../../hooks/useTrips';
import { humanMessage, isApiError } from '../../api/errors';
import { Alert, correlationIdOf } from '../ui/Alerts';
import { Card, CardBody, CardHeader, DetailRow } from '../ui/Card';
import { CopyButton } from '../ui/CopyButton';
import { SkeletonRows } from '../ui/Skeleton';
import { CITY_TIME_LABEL, cityDateTime } from '../../lib/cityTime';
import { shortId } from '../../lib/format';
import { commissionBpLabel, tariffLabel } from '../../lib/trips';

/**
 * Trip receipt.
 *
 * Three honest states instead of one optimistic one:
 *
 *  - the ride is not finished -> "чек появится после завершения поездки";
 *  - finished, receipt embedded in the trip -> the receipt;
 *  - finished, but the service returned no receipt (endpoint missing, 404/409, an
 *    empty body) -> "чек недоступен" with the code and correlation id.
 *
 * What never happens is a screen full of zeros: a fare component nobody sent is a
 * component this component does not print. Rows are built from the fields the
 * service actually sends (`ReceiptResponse` in trip-service), including the ledger
 * movement behind the ride — a wallet ride has no payment order, and the receipt
 * says that instead of naming a method it was never told.
 */

function ReceiptRows({ receipt }: { receipt: TripReceipt }) {
  const { breakdown } = receipt;
  const sharesComplete = receipt.commissionMinor !== null && receipt.driverNetMinor !== null;
  const invariantHolds =
    sharesComplete &&
    receipt.commissionMinor !== null &&
    receipt.driverNetMinor !== null &&
    receipt.commissionMinor + receipt.driverNetMinor === receipt.priceMinor;
  const commission = commissionBpLabel(receipt.commissionBp);

  // Only one identity is shown: the payment order when there is one (card or
  // corporate rides later), the ledger movement otherwise.
  const moneyRef = receipt.paymentId ?? receipt.transactionId;
  const moneyRefLabel = receipt.paymentId ? 'Платёж' : 'Проводка по счёту';

  return (
    <>
      <dl>
        {receipt.tariff ? (
          <DetailRow label="Тариф">{tariffLabel(receipt.tariff)}</DetailRow>
        ) : null}
        {breakdown ? (
          <>
            <DetailRow label="Посадка">
              <span className="tnum">{formatMoney(breakdown.baseMinor, receipt.currency)}</span>
            </DetailRow>
            <DetailRow label="Пробег">
              <span className="tnum">{formatMoney(breakdown.distanceMinor, receipt.currency)}</span>
            </DetailRow>
            <DetailRow label="Время">
              <span className="tnum">{formatMoney(breakdown.timeMinor, receipt.currency)}</span>
            </DetailRow>
          </>
        ) : (
          <DetailRow label="Разбивка тарифа">не пришла в чеке</DetailRow>
        )}

        <DetailRow label="Итого">
          <span className="tnum text-base">{formatMoney(receipt.priceMinor, receipt.currency)}</span>
        </DetailRow>

        {receipt.commissionMinor !== null ? (
          <DetailRow label={commission ? `Комиссия платформы ${commission}` : 'Комиссия платформы'}>
            <span className="tnum">{formatMoney(receipt.commissionMinor, receipt.currency)}</span>
          </DetailRow>
        ) : null}

        {receipt.driverNetMinor !== null ? (
          <DetailRow label="Доход водителя">
            <span className="tnum text-success-700">
              {formatMoney(receipt.driverNetMinor, receipt.currency)}
            </span>
          </DetailRow>
        ) : null}

        {receipt.driverDisplayName ? (
          <DetailRow label="Водитель">{receipt.driverDisplayName}</DetailRow>
        ) : null}

        {moneyRef ? (
          <DetailRow label={moneyRefLabel}>
            <span className="inline-flex items-center gap-1">
              <span className="font-mono text-xs">{shortId(moneyRef)}</span>
              <CopyButton value={moneyRef} />
            </span>
          </DetailRow>
        ) : null}
      </dl>

      <p className="mt-2 text-xs text-ink-500">
        {receipt.paymentId
          ? 'Сумма списана по платёжному поручению, указанному выше.'
          : 'Поездку оплачивает счёт ORTA в тенге: отдельного платёжного поручения у неё нет, деньги двигает проводка по счёту.'}
      </p>

      {/*
        The design calls the split of a fare an invariant: driver income plus the
        platform commission must equal the total. When the receipt carries all
        three numbers the screen checks them and says so if they disagree — a
        silently wrong receipt is worse than a flagged one.
      */}
      {sharesComplete && !invariantHolds ? (
        <Alert className="mt-3" tone="warning" title="Суммы в чеке не сходятся">
          Комиссия платформы и доход водителя в сумме не дают стоимость поездки. Напишите в
          поддержку и назовите номер поездки — расхождение проверит сервис.
        </Alert>
      ) : null}
    </>
  );
}

export function TripReceiptBlock({ trip }: { trip: Trip }) {
  const embedded = trip.receipt;
  const completed = trip.status === 'COMPLETED';
  const query = useTripReceipt(trip.tripId, completed && embedded === null);

  const receipt = embedded ?? query.data ?? null;
  const correlationId = correlationIdOf(query.error);
  const failureCode = isApiError(query.error) ? query.error.code : null;
  const unavailable = embedded === null && completed && !query.isPending && receipt === null;

  return (
    <Card>
      <CardHeader
        title="Чек поездки"
        subtitle={
          receipt
            ? `№ ${receipt.tripNumber ?? trip.tripNumber} · ${cityDateTime(receipt.completedAt ?? trip.completedAt)} (${CITY_TIME_LABEL})`
            : 'Документ о завершённой поездке'
        }
      />
      <CardBody>
        {!completed && embedded === null ? (
          <Alert tone="info" title="Чек появится после завершения поездки">
            Пока поездка не завершена, чека нет: сумму по факту считает сервис, и до этого момента
            показывать нечего.
          </Alert>
        ) : null}

        {completed && query.isPending && embedded === null ? <SkeletonRows count={3} /> : null}

        {receipt ? <ReceiptRows receipt={receipt} /> : null}

        {unavailable ? (
          <Alert tone="warning" title="Чек недоступен">
            Сервис не вернул чек по этой поездке, поэтому суммы здесь не показываем — подставлять
            нули было бы хуже, чем признать, что данных нет.
            {failureCode ? (
              <>
                {' '}
                Код ответа: <code className="rounded bg-white/70 px-1">{failureCode}</code>.
              </>
            ) : null}
            {correlationId ? (
              <>
                {' '}
                Correlation ID: <code className="rounded bg-white/70 px-1">{correlationId}</code>.
              </>
            ) : null}
            {!failureCode && !correlationId && query.isError ? (
              <> {humanMessage(query.error)}</>
            ) : null}
          </Alert>
        ) : null}
      </CardBody>
    </Card>
  );
}
