/**
 * Раздел «Счета, лимиты и холды».
 *
 * Что здесь есть по факту API, а не по ожиданиям:
 *  - счёт открывается ТОЛЬКО по идентификатору. Поиска по телефону в публичном API
 *    нет: внутренний `InternalAccountController.resolve(phone)` защищён внутренним
 *    токеном и из браузера недоступен, публичного пути «счета по userId» тоже нет;
 *  - `GET /api/v1/accounts` возвращает счета вошедшего (`AccountController.list` ->
 *    `listAccounts(currentUser.requireUserId())`), а не чужие, поэтому список
 *    счетов здесь не показывается: делать вид, что это админский листинг, было бы
 *    неправдой, и это прямо написано в подсказке;
 *  - снимок, выписка и холды доступны оператору: `AccountApplicationService`
 *    пускает владельца и роли ADMIN/SUPPORT (`AuthenticatedUser.canAccess`);
 *  - лимиты — только ADMIN: `AccountLimitService.requireOperator` требует `isAdmin()`,
 *    поэтому для SUPPORT форма не рисуется вовсе, а запрос лимитов не выполняется
 *    (иначе гарантированный 403 выглядел бы как поломка раздела);
 *  - ошибки идут через `ErrorAlert` БЕЗ собственного заголовка: `humanMessage`
 *    переводит код сервиса в точную русскую фразу («Счёт не найден», «Недостаточно
 *    прав для этой операции»), а какой блок упал — видно по заголовку карточки.
 */
import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { fetchAccount, fetchAccountHolds, fetchAccountTransactions } from '../../api/endpoints';
import { fieldErrorOf } from '../../api/errors';
import { formatMoney, formatSignedMoney, parseAmountInput } from '../../api/money';
import type { Account, AccountHold, AccountTransaction } from '../../api/types';
import { Alert, ErrorAlert } from '../../components/ui/Alerts';
import { AmountField } from '../../components/ui/AmountField';
import { Badge } from '../../components/ui/Badge';
import { Button, buttonClass } from '../../components/ui/Button';
import { Card, CardBody, CardFooter, CardHeader, DetailRow } from '../../components/ui/Card';
import { EmptyState } from '../../components/ui/EmptyState';
import { SelectField, TextField } from '../../components/ui/Field';
import { Pagination } from '../../components/ui/Pagination';
import { SkeletonRows } from '../../components/ui/Skeleton';
import {
  accountTypeLabel,
  directionLabel,
  formatDateTime,
  isCredit,
  operationLabel,
  roleLabel,
  shortId,
  type Tone,
} from '../../lib/format';
import {
  LIMIT_WINDOWS,
  fetchAccountLimits,
  setAccountLimit,
  type AccountLimits,
  type LimitWindow,
  type SetAccountLimitRequest,
} from '../api/accountLimits';
import type { AdminSectionProps } from '../sections';

const PAGE_SIZE = 20;

/**
 * Русские названия состояний счёта и холда.
 *
 * Общая карта в `lib/format` знает состояния платежей и товаров, но не `FROZEN`,
 * `CAPTURED` или `EXPIRED` — она вернула бы их как есть, по-английски. Оператору
 * нужен смысл, поэтому словарь локальный, а неизвестное состояние остаётся
 * исходной строкой, а не превращается в выдуманное «в порядке».
 */
const ACCOUNT_STATUS_STYLES: Record<string, { label: string; tone: Tone }> = {
  ACTIVE: { label: 'Активен', tone: 'success' },
  FROZEN: { label: 'Заморожен', tone: 'warning' },
  CLOSED: { label: 'Закрыт', tone: 'neutral' },
};

const HOLD_STATUS_STYLES: Record<string, { label: string; tone: Tone }> = {
  ACTIVE: { label: 'Активен', tone: 'warning' },
  CAPTURED: { label: 'Списан', tone: 'success' },
  RELEASED: { label: 'Разблокирован', tone: 'neutral' },
  EXPIRED: { label: 'Истёк', tone: 'neutral' },
};

const WINDOW_LABELS: Record<string, string> = {
  DAILY: 'Дневной',
  MONTHLY: 'Месячный',
};

