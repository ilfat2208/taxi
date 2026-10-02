import { useState } from 'react';
import { Link } from 'react-router-dom';
import { formatMoney, sumMinor } from '../api/money';
import type { Currency } from '../api/types';
import { useAuth } from '../auth/AuthContext';
import { AccountCard } from '../components/accounts/AccountCard';
import { TopUpForm } from '../components/accounts/TopUpForm';
import { PageHeader } from '../components/layout/PageHeader';
import { CartIcon, MarketIcon, OrdersIcon, TransferIcon, WalletIcon } from '../components/layout/icons';
import { Alert, ErrorAlert } from '../components/ui/Alerts';
import { Button, buttonClass } from '../components/ui/Button';
import { Card, CardBody, CardHeader } from '../components/ui/Card';
import { EmptyState } from '../components/ui/EmptyState';
import { SelectField } from '../components/ui/Field';
import { PageLoader } from '../components/ui/Spinner';
import { SkeletonRows } from '../components/ui/Skeleton';
import { useAccounts, useAccountHolds, useAccountTransactions, useCreateAccount } from '../hooks/useAccounts';
import { useProfile } from '../hooks/useProfile';
import { directionLabel, formatDateTime, isCredit, operationLabel } from '../lib/format';
import { maskPhone } from '../lib/phone';

const CURRENCIES: Currency[] = ['KZT', 'USD', 'EUR', 'RUB'];
const ACCOUNT_TYPES = [
  { value: 'CUSTOMER', label: 'Текущий счёт' },
  { value: 'SAVINGS', label: 'Сберегательный' },
];

/** Quick-action tile: deliberately not a Button, so it can wrap a router Link. */
const QUICK_ACTION_CLASS =
  'flex flex-col items-center justify-center gap-1 rounded-card border border-ink-200 bg-white py-3 text-sm font-medium text-ink-700 transition-colors hover:border-brand-300 hover:text-brand-600';

/** Active holds of one account: the money behind `heldMinor`. */
function HoldsCard({ accountId }: { accountId: string }) {
  const holds = useAccountHolds(accountId);
  const items = holds.data?.items ?? [];

  if (holds.isPending || items.length === 0) {
    return null;
  }

  return (
    <Card className="mb-6">
      <CardHeader
        title="Зарезервированные суммы"
        subtitle="Деньги под активными операциями — уже недоступны для списания"
      />
      <CardBody>
        <ul className="divide-y divide-ink-100">
          {items.map((hold) => (
            <li key={hold.holdId} className="flex items-center justify-between gap-3 py-2 text-sm">
              <span className="min-w-0">
                <span className="block truncate text-ink-900">{hold.reason || hold.referenceType || 'Резерв'}</span>
                <span className="block text-xs text-ink-500">
                  {hold.status}
                  {hold.expiresAt ? ` · до ${formatDateTime(hold.expiresAt)}` : ''}
                </span>
              </span>
              <span className="tnum shrink-0 font-medium text-ink-900">
                {formatMoney(hold.amountMinor, hold.currency)}
              </span>
            </li>
          ))}
        </ul>
      </CardBody>
    </Card>
  );
}

/** Opens the caller's first account (one per currency/type is allowed). */
function CreateAccountForm() {
  const [currency, setCurrency] = useState<Currency>('KZT');
  const [type, setType] = useState('CUSTOMER');
  const create = useCreateAccount();

  return (
    <form
      className="space-y-3"
      onSubmit={(event) => {
        event.preventDefault();
        if (create.isPending) {
          return;
        }
        create.mutate({ currency, type });
      }}
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <SelectField
          id="new-account-currency"
          label="Валюта"
          value={currency}
          onChange={(event) => setCurrency(event.target.value as Currency)}
          options={CURRENCIES.map((code) => ({ value: code, label: code }))}
        />
        <SelectField
          id="new-account-type"
          label="Тип счёта"
          value={type}
          onChange={(event) => setType(event.target.value)}
          options={ACCOUNT_TYPES}
        />
      </div>

      {create.error ? <ErrorAlert error={create.error} title="Не удалось открыть счёт" /> : null}

      <Button type="submit" loading={create.isPending} disabled={create.isPending}>
        Открыть счёт
      </Button>
    </form>
  );
}

/**
 * Dashboard: balances, quick actions and the latest ledger movements.
 *
 * The account whose statement is displayed is chosen here (not in the URL) because
 * it is a view preference; the transfer and checkout flows ask for their own source
 * account explicitly, so nothing money-related depends on this selection.
 */
