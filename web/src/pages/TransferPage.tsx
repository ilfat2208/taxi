import { useState } from 'react';
import { Link } from 'react-router-dom';
import { formatMoney, parseAmountInput } from '../api/money';
import { fieldErrorOf } from '../api/errors';
import type { Payment } from '../api/types';
import { AccountPicker } from '../components/accounts/AccountPicker';
import { PageHeader } from '../components/layout/PageHeader';
import { AmountField } from '../components/ui/AmountField';
import { Alert, ErrorAlert } from '../components/ui/Alerts';
import { Badge, StatusBadge } from '../components/ui/Badge';
import { Button, buttonClass } from '../components/ui/Button';
import { Card, CardBody, CardHeader, DetailRow } from '../components/ui/Card';
import { EmptyState } from '../components/ui/EmptyState';
import { TextAreaField, TextField } from '../components/ui/Field';
import { PageLoader } from '../components/ui/Spinner';
import { useAccounts } from '../hooks/useAccounts';
import { useCreateTransfer } from '../hooks/usePayments';
import { useIdempotencyKey, transferSignature } from '../lib/idempotency';
import { formatDateTime } from '../lib/format';
import { PHONE_PREFIX, formatPhoneInput, maskPhone, normalizePhone } from '../lib/phone';

interface TransferErrors {
  source?: string;
  phone?: string;
  amount?: string;
}

/**
 * P2P transfer by phone number, in two steps.
 *
 * Step 1 collects and validates, step 2 shows exactly what will be sent (source
 * account, masked recipient, amount, description) before any money moves. The
 * confirm step is where the Idempotency-Key is minted: one key per payload, reused
 * if the user retries the same submit, and dropped on success so "Повторить" is a
 * genuinely new transfer.
 */
