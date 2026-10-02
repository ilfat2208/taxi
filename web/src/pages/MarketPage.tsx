import { useEffect, useState } from 'react';
import { PageHeader } from '../components/layout/PageHeader';
import { SearchIcon } from '../components/layout/icons';
import { ProductCard } from '../components/market/ProductCard';
import { ErrorAlert } from '../components/ui/Alerts';
import { Card, CardBody } from '../components/ui/Card';
import { EmptyState } from '../components/ui/EmptyState';
import { SelectField, TextField } from '../components/ui/Field';
import { Pagination } from '../components/ui/Pagination';
import { SkeletonCards } from '../components/ui/Skeleton';
import { useCategories, useProducts } from '../hooks/useCatalog';
import { useDebouncedValue } from '../hooks/useDebouncedValue';
import type { ProductSort } from '../api/types';

const PAGE_SIZE = 12;

const SORT_OPTIONS: { value: ProductSort; label: string }[] = [
  { value: 'relevance', label: 'По релевантности' },
  { value: 'price_asc', label: 'Сначала дешёвые' },
  { value: 'price_desc', label: 'Сначала дорогие' },
  { value: 'newest', label: 'Сначала новые' },
];

/**
 * Marketplace grid: free-text search, category rail, sorting and pagination.
 *
 * The search box is debounced so a fast typist does not fire one request per
 * keystroke, and every filter change resets the page — otherwise page 4 of a
 * narrower result set shows an empty grid.
 */
export function MarketPage() {
  const [search, setSearch] = useState('');
  const debouncedSearch = useDebouncedValue(search, 350);
  const [category, setCategory] = useState('');
  const [sort, setSort] = useState<ProductSort>('relevance');
  const [page, setPage] = useState(0);

  useEffect(() => {
    setPage(0);
  }, [debouncedSearch, category, sort]);

  const categoriesQuery = useCategories();
  const productsQuery = useProducts({
    query: debouncedSearch.trim() === '' ? undefined : debouncedSearch.trim(),
    category: category === '' ? undefined : category,
    page,
    size: PAGE_SIZE,
    sort,
  });

  const data = productsQuery.data;
  const hasFilters = debouncedSearch.trim() !== '' || category !== '';

  return (
    <>
      <PageHeader
        title="Маркет"
        subtitle="Товары продавцов ORTA: поиск, категории, сортировка"
      />

      <Card className="mb-4">
        <CardBody className="grid gap-3 sm:grid-cols-3">
          <div className="relative sm:col-span-1">
            <TextField
              id="market-search"
              label="Поиск"
              type="search"
              value={search}
              placeholder="Например: наушники"
              onChange={(event) => setSearch(event.target.value)}
              hint="Поиск по названию, бренду и описанию"
            />
            <SearchIcon className="pointer-events-none absolute right-3 top-9 h-4 w-4 text-ink-400" />
          </div>

          <SelectField
            id="market-category"
            label="Категория"
            value={category}
            placeholder="Все категории"
            options={(categoriesQuery.data ?? []).map((entry) => ({
              value: entry.slug ?? entry.name,
              label: entry.name,
            }))}
            onChange={(event) => setCategory(event.target.value)}
            hint={
              categoriesQuery.isError
                ? 'Категории недоступны — фильтр по названию вручную'
                : undefined
            }
          />

          <SelectField
            id="market-sort"
            label="Сортировка"
            value={sort}
            options={SORT_OPTIONS}
            onChange={(event) => setSort(event.target.value as ProductSort)}
          />
        </CardBody>
      </Card>

      {data ? (
        <p className="mb-3 text-sm text-ink-500" aria-live="polite">
          {data.totalElements > 0
            ? `Найдено товаров: ${data.totalElements}`
            : 'Ничего не найдено'}
          {productsQuery.isFetching ? ' · обновляем…' : ''}
        </p>
      ) : null}

      {productsQuery.isPending ? <SkeletonCards count={8} /> : null}

      {productsQuery.isError ? (
        <ErrorAlert
          error={productsQuery.error}
          title="Не удалось загрузить каталог"
          onRetry={() => void productsQuery.refetch()}
        />
      ) : null}

      {data && data.items.length === 0 ? (
        <EmptyState
          title="Товары не найдены"
          description={
            hasFilters
              ? 'Попробуйте изменить запрос или снять фильтр категории.'
              : 'Продавцы ещё не опубликовали товары. Если у вас есть роль MERCHANT, создайте первый товар в разделе «Мой магазин».'
          }
        />
      ) : null}

      {data && data.items.length > 0 ? (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {data.items.map((product) => (
            <ProductCard key={product.id} product={product} />
          ))}
        </div>
      ) : null}

      {data ? (
        <Pagination
          page={data.page}
          totalPages={data.totalPages}
          hasNext={data.hasNext}
          totalElements={data.totalElements}
          isFetching={productsQuery.isFetching}
          onPageChange={setPage}
        />
      ) : null}
    </>
  );
}
