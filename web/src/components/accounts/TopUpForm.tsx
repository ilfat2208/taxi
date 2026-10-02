import { useState } from 'react';
import { formatMoney, parseAmountInput } from '../../api/money';
import type { Account } from '../../api/types';
import { fieldErrorOf } from '../../api/errors';
import { useIdempotencyKey } from '../../lib/idempotency';
import { useTopUpAccount } from '../../hooks/useAccounts';
import { AmountField } from '../ui/AmountField';
import { Alert, ErrorAlert } from '../ui/Alerts';
import { Button } from '../ui/Button';
import { TextField } from '../ui/Field';

/**
 * ADMIN-only demo top-up (`POST /accounts/{id}/top-up`).
 *
 * Same money-path rules as the transfer form: the amount is parsed from minor
 * units, the Idempotency-Key is minted once per payload, and the button is
 * disabled while the request is in flight.
 */
export function TopUpForm({ account }: { account: Account }) {
  const [amountText, setAmountText] = useState('');
  const [reason, setReason] = useState('Демо-пополнение');
  const [errors, setErrors] = useState<{ amount?: string; reason?: string }>({});
  const topUp = useTopUpAccount();

  const parsed = parseAmountInput(amountText, {
    label: 'сумму',
    maxMinor: 100_000_000,
    maxMessage: 'Максимум 1 000 000 ₸ за одну операцию',
  });
  const signature = JSON.stringify({ accountId: account.id, amountText, reason });
  const { acquire, reset } = useIdempotencyKey(signature);

  const submit = () => {
    if (topUp.isPending) {
      return;
    }
    const nextErrors: { amount?: string; reason?: string } = {};
    if (!parsed.ok) {
      nextErrors.amount = parsed.message;
    }
    if (reason.trim().length < 3) {
      nextErrors.reason = 'Укажите причину (минимум 3 символа)';
    }
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0 || !parsed.ok) {
      return;
    }

    topUp.mutate(
      {
        accountId: account.id,
        body: { amountMinor: parsed.minor, reason: reason.trim() },
        idempotencyKey: acquire(),
      },
      {
        onSuccess: () => {
          setAmountText('');
          setReason('Демо-пополнение');
          reset();
        },
      },
    );
  };

  const serverAmountError = fieldErrorOf(topUp.error, 'amountMinor');
  const serverReasonError = fieldErrorOf(topUp.error, 'reason');

  return (
    <form
      className="space-y-3"
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      <p className="text-sm text-ink-500">
        Роль ADMIN: демо-пополнение без реальных денег. Сейчас доступно{' '}
        <span className="tnum font-medium text-ink-700">
          {formatMoney(account.availableMinor, account.currency)}
        </span>
        .
      </p>

      <div className="grid gap-3 sm:grid-cols-2">
        <AmountField
          id={`topup-amount-${account.id}`}
          label="Сумма пополнения"
          value={amountText}
          onValueChange={setAmountText}
          currency={account.currency}
          error={errors.amount ?? serverAmountError}
          hint="Не более 1 000 000 ₸ за операцию (демо-лимит)"
          suggestions={[1000, 5000, 10000]}
        />
        <TextField
          id={`topup-reason-${account.id}`}
          label="Причина"
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          error={errors.reason ?? serverReasonError}
          required
        />
      </div>

      {topUp.error ? <ErrorAlert error={topUp.error} title="Пополнение не выполнено" /> : null}
      {topUp.isSuccess ? <Alert tone="success" title="Счёт пополнен" /> : null}

      <Button type="submit" loading={topUp.isPending} disabled={topUp.isPending}>
        Пополнить
      </Button>
    </form>
  );
}