export function TransferPage() {
  const accountsQuery = useAccounts();
  const accounts = accountsQuery.data ?? [];

  const [selectedSourceId, setSelectedSourceId] = useState<string | null>(null);
  const [phone, setPhone] = useState(PHONE_PREFIX);
  const [amountText, setAmountText] = useState('');
  const [description, setDescription] = useState('');
  const [step, setStep] = useState<'form' | 'review'>('form');
  const [errors, setErrors] = useState<TransferErrors>({});
  const [receipt, setReceipt] = useState<Payment | null>(null);

  const source = accounts.find((account) => account.id === selectedSourceId) ?? accounts[0] ?? null;
  const normalizedPhone = normalizePhone(phone);

  const parsed = parseAmountInput(amountText, {
    label: 'сумму',
    maxMinor: source?.availableMinor,
    maxMessage: 'Недостаточно средств на выбранном счёте',
  });

  const signature = transferSignature({
    sourceAccountId: source?.id ?? null,
    targetPhone: normalizedPhone,
    amountMinor: parsed.ok ? parsed.minor : null,
    currency: source?.currency ?? null,
    description: description.trim(),
  });
  const { acquire, reset } = useIdempotencyKey(signature);
  const transfer = useCreateTransfer();
  const errorList = Object.values(errors).filter((message): message is string => Boolean(message));

  const validate = (): TransferErrors => {
    const next: TransferErrors = {};
    if (!source) {
      next.source = 'Выберите счёт списания';
    }
    if (!normalizedPhone) {
      next.phone = 'Введите номер получателя в формате +7 700 000 00 00';
    } else if (source && normalizedPhone === normalizePhone(source.ownerPhone ?? '')) {
      next.phone = 'Нельзя перевести средства на свой же счёт';
    }
    if (!parsed.ok) {
      next.amount = parsed.message;
    }
    return next;
  };

  const goToReview = () => {
    const next = validate();
    setErrors(next);
    if (Object.values(next).some(Boolean)) {
      return;
    }
    setStep('review');
  };

  /** Validation feedback disappears as soon as the user fixes the field. */
  const clearError = (field: keyof TransferErrors) => {
    setErrors((previous) => (previous[field] ? { ...previous, [field]: undefined } : previous));
  };

  const confirm = () => {
    // Second guard behind the disabled button: a stray event can never send twice.
    if (transfer.isPending || !source || !parsed.ok || !normalizedPhone) {
      return;
    }
    transfer.mutate(
      {
        body: {
          sourceAccountId: source.id,
          targetPhone: normalizedPhone,
          amountMinor: parsed.minor,
          currency: source.currency,
          description: description.trim() || undefined,
        },
        idempotencyKey: acquire(),
      },
      {
        onSuccess: (payment) => {
          setReceipt(payment);
          // Drop the key: repeating this transfer must be a new intent.
          reset();
        },
      },
    );
  };

  const repeat = () => {
    setReceipt(null);
    setStep('form');
    setErrors({});
  };

  if (accountsQuery.isPending) {
    return (
      <>
        <PageHeader title="Перевод по номеру телефона" />
        <PageLoader label="Загружаем счета…" />
      </>
    );
  }

  if (accountsQuery.isError) {
    return (
      <>
        <PageHeader title="Перевод по номеру телефона" />
        <ErrorAlert
          error={accountsQuery.error}
          title="Не удалось загрузить счета"
          onRetry={() => void accountsQuery.refetch()}
        />
      </>
    );
  }

  if (accounts.length === 0) {
    return (
      <>
        <PageHeader title="Перевод по номеру телефона" />
        <EmptyState
          title="Нет счёта для перевода"
          description="Сначала откройте счёт на главной странице — переводить можно только со своего счёта."
          action={
            <Link to="/" className={buttonClass()}>
              На главную
            </Link>
          }
        />
      </>
    );
  }

  if (receipt) {
    return (
      <>
        <PageHeader title="Перевод отправлен" subtitle="Деньги зарезервированы, платёж обрабатывается" />
        <Card>
          <CardHeader
            title={`Платёж № ${receipt.paymentNumber}`}
            subtitle={formatDateTime(receipt.createdAt)}
            action={<StatusBadge status={receipt.status} />}
          />
          <CardBody>
            <dl>
              <DetailRow label="Получатель">{normalizedPhone ? maskPhone(normalizedPhone) : '—'}</DetailRow>
              <DetailRow label="Сумма">
                <span className="tnum">{formatMoney(receipt.amountMinor, receipt.currency)}</span>
              </DetailRow>
              <DetailRow label="Комиссия">
                <span className="tnum">{formatMoney(receipt.feeMinor, receipt.currency)}</span>
              </DetailRow>
              <DetailRow label="Итого">
                <span className="tnum text-base">{formatMoney(receipt.totalMinor, receipt.currency)}</span>
              </DetailRow>
              {receipt.description ? <DetailRow label="Комментарий">{receipt.description}</DetailRow> : null}
              <DetailRow label="ID платежа">
                <span className="font-mono text-xs">{receipt.paymentId}</span>
              </DetailRow>
            </dl>

            <div className="mt-4 flex flex-wrap gap-2">
              <Button onClick={repeat}>Повторить перевод</Button>
              <Link
                to={`/payments/${receipt.paymentId}`}
                className={buttonClass({ variant: 'secondary' })}
              >
                Открыть платёж
              </Link>
              <Link to="/" className={buttonClass({ variant: 'ghost' })}>
                На главную
              </Link>
            </div>

            <p className="mt-3 text-xs text-ink-500">
              «Повторить перевод» создаёт новый платёж с новым ключом идемпотентности — предыдущий перевод не
              будет отправлен дважды.
            </p>
          </CardBody>
        </Card>
      </>
    );
  }

  if (step === 'review' && source && parsed.ok && normalizedPhone) {
    return (
      <>
        <PageHeader
          title="Проверьте перевод"
          subtitle="Пока вы не подтвердите, деньги не покинут счёт"
          backTo="/transfer"
        />
        <Card>
          <CardHeader title="Реквизиты перевода" action={<Badge tone="warning">Шаг 2 из 2</Badge>} />
          <CardBody>
            <dl>
              <DetailRow label="Счёт списания">
                {source.displayName || source.type} · {source.currency}
              </DetailRow>
              <DetailRow label="Доступно на счёте">
                <span className="tnum">{formatMoney(source.availableMinor, source.currency)}</span>
              </DetailRow>
              <DetailRow label="Получатель">
                {maskPhone(normalizedPhone)} <span className="text-xs text-ink-500">(P2P по номеру)</span>
              </DetailRow>
              <DetailRow label="Сумма">
                <span className="tnum text-base">{formatMoney(parsed.minor, source.currency)}</span>
              </DetailRow>
              {description.trim() ? <DetailRow label="Комментарий">{description.trim()}</DetailRow> : null}
            </dl>

            {transfer.error ? (
              <div className="mt-4">
                <ErrorAlert
                  error={transfer.error}
                  title="Перевод не выполнен"
                  onRetry={confirm}
                  retryLabel="Повторить отправку"
                />
                <p className="mt-2 text-xs text-ink-500">
                  Повторная отправка использует тот же ключ идемпотентности, поэтому перевод не задвоится.
                </p>
              </div>
            ) : null}

            <div className="mt-4 flex flex-wrap gap-2">
              <Button size="lg" onClick={confirm} loading={transfer.isPending} disabled={transfer.isPending}>
                Подтвердить перевод
              </Button>
              <Button
                variant="secondary"
                size="lg"
                onClick={() => setStep('form')}
                disabled={transfer.isPending}
              >
                Изменить
              </Button>
            </div>
          </CardBody>
        </Card>
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="Перевод по номеру телефона"
        subtitle="Внутри ORTA переводы мгновенные: получатель определится по номеру"
      />

      <Card>
        <CardHeader title="Новый перевод" action={<Badge tone="neutral">Шаг 1 из 2</Badge>} />
        <CardBody>
          <form
            className="space-y-4"
            noValidate
            onSubmit={(event) => {
              event.preventDefault();
              goToReview();
            }}
          >
            <AccountPicker
              accounts={accounts}
              value={source?.id ?? ''}
              onChange={setSelectedSourceId}
              name="sourceAccountId"
              error={errors.source}
            />

            <TextField
              id="transfer-phone"
              label="Телефон получателя"
              type="tel"
              inputMode="tel"
              autoComplete="off"
              placeholder="+7 700 000 00 00"
              value={phone}
              onChange={(event) => {
                setPhone(formatPhoneInput(event.target.value));
                clearError('phone');
              }}
              error={errors.phone ?? fieldErrorOf(transfer.error, 'targetPhone')}
              hint="Формат: +7 700 000 00 00 — подойдёт номер любого пользователя демо-стенда"
              required
            />

            <AmountField
              id="transfer-amount"
              label="Сумма перевода"
              value={amountText}
              onValueChange={(value) => {
                setAmountText(value);
                clearError('amount');
              }}
              currency={source?.currency ?? 'KZT'}
              error={errors.amount ?? fieldErrorOf(transfer.error, 'amountMinor')}
              hint={
                source
                  ? `Доступно ${formatMoney(source.availableMinor, source.currency)} — с учётом зарезервированных сумм`
                  : undefined
              }
              suggestions={[1000, 5000, 20000]}
            />

            <TextAreaField
              id="transfer-description"
              label="Комментарий"
              value={description}
              maxLength={200}
              onChange={(event) => setDescription(event.target.value)}
              hint="Необязательно: попадёт в выписку получателя"
              placeholder="Например: за обед"
            />

            {errorList.length > 0 ? (
              <Alert tone="danger" title="Проверьте поля формы">
                <ul className="list-disc space-y-1 pl-5">
                  {errorList.map((message) => (
                    <li key={message}>{message}</li>
                  ))}
                </ul>
              </Alert>
            ) : null}

            <Button type="submit" size="lg">
              Перейти к подтверждению
            </Button>
          </form>
        </CardBody>
      </Card>
    </>
  );
}
