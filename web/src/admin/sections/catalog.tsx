/**
 * Раздел админ-панели «Магазины, товары и сток».
 *
 * Раздел собран вокруг реального support-API каталога
 * (`services/catalog-service/.../api/SupportCatalogController.java`):
 *  - `GET /api/v1/support/merchants/{id}` — магазин по идентификатору;
 *  - `GET /api/v1/support/merchants/by-owner/{userId}` — магазин по владельцу;
 *  - `GET /api/v1/support/merchants/{id}/products` — товары магазина, черновики
 *    включены, архивные по флагу;
 *  - `GET /api/v1/support/products/{id}` — товар с вердиктом «покупаемо/нет»;
 *  - `GET /api/v1/support/products/{id}/stock` — остатки и держащие их резервы;
 *  - `GET /api/v1/support/reservations/{orderId}` — резервы стока по заказу.
 *
 * Все шесть — GET: раздел только читает, и кнопок изменения в нём нет ни у ADMIN,
 * ни у SUPPORT. Массового поиска магазинов и товаров в API нет, поэтому поиск здесь
 * точечный (по идентификатору), и об этом честно написано в панели «Чего в API нет».
 *
 * Раздел разложен по секциям, а не одной длинной колонкой: тулбар с числами
 * найденного и переходом к секции, плитки, три рабочие панели поиска (магазин, товар,
 * резервы), панель остатков и панель товаров магазина с пагинацией. Все формы поиска
 * видны одновременно — прятать их за вкладкой значит заставлять оператора угадывать,
 * где искать. Блоки берутся из общего набора `admin/kit`, поэтому раздел выглядит так
 * же, как соседние разделы панели.
 *
 * Плитки посчитаны по реальным ответам каталога: «—» там, где запрос ещё не уходил,
 * потому что ноль означал бы утверждение о данных, которого сервис не делал.
 * Кнопка «CSV» выгружает в буфер обмена уже загруженные строки товаров: это действие
 * браузера, а не запись на сервере.
 */
import { useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { isApiError } from '../../api/errors';
import { formatMoney } from '../../api/money';
import type { Page } from '../../api/types';
import { Alert, ErrorAlert } from '../../components/ui/Alerts';
import { Badge, StatusBadge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { DetailRow } from '../../components/ui/Card';
import { CopyButton } from '../../components/ui/CopyButton';
import { EmptyState } from '../../components/ui/EmptyState';
import { CheckboxField, SelectField, TextField, type SelectOption } from '../../components/ui/Field';
import { Pagination } from '../../components/ui/Pagination';
import { SkeletonRows } from '../../components/ui/Skeleton';
import { cx } from '../../lib/cx';
import { formatDateTime, roleLabel } from '../../lib/format';
import { KpiTile, Panel, Toolbar } from '../kit';
import type { AdminSectionProps } from '../sections';
import {
  fetchSupportMerchant,
  fetchSupportMerchantByOwner,
  fetchSupportMerchantProducts,
  fetchSupportProduct,
  fetchSupportReservations,
  fetchSupportStock,
  type SupportMerchant,
  type SupportProduct,
  type SupportReservation,
  type SupportStock,
} from '../api/supportCatalog';

const PAGE_SIZE = 10;

type MerchantSearchMode = 'id' | 'owner';

/** Что именно ввёл оператор: id магазина или id его владельца. */
function merchantKindLabel(mode: MerchantSearchMode): string {
  return mode === 'owner' ? 'идентификатор владельца (userId)' : 'идентификатор магазина';
}

const MERCHANT_MODE_OPTIONS: SelectOption[] = [
  { value: 'id', label: 'По идентификатору магазина' },
  { value: 'owner', label: 'По владельцу (userId)' },
];

/** Секции раздела: на них ведут ссылки в тулбаре, все они видны одновременно. */
const CATALOG_SECTIONS: Array<{ id: string; label: string }> = [
  { id: 'catalog-merchant', label: 'Магазин' },
  { id: 'catalog-product', label: 'Товар' },
  { id: 'catalog-reservations', label: 'Резервы по заказу' },
  { id: 'catalog-stock', label: 'Остатки' },
  { id: 'catalog-products', label: 'Товары магазина' },
];

function isNotFound(error: unknown): boolean {
  return isApiError(error) && error.isNotFound;
}

/**
 * Путь эндпоинта внутри текста: моноширинно и без обратных кавычек, которые
 * иначе попадали бы на экран как есть.
 */
function Endpoint({ children }: { children: ReactNode }) {
  return <code className="font-mono text-xs">{children}</code>;
}

/** Иконка плитки: набор блоков даёт цветной квадрат 40×40, сюда приходит только знак. */
function Icon({ children }: { children: ReactNode }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-5 w-5"
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

/**
 * Ошибка запроса: подпись говорит, что именно не получилось, а `ErrorAlert` — почему.
 *
 * Свой `title` в `ErrorAlert` не передаём намеренно: без него заголовком становится
 * `humanMessage(error)`, то есть перевод кода сервиса, а не только серверный `detail`.
 */
function RequestError({
  label,
  error,
  onRetry,
}: {
  label: string;
  error: unknown;
  onRetry: () => void;
}) {
  return (
    <div className="space-y-2">
      <p className="text-sm font-medium text-ink-700">{label}</p>
      <ErrorAlert error={error} onRetry={onRetry} />
    </div>
  );
}

/** Рейтинг приходит в базисных пунктах (`480` = 4,8); сервис отдаёт 0, пока оценок нет. */
function ratingText(ratingBasisPoints: number | null | undefined): string {
  if (ratingBasisPoints === null || ratingBasisPoints === undefined) {
    return '—';
  }
  if (ratingBasisPoints === 0) {
    return 'оценок нет (сервис вернул 0)';
  }
  return `${(ratingBasisPoints / 100).toFixed(1).replace('.', ',')} из 5 (${ratingBasisPoints} bp)`;
}

/**
 * Кнопка «CSV»: выгружает уже загруженные строки в буфер обмена.
 *
 * Это действие над данными в браузере, а не изменение на сервере: у ручек раздела
 * нет ни одной мутации. Поэтому пометки `data-admin-write` здесь нет и быть не должно.
 */
function CsvButton({ rows, name }: { rows: string[][]; name: string }) {
  const [state, setState] = useState<'idle' | 'ok' | 'fail'>('idle');

  useEffect(() => {
    if (state === 'idle') {
      return;
    }
    const timer = window.setTimeout(() => setState('idle'), 2_000);
    return () => window.clearTimeout(timer);
  }, [state]);

  const copy = async () => {
    const csv = rows
      .map((row) => row.map((cell) => `"${cell.replace(/"/g, '""')}"`).join(';'))
      .join('\r\n');
    try {
      await navigator.clipboard.writeText(csv);
      setState('ok');
    } catch {
      // Буфер обмена недоступен (небезопасный контекст, отказ в правах) — так и говорим.
      setState('fail');
    }
  };

  return (
    <Button
      variant="secondary"
      size="sm"
      // Одна строка — это только заголовок CSV: выгружать нечего.
      disabled={rows.length <= 1}
      title={`Скопировать CSV загруженных строк: ${name}`}
      onClick={() => void copy()}
    >
      <span aria-live="polite">
        {state === 'ok' ? 'CSV скопирован' : state === 'fail' ? 'CSV недоступен' : 'CSV'}
      </span>
    </Button>
  );
}

/* --------------------------------------------------------------- поиск по id */

interface IdSearch {
  value: string;
  setValue: (value: string) => void;
  /** Идентификатор, по которому реально ушёл запрос; `null` — запроса не было. */
  submitted: string | null;
  /** Отправить поиск. Без аргумента берёт текущее значение поля. */
  submit: (id?: string) => void;
}

/**
 * Состояние точечного поиска.
 *
 * Запрос уходит только по кнопке: искать по «M», «M-1», «M-10» на каждый нажатый
 * символ — это три запроса и три 404, а пустое поле не должно ходить на сервер
 * вообще (правило `enabled: Boolean(id)`).
 */
function useIdSearch(initial = ''): IdSearch {
  const [value, setValue] = useState(initial);
  const [submitted, setSubmitted] = useState<string | null>(null);

  return {
    value,
    setValue,
    submitted,
    submit: (id?: string) => {
      const next = (id ?? value).trim();
      setSubmitted(next === '' ? null : next);
    },
  };
}

/**
 * Что панели нужно знать о своём запросе.
 *
 * Отдельный флаг `loading` нужен потому, что у выключенного запроса (`enabled: false`,
 * пустое поле поиска) `isPending` тоже `true` — скелетон на пустой форме врал бы.
 */
interface QueryView<T> {
  data: T | undefined;
  loading: boolean;
  fetching: boolean;
  error: unknown;
  refetch: () => void;
}

function toView<T>(
  query: Pick<UseQueryResult<T, Error>, 'data' | 'isPending' | 'isFetching' | 'isError' | 'error' | 'refetch'>,
  requested = true,
): QueryView<T> {
  return {
    data: query.data,
    loading: requested && query.isPending,
    fetching: query.isFetching,
    error: query.isError ? query.error : null,
    refetch: () => void query.refetch(),
  };
}

/** Общая для панелей форма поиска: одна подпись, одна кнопка, запрос только по нажатию. */
function SearchBar({
  idPrefix,
  value,
  onValueChange,
  onSubmit,
  label,
  placeholder,
  hint,
  submitLabel,
  mode,
  modeOptions,
  onModeChange,
}: {
  idPrefix: string;
  value: string;
  onValueChange: (value: string) => void;
  onSubmit: () => void;
  label: string;
  placeholder: string;
  hint?: string;
  submitLabel: string;
  mode?: string;
  modeOptions?: SelectOption[];
  onModeChange?: (mode: string) => void;
}) {
  const withMode = Boolean(modeOptions && onModeChange);

  return (
    <form
      className={cx('grid gap-3', withMode ? 'sm:grid-cols-2' : 'sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end')}
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit();
      }}
    >
      {withMode && modeOptions && onModeChange ? (
        <SelectField
          id={`${idPrefix}-mode`}
          label="Что ищем"
          value={mode ?? modeOptions[0]?.value ?? ''}
          options={modeOptions}
          onChange={(event) => onModeChange(event.target.value)}
        />
      ) : null}
      <TextField
        id={`${idPrefix}-value`}
        label={label}
        placeholder={placeholder}
        hint={hint}
        value={value}
        onChange={(event) => onValueChange(event.target.value)}
      />
      <div className={cx(withMode && 'sm:col-span-2')}>
        <Button type="submit" block>
          {submitLabel}
        </Button>
      </div>
    </form>
  );
}

/* ------------------------------------------------------------ карточка магазина */

function MerchantCard({ merchant }: { merchant: SupportMerchant }) {
  return (
    <div className="rounded-card border border-ink-200 p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-base font-semibold text-ink-900">{merchant.displayName ?? merchant.name}</p>
          {merchant.displayName && merchant.displayName !== merchant.name ? (
            <p className="text-sm text-ink-500">Юридическое имя: {merchant.name}</p>
          ) : null}
          <p className="mt-0.5 flex items-center gap-1 font-mono text-xs text-ink-500">
            {merchant.id}
            <CopyButton value={merchant.id} />
          </p>
        </div>
        {merchant.status ? <StatusBadge status={merchant.status} /> : null}
      </div>

      <dl className="mt-3 grid gap-x-6 sm:grid-cols-2">
        <DetailRow label="Владелец">
          {merchant.ownerUserId ? (
            <span className="inline-flex items-center gap-1 font-mono text-xs">
              {merchant.ownerUserId}
              <CopyButton value={merchant.ownerUserId} />
            </span>
          ) : (
            '—'
          )}
        </DetailRow>
        <DetailRow label="Город">{merchant.city ?? '—'}</DetailRow>
        <DetailRow label="Телефон">{merchant.phone ?? '—'}</DetailRow>
        <DetailRow label="Почта">{merchant.email ?? '—'}</DetailRow>
        <DetailRow label="Счёт выплат">
          {merchant.payoutAccountId ? (
            <span className="font-mono text-xs">{merchant.payoutAccountId}</span>
          ) : (
            '—'
          )}
        </DetailRow>
        <DetailRow label="Товаров у магазина">
          {merchant.productCount === null ? '—' : String(merchant.productCount)}
        </DetailRow>
        <DetailRow label="Рейтинг">{ratingText(merchant.ratingBasisPoints)}</DetailRow>
        <DetailRow label="Создан">{formatDateTime(merchant.createdAt)}</DetailRow>
      </dl>
    </div>
  );
}

/* --------------------------------------------------------------- резервы */

/** Резервы строкой-карточкой: узкая колонка не терпит семиколоночную таблицу. */
function ReservationList({ reservations }: { reservations: SupportReservation[] }) {
  return (
    <ul className="divide-y divide-ink-100">
      {reservations.map((reservation) => (
        <li key={reservation.id} className="py-2">
          <div className="flex items-start justify-between gap-2">
            <span className="min-w-0">
              <span className="block font-mono text-xs text-ink-600">{reservation.id}</span>
              <span className="block text-xs text-ink-500">
                заказ <span className="font-mono">{reservation.orderId || '—'}</span> · товар{' '}
                <span className="font-mono">{reservation.productId || '—'}</span>
              </span>
            </span>
            <span className="shrink-0 text-right">
              <StatusBadge status={reservation.status} />
              <span className="tnum mt-0.5 block text-xs text-ink-700">× {reservation.quantity}</span>
            </span>
          </div>
          <p className="tnum mt-1 text-xs text-ink-500">
            создан {formatDateTime(reservation.createdAt)} · истекает {formatDateTime(reservation.expiresAt)}
          </p>
        </li>
      ))}
    </ul>
  );
}

/* ------------------------------------------------------- панель «Магазин» */

function MerchantPanel({
  mode,
  onModeChange,
  search,
  onSubmit,
  view,
}: {
  mode: MerchantSearchMode;
  onModeChange: (mode: MerchantSearchMode) => void;
  search: IdSearch;
  onSubmit: () => void;
  view: QueryView<SupportMerchant>;
}) {
  return (
    <Panel
      id="catalog-merchant"
      title="Магазин"
      subtitle="Точечное чтение: id магазина или id его владельца. Списка всех магазинов в support-API нет."
      className="h-full"
      bodyClassName="space-y-4"
    >
      <SearchBar
        idPrefix="catalog-merchant"
        label={merchantKindLabel(mode)}
        placeholder={mode === 'owner' ? 'U-1001' : '01M3MERCHANT…'}
        hint="Запрос уходит по кнопке, а не на каждый символ."
        submitLabel="Найти магазин"
        value={search.value}
        onValueChange={search.setValue}
        onSubmit={onSubmit}
        mode={mode}
        modeOptions={MERCHANT_MODE_OPTIONS}
        onModeChange={(value) => onModeChange(value === 'owner' ? 'owner' : 'id')}
      />

      {search.submitted === null ? (
        <EmptyState
          title="Магазин не выбран"
          description="Введите идентификатор магазина или его владельца и нажмите «Найти магазин». Пустое поле запрос не отправляет: без идентификатора искать нечего."
        />
      ) : null}

      {view.loading ? <SkeletonRows count={3} /> : null}

      {view.error !== null && !view.loading ? (
        isNotFound(view.error) ? (
          <EmptyState
            title={mode === 'owner' ? 'Магазин у этого владельца не найден' : 'Магазин не найден'}
            description={`Сервис каталога ответил 404 MERCHANT_NOT_FOUND: магазина с таким ${merchantKindLabel(mode)} «${search.submitted}» нет.`}
          />
        ) : (
          <RequestError label="Не удалось получить магазин" error={view.error} onRetry={view.refetch} />
        )
      ) : null}

      {view.data ? <MerchantCard merchant={view.data} /> : null}
    </Panel>
  );
}

/* --------------------------------------------------------- панель «Товар» */

/** Ответ сервиса: покупаемо ли, и если нет — почему. Показываем ровно то, что пришло. */
function VerdictBlock({ product }: { product: SupportProduct }) {
  if (product.buyable) {
    return (
      <Alert tone="success" title="Товар можно купить">
        Статус допускает продажу, и доступное количество больше нуля.
      </Alert>
    );
  }

  return (
    <Alert tone="warning" title="Товар нельзя купить">
      Сервис вернул <Endpoint>buyable = false</Endpoint>
      {product.archived ? ' (товар в архиве)' : ''}
      {product.sellable ? '' : ' (этот статус продавать нельзя)'}.
      {product.unavailableReason ? ` Причина от сервиса: ${product.unavailableReason}.` : ''}
    </Alert>
  );
}

/** Три вердикта сервиса словами: «да»/«нет» честнее, чем отсутствие строки. */
function VerdictBadges({ product }: { product: SupportProduct }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Badge tone={product.sellable ? 'success' : 'neutral'}>{`sellable: ${product.sellable ? 'да' : 'нет'}`}</Badge>
      <Badge tone={product.archived ? 'warning' : 'neutral'}>{`archived: ${product.archived ? 'да' : 'нет'}`}</Badge>
      <Badge tone={product.buyable ? 'success' : 'danger'}>{`buyable: ${product.buyable ? 'да' : 'нет'}`}</Badge>
    </div>
  );
}

