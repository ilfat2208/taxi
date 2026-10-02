import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { formatMoney, parseAmountInput, sumMinor, toMajorString } from '../api/money';
import { fieldErrorOf, isApiError } from '../api/errors';
import { PageHeader } from '../components/layout/PageHeader';
import { AmountField } from '../components/ui/AmountField';
import { Alert, ErrorAlert } from '../components/ui/Alerts';
import { StatusBadge } from '../components/ui/Badge';
import { Button, buttonClass } from '../components/ui/Button';
import { Card, CardBody, CardHeader, DetailRow } from '../components/ui/Card';
import { EmptyState } from '../components/ui/EmptyState';
import { TextField } from '../components/ui/Field';
import { PageLoader } from '../components/ui/Spinner';
import { Timeline, type TimelineEntry } from '../components/ui/Timeline';
import { usePayment, useRefundPayment, useRefunds } from '../hooks/usePayments';
import { useIdempotencyKey, transferSignature } from '../lib/idempotency';
import { formatDateTime, paymentTypeLabel } from '../lib/format';
import type { PaymentDetail } from '../api/types';

/** Refunds are offered only for money that actually arrived. */
function refundable(detail: PaymentDetail | undefined): boolean {
  if (!detail) {
    return false;
  }
  const { payment } = detail;
  if (payment.type === 'REFUND') {
    return false;
  }
  return (
    (payment.status === 'COMPLETED' || payment.status === 'PARTIALLY_REFUNDED') && payment.amountMinor > 0
  );
}

function transitionsOf(detail: PaymentDetail): TimelineEntry[] {
  if (detail.transitions.length > 0) {
    return detail.transitions.map((transition, index) => ({
      key: `${transition.id ?? transition.toStatus}-${index}`,
      status: transition.toStatus,
      time: transition.createdAt ?? transition.occurredAt ?? null,
      note: transition.reason ?? transition.comment ?? null,
    }));
  }
  return [
    {
      key: 'current',
      status: detail.payment.status,
      time: detail.payment.completedAt ?? detail.payment.createdAt,
      note: 'История переходов недоступна — показано текущее состояние',
    },
  ];
}

/**
 * Payment card: state timeline plus a refund form when the state allows one.
 *
 * The refund is a money movement, so it follows the same rules as the transfer:
 * amount parsed from minor units, one Idempotency-Key per attempt, the button
 * disabled while the request is in flight.
 */
