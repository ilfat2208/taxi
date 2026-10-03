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
 * точечный (по идентификатору), и об этом честно написано в конце раздела.
 */
import { useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { isApiError } from '../../api/errors';
import { formatMoney } from '../../api/money';
import { Alert, ErrorAlert } from '../../components/ui/Alerts';
import { Badge, StatusBadge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { Card, CardBody, CardHeader, DetailRow } from '../../components/ui/Card';
import { CopyButton } from '../../components/ui/CopyButton';
import { EmptyState } from '../../components/ui/EmptyState';
import { CheckboxField, SelectField, TextField, type SelectOption } from '../../components/ui/Field';
import { Pagination } from '../../components/ui/Pagination';
import { SkeletonRows } from '../../components/ui/Skeleton';
import { formatDateTime, roleLabel } from '../../lib/format';
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
      className={
        withMode
          ? 'grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] sm:items-end'
          : 'grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end'
      }
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
      <Button type="submit">{submitLabel}</Button>
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
        </div>
        {merchant.status ? <StatusBadge status={merchant.status} /> : null}
      </div>

      <dl className="mt-3">
        <DetailRow label="Магазин">
          <span className="inline-flex items-center gap-1 font-mono text-xs">
            {merchant.id}
            <CopyButton value={merchant.id} />
          </span>
        </DetailRow>
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

/* ------------------------------------------------------- товары магазина */

function MerchantProducts({
  merchantId,
  onPickProduct,
}: {
  merchantId: string;
  onPickProduct: (productId: string) => void;
}) {
  const [includeArchived, setIncludeArchived] = useState(false);
  const [page, setPage] = useState(0);

  const query = useQuery({
    queryKey: ['admin', 'catalog', 'merchant', merchantId, 'products', { includeArchived, page }],
    queryFn: () => fetchSupportMerchantProducts(merchantId, { includeArchived, page, size: PAGE_SIZE }),
    placeholderData: (previous) => previous,
  });

  const data = query.data;

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
    <div className="rounded-card border border-ink-200 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-ink-900">Товары магазина</p>
          <p className="text-xs text-ink-500">
            <Endpoint>GET /api/v1/support/merchants/{'{id}'}/products</Endpoint> — черновики включены,
            архивные по флагу
          </p>
        </div>
        <div className="w-full sm:w-72">
          <CheckboxField
            id={`merchant-${merchantId}-archived`}
            label="Показывать архивные"
            checked={includeArchived}
            hint="По умолчанию сервис архива не отдаёт."
            onChange={(event) => {
              setIncludeArchived(event.target.checked);
              setPage(0);
            }}
          />
        </div>
      </div>

      {categories.length > 0 ? (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <span className="text-xs text-ink-500">Категории в этой странице товаров:</span>
          {categories.map((category) => (
            <Badge key={category} tone="neutral">
              {category}
            </Badge>
          ))}
        </div>
      ) : null}

      <div className="mt-3">
        {query.isPending ? <SkeletonRows count={3} /> : null}

        {query.isError ? (
          <RequestError
            label="Не удалось загрузить товары магазина"
            error={query.error}
            onRetry={() => void query.refetch()}
          />
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
          <div className="relative overflow-x-auto">
            <table className="w-full min-w-[42rem] border-collapse text-sm">
              <thead>
                <tr className="border-b border-ink-200 text-left text-xs text-ink-500">
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
                      {product.buyable ? null : (
                        <span className="mt-1 block">
                          <Badge tone="warning">не покупается</Badge>
                        </span>
                      )}
                    </td>
                    <td className="py-2 pr-3 font-mono text-xs text-ink-600">{product.sku ?? '—'}</td>
                    <td className="py-2 pr-3 text-ink-700">{product.category ?? '—'}</td>
                    <td className="py-2 pr-3">
                      <StatusBadge status={product.status} />
                    </td>
                    <td className="tnum py-2 pr-3 text-ink-900">
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

            <Pagination
              page={data.page}
              totalPages={data.totalPages}
              hasNext={data.hasNext}
              totalElements={data.totalElements}
              isFetching={query.isFetching}
              onPageChange={setPage}
            />
          </div>
        ) : null}
      </div>
    </div>
  );
}

/* -------------------------------------------------------------- магазин */

function MerchantPanel({ onPickProduct }: { onPickProduct: (productId: string) => void }) {
  const [mode, setMode] = useState<MerchantSearchMode>('id');
  const search = useIdSearch();

  const query = useQuery({
    queryKey: ['admin', 'catalog', 'merchant', mode, search.submitted ?? 'none'],
    queryFn: () =>
      mode === 'owner'
        ? fetchSupportMerchantByOwner(search.submitted as string)
        : fetchSupportMerchant(search.submitted as string),
    enabled: search.submitted !== null,
    retry: 0,
  });

  // Выключенный запрос тоже `isPending`, поэтому скелетон показываем только тогда,
  // когда поиск действительно отправлен.
  const loading = search.submitted !== null && query.isPending;

  return (
    <Card>
      <CardHeader
        title="Магазин"
        subtitle="Точечное чтение: id магазина или id его владельца. Списка всех магазинов в support-API нет."
      />
      <CardBody className="space-y-4">
        <SearchBar
          idPrefix="catalog-merchant"
          label={merchantKindLabel(mode)}
          placeholder={mode === 'owner' ? 'U-1001' : '01M3MERCHANT…'}
          hint="Запрос уходит по кнопке, а не на каждый символ."
          submitLabel="Найти магазин"
          value={search.value}
          onValueChange={search.setValue}
          onSubmit={search.submit}
          mode={mode}
          modeOptions={MERCHANT_MODE_OPTIONS}
          onModeChange={(value) => {
            setMode(value === 'owner' ? 'owner' : 'id');
            search.setValue('');
          }}
        />

        {search.submitted === null ? (
          <p className="text-sm text-ink-500">
            Введите идентификатор и нажмите «Найти магазин». Пустое поле запрос не отправляет.
          </p>
        ) : null}

        {loading ? <SkeletonRows count={3} /> : null}

        {query.isError && !loading ? (
          isNotFound(query.error) ? (
            <EmptyState
              title={mode === 'owner' ? 'Магазин у этого владельца не найден' : 'Магазин не найден'}
              description={`Сервис каталога ответил 404 MERCHANT_NOT_FOUND: магазина с таким ${merchantKindLabel(mode)} «${search.submitted}» нет.`}
            />
          ) : (
            <RequestError
              label="Не удалось получить магазин"
              error={query.error}
              onRetry={() => void query.refetch()}
            />
          )
        ) : null}

        {query.data ? (
          <>
            <MerchantCard merchant={query.data} />
            <MerchantProducts merchantId={query.data.id} onPickProduct={onPickProduct} />
          </>
        ) : null}
      </CardBody>
    </Card>
  );
}

/* ---------------------------------------------------------------- товар */

function ReservationsList({ reservations }: { reservations: SupportReservation[] }) {
  return (
    <div className="relative overflow-x-auto">
      <table className="w-full min-w-[40rem] border-collapse text-sm">
        <thead>
          <tr className="border-b border-ink-200 text-left text-xs text-ink-500">
            <th scope="col" className="py-2 pr-3 font-medium">Резерв</th>
            <th scope="col" className="py-2 pr-3 font-medium">Заказ</th>
            <th scope="col" className="py-2 pr-3 font-medium">Товар</th>
            <th scope="col" className="py-2 pr-3 font-medium">Кол-во</th>
            <th scope="col" className="py-2 pr-3 font-medium">Статус</th>
            <th scope="col" className="py-2 pr-3 font-medium">Создан</th>
            <th scope="col" className="py-2 font-medium">Истекает</th>
          </tr>
        </thead>
        <tbody>
          {reservations.map((reservation) => (
            <tr key={reservation.id} className="border-b border-ink-100">
              <td className="py-2 pr-3 font-mono text-xs text-ink-600">{reservation.id}</td>
              <td className="py-2 pr-3 font-mono text-xs text-ink-600">{reservation.orderId}</td>
              <td className="py-2 pr-3 font-mono text-xs text-ink-600">{reservation.productId}</td>
              <td className="tnum py-2 pr-3 text-ink-900">{reservation.quantity}</td>
              <td className="py-2 pr-3">
                <StatusBadge status={reservation.status} />
              </td>
              <td className="tnum py-2 pr-3 text-ink-700">{formatDateTime(reservation.createdAt)}</td>
              <td className="tnum py-2 text-ink-700">{formatDateTime(reservation.expiresAt)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function StockBlock({ productId }: { productId: string }) {
  const query = useQuery({
    queryKey: ['admin', 'catalog', 'product', productId, 'stock'],
    queryFn: () => fetchSupportStock(productId),
    retry: 0,
  });

  return (
    <div className="rounded-card border border-ink-200 p-4">
      <p className="text-sm font-semibold text-ink-900">Остатки и резервы</p>
      <p className="text-xs text-ink-500">
        <Endpoint>GET /api/v1/support/products/{'{id}'}/stock</Endpoint> — счётчики и резервы, которые их
        держат
      </p>

      <div className="mt-3">
        {query.isPending ? <SkeletonRows count={2} /> : null}

        {query.isError ? (
          <RequestError
            label="Не удалось получить остатки товара"
            error={query.error}
            onRetry={() => void query.refetch()}
          />
        ) : null}

        {query.data ? (
          <>
            <dl>
              <DetailRow label="На складе">
                <span className="tnum">{query.data.onHand}</span>
              </DetailRow>
              <DetailRow label="В резерве">
                <span className="tnum">{query.data.reserved}</span>
              </DetailRow>
              <DetailRow label="Доступно к продаже">
                <span className="tnum">{query.data.available}</span>
              </DetailRow>
              <DetailRow label="Статус товара">
                <StatusBadge status={query.data.productStatus} />
              </DetailRow>
              <DetailRow label="Обновлено">{formatDateTime(query.data.updatedAt)}</DetailRow>
            </dl>

            {query.data.holds.length === 0 ? (
              <p className="mt-3 text-sm text-ink-500">
                Сервис не вернул ни одного резерва: единицы никто не держит.
              </p>
            ) : (
              <div className="mt-3">
                <p className="mb-2 text-xs text-ink-500">Последние резервы (до 20, новыми первыми)</p>
                <ReservationsList reservations={query.data.holds} />
              </div>
            )}
          </>
        ) : null}
      </div>
    </div>
  );
}

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

function ProductCard({ product }: { product: SupportProduct }) {
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
        <VerdictBlock product={product} />
      </div>

      <dl className="mt-3">
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
        <DetailRow label="На складе / в резерве / доступно">
          <span className="tnum">
            {product.onHand ?? '—'} / {product.reserved ?? '—'} / {product.available ?? '—'}
          </span>
        </DetailRow>
      </dl>

      {product.description ? (
        <p className="mt-2 text-sm text-ink-600">{product.description}</p>
      ) : null}
    </div>
  );
}

function ProductPanel({ search }: { search: IdSearch }) {
  const query = useQuery({
    queryKey: ['admin', 'catalog', 'product', search.submitted ?? 'none'],
    queryFn: () => fetchSupportProduct(search.submitted as string),
    enabled: search.submitted !== null,
    retry: 0,
  });
  const loading = search.submitted !== null && query.isPending;

  return (
    <Card>
      <CardHeader
        title="Товар и сток"
        subtitle="Поиск по идентификатору товара: массового поиска товаров в support-API нет."
      />
      <CardBody className="space-y-4">
        <SearchBar
          idPrefix="catalog-product"
          label="Идентификатор товара"
          placeholder="01M3PRODUCT…"
          hint="Можно вставить id из списка товаров магазина слева."
          submitLabel="Найти товар"
          value={search.value}
          onValueChange={search.setValue}
          onSubmit={search.submit}
        />

        {search.submitted === null ? (
          <p className="text-sm text-ink-500">
            Введите идентификатор товара или откройте его из списка товаров магазина.
          </p>
        ) : null}

        {loading ? <SkeletonRows count={3} /> : null}

        {query.isError && !loading ? (
          isNotFound(query.error) ? (
            <EmptyState
              title="Товар не найден"
              description={`Сервис каталога ответил 404 PRODUCT_NOT_FOUND: товара «${search.submitted}» нет. Архивный товар сервис при этом отдаёт — значит, его действительно нет.`}
            />
          ) : (
            <RequestError
              label="Не удалось получить товар"
              error={query.error}
              onRetry={() => void query.refetch()}
            />
          )
        ) : null}

        {query.data ? (
          <>
            <ProductCard product={query.data} />
            <StockBlock productId={query.data.id} />
          </>
        ) : null}
      </CardBody>
    </Card>
  );
}

/* ------------------------------------------------------- резервы по заказу */

function ReservationsPanel() {
  const search = useIdSearch();

  const query = useQuery({
    queryKey: ['admin', 'catalog', 'reservations', search.submitted ?? 'none'],
    queryFn: () => fetchSupportReservations(search.submitted as string),
    enabled: search.submitted !== null,
    retry: 0,
  });
  const loading = search.submitted !== null && query.isPending;

  return (
    <Card>
      <CardHeader
        title="Резервы стока по заказу"
        subtitle={
          <>
            <Endpoint>GET /api/v1/support/reservations/{'{orderId}'}</Endpoint> — что именно держит
            единицы этого чекаута
          </>
        }
      />
      <CardBody className="space-y-4">
        <SearchBar
          idPrefix="catalog-reservations"
          label="Идентификатор заказа"
          placeholder="01M3ORDER…"
          hint="Поиск по orderId: у эндпоинта нет фильтров."
          submitLabel="Показать резервы"
          value={search.value}
          onValueChange={search.setValue}
          onSubmit={search.submit}
        />

        {search.submitted === null ? (
          <p className="text-sm text-ink-500">
            Пустой ответ у этого эндпоинта не предусмотрен: если каталог не резервировал сток по заказу,
            сервис отвечает 404 RESERVATION_NOT_FOUND.
          </p>
        ) : null}

        {loading ? <SkeletonRows count={3} /> : null}

        {query.isError && !loading ? (
          isNotFound(query.error) ? (
            <EmptyState
              title="Каталог не резервировал сток по этому заказу"
              description={`Сервис ответил 404 RESERVATION_NOT_FOUND по заказу «${search.submitted}». Это не «резервов нет», а «этот сервис про такой заказ не знает»: возможно, заказ оформлен до появления резервов или id указан неверно.`}
            />
          ) : (
            <RequestError
              label="Не удалось получить резервы"
              error={query.error}
              onRetry={() => void query.refetch()}
            />
          )
        ) : null}

        {query.data && query.data.length > 0 ? <ReservationsList reservations={query.data} /> : null}
      </CardBody>
    </Card>
  );
}

/* -------------------------------------------------------------- сам раздел */

export default function CatalogSection({ role, canWrite }: AdminSectionProps) {
  // `section` не читаем: заголовок, описание и список эндпоинтов уже нарисованы
  // оболочкой `AdminPage`, дублировать их в разделе нечего.
  const productSearch = useIdSearch();

  const pickProduct = (productId: string) => {
    productSearch.setValue(productId);
    // Открываем карточку сразу: `submitted` — это и есть «запрос ушёл».
    productSearch.submit(productId);
  };

  return (
    <div className="space-y-4">
      <Alert tone="info" title="Раздел ничего не меняет">
        Все шесть эндпоинтов раздела — GET: изменяющих операций у support-API каталога нет, и каждый вызов
        аудируется в сервисе каталога. Поэтому кнопок изменения здесь не появится ни у ADMIN, ни у SUPPORT
        {canWrite ? ' (роль ADMIN здесь тоже ничего не меняет)' : ''}. Вы вошли как {roleLabel(role)}.
      </Alert>

      <div className="grid gap-4 xl:grid-cols-2">
        <MerchantPanel onPickProduct={pickProduct} />
        <ProductPanel search={productSearch} />
      </div>

      <ReservationsPanel />

      <Card>
        <CardHeader
          title="Чего в API пока нет"
          subtitle="Чтобы не искать в интерфейсе то, чего сервис не отдаёт."
        />
        <CardBody className="space-y-2 text-sm text-ink-600">
          <p>
            <strong className="text-ink-800">Массового поиска магазинов и товаров нет.</strong> Доступны
            только точечные чтения: магазин по id или по владельцу, товар по id, сток товара и резервы
            заказа. Поэтому в разделе нет ни строки поиска «все магазины», ни таблицы всего каталога: её
            пришлось бы имитировать.
          </p>
          <p>
            <strong className="text-ink-800">Единственный список — товары конкретного магазина</strong>{' '}
            (<Endpoint>/support/merchants/{'{id}'}/products</Endpoint>): в нём есть черновики и, по
            флагу, архивные товары.
          </p>
          <p>
            <strong className="text-ink-800">Категорий у магазина в ответе нет.</strong> В{' '}
            <Endpoint>SupportMerchantResponse</Endpoint> такого поля нет, поэтому категории выше собраны
            из категорий загруженных товаров магазина, а не выданы сервисом как «категории магазина».
          </p>
          <p>
            <strong className="text-ink-800">Публичной ссылки на товар здесь нет.</strong>{' '}
            <Endpoint>SupportProductResponse</Endpoint> отдаёт <Endpoint>id</Endpoint>,{' '}
            <Endpoint>merchantId</Endpoint> и <Endpoint>merchantName</Endpoint>, но не адрес витрины, а
            публичный каталог (<Endpoint>/api/v1/catalog/**</Endpoint>) показывает только товары на
            продаже — черновик или архивный товар оттуда не открыть.
          </p>
        </CardBody>
      </Card>
    </div>
  );
}