function ProductCard({ product }: { product: SupportProduct }) {
  const countersMissing =
    product.onHand === undefined && product.reserved === undefined && product.available === undefined;

  return (
    <div className="rounded-card border border-ink-200 p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-base font-semibold text-ink-900">{product.title}</p>
          <p className="text-sm text-ink-500">{product.merchantName}</p>
        </div>
        <StatusBadge status={product.status} />
      </div>

      <div className="mt-3">
        <VerdictBadges product={product} />
      </div>

      <div className="mt-3">
        <VerdictBlock product={product} />
      </div>

      <dl className="mt-3 grid gap-x-6 sm:grid-cols-2">
        <DetailRow label="Товар">
          <span className="inline-flex items-center gap-1 font-mono text-xs">
            {product.id}
            <CopyButton value={product.id} />
          </span>
        </DetailRow>
        <DetailRow label="Магазин">
          <span className="inline-flex items-center gap-1 font-mono text-xs">
            {product.merchantId}
            <CopyButton value={product.merchantId} />
          </span>
        </DetailRow>
        <DetailRow label="Артикул">{product.sku ?? '—'}</DetailRow>
        <DetailRow label="Категория">{product.category ?? '—'}</DetailRow>
        <DetailRow label="Бренд">{product.brand ?? '—'}</DetailRow>
        <DetailRow label="Цена">
          <span className="tnum">{formatMoney(product.priceMinor, product.currency)}</span>
        </DetailRow>
        <DetailRow label="Счётчики из карточки товара">
          <span className="tnum">
            {countersMissing
              ? '—'
              : `${product.onHand ?? '—'} / ${product.reserved ?? '—'} / ${product.available ?? '—'}`}
          </span>
        </DetailRow>
        <DetailRow label="Причина отказа">{product.unavailableReason ?? '—'}</DetailRow>
      </dl>

      {product.description ? <p className="mt-2 text-sm text-ink-600">{product.description}</p> : null}
    </div>
  );
}