export function PaymentDetailPage() {
  const { paymentId } = useParams<{ paymentId: string }>();
  const detailQuery = usePayment(paymentId);
  const detail = detailQuery.data;
  const canRefund = refundable(detail);

  const refundsQuery = useRefunds(paymentId, canRefund);
  const refund = useRefundPayment();

  const [amountText, setAmountText] = useState('');
  const [reason, setReason] = useState('Возврат по запросу клиента');
  const [errors, setErrors] = useState<{ amount?: string; reason?: string }>({});
  const [amountTouched, setAmountTouched] = useState(false);

  const maxRefundable = detail?.payment.amountMinor ?? 0;
  const effectiveAmount = amountTouched
    ? amountText
    : detail
      ? toMajorString(maxRefundable)
      : '';

  const parsed = parseAmountInput(effectiveAmount, {
    label: 'сумму возврата',
    maxMinor: maxRefundable,
    maxMessage: `Больше суммы платежа (${formatMoney(maxRefundable, detail?.payment.currency)})`,
  });

  const { acquire, reset } = useIdempotencyKey(
    transferSignature({
      paymentId: paymentId ?? null,
      amountMinor: parsed.ok ? parsed.minor : null,
      reason: reason.trim(),
    }),
  );

  const submitRefund = () => {
    if (refund.isPending || !paymentId || !detail) {
      return;
    }
    const next: { amount?: string; reason?: string } = {};
    if (!parsed.ok) {
      next.amount = parsed.message;
    }
    if (reason.trim().length < 3) {
      next.reason = 'Опишите причину возврата (минимум 3 символа)';
    }
    setErrors(next);
    if (Object.keys(next).length > 0 || !parsed.ok) {
      return;
    }

    refund.mutate(
      {
        paymentId,
        body: { amountMinor: parsed.minor, reason: reason.trim() },
        idempotencyKey: acquire(),
      },
      {
        onSuccess: () => {
          setAmountTouched(false);
          setAmountText('');
          reset();
        },
      },
    );
  };

  if (detailQuery.isPending) {
    return (
      <>
        <PageHeader title="Платёж" backTo="/payments" />
        <PageLoader label="Загружаем платёж…" />
      </>
    );
  }

  if (detailQuery.isError) {
    const notFound = isApiError(detailQuery.error) && detailQuery.error.isNotFound;
    return (
      <>
        <PageHeader title="Платёж" backTo="/payments" />
        {notFound ? (
          <EmptyState
            title="Платёж не найден"
            description="Возможно, ссылка устарела или платёж принадлежит другому пользователю."
            action={
              <Link to="/payments" className={buttonClass()}>
                К списку платежей
              </Link>
            }
          />
        ) : (
          <ErrorAlert
            error={detailQuery.error}
            title="Не удалось загрузить платёж"
            onRetry={() => void detailQuery.refetch()}
          />
        )}
      </>
    );
  }

  if (!detail) {
    return (
      <>
        <PageHeader title="Платёж" backTo="/payments" />
        <EmptyState title="Платёж не найден" />
      </>
    );
  }

  const { payment } = detail;
  const refundedMinor = sumMinor((refundsQuery.data ?? []).map((entry) => entry.amountMinor));

  return (
    <>
      <PageHeader
        title={`Платёж № ${payment.paymentNumber}`}
        subtitle={paymentTypeLabel(payment.type)}
        backTo="/payments"
        actions={<StatusBadge status={payment.status} />}
      />

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader title="Детали платежа" />
          <CardBody>
            <dl>
              <DetailRow label="Сумма">
                <span className="tnum text-base">{formatMoney(payment.amountMinor, payment.currency)}</span>
              </DetailRow>
              <DetailRow label="Комиссия">
                <span className="tnum">{formatMoney(payment.feeMinor, payment.currency)}</span>
              </DetailRow>
              <DetailRow label="Итого">
                <span className="tnum">{formatMoney(payment.totalMinor, payment.currency)}</span>
              </DetailRow>
              <DetailRow label="Описание">{payment.description || '—'}</DetailRow>
              <DetailRow label="Создан">{formatDateTime(payment.createdAt)}</DetailRow>
              <DetailRow label="Завершён">{formatDateTime(payment.completedAt)}</DetailRow>
              <DetailRow label="Счёт списания">
                <span className="font-mono text-xs">{payment.sourceAccountId ?? '—'}</span>
              </DetailRow>
              <DetailRow label="Счёт получателя">
                <span className="font-mono text-xs">{payment.targetAccountId ?? '—'}</span>
              </DetailRow>
              <DetailRow label="ID платежа">
                <span className="font-mono text-xs">{payment.paymentId}</span>
              </DetailRow>
            </dl>

            {payment.failureReason ? (
              <div className="mt-3">
                <Alert tone="danger" title={`Платёж не выполнен${payment.failureCode ? ` (${payment.failureCode})` : ''}`}>
                  {payment.failureReason}
                </Alert>
              </div>
            ) : null}

            {canRefund ? (
              <div className="mt-5 border-t border-ink-100 pt-4">
                <h3 className="text-sm font-semibold text-ink-900">Оформить возврат</h3>
                <p className="mt-1 text-xs text-ink-500">
                  Доступно к возврату: {formatMoney(Math.max(0, payment.amountMinor - refundedMinor), payment.currency)}
                  {refundedMinor > 0 ? ` · уже возвращено ${formatMoney(refundedMinor, payment.currency)}` : ''}
                </p>

                <form
                  className="mt-3 space-y-3"
                  noValidate
                  onSubmit={(event) => {
                    event.preventDefault();
                    submitRefund();
                  }}
                >
                  <AmountField
                    id="refund-amount"
                    label="Сумма возврата"
                    value={effectiveAmount}
                    onValueChange={(value) => {
                      setAmountTouched(true);
                      setAmountText(value);
                    }}
                    currency={payment.currency}
                    error={errors.amount ?? fieldErrorOf(refund.error, 'amountMinor')}
                  />

                  <TextField
                    id="refund-reason"
                    label="Причина возврата"
                    value={reason}
                    onChange={(event) => setReason(event.target.value)}
                    error={errors.reason ?? fieldErrorOf(refund.error, 'reason')}
                    required
                  />

                  {refund.error ? <ErrorAlert error={refund.error} title="Возврат не выполнен" /> : null}
                  {refund.isSuccess ? <Alert tone="success" title="Возврат создан" /> : null}

                  <Button type="submit" loading={refund.isPending} disabled={refund.isPending}>
                    Вернуть деньги
                  </Button>
                </form>
              </div>
            ) : (
              <p className="mt-5 border-t border-ink-100 pt-4 text-sm text-ink-500">
                Возврат доступен только для завершённых платежей. Текущее состояние:{' '}
                <StatusBadge status={payment.status} />
              </p>
            )}
          </CardBody>
        </Card>

        <div className="space-y-4">
          <Card>
            <CardHeader title="История состояний" />
            <CardBody>
              <Timeline entries={transitionsOf(detail)} />
            </CardBody>
          </Card>

          {canRefund ? (
            <Card>
              <CardHeader title="Возвраты" subtitle={refundsQuery.data ? `Всего: ${refundsQuery.data.length}` : undefined} />
              <CardBody>
                {refundsQuery.isPending ? <p className="text-sm text-ink-500">Загружаем…</p> : null}
                {refundsQuery.isError ? (
                  <p className="text-sm text-ink-500">История возвратов недоступна.</p>
                ) : null}
                {refundsQuery.data && refundsQuery.data.length === 0 ? (
                  <p className="text-sm text-ink-500">Возвратов по этому платежу нет.</p>
                ) : null}
                {refundsQuery.data && refundsQuery.data.length > 0 ? (
                  <ul className="divide-y divide-ink-100">
                    {refundsQuery.data.map((entry) => (
                      <li key={entry.refundId} className="flex items-center justify-between gap-3 py-2 text-sm">
                        <span>
                          <span className="tnum block font-medium text-ink-900">
                            {formatMoney(entry.amountMinor, entry.currency)}
                          </span>
                          <span className="block text-xs text-ink-500">{formatDateTime(entry.createdAt)}</span>
                        </span>
                        <StatusBadge status={entry.status} />
                      </li>
                    ))}
                  </ul>
                ) : null}
              </CardBody>
            </Card>
          ) : null}
        </div>
      </div>
    </>
  );
}