const HOLD_STATUS_OPTIONS = [
  { value: 'ACTIVE', label: 'Активные' },
  { value: 'CAPTURED', label: 'Списанные' },
  { value: 'RELEASED', label: 'Разблокированные' },
  { value: 'EXPIRED', label: 'Истёкшие' },
];

function windowLabel(window: string): string {
  return WINDOW_LABELS[window.toUpperCase()] ?? window;
}

function styleOf(
  styles: Record<string, { label: string; tone: Tone }>,
  status: string,
): { label: string; tone: Tone } {
  return styles[status.toUpperCase()] ?? { label: status, tone: 'neutral' };
}

/** Знак движения берётся из `direction`, а сумма — как модуль: направление решает сервис. */
function signedAmount(transaction: AccountTransaction): number {
  return isCredit(transaction.direction)
    ? Math.abs(transaction.amountMinor)
    : -Math.abs(transaction.amountMinor);
}

/* -------------------------------------------------------------- снимок счёта */

function SnapshotDetails({ account }: { account: Account }) {
  const status = styleOf(ACCOUNT_STATUS_STYLES, account.status);
  return (
    <dl className="grid gap-x-10 lg:grid-cols-2">
      <DetailRow label="Владелец">{account.displayName || '—'}</DetailRow>
      <DetailRow label="Идентификатор владельца (userId)">
        {account.ownerUserId ? (
          <span className="font-mono text-xs">{account.ownerUserId}</span>
        ) : (
          '—'
        )}
      </DetailRow>
      <DetailRow label="Телефон владельца">{account.ownerPhone || '—'}</DetailRow>
      <DetailRow label="Тип счёта">{accountTypeLabel(account.type)}</DetailRow>
      <DetailRow label="Валюта">{account.currency}</DetailRow>
      <DetailRow label="Состояние">
        <Badge tone={status.tone}>{status.label}</Badge>
      </DetailRow>
      <DetailRow label="Баланс">{formatMoney(account.balanceMinor, account.currency)}</DetailRow>
      <DetailRow label="Зарезервировано (холд)">
        {formatMoney(account.heldMinor, account.currency)}
      </DetailRow>
      <DetailRow label="Доступно к списанию">
        <span className="text-base">{formatMoney(account.availableMinor, account.currency)}</span>
      </DetailRow>
      <DetailRow label="Счёт открыт">{formatDateTime(account.createdAt)}</DetailRow>
    </dl>
  );
}

/* ------------------------------------------------------------------- лимиты */

