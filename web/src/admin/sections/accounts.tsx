/**
 * Раздел «Счета, лимиты и холды».
 *
 * Экран собран как рабочее место, а не как одна таблица на весь рост: сверху тулбар с
 * поиском счёта и действиями, под ним плитки с числами, дальше две колонки — слева
 * подсказка «как найти счёт», карточка счёта (владелец, статус, крупный баланс, поля) и
 * лимиты, справа выписка леджера с рейлом срезов и диаграммой по операциям, ниже —
 * активные резервы.
 *
 * Блоки берутся из общего набора `../kit`: плитка, панель, рейл, полосы, тулбар. Свои
 * плитки и полосы здесь не рисуются — иначе раздел выглядел бы как отдельный продукт.
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
 *    прав для этой операции»), а какой блок упал — видно по заголовку панели.
 *
 * Плитки рисуются всегда, в том числе до выбора счёта: не выбранный счёт — это «—», а не
 * ноль. Ноль здесь читался бы как «на счёте пусто», и это была бы неправда.
 *
 * Метки `data-admin-kpi` и `data-admin-panel` — не украшение: их считает браузерная
 * проверка `e2e/check-admin.mjs` по числам из `sections.ts` (там обещано 4 плитки и
 * 4 блока). Здесь их больше — проверка требует «не меньше», а лишние блоки означают,
 * что на экране есть что читать, а не только одна таблица.
 */
import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { fetchAccount, fetchAccountHolds, fetchAccountTransactions } from '../../api/endpoints';
import { fieldErrorOf } from '../../api/errors';
import {
  formatMoney,
  formatSignedMoney,
  parseAmountInput,
  sumMinor,
  toMajorString,
} from '../../api/money';
import type { Account, AccountHold, AccountTransaction } from '../../api/types';
import { Alert, ErrorAlert } from '../../components/ui/Alerts';
import { AmountField } from '../../components/ui/AmountField';
import { Badge } from '../../components/ui/Badge';
import { Button, buttonClass } from '../../components/ui/Button';
import { DetailRow } from '../../components/ui/Card';
import { CopyButton } from '../../components/ui/CopyButton';
import { EmptyState } from '../../components/ui/EmptyState';
import { SelectField, TextField } from '../../components/ui/Field';
import { Pagination } from '../../components/ui/Pagination';
import { SkeletonRows } from '../../components/ui/Skeleton';
import { cx } from '../../lib/cx';
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
import { BarList, KpiTile, Panel, StatusRail, Toolbar, type KitTone } from '../kit';
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
 * Опрос счёта, выписки и резервов раз в 15 секунд.
 *
 * Оператор смотрит на живой счёт: холд появляется и снимается на глазах, и цифра
 * «доступно к списанию» без обновления врёт уже через минуту. Интервал сознательно не
 * секундный: аккаунт-сервис не обязан держать нагрузку диспетчерской карты.
 */
const REFRESH_MS = 15_000;

/** Русские названия состояний счёта и холда. */
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

/**
 * Срез выписки для рейла.
 *
 * «Холды» — это не направление, а операция: блокировка средств (`HOLD`) и разблокировка
 * (`RELEASE`) идут дебетом, поэтому строка холда попадает и в «Списания», и в «Холды».
 * Считать это ошибкой нельзя, но и молчать об этом нельзя — про пересечение написано
 * прямо под рейлом.
 */
type LedgerSlice = '' | 'CREDIT' | 'DEBIT' | 'HOLD';

/** Тона полос диаграммы: те же, что у плиток и бейджей, чтобы экран читался одинаково. */
const OPERATION_TONES: KitTone[] = ['brand', 'success', 'warning', 'info', 'neutral'];

const CLOCK_FORMAT = new Intl.DateTimeFormat('ru-KZ', {
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
});

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

function directionTone(direction: string): Tone {
  return isCredit(direction) ? 'success' : 'info';
}

/** Попадает ли строка выписки в выбранный срез рейла. */
function inSlice(transaction: AccountTransaction, slice: LedgerSlice): boolean {
  if (slice === '') {
    return true;
  }
  const operation = transaction.operation.toUpperCase();
  if (slice === 'HOLD') {
    return operation === 'HOLD' || operation === 'RELEASE';
  }
  return transaction.direction.toUpperCase() === slice;
}

function countInSlice(items: readonly AccountTransaction[], slice: LedgerSlice): number {
  return items.filter((item) => inSlice(item, slice)).length;
}

/**
 * Время последнего ответа сервиса — с секундами.
 *
 * `formatDateTime` округляет до минуты, а по нему не видно, идёт ли опрос вообще: ответ
 * минуту назад и ответ только что выглядят одинаково. Секунды здесь — признак живости.
 */
function clockOf(updatedAt: number): string {
  return updatedAt > 0 ? CLOCK_FORMAT.format(new Date(updatedAt)) : '—';
}

/** «1 запись», «2 записи», «5 записей» — счётчик должен читаться как речь. */
function records(count: number): string {
  const mod10 = count % 10;
  const mod100 = count % 100;
  if (mod10 === 1 && mod100 !== 11) {
    return `${count} запись`;
  }
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) {
    return `${count} записи`;
  }
  return `${count} записей`;
}

/** Доля израсходованного лимита в процентах. Считается по минорным единицам как есть. */
function usedPercent(usedMinor: number | null, limitMinor: number | null): number | null {
  if (usedMinor === null || limitMinor === null || limitMinor <= 0) {
    return null;
  }
  return Math.min(100, Math.round((usedMinor / limitMinor) * 100));
}

/**
 * CSV загруженной выписки.
 *
 * Разделитель — точка с запятой, а суммы — десятичные строки из `toMajorString`: файл
 * открывают в русском Excel, где запятая уже занята дробной частью. Разделитель строк
 * CRLF — иначе Excel соберёт всё в одну строку.
 */