function ProductPanel({ search, view }: { search: IdSearch; view: QueryView<SupportProduct> }) {
  return (
    <Panel
      id="catalog-product"
      title="Товар"
      subtitle="Поиск по идентификатору товара: массового поиска товаров в support-API нет."
      className="h-full"
      bodyClassName="space-y-4"
    >
      <SearchBar
        idPrefix="catalog-product"
        label="Идентификатор товара"
        placeholder="01M3PRODUCT…"
        hint="Можно вставить id из списка товаров магазина ниже."
        submitLabel="Найти товар"
        value={search.value}
        onValueChange={search.setValue}
        onSubmit={() => search.submit()}
      />

      {search.submitted === null ? (
        <EmptyState
          title="Товар не выбран"
          description="Введите идентификатор товара или откройте его из списка товаров магазина."
        />
      ) : null}

      {view.loading ? <SkeletonRows count={3} /> : null}

      {view.error !== null && !view.loading ? (
        isNotFound(view.error) ? (
          <EmptyState
            title="Товар не найден"
            description={`Сервис каталога ответил 404 PRODUCT_NOT_FOUND: товара «${search.submitted}» нет. Архивный товар сервис при этом отдаёт — значит, его действительно нет.`}
          />
        ) : (
          <RequestError label="Не удалось получить товар" error={view.error} onRetry={view.refetch} />
        )
      ) : null}

      {view.data ? <ProductCard product={view.data} /> : null}
    </Panel>
  );
}

/* -------------------------------------------------- панель «Резервы по заказу» */