function LimitsTable({ limits }: { limits: AccountLimits }) {
  const { currency } = limits;

  return (
    <div className="space-y-4">
      {limits.limits.length === 0 ? (
        <EmptyState
          title="Сервис не вернул ни одного окна лимита"
          description="Обычно приходят два окна — дневное и месячное. Пустой ответ означает, что настроек нет вовсе, и утверждать про счёт «без ограничения» по такому ответу нельзя."
        />
      ) : (
        <div className="relative overflow-x-auto">
          <table className="w-full min-w-[860px] text-sm">
            <caption className="sr-only">Лимиты исходящих операций по окнам</caption>
            <thead>
              <tr className="border-b border-ink-200 text-left text-xs font-medium text-ink-500">
                <th scope="col" className="py-2 pr-4">
                  Окно
                </th>
                <th scope="col" className="py-2 pr-4 text-right">
                  Лимит
                </th>
                <th scope="col" className="py-2 pr-4 text-right">
                  Израсходовано в окне
                </th>
                <th scope="col" className="py-2 pr-4 text-right">
                  Остаток
                </th>
                <th scope="col" className="py-2 pr-4">
                  Окно действует до
                </th>
                <th scope="col" className="py-2">
                  Обновлён
                </th>
              </tr>
            </thead>
            <tbody>
              {limits.limits.map((entry) => (
                <tr key={entry.window} className="border-b border-ink-100 last:border-b-0">
                  <td className="py-2 pr-4 font-medium text-ink-900">{windowLabel(entry.window)}</td>
                  <td className="tnum py-2 pr-4 text-right text-ink-900">
                    {entry.outgoingLimitMinor !== null ? (
                      formatMoney(entry.outgoingLimitMinor, currency)
                    ) : entry.configured ? (
                      '—'
                    ) : (
                      <span className="text-ink-500">не задан — без ограничения</span>
                    )}
                  </td>
                  <td className="tnum py-2 pr-4 text-right text-ink-700">
                    {entry.usedMinor !== null ? formatMoney(entry.usedMinor, currency) : '—'}
                  </td>
                  <td className="tnum py-2 pr-4 text-right text-ink-700">
                    {entry.remainingMinor !== null ? formatMoney(entry.remainingMinor, currency) : '—'}
                  </td>
                  <td className="py-2 pr-4 text-ink-700">{formatDateTime(entry.windowEnd)}</td>
                  <td className="py-2 text-ink-700">{formatDateTime(entry.updatedAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {limits.velocity ? (
        <dl className="grid gap-x-10 lg:grid-cols-2">
          <DetailRow label="Скоростной контроль (антифрод)">
            {limits.velocity.enabled ? 'включён' : 'выключен'}
          </DetailRow>
          <DetailRow label="Операций в окне контроля">
            {limits.velocity.operationsInWindow !== null ? limits.velocity.operationsInWindow : '—'}
          </DetailRow>
          <DetailRow label="Предел операций">
            {limits.velocity.maxOperations !== null ? limits.velocity.maxOperations : '—'}
          </DetailRow>
          <DetailRow label="Окно контроля">
            {limits.velocity.window !== null ? (
              <span className="font-mono text-xs">{limits.velocity.window}</span>
            ) : (
              '—'
            )}
          </DetailRow>
        </dl>
      ) : null}

      <p className="text-xs text-ink-500">
        Скоростной контроль приходит только на чтение: <code>PUT</code> лимитов меняет окно и сумму
        лимита, а его настройки — нет. Формы для них здесь поэтому тоже нет, и ничего «примерного»
        вместо них не подставляется.
      </p>
    </div>
  );
}

/** Форма меняет ровно то, что умеет `PUT`: одно окно и сумму лимита. */
function LimitsForm({ accountId, currency }: { accountId: string; currency: string }) {
  const queryClient = useQueryClient();
  const [window, setWindow] = useState<LimitWindow>('DAILY');
  const [amount, setAmount] = useState('');
  const [amountError, setAmountError] = useState<string | undefined>(undefined);

  const mutation = useMutation({
    mutationFn: (body: SetAccountLimitRequest) => setAccountLimit(accountId, body),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['admin', 'accounts', accountId, 'limits'] });
    },
  });

  const applied = mutation.data?.limits.find((entry) => entry.window === mutation.variables?.window);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const parsed = parseAmountInput(amount, { label: 'лимит' });
    if (!parsed.ok) {
      setAmountError(parsed.message);
      return;
    }
    setAmountError(undefined);
    mutation.mutate({ window, outgoingLimitMinor: parsed.minor });
  }

  return (
    <form
      className="space-y-3 border-t border-ink-100 pt-4"
      // Единственное действие раздела, меняющее данные на сервере. Метка нужна
      // браузерной проверке (e2e/check-admin.mjs): она ищет [data-admin-write] и
      // требует, чтобы у роли SUPPORT такого элемента не было вовсе. Форма для
      // SUPPORT и не рендерится (`canWrite` выше), поэтому метка исчезает вместе с ней.
      data-admin-write="изменение лимитов"
      onSubmit={submit}
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <SelectField
          id="admin-limit-window"
          label="Окно лимита"
          value={window}
          error={fieldErrorOf(mutation.error, 'window')}
          onChange={(event) => {
            setWindow(event.target.value as LimitWindow);
          }}
          options={LIMIT_WINDOWS.map((value) => ({ value, label: windowLabel(value) }))}
          hint="Границы окон календарные по UTC: сутки с 00:00 и месяц с 1-го числа."
        />

        <AmountField
          id="admin-limit-amount"
          label={`Новый лимит, ${windowLabel(window).toLowerCase()}`}
          value={amount}
          currency={currency}
          disabled={mutation.isPending}
          error={amountError ?? fieldErrorOf(mutation.error, 'outgoingLimitMinor')}
          hint="Строго больше нуля: ноль сервис отвергает — «не платить ничего» это заморозка счёта, а отдельная операция со своим следом в аудите."
          onValueChange={(value) => {
            setAmount(value);
            setAmountError(undefined);
          }}
        />
      </div>

      {mutation.isError ? (
        <ErrorAlert error={mutation.error} title="Не удалось сохранить лимит" />
      ) : null}

      {mutation.isSuccess && applied ? (
        <Alert tone="success" title="Лимит применён">
          {windowLabel(applied.window)}:{' '}
          {applied.outgoingLimitMinor !== null
            ? formatMoney(applied.outgoingLimitMinor, currency)
            : '—'}{' '}
          · израсходовано{' '}
          {applied.usedMinor !== null ? formatMoney(applied.usedMinor, currency) : '—'} · остаток{' '}
          {applied.remainingMinor !== null ? formatMoney(applied.remainingMinor, currency) : '—'}.
          Это те значения, которые сервис вернул после сохранения, — именно их он применит к
          следующей исходящей операции. Понижение лимита не трогает уже зарезервированные деньги:
          оно лишь отказывает новым операциям.
        </Alert>
      ) : null}

      <Button type="submit" loading={mutation.isPending} disabled={mutation.isPending}>
        Сохранить лимит
      </Button>
    </form>
  );
}

/* -------------------------------------------------------------------- раздел */

export default function AccountsSection({ role, canWrite }: AdminSectionProps) {
  const [draftId, setDraftId] = useState('');
  const [accountId, setAccountId] = useState('');
  const [ledgerPage, setLedgerPage] = useState(0);
  const [holdsPage, setHoldsPage] = useState(0);
  const [holdsStatus, setHoldsStatus] = useState('ACTIVE');

  // Пустой идентификатор — ни одного запроса по счёту: поиск не выполняется на пустое
  // значение, поэтому `enabled` у всех четырёх запросов ниже завязан на это условие.
  const hasAccount = accountId.trim() !== '';

  const account = useQuery({
    queryKey: ['admin', 'accounts', accountId],
    queryFn: () => fetchAccount(accountId),
    enabled: hasAccount,
    staleTime: 10_000,
  });

  const ledger = useQuery({
    queryKey: ['admin', 'accounts', accountId, 'transactions', { page: ledgerPage, size: PAGE_SIZE }],
    queryFn: () => fetchAccountTransactions(accountId, { page: ledgerPage, size: PAGE_SIZE }),
    enabled: hasAccount,
    staleTime: 10_000,
  });

  const holds = useQuery({
    queryKey: ['admin', 'accounts', accountId, 'holds', { status: holdsStatus, page: holdsPage }],
    queryFn: () =>
      fetchAccountHolds(accountId, {
        status: holdsStatus === '' ? undefined : holdsStatus,
        page: holdsPage,
        size: PAGE_SIZE,
      }),
    enabled: hasAccount,
    staleTime: 10_000,
  });

  // Лимиты читает только ADMIN — у SUPPORT запрос не уходит вовсе, и это осознанно.
  const limits = useQuery({
    queryKey: ['admin', 'accounts', accountId, 'limits'],
    queryFn: () => fetchAccountLimits(accountId),
    enabled: hasAccount && canWrite,
    staleTime: 10_000,
  });

  function openAccount(raw: string) {
    const next = raw.trim();
    setAccountId(next);
    setLedgerPage(0);
    setHoldsPage(0);
  }

  return (
    <div className="space-y-5">
      <Card>
        <CardHeader
          title="Счёт по идентификатору"
          subtitle="Снимок, выписка леджера, активные резервы и лимиты одного счёта"
        />
        <CardBody>
          <form
            className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end"
            onSubmit={(event) => {
              event.preventDefault();
              openAccount(draftId);
            }}
          >
            <TextField
              id="admin-account-id"
              label="Идентификатор счёта"
              value={draftId}
              placeholder="01M3Y1AYYJGHVVY7NCZQ690MJF"
              hint="26-символьный ULID счёта, как его отдаёт account-service в поле id."
              autoComplete="off"
              spellCheck={false}
              onChange={(event) => {
                setDraftId(event.target.value);
              }}
            />
            <div className="flex flex-wrap gap-2 pb-6">
              <Button type="submit">Показать счёт</Button>
              {hasAccount ? (
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => {
                    setDraftId('');
                    openAccount('');
                  }}
                >
                  Очистить
                </Button>
              ) : null}
            </div>
          </form>

          <Alert tone="info" className="mt-4" title="Поиска счёта по телефону в API нет">
            <p>
              Внутренний путь поиска по номеру (
              <code>GET /api/v1/accounts/internal/resolve?phone=…</code>) закрыт внутренним токеном
              и из браузера недоступен; публичного пути «счета по userId владельца» в API тоже нет.
              Поэтому идентификатор вводится вручную — его видно, например, в платеже (поля
              sourceAccountId и targetAccountId), в заказе или в поездке.
            </p>
            <p className="mt-2">
              Список счетов здесь не показывается намеренно: <code>GET /api/v1/accounts</code>{' '}
              возвращает только счета вошедшего, а не чужие, — выдавать его за админский листинг
              было бы неправдой.
            </p>
            <div className="mt-2 flex flex-wrap gap-2">
              <Link
                to="/admin/payments"
                className={buttonClass({ variant: 'secondary', size: 'sm' })}
              >
                Найти счёт в платежах
              </Link>
              <Link to="/admin/orders" className={buttonClass({ variant: 'secondary', size: 'sm' })}>
                Открыть заказы
              </Link>
            </div>
          </Alert>
        </CardBody>
      </Card>

      {!hasAccount ? (
        <EmptyState
          title="Счёт не выбран"
          description="Введите идентификатор счёта — раздел запросит снимок счёта, выписку леджера, активные холды и лимиты. Пока идентификатор не введён, ни одного запроса по счёту не отправляется."
        />
      ) : (
        <>
          <Card>
            <CardHeader
              title="Снимок счёта"
              subtitle={`Счёт ${shortId(accountId, 12)}`}
              action={
                <Button
                  variant="secondary"
                  size="sm"
                  loading={account.isFetching}
                  onClick={() => void account.refetch()}
                >
                  Обновить
                </Button>
              }
            />
            <CardBody>
              {account.isPending ? <SkeletonRows count={5} /> : null}

              {account.isError ? (
                <ErrorAlert error={account.error} onRetry={() => void account.refetch()} />
              ) : null}

              {account.data ? <SnapshotDetails account={account.data} /> : null}
            </CardBody>
          </Card>

          <Card>
            <CardHeader
              title="Выписка леджера"
              subtitle="Движения по счёту, новые сверху"
              action={
                ledger.data ? (
                  <span className="text-xs text-ink-500">всего записей: {ledger.data.totalElements}</span>
                ) : null
              }
            />
            <CardBody>
              {ledger.isPending ? <SkeletonRows count={6} /> : null}

              {ledger.isError ? (
                <ErrorAlert error={ledger.error} onRetry={() => void ledger.refetch()} />
              ) : null}

              {ledger.data && ledger.data.items.length === 0 ? (
                <EmptyState
                  title="Движений по счёту нет"
                  description="Леджер этого счёта пуст: ни переводов, ни оплат, ни холдов, ни пополнений. Это ответ сервиса, а не отсутствие загрузки."
                />
              ) : null}

              {ledger.data && ledger.data.items.length > 0 ? (
                <div className="relative overflow-x-auto">
                  <table className="w-full min-w-[980px] text-sm">
                    <caption className="sr-only">Выписка леджера по счёту</caption>
                    <thead>
                      <tr className="border-b border-ink-200 text-left text-xs font-medium text-ink-500">
                        <th scope="col" className="py-2 pr-4">
                          Время
                        </th>
                        <th scope="col" className="py-2 pr-4">
                          Операция
                        </th>
                        <th scope="col" className="py-2 pr-4">
                          Направление
                        </th>
                        <th scope="col" className="py-2 pr-4 text-right">
                          Сумма
                        </th>
                        <th scope="col" className="py-2 pr-4 text-right">
                          Остаток после
                        </th>
                        <th scope="col" className="py-2">
                          Основание
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {ledger.data.items.map((transaction, index) => (
                        <tr
                          // `id` берётся из `transactionId`; если сервис его не прислал,
                          // пара «время + операция» остаётся единственным различителем строки.
                          key={
                            transaction.id !== ''
                              ? transaction.id
                              : `${transaction.createdAt}-${transaction.operation}-${index}`
                          }
                          className="border-b border-ink-100 last:border-b-0"
                        >
                          <td className="py-2 pr-4 whitespace-nowrap text-ink-700">
                            {formatDateTime(transaction.createdAt)}
                          </td>
                          <td className="py-2 pr-4 text-ink-900">
                            <span className="font-medium">{operationLabel(transaction.operation)}</span>
                            {transaction.description ? (
                              <span className="block text-xs text-ink-500">
                                {transaction.description}
                              </span>
                            ) : null}
                          </td>
                          <td className="py-2 pr-4 text-ink-700">
                            {directionLabel(transaction.direction)}
                          </td>
                          <td
                            className={
                              isCredit(transaction.direction)
                                ? 'tnum py-2 pr-4 text-right font-medium text-success-700'
                                : 'tnum py-2 pr-4 text-right font-medium text-ink-900'
                            }
                          >
                            {formatSignedMoney(signedAmount(transaction), transaction.currency)}
                          </td>
                          <td className="tnum py-2 pr-4 text-right text-ink-700">
                            {formatMoney(transaction.balanceAfterMinor, transaction.currency)}
                          </td>
                          <td className="py-2 text-ink-700">
                            {transaction.referenceType ? (
                              <span className="block">
                                {transaction.referenceType}
                                {transaction.referenceId ? (
                                  <span
                                    className="ml-1 font-mono text-xs text-ink-500"
                                    title={transaction.referenceId}
                                  >
                                    {shortId(transaction.referenceId, 10)}
                                  </span>
                                ) : null}
                              </span>
                            ) : (
                              '—'
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : null}
            </CardBody>

            {ledger.data ? (
              <CardFooter>
                <Pagination
                  page={ledger.data.page}
                  totalPages={ledger.data.totalPages}
                  hasNext={ledger.data.hasNext}
                  totalElements={ledger.data.totalElements}
                  isFetching={ledger.isFetching}
                  onPageChange={setLedgerPage}
                />
              </CardFooter>
            ) : null}
          </Card>

          <Card>
            <CardHeader
              title="Резервы средств (холды)"
              subtitle="Деньги под операциями в процессе: они уже недоступны для списания, даже если ещё не списаны"
              action={
                <div className="w-48">
                  <SelectField
                    id="admin-holds-status"
                    label="Состояние"
                    value={holdsStatus}
                    options={HOLD_STATUS_OPTIONS}
                    placeholder="Все состояния"
                    onChange={(event) => {
                      setHoldsStatus(event.target.value);
                      setHoldsPage(0);
                    }}
                  />
                </div>
              }
            />
            <CardBody>
              {holds.isPending ? <SkeletonRows count={4} /> : null}

              {holds.isError ? (
                <ErrorAlert error={holds.error} onRetry={() => void holds.refetch()} />
              ) : null}

              {holds.data && holds.data.items.length === 0 ? (
                <EmptyState
                  title={
                    holdsStatus === ''
                      ? 'Резервов у счёта нет'
                      : `Резервов в состоянии «${styleOf(HOLD_STATUS_STYLES, holdsStatus).label.toLowerCase()}» нет`
                  }
                  description="Резерв появляется, когда сервис держит деньги под операцией в процессе: поездкой, оплатой заказа или переводом. Пустой список — это ответ сервиса."
                />
              ) : null}

              {holds.data && holds.data.items.length > 0 ? (
                <div className="relative overflow-x-auto">
                  <table className="w-full min-w-[940px] text-sm">
                    <caption className="sr-only">Резервы средств по счёту</caption>
                    <thead>
                      <tr className="border-b border-ink-200 text-left text-xs font-medium text-ink-500">
                        <th scope="col" className="py-2 pr-4">
                          Что держит деньги
                        </th>
                        <th scope="col" className="py-2 pr-4">
                          Причина
                        </th>
                        <th scope="col" className="py-2 pr-4 text-right">
                          Сумма
                        </th>
                        <th scope="col" className="py-2 pr-4">
                          Состояние
                        </th>
                        <th scope="col" className="py-2 pr-4">
                          Создан
                        </th>
                        <th scope="col" className="py-2">
                          Действует до
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {holds.data.items.map((hold: AccountHold) => {
                        const status = styleOf(HOLD_STATUS_STYLES, hold.status);
                        return (
                          <tr
                            key={hold.holdId !== '' ? hold.holdId : `${hold.createdAt}-${hold.amountMinor}`}
                            className="border-b border-ink-100 last:border-b-0"
                          >
                            <td className="py-2 pr-4 text-ink-900">
                              {hold.referenceType ? (
                                <span className="block">
                                  {hold.referenceType}
                                  {hold.referenceId ? (
                                    <span
                                      className="ml-1 font-mono text-xs text-ink-500"
                                      title={hold.referenceId}
                                    >
                                      {shortId(hold.referenceId, 10)}
                                    </span>
                                  ) : null}
                                </span>
                              ) : (
                                <span className="text-ink-500">ссылка не указана</span>
                              )}
                            </td>
                            <td className="py-2 pr-4 text-ink-700">{hold.reason || '—'}</td>
                            <td className="tnum py-2 pr-4 text-right font-medium text-ink-900">
                              {formatMoney(hold.amountMinor, hold.currency)}
                            </td>
                            <td className="py-2 pr-4">
                              <Badge tone={status.tone}>{status.label}</Badge>
                            </td>
                            <td className="py-2 pr-4 whitespace-nowrap text-ink-700">
                              {formatDateTime(hold.createdAt)}
                            </td>
                            <td className="py-2 whitespace-nowrap text-ink-700">
                              {formatDateTime(hold.expiresAt)}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              ) : null}
            </CardBody>

            {holds.data ? (
              <CardFooter>
                <Pagination
                  page={holds.data.page}
                  totalPages={holds.data.totalPages}
                  hasNext={holds.data.hasNext}
                  totalElements={holds.data.totalElements}
                  isFetching={holds.isFetching}
                  onPageChange={setHoldsPage}
                />
              </CardFooter>
            ) : null}
          </Card>

          <Card>
            <CardHeader
              title="Лимиты"
              subtitle="Потолок исходящих операций за календарные сутки и месяц, а также скоростной контроль антифрода"
            />
            <CardBody>
              {!canWrite ? (
                <Alert tone="info" title="Изменение лимитов доступно роли ADMIN">
                  Лимиты — данные антифрода, и account-service закрывает их для всех, кроме
                  оператора: проверка роли живёт в самом сервисе, а не в интерфейсе. Поэтому у роли{' '}
                  {roleLabel(role)} не показываются ни таблица лимитов, ни форма, а запрос к{' '}
                  <code>/limits</code> не отправляется вовсе — вместо гарантированного 403 здесь
                  честное объяснение. Даже чтение лимитов требует роли ADMIN, а не только их
                  изменение.
                </Alert>
              ) : (
                <>
                  {limits.isPending ? <SkeletonRows count={3} /> : null}

                  {limits.isError ? (
                    <ErrorAlert error={limits.error} onRetry={() => void limits.refetch()} />
                  ) : null}

                  {limits.data ? <LimitsTable limits={limits.data} /> : null}

                  {limits.data ? (
                    <LimitsForm
                      key={accountId}
                      accountId={accountId}
                      currency={limits.data.currency || account.data?.currency || 'KZT'}
                    />
                  ) : null}
                </>
              )}
            </CardBody>
          </Card>
        </>
      )}
    </div>
  );
}