function ledgerCsv(items: readonly AccountTransaction[]): string {
  const header = [
    'время',
    'операция',
    'направление',
    'сумма',
    'валюта',
    'остаток после',
    'основание',
    'описание',
  ];
  const quote = (cell: string) => (/[";\r\n]/.test(cell) ? `"${cell.replace(/"/g, '""')}"` : cell);
  const rows = items.map((item) => [
    item.createdAt,
    operationLabel(item.operation),
    directionLabel(item.direction),
    toMajorString(signedAmount(item)),
    item.currency,
    toMajorString(item.balanceAfterMinor),
    item.referenceType ? `${item.referenceType} ${item.referenceId ?? ''}`.trim() : '',
    item.description ?? '',
  ]);
  return [header, ...rows].map((cells) => cells.map(quote).join(';')).join('\r\n');
}

/* ------------------------------------------------------- мелкие детали разметки */

/** Путь API в тексте подсказки: моноширинный, чтобы не путался с обычной речью. */
function Endpoint({ children }: { children: ReactNode }) {
  return (
    <code className="rounded bg-ink-100 px-1 py-0.5 font-mono text-xs break-all text-ink-700">
      {children}
    </code>
  );
}

/** Ячейка шапки таблицы: липнет к верху области прокрутки, чтобы заголовки не уезжали. */
function Th({
  children,
  align = 'left',
  className,
}: {
  children: ReactNode;
  align?: 'left' | 'right';
  className?: string;
}) {
  return (
    <th
      scope="col"
      className={cx(
        'sticky top-0 z-10 border-b border-ink-200 bg-white py-2 pr-4 text-xs font-medium text-ink-500',
        align === 'right' && 'text-right',
        className,
      )}
    >
      {children}
    </th>
  );
}

/* ----------------------------------------------------- карточка счёта и снимок */

/** Крупное число снимка: баланс и доступное к списанию читают первыми. */
function BigNumber({ label, value, note }: { label: string; value: ReactNode; note: ReactNode }) {
  return (
    <div className="min-w-0 rounded-xl border border-ink-100 bg-ink-50 p-3">
      <p className="text-xs font-medium tracking-wide text-ink-500 uppercase">{label}</p>
      <p className="tnum mt-1 text-2xl font-semibold break-words text-ink-900">{value}</p>
      <p className="mt-0.5 text-xs text-ink-500">{note}</p>
    </div>
  );
}

/**
 * Карточка счёта: имя владельца и состояние в заголовке панели, крупный баланс, сетка полей.
 *
 * Суммы печатаются только через `formatMoney`: API отдаёт минорные единицы, и любая
 * арифметика с ними здесь была бы делением денег на 100 в уме.
 */
function AccountCard({ account }: { account: Account }) {
  const status = styleOf(ACCOUNT_STATUS_STYLES, account.status);

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <BigNumber
          label="Баланс"
          value={formatMoney(account.balanceMinor, account.currency)}
          note="все деньги счёта, включая зарезервированные"
        />
        <BigNumber
          label="Доступно к списанию"
          value={formatMoney(account.availableMinor, account.currency)}
          note={`баланс минус резерв ${formatMoney(account.heldMinor, account.currency)}`}
        />
      </div>

      <dl className="grid gap-x-8 sm:grid-cols-2">
        <DetailRow label="Владелец">{account.displayName || '—'}</DetailRow>
        <DetailRow label="Телефон владельца">{account.ownerPhone || '—'}</DetailRow>
        <DetailRow label="Идентификатор владельца (userId)">
          {account.ownerUserId ? (
            <span className="inline-flex min-w-0 items-center gap-1">
              <span className="font-mono text-xs break-all">{account.ownerUserId}</span>
              <CopyButton value={account.ownerUserId} label="копировать" />
            </span>
          ) : (
            '—'
          )}
        </DetailRow>
        <DetailRow label="Идентификатор счёта">
          <span className="inline-flex min-w-0 items-center gap-1">
            <span className="font-mono text-xs break-all">{account.id}</span>
            <CopyButton value={account.id} label="копировать" />
          </span>
        </DetailRow>
        <DetailRow label="Тип счёта">{accountTypeLabel(account.type)}</DetailRow>
        <DetailRow label="Валюта">{account.currency}</DetailRow>
        <DetailRow label="Состояние">
          <Badge tone={status.tone}>{status.label}</Badge>
        </DetailRow>
        <DetailRow label="Зарезервировано (холд)">
          {formatMoney(account.heldMinor, account.currency)}
        </DetailRow>
        <DetailRow label="Счёт открыт">{formatDateTime(account.createdAt)}</DetailRow>
      </dl>
    </div>
  );
}

/* ------------------------------------------------------------------- лимиты */

/**
 * Полоса использования лимита.
 *
 * Библиотека для графика здесь не нужна: это одна полоска шириной в процент. Цвет
 * меняется по остатку, но не заменяет число — процент и остаток написаны рядом, потому
 * что «красная полоска» сама по себе ничего не сообщает тому, кто её не различает.
 */
function UsageBar({
  usedMinor,
  limitMinor,
  remainingMinor,
  currency,
  label,
}: {
  usedMinor: number | null;
  limitMinor: number | null;
  remainingMinor: number | null;
  currency: string;
  label: string;
}) {
  const percent = usedPercent(usedMinor, limitMinor);
  if (percent === null) {
    return <span className="text-xs text-ink-400">—</span>;
  }
  const barTone = percent >= 90 ? 'bg-brand-500' : percent >= 70 ? 'bg-warning-500' : 'bg-success-500';

  return (
    <div className="min-w-[8rem] space-y-1">
      <div
        className="h-1.5 w-full overflow-hidden rounded-full bg-ink-100"
        role="img"
        aria-label={`${label}: израсходовано ${percent} %, остаток ${
          remainingMinor !== null ? formatMoney(remainingMinor, currency) : 'неизвестен'
        }`}
      >
        <div className={cx('h-full rounded-full', barTone)} style={{ width: `${percent}%` }} />
      </div>
      <span className="tnum block text-xs text-ink-500">
        {percent} % · остаток {remainingMinor !== null ? formatMoney(remainingMinor, currency) : '—'}
      </span>
    </div>
  );
}

function LimitsTable({ limits }: { limits: AccountLimits }) {
  const { currency } = limits;

  if (limits.limits.length === 0) {
    return (
      <EmptyState
        icon="📉"
        title="Сервис не вернул ни одного окна лимита"
        description="Обычно приходят два окна — дневное и месячное. Пустой ответ означает, что настроек нет вовсе, и утверждать про счёт «без ограничения» по такому ответу нельзя."
      />
    );
  }

  return (
    <div className="relative overflow-x-auto">
      <table className="w-full min-w-[34rem] text-sm">
        <caption className="sr-only">Лимиты исходящих операций по окнам</caption>
        <thead>
          <tr>
            <Th>Окно</Th>
            <Th align="right">Лимит</Th>
            <Th align="right">Израсходовано</Th>
            <Th align="right">Остаток</Th>
            <Th>Использование</Th>
          </tr>
        </thead>
        <tbody>
          {limits.limits.map((entry) => (
            <tr key={entry.window} className="border-b border-ink-100 last:border-b-0">
              <td className="py-2 pr-4 align-top">
                <span className="block font-medium text-ink-900">{windowLabel(entry.window)}</span>
                <span className="block text-xs text-ink-500">
                  до {formatDateTime(entry.windowEnd)} · обновлён {formatDateTime(entry.updatedAt)}
                </span>
              </td>
              <td className="tnum py-2 pr-4 text-right align-top text-ink-900">
                {entry.outgoingLimitMinor !== null ? (
                  formatMoney(entry.outgoingLimitMinor, currency)
                ) : entry.configured ? (
                  '—'
                ) : (
                  <span className="text-ink-500">не задан — без ограничения</span>
                )}
              </td>
              <td className="tnum py-2 pr-4 text-right align-top text-ink-700">
                {entry.usedMinor !== null ? formatMoney(entry.usedMinor, currency) : '—'}
              </td>
              <td className="tnum py-2 pr-4 text-right align-top text-ink-700">
                {entry.remainingMinor !== null ? formatMoney(entry.remainingMinor, currency) : '—'}
              </td>
              <td className="py-2 align-top">
                <UsageBar
                  usedMinor={entry.usedMinor}
                  limitMinor={entry.outgoingLimitMinor}
                  remainingMinor={entry.remainingMinor}
                  currency={currency}
                  label={windowLabel(entry.window)}
                />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Скоростной контроль: только чтение, `PUT` лимитов его не меняет. */
function VelocityBlock({
  velocity,
  currency,
}: {
  velocity: NonNullable<AccountLimits['velocity']>;
  currency: string;
}) {
  return (
    <div className="rounded-xl border border-ink-100 bg-ink-50 p-3">
      <p className="flex flex-wrap items-center gap-2 text-sm font-medium text-ink-900">
        Скоростной контроль (антифрод)
        <Badge tone={velocity.enabled ? 'success' : 'neutral'}>
          {velocity.enabled ? 'включён' : 'выключен'}
        </Badge>
      </p>
      <dl className="mt-2 grid gap-x-6 sm:grid-cols-2">
        <DetailRow label="Операций в окне">
          {velocity.operationsInWindow !== null ? (
            <span className="tnum">{velocity.operationsInWindow}</span>
          ) : (
            '—'
          )}
        </DetailRow>
        <DetailRow label="Предел операций">
          {velocity.maxOperations !== null ? <span className="tnum">{velocity.maxOperations}</span> : '—'}
        </DetailRow>
        <DetailRow label="Окно контроля">
          {velocity.window !== null ? <span className="font-mono text-xs">{velocity.window}</span> : '—'}
        </DetailRow>
        <DetailRow label="Валюта лимитов">{currency}</DetailRow>
      </dl>
      <p className="mt-2 text-xs text-ink-500">
        Эти значения приходят только на чтение: <Endpoint>PUT /accounts/&#123;id&#125;/limits</Endpoint>{' '}
        меняет окно и сумму лимита, а настройки скоростного контроля — нет. Формы для них поэтому тоже
        нет, и ничего «примерного» вместо них не подставляется.
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
      // Инвалидируем ровно два ключа этого счёта: таблицу лимитов и снимок счёта.
      // `exact` — чтобы не тянуть заодно выписку и холды: `PUT` их не меняет.
      void queryClient.invalidateQueries({
        queryKey: ['admin', 'accounts', accountId, 'limits'],
        exact: true,
      });
      void queryClient.invalidateQueries({ queryKey: ['admin', 'accounts', accountId], exact: true });
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

/* ------------------------------------------------- выписка: диаграмма и экспорт */

/**
 * Диаграмма по операциям выписки — полосками из общего набора, без библиотек.
 *
 * Длина полосы — число операций этого вида, а сумма стоит рядом текстом через
 * `formatMoney`. Так сделано намеренно: набор печатает числа как есть, а деньги в
 * минорных единицах нельзя показывать сырым числом — «434800» не читается как деньги.
 * Суммы берутся по модулю: складывать списания с поступлениями в одну долю нельзя.
 */
function OperationBars({ items, currency }: { items: readonly AccountTransaction[]; currency: string }) {
  const rows = useMemo(() => {
    const groups = new Map<string, { count: number; totalMinor: number }>();
    for (const item of items) {
      const label = operationLabel(item.operation);
      const current = groups.get(label) ?? { count: 0, totalMinor: 0 };
      groups.set(label, {
        count: current.count + 1,
        totalMinor: sumMinor([current.totalMinor, Math.abs(item.amountMinor)]),
      });
    }
    return [...groups.entries()]
      .sort((left, right) => right[1].totalMinor - left[1].totalMinor)
      .slice(0, 6)
      .map(([label, group], index) => ({
        key: label,
        label,
        value: group.count,
        hint: formatMoney(group.totalMinor, currency),
        tone: OPERATION_TONES[index % OPERATION_TONES.length] ?? 'neutral',
      }));
  }, [items, currency]);

  const totalMinor = useMemo(() => sumMinor(items.map((item) => Math.abs(item.amountMinor))), [items]);

  if (items.length === 0) {
    return (
      <EmptyState
        icon="📊"
        title="Считать нечего"
        description="На загруженной странице нет движений, поэтому и диаграмма пуста. Это не ошибка загрузки, а пустой ответ сервиса."
      />
    );
  }

  return (
    <div className="rounded-xl border border-ink-100 bg-ink-50 p-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-sm font-medium text-ink-900">Оборот по операциям</p>
        <p className="tnum text-xs text-ink-500">
          всего {formatMoney(totalMinor, currency)} · {records(items.length)}
        </p>
      </div>

      <BarList items={rows} empty="На загруженной странице нет движений." />

      <p className="mt-2 text-xs text-ink-500">
        По загруженной странице: полоса — сколько операций этого вида, сумма рядом — по модулю,
        групп не больше шести. За весь счёт диаграмма не строится: у{' '}
        <Endpoint>/transactions</Endpoint> нет итогов по операциям, и складывать их из одной
        страницы было бы неправдой.
      </p>
    </div>
  );
}

/**
 * «Экспорт» = скопировать CSV загруженной выписки.
 *
 * Скачивание файла здесь было бы враньём про объём: на руках только текущая страница,
 * поэтому копируется ровно она, и подпись говорит, сколько строк ушло.
 */
function ExportLedgerButton({
  items,
  disabled,
}: {
  items: readonly AccountTransaction[];
  disabled: boolean;
}) {
  const [state, setState] = useState<'idle' | 'copied' | 'failed'>('idle');

  useEffect(() => {
    if (state === 'idle') {
      return;
    }
    const timer = window.setTimeout(() => setState('idle'), 2_500);
    return () => window.clearTimeout(timer);
  }, [state]);

  const label =
    state === 'copied'
      ? `Скопировано (${records(items.length)})`
      : state === 'failed'
        ? 'Копирование недоступно'
        : 'Экспорт';

  return (
    <Button
      variant="secondary"
      size="sm"
      disabled={disabled}
      title="Скопировать CSV загруженной выписки"
      // Имя кнопки начинается с её видимой подписи: на него опираются и скринридер,
      // и голосовое управление, которому иначе нечем нажать «Экспорт».
      aria-label="Экспорт: скопировать CSV загруженной выписки"
      onClick={() => {
        void (async () => {
          try {
            // В небезопасном контексте (и в jsdom) `navigator.clipboard` отсутствует:
            // это честно показывается словами, а не молчаливым «ничего не произошло».
            await navigator.clipboard.writeText(ledgerCsv(items));
            setState('copied');
          } catch {
            setState('failed');
          }
        })();
      }}
    >
      {label}
    </Button>
  );
}

/* -------------------------------------------------------------------- раздел */

export default function AccountsSection({ role, canWrite }: AdminSectionProps) {
  const [draftId, setDraftId] = useState('');
  const [accountId, setAccountId] = useState('');
  const [ledgerPage, setLedgerPage] = useState(0);
  const [ledgerSlice, setLedgerSlice] = useState<LedgerSlice>('');
  const [holdsPage, setHoldsPage] = useState(0);
  const [holdsStatus, setHoldsStatus] = useState('ACTIVE');
  const [filtersOpen, setFiltersOpen] = useState(false);

  // Пустой идентификатор — ни одного запроса по счёту: поиск не выполняется на пустое
  // значение, поэтому `enabled` у всех запросов ниже завязан на это условие.
  const hasAccount = accountId.trim() !== '';

  const account = useQuery({
    queryKey: ['admin', 'accounts', accountId],
    queryFn: () => fetchAccount(accountId),
    enabled: hasAccount,
    staleTime: REFRESH_MS,
    refetchInterval: REFRESH_MS,
  });

  const ledger = useQuery({
    queryKey: ['admin', 'accounts', accountId, 'transactions', { page: ledgerPage, size: PAGE_SIZE }],
    queryFn: () => fetchAccountTransactions(accountId, { page: ledgerPage, size: PAGE_SIZE }),
    enabled: hasAccount,
    staleTime: REFRESH_MS,
    refetchInterval: REFRESH_MS,
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
    staleTime: REFRESH_MS,
    refetchInterval: REFRESH_MS,
  });

  // Отдельный маленький запрос ради одной плитки: сколько у счёта активных резервов.
  // Без него пришлось бы либо показывать число из текущей страницы (это неправда про
  // счёт целиком), либо врать нулём. `size: 1` — нужен только `totalElements`.
  const activeHolds = useQuery({
    queryKey: ['admin', 'accounts', accountId, 'holds', 'active-count'],
    queryFn: () => fetchAccountHolds(accountId, { status: 'ACTIVE', page: 0, size: 1 }),
    enabled: hasAccount,
    staleTime: REFRESH_MS,
    refetchInterval: REFRESH_MS,
  });

  // Лимиты читает только ADMIN — у SUPPORT запрос не уходит вовсе, и это осознанно.
  const limits = useQuery({
    queryKey: ['admin', 'accounts', accountId, 'limits'],
    queryFn: () => fetchAccountLimits(accountId),
    enabled: hasAccount && canWrite,
    staleTime: 10_000,
  });

  const currency = account.data?.currency ?? limits.data?.currency ?? 'KZT';
  const ledgerItemsAll = ledger.data?.items ?? [];

  // Срез — по уже загруженной странице: у `/transactions` нет параметра направления,
  // и делать вид, что он есть, нельзя. Про это прямо написано под рейлом.
  const ledgerItems = useMemo(
    () => ledgerItemsAll.filter((item) => inSlice(item, ledgerSlice)),
    [ledgerItemsAll, ledgerSlice],
  );

  function openAccount(raw: string) {
    const next = raw.trim();
    setAccountId(next);
    setLedgerPage(0);
    setLedgerSlice('');
    setHoldsPage(0);
  }

  /** Обновить всё, что относится к открытому счёту: тулбар делает это одной кнопкой. */
  function refreshAll() {
    void account.refetch();
    void ledger.refetch();
    void holds.refetch();
    void activeHolds.refetch();
    if (canWrite) {
      void limits.refetch();
    }
  }

  const anyFetching =
    account.isFetching || ledger.isFetching || holds.isFetching || activeHolds.isFetching;

  const accountCaption = !hasAccount
    ? 'счёт не выбран'
    : account.isError
      ? 'снимок счёта не получен'
      : `ответ снимка ${clockOf(account.dataUpdatedAt)}`;

  const activeFilters = [ledgerSlice !== '', holdsStatus !== 'ACTIVE'].filter(Boolean).length;

  return (
    <div className="space-y-4">
      {/* 1. Тулбар раздела: поиск слева, действия справа — как в обычной админке. */}
      <Toolbar
        right={
          <>
            <Badge tone="neutral">
              {hasAccount
                ? `записей в выписке: ${ledger.data ? ledger.data.totalElements : '—'}`
                : 'счёт не выбран'}
            </Badge>
            <Button
              variant="secondary"
              size="sm"
              loading={anyFetching}
              disabled={!hasAccount}
              onClick={refreshAll}
            >
              Обновить
            </Button>
            <Button
              variant="secondary"
              size="sm"
              aria-expanded={filtersOpen}
              aria-controls="admin-account-filters"
              onClick={() => setFiltersOpen((open) => !open)}
            >
              Фильтр{activeFilters > 0 ? ` · ${activeFilters}` : ''}
            </Button>
            <ExportLedgerButton items={ledgerItems} disabled={ledgerItems.length === 0} />
          </>
        }
      >
        <form
          className="flex min-w-0 flex-1 flex-wrap items-end gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            openAccount(draftId);
          }}
        >
          <div className="min-w-[16rem] flex-1">
            <TextField
              id="admin-account-id"
              label="Идентификатор счёта"
              value={draftId}
              placeholder="01M3Y1AYYJGHVVY7NCZQ690MJF"
              autoComplete="off"
              spellCheck={false}
              onChange={(event) => {
                setDraftId(event.target.value);
              }}
            />
          </div>
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
        </form>
      </Toolbar>

      {filtersOpen ? (
        <Panel
          title="Фильтры раздела"
          subtitle="Те же фильтры есть в своих блоках: здесь они собраны в одном месте"
          bodyClassName="grid gap-3 sm:grid-cols-2"
        >
          <SelectField
            id="admin-filter-direction"
            label="Направление в выписке"
            value={ledgerSlice}
            options={[
              { value: '', label: 'Все движения' },
              { value: 'CREDIT', label: 'Поступления' },
              { value: 'DEBIT', label: 'Списания' },
              { value: 'HOLD', label: 'Холды (HOLD и RELEASE)' },
            ]}
            hint="Срез по загруженной странице: серверного фильтра направления у /transactions нет."
            onChange={(event) => {
              setLedgerSlice(event.target.value as LedgerSlice);
              setLedgerPage(0);
            }}
          />
          <SelectField
            id="admin-filter-holds-status"
            label="Состояние резервов"
            value={holdsStatus}
            options={HOLD_STATUS_OPTIONS}
            placeholder="Все состояния"
            hint="Этот фильтр уходит в сервис параметром status — он же выбирается в блоке резервов."
            onChange={(event) => {
              setHoldsStatus(event.target.value);
              setHoldsPage(0);
            }}
          />
        </Panel>
      ) : null}

      {/* 2. Плитки: считает браузерная проверка, и они же — быстрый ответ «что на счёте». */}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiTile
          label="Баланс"
          icon="💰"
          tone="success"
          loading={hasAccount && account.isPending}
          value={account.data ? formatMoney(account.data.balanceMinor, currency) : '—'}
          caption={accountCaption}
        />
        <KpiTile
          label="Зарезервировано (холды)"
          icon="🔒"
          tone="warning"
          loading={hasAccount && account.isPending}
          value={account.data ? formatMoney(account.data.heldMinor, currency) : '—'}
          caption="деньги под операциями в процессе"
        />
        <KpiTile
          label="Доступно к списанию"
          icon="✅"
          tone="info"
          loading={hasAccount && account.isPending}
          value={account.data ? formatMoney(account.data.availableMinor, currency) : '—'}
          caption="баланс минус зарезервированное"
        />
        <KpiTile
          label="Операций в выписке"
          icon="🧾"
          loading={hasAccount && ledger.isPending}
          value={ledger.data ? String(ledger.data.totalElements) : '—'}
          caption={ledger.isError ? 'выписка не получена' : 'totalElements леджера, а не страницы'}
        />
        <KpiTile
          label="Активных холдов"
          icon="⏳"
          tone="warning"
          loading={hasAccount && activeHolds.isPending}
          value={activeHolds.data ? String(activeHolds.data.totalElements) : '—'}
          caption={
            activeHolds.isError
              ? 'ответа по активным холдам нет'
              : 'отдельный запрос /holds?status=ACTIVE'
          }
        />
        <KpiTile
          label="Состояние счёта"
          icon="🩺"
          tone="neutral"
          value={
            account.data ? (
              <Badge tone={styleOf(ACCOUNT_STATUS_STYLES, account.data.status).tone}>
                {styleOf(ACCOUNT_STATUS_STYLES, account.data.status).label}
              </Badge>
            ) : (
              '—'
            )
          }
          caption="как его отдаёт account-service"
        />
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,26rem)_minmax(0,1fr)]">
        {/* Левая колонка: как найти счёт, карточка счёта и лимиты. */}
        <div className="min-w-0 space-y-4">
          <Panel
            title="Поиска счёта по телефону в API нет"
            subtitle="Идентификатор вводится вручную — и вот откуда его взять"
            bodyClassName="space-y-3 text-xs text-ink-600"
          >
            <p>
              Внутренний путь поиска по номеру (
              <Endpoint>GET /api/v1/accounts/internal/resolve?phone=…</Endpoint>) закрыт
              внутренним токеном и из браузера недоступен; публичного пути «счета по userId
              владельца» в API тоже нет. Идентификатор видно в платеже (поля sourceAccountId и
              targetAccountId), в заказе или в поездке.
            </p>
            <p>
              Список счетов здесь не показывается намеренно:{' '}
              <Endpoint>GET /api/v1/accounts</Endpoint> возвращает только счета вошедшего, а не
              чужие, — выдавать его за админский листинг было бы неправдой.
            </p>
            <div className="flex flex-wrap gap-2">
              <Link to="/admin/payments" className={buttonClass({ variant: 'secondary', size: 'sm' })}>
                Найти счёт в платежах
              </Link>
              <Link to="/admin/orders" className={buttonClass({ variant: 'secondary', size: 'sm' })}>
                Открыть заказы
              </Link>
            </div>
          </Panel>

          <Panel
            title={
              hasAccount && account.data ? (
                <span className="inline-flex flex-wrap items-center gap-2">
                  {account.data.displayName || 'Владелец не указан'}
                  <Badge tone={styleOf(ACCOUNT_STATUS_STYLES, account.data.status).tone}>
                    {styleOf(ACCOUNT_STATUS_STYLES, account.data.status).label}
                  </Badge>
                </span>
              ) : (
                'Карточка счёта'
              )
            }
            subtitle={
              hasAccount
                ? `Счёт ${shortId(accountId, 12)} · обновляется каждые 15 с · ответ ${clockOf(account.dataUpdatedAt)}`
                : 'Владелец, состояние, баланс и реквизиты счёта'
            }
            action={
              <Button
                variant="secondary"
                size="sm"
                loading={account.isFetching}
                disabled={!hasAccount}
                onClick={() => void account.refetch()}
              >
                Обновить
              </Button>
            }
          >
            {!hasAccount ? (
              <EmptyState
                icon="🔎"
                title="Счёт не выбран"
                description="Введите идентификатор счёта выше — раздел запросит снимок, выписку, резервы и лимиты. Пока идентификатор пуст, ни одного запроса по счёту не уходит."
              />
            ) : null}

            {hasAccount && account.isPending ? <SkeletonRows count={4} /> : null}

            {hasAccount && account.isError ? (
              <ErrorAlert error={account.error} onRetry={() => void account.refetch()} />
            ) : null}

            {hasAccount && account.data ? <AccountCard account={account.data} /> : null}
          </Panel>

          <Panel
            title="Лимиты"
            subtitle="Потолок исходящих операций за календарные сутки и месяц и скоростной контроль антифрода"
            action={
              canWrite ? (
                <Button
                  variant="secondary"
                  size="sm"
                  loading={limits.isFetching}
                  disabled={!hasAccount}
                  onClick={() => void limits.refetch()}
                >
                  Обновить
                </Button>
              ) : undefined
            }
          >
            {!canWrite ? (
              <Alert tone="info" title="Изменение лимитов доступно роли ADMIN">
                Лимиты — данные антифрода, и account-service закрывает их для всех, кроме оператора:
                проверка роли живёт в самом сервисе, а не в интерфейсе. Поэтому у роли {roleLabel(role)}{' '}
                не показываются ни таблица лимитов, ни форма, а запрос к <Endpoint>/limits</Endpoint> не
                отправляется вовсе — вместо гарантированного 403 здесь честное объяснение. Даже чтение
                лимитов требует роли ADMIN.
              </Alert>
            ) : (
              <div className="space-y-4">
                {!hasAccount ? (
                  <EmptyState
                    icon="🚦"
                    title="Лимиты читаются по счёту"
                    description="Выберите счёт — здесь появятся окна DAILY и MONTHLY с расходом, остатком и полосой использования, а под ними форма изменения лимита."
                  />
                ) : null}

                {hasAccount && limits.isPending ? <SkeletonRows count={3} /> : null}

                {hasAccount && limits.isError ? (
                  <ErrorAlert error={limits.error} onRetry={() => void limits.refetch()} />
                ) : null}

                {hasAccount && limits.data ? (
                  <>
                    <LimitsTable limits={limits.data} />

                    {limits.data.velocity ? (
                      <VelocityBlock
                        velocity={limits.data.velocity}
                        currency={limits.data.currency}
                      />
                    ) : null}

                    <LimitsForm
                      key={accountId}
                      accountId={accountId}
                      currency={limits.data.currency || account.data?.currency || 'KZT'}
                    />
                  </>
                ) : null}
              </div>
            )}
          </Panel>
        </div>

        {/* Правая колонка: выписка леджера с рейлом и диаграммой, затем резервы. */}
        <div className="min-w-0 space-y-4">
          <Panel
            title="Выписка леджера"
            subtitle={
              hasAccount
                ? `Движения по счёту, новые сверху · опрос каждые 15 с · ответ ${clockOf(ledger.dataUpdatedAt)}`
                : 'Движения по счёту, новые сверху'
            }
            action={
              <Button
                variant="secondary"
                size="sm"
                loading={ledger.isFetching}
                disabled={!hasAccount}
                onClick={() => void ledger.refetch()}
              >
                Обновить
              </Button>
            }
          >
            {!hasAccount ? (
              <EmptyState
                icon="📄"
                title="Выписки пока нет"
                description="Выписка запрашивается по идентификатору счёта: раздел не угадывает счёт по роли или сессии. Введите идентификатор — здесь появятся движения леджера."
              />
            ) : null}

            {hasAccount && ledger.isPending ? <SkeletonRows count={6} /> : null}

            {hasAccount && ledger.isError ? (
              <ErrorAlert error={ledger.error} onRetry={() => void ledger.refetch()} />
            ) : null}

            {hasAccount && ledger.data && ledgerItemsAll.length === 0 ? (
              <EmptyState
                icon="📄"
                title="Движений по счёту нет"
                description="Леджер этого счёта пуст: ни переводов, ни оплат, ни холдов, ни пополнений. Это ответ сервиса, а не отсутствие загрузки."
              />
            ) : null}

            {hasAccount && ledger.data && ledgerItemsAll.length > 0 ? (
              <div className="flex flex-col gap-4 lg:flex-row">
                <div className="shrink-0 lg:w-48">
                  <StatusRail
                    items={[
                      { value: 'CREDIT', label: 'Поступления', count: countInSlice(ledgerItemsAll, 'CREDIT') },
                      { value: 'DEBIT', label: 'Списания', count: countInSlice(ledgerItemsAll, 'DEBIT') },
                      { value: 'HOLD', label: 'Холды', count: countInSlice(ledgerItemsAll, 'HOLD') },
                    ]}
                    active={ledgerSlice}
                    allLabel="Все движения"
                    allCount={ledgerItemsAll.length}
                    ariaLabel="Срез выписки"
                    onSelect={(value) => {
                      setLedgerSlice(value as LedgerSlice);
                      setLedgerPage(0);
                    }}
                  />
                  <p className="mt-2 text-xs text-ink-500">
                    Числа в рейле — по загруженной странице: серверного фильтра направления у{' '}
                    <Endpoint>/transactions</Endpoint> нет. Холды пересекаются со списаниями:
                    блокировка средств идёт дебетом.
                  </p>
                </div>

                <div className="min-w-0 flex-1 space-y-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="text-sm font-medium text-ink-900">Движения страницы</p>
                    <Badge tone="neutral">
                      {ledgerSlice === ''
                        ? `на странице ${ledgerItemsAll.length}`
                        : `подходит ${ledgerItems.length} из ${ledgerItemsAll.length}`}
                    </Badge>
                  </div>

                  <OperationBars items={ledgerItems} currency={currency} />

                  {ledgerItems.length === 0 ? (
                    <EmptyState
                      icon="🔍"
                      title="В этом срезе ничего нет"
                      description="На загруженной странице нет строк с выбранным срезом. Срез не ходит на сервер: он смотрит только на уже полученные записи, поэтому снимите его или перейдите на другую страницу."
                    />
                  ) : (
                    // Таблицу оборачиваем ровно в `relative overflow-x-auto`: этой
                    // разметки требует проверка вёрстки. Прокрутку по вертикали держит
                    // вложенный блок — поэтому шапка липнет к его верху, а не к границе
                    // всей таблицы, и заголовки не уезжают на длинной выписке.
                    <div className="relative overflow-x-auto">
                      <div className="max-h-[65vh] overflow-y-auto">
                        <table className="w-full min-w-[52rem] text-sm">
                          <caption className="sr-only">Выписка леджера по счёту</caption>
                          <thead>
                            <tr>
                              <Th>Время</Th>
                              <Th>Операция</Th>
                              <Th>Направление</Th>
                              <Th align="right">Сумма</Th>
                              <Th align="right">Остаток после</Th>
                              <Th>Основание</Th>
                            </tr>
                          </thead>
                          <tbody>
                            {ledgerItems.map((transaction, index) => (
                              <tr
                                // `id` берётся из `transactionId`; если сервис его не прислал,
                                // пара «время + операция» — единственный различитель строки.
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
                                  <span className="font-medium">
                                    {operationLabel(transaction.operation)}
                                  </span>
                                  {transaction.description ? (
                                    <span className="block text-xs text-ink-500">
                                      {transaction.description}
                                    </span>
                                  ) : null}
                                </td>
                                <td className="py-2 pr-4">
                                  <Badge tone={directionTone(transaction.direction)}>
                                    {directionLabel(transaction.direction)}
                                  </Badge>
                                </td>
                                <td
                                  className={
                                    isCredit(transaction.direction)
                                      ? 'tnum py-2 pr-4 text-right font-medium whitespace-nowrap text-success-700'
                                      : 'tnum py-2 pr-4 text-right font-medium whitespace-nowrap text-ink-900'
                                  }
                                >
                                  {formatSignedMoney(signedAmount(transaction), transaction.currency)}
                                </td>
                                <td className="tnum py-2 pr-4 text-right whitespace-nowrap text-ink-700">
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
                                    <span className="text-ink-500">—</span>
                                  )}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            ) : null}

            {hasAccount && ledger.data ? (
              <div className="mt-3 flex flex-col gap-1 border-t border-ink-100 pt-3 sm:flex-row sm:items-center sm:justify-between">
                <p className="text-xs text-ink-500">
                  Всего записей в леджере: <span className="tnum">{ledger.data.totalElements}</span> · на
                  странице <span className="tnum">{ledgerItemsAll.length}</span> · размер страницы{' '}
                  {PAGE_SIZE}
                </p>
                <Pagination
                  className="pt-0"
                  page={ledger.data.page}
                  totalPages={ledger.data.totalPages}
                  hasNext={ledger.data.hasNext}
                  totalElements={ledger.data.totalElements}
                  isFetching={ledger.isFetching}
                  onPageChange={setLedgerPage}
                />
              </div>
            ) : null}
          </Panel>

          <Panel
            title="Резервы средств (холды)"
            subtitle="Деньги под операциями в процессе: они уже недоступны для списания, даже если ещё не списаны"
            action={
              <Button
                variant="secondary"
                size="sm"
                loading={holds.isFetching}
                disabled={!hasAccount}
                onClick={() => void holds.refetch()}
              >
                Обновить
              </Button>
            }
            bodyClassName="space-y-3"
          >
            {!hasAccount ? (
              <EmptyState
                icon="🧊"
                title="Резервов пока нет"
                description="Резервы запрашиваются по идентификатору счёта: сервис не отдаёт список холдов по всем счетам сразу. Введите идентификатор — здесь появятся деньги, занятые операциями в процессе."
              />
            ) : null}

            {hasAccount ? (
              <>
                <div className="flex flex-wrap items-end justify-between gap-3">
                  <div className="w-full sm:w-56">
                    <SelectField
                      id="admin-holds-status"
                      label="Состояние резерва"
                      value={holdsStatus}
                      options={HOLD_STATUS_OPTIONS}
                      placeholder="Все состояния"
                      hint="Фильтр уходит в сервис параметром status."
                      onChange={(event) => {
                        setHoldsStatus(event.target.value);
                        setHoldsPage(0);
                      }}
                    />
                  </div>
                  <Badge tone="neutral">
                    {holds.data
                      ? `на странице ${holds.data.items.length} · всего ${holds.data.totalElements}`
                      : 'считаем…'}
                  </Badge>
                </div>

                <p className="text-xs text-ink-500">
                  Имени держателя сервис не отдаёт: в ответе <Endpoint>/holds</Endpoint> есть только
                  сумма, состояние, причина, ссылка на операцию и время. Поэтому колонки «кто держит»
                  здесь нет — вместо неё ссылка на то, что эти деньги заняло.
                </p>
              </>
            ) : null}

            {hasAccount && holds.isPending ? <SkeletonRows count={4} /> : null}

            {hasAccount && holds.isError ? (
              <ErrorAlert error={holds.error} onRetry={() => void holds.refetch()} />
            ) : null}

            {hasAccount && holds.data && holds.data.items.length === 0 ? (
              <EmptyState
                icon="🧊"
                title={
                  holdsStatus === ''
                    ? 'Резервов у счёта нет'
                    : `Резервов в состоянии «${styleOf(HOLD_STATUS_STYLES, holdsStatus).label.toLowerCase()}» нет`
                }
                description="Резерв появляется, когда сервис держит деньги под операцией в процессе: поездкой, оплатой заказа или переводом. Пустой список — это ответ сервиса."
              />
            ) : null}

            {hasAccount && holds.data && holds.data.items.length > 0 ? (
              <div className="relative overflow-x-auto">
                <div className="max-h-[65vh] overflow-y-auto">
                  <table className="w-full min-w-[50rem] text-sm">
                    <caption className="sr-only">Резервы средств по счёту</caption>
                    <thead>
                      <tr>
                        <Th>Состояние</Th>
                        <Th align="right">Сумма</Th>
                        <Th>Что держит деньги</Th>
                        <Th>Причина</Th>
                        <Th>Создан</Th>
                        <Th>Действует до</Th>
                      </tr>
                    </thead>
                    <tbody>
                      {holds.data.items.map((hold: AccountHold) => {
                        const status = styleOf(HOLD_STATUS_STYLES, hold.status);
                        return (
                          <tr
                            key={
                              hold.holdId !== ''
                                ? hold.holdId
                                : `${hold.createdAt}-${hold.amountMinor}`
                            }
                            className="border-b border-ink-100 last:border-b-0"
                          >
                            <td className="py-2 pr-4">
                              <Badge tone={status.tone}>{status.label}</Badge>
                            </td>
                            <td className="tnum py-2 pr-4 text-right font-medium whitespace-nowrap text-ink-900">
                              {formatMoney(hold.amountMinor, hold.currency)}
                            </td>
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
                              {hold.holdId ? (
                                <span
                                  className="block font-mono text-xs text-ink-400"
                                  title={hold.holdId}
                                >
                                  холд {shortId(hold.holdId, 10)}
                                </span>
                              ) : null}
                            </td>
                            <td className="py-2 pr-4 text-ink-700">{hold.reason || '—'}</td>
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
              </div>
            ) : null}

            {hasAccount && holds.data && holds.data.totalPages > 1 ? (
              <div className="border-t border-ink-100 pt-3">
                <Pagination
                  className="pt-0"
                  page={holds.data.page}
                  totalPages={holds.data.totalPages}
                  hasNext={holds.data.hasNext}
                  totalElements={holds.data.totalElements}
                  isFetching={holds.isFetching}
                  onPageChange={setHoldsPage}
                />
              </div>
            ) : null}
          </Panel>
        </div>
      </div>
    </div>
  );
}