function ReservationsPanel({ search, view }: { search: IdSearch; view: QueryView<SupportReservation[]> }) {
  const reservations = view.data ?? [];

  return (
    <Panel
      id="catalog-reservations"
      title="Резервы по заказу"
      subtitle={
        <>
          <Endpoint>GET /api/v1/support/reservations/{'{orderId}'}</Endpoint> — что именно держит единицы этого
          чекаута
        </>
      }
      className="h-full"
      bodyClassName="space-y-4"
    >
      <SearchBar
        idPrefix="catalog-reservations"
        label="Идентификатор заказа"
        placeholder="01M3ORDER…"
        hint="Поиск по orderId: у эндпоинта нет фильтров."
        submitLabel="Показать резервы"
        value={search.value}
        onValueChange={search.setValue}
        onSubmit={() => search.submit()}
      />

      {search.submitted === null ? (
        <EmptyState
          title="Заказ не указан"
          description="Пустой ответ у этого эндпоинта не предусмотрен: если каталог не резервировал сток по заказу, сервис отвечает 404 RESERVATION_NOT_FOUND."
        />
      ) : null}

      {view.loading ? <SkeletonRows count={3} /> : null}

      {view.error !== null && !view.loading ? (
        isNotFound(view.error) ? (
          <EmptyState
            title="Каталог не резервировал сток по этому заказу"
            description={`Сервис ответил 404 RESERVATION_NOT_FOUND по заказу «${search.submitted}». Это не «резервов нет», а «этот сервис про такой заказ не знает»: возможно, заказ оформлен до появления резервов или id указан неверно.`}
          />
        ) : (
          <RequestError label="Не удалось получить резервы" error={view.error} onRetry={view.refetch} />
        )
      ) : null}

      {view.data && reservations.length > 0 ? <ReservationList reservations={reservations} /> : null}

      {view.data && reservations.length === 0 ? (
        <EmptyState title="Резервов нет" description="Сервис вернул пустой список резервов по этому заказу." />
      ) : null}
    </Panel>
  );
}

/* ------------------------------------------------------- панель «Остатки» */

function StockPanel({ productId, view }: { productId: string | null; view: QueryView<SupportStock> }) {
  return (
    <Panel
      id="catalog-stock"
      title="Остатки и резервы"
      subtitle={
        <>
          <Endpoint>GET /api/v1/support/products/{'{id}'}/stock</Endpoint> — счётчики и резервы, которые их
          держат
        </>
      }
      className="h-full"
    >
      {productId === null ? (
        <EmptyState
          title="Товар не выбран"
          description="Найдите товар по идентификатору — счётчики остатков и держащие их резервы приходят отдельной ручкой /stock."
        />
      ) : null}

      {productId !== null && view.loading ? <SkeletonRows count={2} /> : null}

      {productId !== null && view.error !== null && !view.loading ? (
        <RequestError label="Не удалось получить остатки товара" error={view.error} onRetry={view.refetch} />
      ) : null}

      {view.data ? (
        <>
          <dl className="grid gap-x-6 sm:grid-cols-2">
            <DetailRow label="На складе">
              <span className="tnum">{view.data.onHand}</span>
            </DetailRow>
            <DetailRow label="В резерве">
              <span className="tnum">{view.data.reserved}</span>
            </DetailRow>
            <DetailRow label="Доступно к продаже">
              <span className="tnum text-base">{view.data.available}</span>
            </DetailRow>
            <DetailRow label="Статус товара">
              <StatusBadge status={view.data.productStatus} />
            </DetailRow>
            <DetailRow label="Продаётся ли статус">
              <Badge tone={view.data.sellable ? 'success' : 'neutral'}>
                {view.data.sellable ? 'да' : 'нет'}
              </Badge>
            </DetailRow>
            <DetailRow label="Обновлено">{formatDateTime(view.data.updatedAt)}</DetailRow>
          </dl>

          {view.data.holds.length === 0 ? (
            <EmptyState
              className="mt-3"
              title="Единицы никто не держит"
              description="Сервис не вернул ни одного резерва по этому товару: счётчик «в резерве» нулевой не из-за скрытых записей."
            />
          ) : (
            <div className="mt-3">
              <p className="mb-2 text-xs text-ink-500">Последние резервы (до 20, новыми первыми)</p>
              <ReservationList reservations={view.data.holds} />
            </div>
          )}
        </>
      ) : null}
    </Panel>
  );
}

/* -------------------------------------------------- панель «Товары магазина» */