export function DashboardPage() {
  const { session, hasRole } = useAuth();
  const profile = useProfile();
  const accountsQuery = useAccounts();
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const accounts = accountsQuery.data ?? [];
  const selected = accounts.find((account) => account.id === selectedId) ?? accounts[0] ?? null;
  const transactionsQuery = useAccountTransactions(selected?.id ?? null, 0, 8);

  const sameCurrency = selected ? accounts.filter((account) => account.currency === selected.currency) : [];
  const totalAvailable = sumMinor(sameCurrency.map((account) => account.availableMinor));

  const displayName = profile.data?.displayName ?? session?.displayName ?? null;

  return (
    <>
      <PageHeader
        title={`Здравствуйте${displayName ? `, ${displayName}` : ''}`}
        subtitle={session?.phone ? `Вход выполнен: ${maskPhone(session.phone)}` : 'Демо-аккаунт'}
      />

      <div className="mb-6 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Link to="/transfer" className={QUICK_ACTION_CLASS}>
          <TransferIcon className="h-5 w-5 text-brand-500" />
          Перевод
        </Link>
        <Link to="/market" className={QUICK_ACTION_CLASS}>
          <MarketIcon className="h-5 w-5 text-brand-500" />
          Маркет
        </Link>
        <Link to="/cart" className={QUICK_ACTION_CLASS}>
          <CartIcon className="h-5 w-5 text-brand-500" />
          Корзина
        </Link>
        <Link to="/orders" className={QUICK_ACTION_CLASS}>
          <OrdersIcon className="h-5 w-5 text-brand-500" />
          Заказы
        </Link>
        {hasRole('ADMIN') && selected ? (
          <a href="#demo-topup" className={QUICK_ACTION_CLASS}>
            <WalletIcon className="h-5 w-5 text-brand-500" />
            Пополнить
          </a>
        ) : null}
      </div>

      {accountsQuery.isPending ? <PageLoader label="Загружаем счета…" /> : null}

      {accountsQuery.isError ? (
        <ErrorAlert
          error={accountsQuery.error}
          title="Не удалось загрузить счета"
          onRetry={() => void accountsQuery.refetch()}
        />
      ) : null}

      {accountsQuery.isSuccess && accounts.length === 0 ? (
        <Card>
          <CardHeader title="У вас пока нет счетов" subtitle="Откройте первый счёт, чтобы начать" />
          <CardBody>
            <CreateAccountForm />
          </CardBody>
        </Card>
      ) : null}

      {accounts.length > 0 ? (
        <>
          {accounts.length > 1 && selected ? (
            <p className="mb-3 text-sm text-ink-500">
              Всего доступно в {selected.currency}:{' '}
              <span className="tnum font-medium text-ink-800">
                {formatMoney(totalAvailable, selected.currency)}
              </span>
            </p>
          ) : null}

          <div className="mb-6 grid gap-3 sm:grid-cols-2">
            {accounts.map((account) => (
              <AccountCard key={account.id} account={account}>
                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    variant={account.id === selected?.id ? 'secondary' : 'ghost'}
                    size="sm"
                    onClick={() => setSelectedId(account.id)}
                  >
                    {account.id === selected?.id ? 'Операции показаны' : 'Показать операции'}
                  </Button>
                  <Link
                    to="/transfer"
                    className={buttonClass({ variant: 'ghost', size: 'sm' })}
                    aria-label={`Перевести со счёта ${account.displayName}`}
                  >
                    Перевести
                  </Link>
                </div>
              </AccountCard>
            ))}
          </div>
        </>
      ) : null}

      {hasRole('ADMIN') && selected ? (
        <Card className="mb-6">
          {/* Anchor target for the "Пополнить" quick action. */}
          <span id="demo-topup" aria-hidden="true" />
          <CardHeader
            title="Демо-пополнение"
            subtitle={`Счёт: ${selected.displayName || selected.type}`}
            action={<span className="text-xs text-ink-500">только ADMIN</span>}
          />
          <CardBody>
            <TopUpForm account={selected} />
          </CardBody>
        </Card>
      ) : null}

      {selected ? <HoldsCard accountId={selected.id} /> : null}

      {selected ? (
        <Card className="mb-6">
          <CardHeader
            title="Последние операции"
            subtitle={`Счёт: ${selected.displayName || selected.type}`}
            action={
              <Link to="/payments" className={buttonClass({ variant: 'ghost', size: 'sm' })}>
                Все платежи
              </Link>
            }
          />
          <CardBody>
            {transactionsQuery.isPending ? <SkeletonRows count={4} /> : null}

            {transactionsQuery.isError ? (
              <ErrorAlert
                error={transactionsQuery.error}
                title="Не удалось загрузить операции"
                onRetry={() => void transactionsQuery.refetch()}
              />
            ) : null}

            {transactionsQuery.data && transactionsQuery.data.items.length === 0 ? (
              <EmptyState
                title="Операций пока нет"
                description="Сделайте первый перевод или попросите демо-пополнение (роль ADMIN)."
                action={
                  <Link to="/transfer" className={buttonClass()}>
                    Сделать перевод
                  </Link>
                }
              />
            ) : null}

            {transactionsQuery.data && transactionsQuery.data.items.length > 0 ? (
              <ul className="divide-y divide-ink-100">
                {transactionsQuery.data.items.map((transaction) => (
                  <li key={transaction.id} className="flex items-center justify-between gap-3 py-2.5">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-ink-900">
                        {transaction.description || operationLabel(transaction.operation)}
                      </p>
                      <p className="text-xs text-ink-500">
                        {directionLabel(transaction.direction)} · {formatDateTime(transaction.createdAt)}
                      </p>
                    </div>
                    <div className="shrink-0 text-right">
                      <p
                        className={
                          isCredit(transaction.direction)
                            ? 'tnum text-sm font-semibold text-emerald-600'
                            : 'tnum text-sm font-semibold text-ink-900'
                        }
                      >
                        {isCredit(transaction.direction) ? '+' : '−'}
                        {formatMoney(transaction.amountMinor, transaction.currency)}
                      </p>
                      <p className="tnum text-xs text-ink-500">
                        остаток {formatMoney(transaction.balanceAfterMinor, transaction.currency)}
                      </p>
                    </div>
                  </li>
                ))}
              </ul>
            ) : null}
          </CardBody>
        </Card>
      ) : null}

      {hasRole('MERCHANT') ? (
        <Alert tone="info" title="У вас есть роль MERCHANT">
          В разделе <Link className="underline" to="/merchant">«Мой магазин»</Link> можно создать профиль
          продавца, опубликовать товар и управлять остатками.
        </Alert>
      ) : null}
    </>
  );
}