function MerchantProductsPanel({
  merchantId,
  view,
  includeArchived,
  onIncludeArchivedChange,
  onPageChange,
  onPickProduct,
}: {
  merchantId: string | null;
  view: QueryView<Page<SupportProduct>>;
  includeArchived: boolean;
  onIncludeArchivedChange: (value: boolean) => void;
  onPageChange: (page: number) => void;
  onPickProduct: (productId: string) => void;
}) {
  const data = view.data;

  // Категории берутся из самих товаров: в `SupportMerchantResponse` поля с
  // категориями нет, а придумывать его нельзя.
  const categories = useMemo(() => {
    const found = new Set<string>();
    for (const product of data?.items ?? []) {
      if (product.category) {
        found.add(product.category);
      }
    }
    return [...found].sort((a, b) => a.localeCompare(b, 'ru'));
  }, [data]);

  return (
    <Panel
      id="catalog-products"
      title="Товары магазина"
      subtitle={
        <>
          Единственный список в этом API:{' '}
          <Endpoint>GET /api/v1/support/merchants/{'{id}'}/products</Endpoint> — черновики включены, архивные
          по флагу.
        </>
      }
      action={
        <div className="w-64">
          <CheckboxField
            id="catalog-merchant-archived"
            label="Показывать архивные"
            checked={includeArchived}
            hint="По умолчанию сервис архива не отдаёт."
            onChange={(event) => onIncludeArchivedChange(event.target.checked)}
          />
        </div>
      }
      bodyClassName="space-y-3"
    >
      {merchantId === null ? (
        <EmptyState
          title="Магазин не выбран"
          description="Этот список — товары конкретного магазина: сначала найдите магазин по id или по владельцу в панели «Магазин»."
        />
      ) : null}

      {merchantId !== null && view.loading ? <SkeletonRows count={3} /> : null}

      {merchantId !== null && view.error !== null && !view.loading ? (
        <RequestError label="Не удалось загрузить товары магазина" error={view.error} onRetry={view.refetch} />
      ) : null}

      {categories.length > 0 ? (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-ink-500">Категории в этой странице товаров:</span>
          {categories.map((category) => (
            <Badge key={category} tone="neutral">
              {category}
            </Badge>
          ))}
        </div>
      ) : null}

      {data && data.items.length === 0 ? (
        <EmptyState
          title="У магазина нет товаров"
          description={
            includeArchived
              ? 'Сервис не вернул ни одного товара, включая архивные.'
              : 'Сервис не вернул ни одного товара. Возможно, все они в архиве — включите показ архивных.'
          }
        />
      ) : null}

      {data && data.items.length > 0 ? (
        <>
          <div className="relative overflow-x-auto">
            <table className="w-full min-w-[44rem] border-collapse text-sm">
              <caption className="sr-only">Товары найденного магазина</caption>
              <thead>
                <tr className="border-b border-ink-200 text-left text-xs text-ink-500 uppercase">
                  <th scope="col" className="py-2 pr-3 font-medium">Название</th>
                  <th scope="col" className="py-2 pr-3 font-medium">Артикул</th>
                  <th scope="col" className="py-2 pr-3 font-medium">Категория</th>
                  <th scope="col" className="py-2 pr-3 font-medium">Статус</th>
                  <th scope="col" className="py-2 pr-3 font-medium">Цена</th>
                  <th scope="col" className="py-2 pr-3 font-medium">Доступно</th>
                  <th scope="col" className="py-2 font-medium">Карточка</th>
                </tr>
              </thead>
              <tbody>
                {data.items.map((product) => (
                  <tr key={product.id} className="border-b border-ink-100">
                    <td className="py-2 pr-3 text-ink-900">
                      {product.title}
                      <span className="mt-1 flex flex-wrap gap-1">
                        {product.archived ? <Badge tone="warning">архив</Badge> : null}
                        {product.buyable ? null : <Badge tone="neutral">не покупается</Badge>}
                      </span>
                    </td>
                    <td className="py-2 pr-3 font-mono text-xs text-ink-600">{product.sku ?? '—'}</td>
                    <td className="py-2 pr-3 text-ink-700">{product.category ?? '—'}</td>
                    <td className="py-2 pr-3">
                      <StatusBadge status={product.status} />
                    </td>
                    <td className="tnum py-2 pr-3 whitespace-nowrap text-ink-900">
                      {formatMoney(product.priceMinor, product.currency)}
                    </td>
                    <td className="tnum py-2 pr-3 text-ink-700">
                      {product.available ?? product.availableQuantity}
                    </td>
                    <td className="py-2">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => onPickProduct(product.id)}
                        aria-label={`Открыть карточку товара ${product.title}`}
                      >
                        Открыть
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <Pagination
            page={data.page}
            totalPages={data.totalPages}
            hasNext={data.hasNext}
            totalElements={data.totalElements}
            isFetching={view.fetching}
            onPageChange={onPageChange}
          />
        </>
      ) : null}
    </Panel>
  );
}

/* ------------------------------------------------------ что не отдаётся */

function MissingPanel() {
  return (
    <Panel title="Чего в API пока нет" subtitle="Чтобы не искать в интерфейсе то, чего сервис не отдаёт.">
      <div className="space-y-2 text-sm text-ink-600">
        <p>
          <strong className="text-ink-800">Массового поиска магазинов и товаров нет.</strong> Доступны только
          точечные чтения: магазин по id или по владельцу, товар по id, сток товара и резервы заказа. Поэтому в
          разделе нет ни строки поиска «все магазины», ни таблицы всего каталога: её пришлось бы имитировать.
        </p>
        <p>
          <strong className="text-ink-800">Единственный список — товары конкретного магазина</strong> (
          <Endpoint>/support/merchants/{'{id}'}/products</Endpoint>): в нём есть черновики и, по флагу, архивные
          товары.
        </p>
        <p>
          <strong className="text-ink-800">Категорий у магазина в ответе нет.</strong> В{' '}
          <Endpoint>SupportMerchantResponse</Endpoint> такого поля нет, поэтому категории выше собраны из
          категорий загруженных товаров магазина, а не выданы сервисом как «категории магазина».
        </p>
        <p>
          <strong className="text-ink-800">Публичной ссылки на товар здесь нет.</strong>{' '}
          <Endpoint>SupportProductResponse</Endpoint> отдаёт <Endpoint>id</Endpoint>,{' '}
          <Endpoint>merchantId</Endpoint> и <Endpoint>merchantName</Endpoint>, но не адрес витрины, а публичный
          каталог (<Endpoint>/api/v1/catalog/**</Endpoint>) показывает только товары на продаже — черновик или
          архивный товар оттуда не открыть.
        </p>
      </div>
    </Panel>
  );
}

/* ------------------------------------------------------------ сам раздел */

export default function CatalogSection({ role, canWrite }: AdminSectionProps) {
  // `section` не читаем: заголовок, описание и список эндпоинтов уже нарисованы
  // оболочкой `AdminPage`, дублировать их в разделе нечего.
  const [mode, setMode] = useState<MerchantSearchMode>('id');
  const [includeArchived, setIncludeArchived] = useState(false);
  const [page, setPage] = useState(0);

  const merchantSearch = useIdSearch();
  const productSearch = useIdSearch();
  const reservationsSearch = useIdSearch();

  const merchantQuery = useQuery({
    queryKey: ['admin', 'catalog', 'merchant', mode, merchantSearch.submitted ?? 'none'],
    queryFn: () =>
      mode === 'owner'
        ? fetchSupportMerchantByOwner(merchantSearch.submitted as string)
        : fetchSupportMerchant(merchantSearch.submitted as string),
    enabled: merchantSearch.submitted !== null,
    retry: 0,
  });

  const merchantId = merchantQuery.data?.id ?? null;

  const productsQuery = useQuery({
    queryKey: ['admin', 'catalog', 'merchant', merchantId ?? 'none', 'products', { includeArchived, page }],
    queryFn: () =>
      fetchSupportMerchantProducts(merchantId as string, {
        includeArchived,
        page,
        size: PAGE_SIZE,
      }),
    enabled: merchantId !== null,
    placeholderData: (previous) => previous,
  });

  const productQuery = useQuery({
    queryKey: ['admin', 'catalog', 'product', productSearch.submitted ?? 'none'],
    queryFn: () => fetchSupportProduct(productSearch.submitted as string),
    enabled: productSearch.submitted !== null,
    retry: 0,
  });

  const productId = productQuery.data?.id ?? null;

  const stockQuery = useQuery({
    queryKey: ['admin', 'catalog', 'product', productId ?? 'none', 'stock'],
    queryFn: () => fetchSupportStock(productId as string),
    enabled: productId !== null,
    retry: 0,
  });

  const reservationsQuery = useQuery({
    queryKey: ['admin', 'catalog', 'reservations', reservationsSearch.submitted ?? 'none'],
    queryFn: () => fetchSupportReservations(reservationsSearch.submitted as string),
    enabled: reservationsSearch.submitted !== null,
    retry: 0,
  });

  const merchantView = toView(merchantQuery, merchantSearch.submitted !== null);
  const productsView = toView(productsQuery, merchantId !== null);
  const productView = toView(productQuery, productSearch.submitted !== null);
  const stockView = toView(stockQuery, productId !== null);
  const reservationsView = toView(reservationsQuery, reservationsSearch.submitted !== null);

  const pickProduct = (id: string) => {
    productSearch.setValue(id);
    // Открываем карточку сразу: `submitted` — это и есть «запрос ушёл».
    productSearch.submit(id);
  };

  const submitMerchant = () => {
    // Новая цель — новая первая страница товаров: иначе пагинация осталась бы от прошлого магазина.
    setPage(0);
    merchantSearch.submit();
  };

  const items = useMemo(() => productsView.data?.items ?? [], [productsView.data]);
  const inStock = items.filter((product) => (product.available ?? product.availableQuantity) > 0).length;
  const archived = items.filter((product) => product.archived).length;

  const csvRows = useMemo(
    () => [
      [
        'productId',
        'название',
        'артикул',
        'категория',
        'статус',
        'sellable',
        'archived',
        'buyable',
        'цена_minor',
        'валюта',
        'доступно',
      ],
      ...items.map((product) => [
        product.id,
        product.title,
        product.sku ?? '',
        product.category ?? '',
        product.status,
        product.sellable ? 'да' : 'нет',
        product.archived ? 'да' : 'нет',
        product.buyable ? 'да' : 'нет',
        String(product.priceMinor),
        String(product.currency),
        String(product.available ?? product.availableQuantity),
      ]),
    ],
    [items],
  );

  return (
    <div className="space-y-4">
      <Alert tone="info" title="Раздел ничего не меняет">
        Все шесть эндпоинтов раздела — GET: изменяющих операций у support-API каталога нет, и каждый вызов
        аудируется в сервисе каталога. Поэтому кнопок изменения здесь не появится ни у ADMIN, ни у SUPPORT
        {canWrite ? ' (роль ADMIN здесь тоже ничего не меняет)' : ''}. Вы вошли как {roleLabel(role)}.
      </Alert>

      <Toolbar right={<CsvButton rows={csvRows} name="товары магазина" />}>
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone={merchantView.data ? 'success' : 'neutral'}>
            {`магазин: ${merchantView.data ? 'найден' : 'не выбран'}`}
          </Badge>
          <Badge tone={productView.data ? 'success' : 'neutral'}>
            {`товар: ${productView.data ? 'найден' : 'не выбран'}`}
          </Badge>
          <Badge tone="neutral">{`товаров на странице: ${items.length}`}</Badge>
          <nav aria-label="Секции раздела" className="flex flex-wrap gap-1">
            {CATALOG_SECTIONS.map((section) => (
              <a
                key={section.id}
                href={`#${section.id}`}
                className="rounded-full px-2.5 py-1 text-xs font-medium text-brand-700 hover:bg-brand-50"
              >
                {section.label}
              </a>
            ))}
          </nav>
        </div>
      </Toolbar>

      <p className="-mt-2 mb-4 text-xs text-ink-500">
        Все пять секций раздела видны одновременно, а ссылки выше ведут к нужной панели. Запросы уходят только
        по кнопке: пустое поле не ходит на сервер.
      </p>

      {/* ------------------------------------------------------- плитки */}
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <KpiTile
          label="Найдено магазинов"
          value={merchantView.data ? '1' : '0'}
          tone={merchantView.data ? 'success' : 'neutral'}
          icon={
            <Icon>
              <path d="M4 10v10h16V10" />
              <path d="M3 5h18l-1 5a3 3 0 0 1-5.4 1.3A3 3 0 0 1 12 13a3 3 0 0 1-2.6-1.7A3 3 0 0 1 4 10Z" />
            </Icon>
          }
          caption={
            merchantSearch.submitted === null
              ? 'поиск ещё не запускался: ручка отдаёт один магазин за запрос'
              : `по ${merchantKindLabel(mode)}: ${merchantSearch.submitted}`
          }
        />
        <KpiTile
          label="Найдено товаров"
          value={productView.data ? '1' : '0'}
          tone={productView.data ? 'success' : 'neutral'}
          icon={
            <Icon>
              <path d="M4 8h16l-1.2 11.2A2 2 0 0 1 16.8 21H7.2a2 2 0 0 1-2-1.8Z" />
              <path d="M9 8V6a3 3 0 0 1 6 0v2" />
            </Icon>
          }
          caption={productSearch.submitted === null ? 'поиск ещё не запускался' : `id товара: ${productSearch.submitted}`}
        />
        <KpiTile
          label="Товаров у магазина"
          value={productsView.data ? productsView.data.totalElements : '—'}
          tone="brand"
          icon={
            <Icon>
              <path d="M7 3h10a2 2 0 0 1 2 2v16l-3-2-2 2-2-2-2 2-3-2V5a2 2 0 0 1 2-2Z" />
              <path d="M9 8h6" />
              <path d="M9 12h6" />
            </Icon>
          }
          caption={
            merchantId === null
              ? 'счёт сервера появится после поиска магазина'
              : `Page.totalElements · архивные ${includeArchived ? 'запрошены' : 'не запрошены'}`
          }
        />
        <KpiTile
          label="В наличии на странице"
          value={items.length === 0 ? '—' : inStock}
          tone="success"
          icon={
            <Icon>
              <path d="M4.5 12.5 9.5 17.5 19.5 6.5" />
            </Icon>
          }
          caption={items.length === 0 ? 'нет загруженных товаров' : `из ${items.length} загруженных строк`}
        />
        <KpiTile
          label="Архивных"
          value={items.length === 0 ? '—' : archived}
          tone={archived > 0 ? 'warning' : 'neutral'}
          icon={
            <Icon>
              <path d="M4 8h16v12H4z" />
              <path d="M3 4h18v4H3z" />
              <path d="M10 12h4" />
            </Icon>
          }
          caption="по загруженной странице; сервис отдаёт архив только по флагу"
        />
        <KpiTile
          label="Единиц на складе"
          value={stockView.data ? stockView.data.onHand : '—'}
          tone="info"
          icon={
            <Icon>
              <path d="M3 9.5 12 4l9 5.5V20H3Z" />
              <path d="M9 20v-6h6v6" />
            </Icon>
          }
          caption={stockView.data ? 'счётчик onHand из /stock' : 'появится после поиска товара'}
        />
        <KpiTile
          label="Единиц в резерве"
          value={stockView.data ? stockView.data.reserved : '—'}
          tone={stockView.data && stockView.data.reserved > 0 ? 'warning' : 'neutral'}
          icon={
            <Icon>
              <circle cx="12" cy="12" r="8" />
              <path d="M12 8v4.5l3 1.8" />
            </Icon>
          }
          caption={stockView.data ? `доступно к продаже: ${stockView.data.available}` : 'появится после поиска товара'}
        />
        <KpiTile
          label="Резервов по заказу"
          value={reservationsView.data ? reservationsView.data.length : '—'}
          tone="brand"
          icon={
            <Icon>
              <path d="M7 3h10a2 2 0 0 1 2 2v16l-3-2-2 2-2-2-2 2-3-2V5a2 2 0 0 1 2-2Z" />
              <path d="M9 16h6" />
            </Icon>
          }
          caption={
            reservationsSearch.submitted === null
              ? 'заказ не указан'
              : `orderId: ${reservationsSearch.submitted}`
          }
        />
      </div>
      <p className="text-xs text-ink-500">
        «—» в плитке значит «данных нет»: запрос ещё не уходил или сервис не ответил. Ноль стоит только там, где
        ответ сервиса действительно нулевой.
      </p>

      {/* -------------------------------------------- три рабочие панели */}
      <div className="grid gap-4 xl:grid-cols-3">
        <MerchantPanel
          mode={mode}
          onModeChange={(next) => {
            setMode(next);
            // Смена смысла поля сбрасывает и поле, и прежний результат: искать «M-1»
            // как владельца, пока на экране висит ответ про магазин, — врать себе.
            merchantSearch.setValue('');
            merchantSearch.submit('');
            setPage(0);
          }}
          search={merchantSearch}
          onSubmit={submitMerchant}
          view={merchantView}
        />
        <ProductPanel search={productSearch} view={productView} />
        <ReservationsPanel search={reservationsSearch} view={reservationsView} />
      </div>

      {/* ---------------------------------------- остатки и чего нет */}
      <div className="grid gap-4 xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <StockPanel productId={productId} view={stockView} />
        <MissingPanel />
      </div>

      {/* ------------------------------------------------ товары магазина */}
      <MerchantProductsPanel
        merchantId={merchantId}
        view={productsView}
        includeArchived={includeArchived}
        onIncludeArchivedChange={(value) => {
          setIncludeArchived(value);
          setPage(0);
        }}
        onPageChange={setPage}
        onPickProduct={pickProduct}
      />
    </div>
  );
}
