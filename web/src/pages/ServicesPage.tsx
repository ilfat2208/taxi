import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { PageHeader } from '../components/layout/PageHeader';
import { SearchIcon } from '../components/layout/icons';
import { CompanyCard } from '../components/services/CompanyCard';
import { ErrorAlert } from '../components/ui/Alerts';
import { Badge } from '../components/ui/Badge';
import { buttonClass } from '../components/ui/Button';
import { Card, CardBody } from '../components/ui/Card';
import { EmptyState } from '../components/ui/EmptyState';
import { SelectField, TextField } from '../components/ui/Field';
import { Pagination } from '../components/ui/Pagination';
import { SkeletonCards } from '../components/ui/Skeleton';
import { useQtimeCompanies } from '../hooks/useQtime';
import { useDebouncedValue } from '../hooks/useDebouncedValue';

/**
 * `/services` — the QTime catalogue.
 *
 * Search, category and city are the three filters of the contract. There is no
 * "categories" or "cities" endpoint yet, so the option lists are built from the
 * companies that were actually loaded (and remembered while the list narrows) —
 * the note under the filters says exactly that instead of pretending a reference
 * book exists.
 */

const PAGE_SIZE = 12;

/** Keeps the filter options from disappearing when the list is narrowed by them. */
function useSeenOptions(values: string[]): string[] {
  const [seen, setSeen] = useState<string[]>([]);
  useEffect(() => {
    setSeen((previous) => {
      const next = new Set(previous);
      let changed = false;
      for (const value of values) {
        if (value !== '' && !next.has(value)) {
          next.add(value);
          changed = true;
        }
      }
      return changed ? Array.from(next).sort((a, b) => a.localeCompare(b, 'ru')) : previous;
    });
  }, [values]);
  return seen;
}

export function ServicesPage() {
  const [search, setSearch] = useState('');
  const debouncedSearch = useDebouncedValue(search, 350);
  const [category, setCategory] = useState('');
  const [city, setCity] = useState('');
  const [page, setPage] = useState(0);

  useEffect(() => {
    setPage(0);
  }, [debouncedSearch, category, city]);

  const query = useQtimeCompanies({
    query: debouncedSearch.trim() === '' ? undefined : debouncedSearch.trim(),
    category: category === '' ? undefined : category,
    city: city === '' ? undefined : city,
    page,
    size: PAGE_SIZE,
  });

  const items = useMemo(() => query.data?.items ?? [], [query.data]);
  const categoryOptions = useSeenOptions(
    items.map((company) => company.category).filter((value): value is string => Boolean(value)),
  );
  const cityOptions = useSeenOptions(
    items.map((company) => company.city).filter((value): value is string => Boolean(value)),
  );

  const hasFilters = debouncedSearch.trim() !== '' || category !== '' || city !== '';
  const activeFilters = [category, city].filter((value) => value !== '');

  return (
    <>
      <PageHeader
        title="Услуги"
        subtitle="Запись через QTime: компании, специалисты, услуги и свободные окна"
        actions={
          <>
            <Badge tone="brand">QTime</Badge>
            <Link to="/services/bookings" className={buttonClass({ variant: 'secondary', size: 'sm' })}>
              Мои записи
            </Link>
          </>
        }
      />

      {activeFilters.length > 0 ? (
        <div className="mb-3 flex flex-wrap items-center gap-2">
          {activeFilters.map((value) => (
            <Badge key={value} tone="neutral">
              {value}
            </Badge>
          ))}
          <button
            type="button"
            className="text-xs text-brand-600 hover:underline"
            onClick={() => {
              setCategory('');
              setCity('');
            }}
          >
            Сбросить фильтры
          </button>
        </div>
      ) : null}

      <Card className="mb-4">
        <CardBody className="grid gap-3 sm:grid-cols-3">
          <div className="relative sm:col-span-1">
            <TextField
              id="services-search"
              label="Поиск"
              type="search"
              value={search}
              placeholder="Например: маникюр"
              hint="По названию компании"
              onChange={(event) => setSearch(event.target.value)}
            />
            <SearchIcon className="pointer-events-none absolute right-3 top-9 h-4 w-4 text-ink-400" />
          </div>

          <SelectField
            id="services-category"
            label="Категория"
            value={category}
            placeholder="Все категории"
            options={categoryOptions.map((value) => ({ value, label: value }))}
            onChange={(event) => setCategory(event.target.value)}
            hint="Список собран из загруженных компаний"
          />

          <SelectField
            id="services-city"
            label="Город"
            value={city}
            placeholder="Все города"
            options={cityOptions.map((value) => ({ value, label: value }))}
            onChange={(event) => setCity(event.target.value)}
            hint="Справочника городов у сервиса пока нет"
          />
        </CardBody>
      </Card>

      {query.data ? (
        <p className="mb-3 text-sm text-ink-500" aria-live="polite">
          {query.data.totalElements > 0
            ? `Найдено компаний: ${query.data.totalElements}`
            : 'Ничего не найдено'}
          {query.isFetching ? ' · обновляем…' : ''}
        </p>
      ) : null}

      {query.isPending ? <SkeletonCards count={6} /> : null}

      {query.isError ? (
        <ErrorAlert
          error={query.error}
          title="Не удалось загрузить компании"
          onRetry={() => void query.refetch()}
        />
      ) : null}

      {query.data && items.length === 0 ? (
        <EmptyState
          title="Компании не найдены"
          description={
            hasFilters
              ? 'Попробуйте изменить запрос или снять фильтры.'
              : 'QTime ещё не подключил ни одной компании — список появится, когда расписание заведёт первая.'
          }
        />
      ) : null}

      {items.length > 0 ? (
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {items.map((company) => (
            <CompanyCard key={company.companyId} company={company} />
          ))}
        </ul>
      ) : null}

      {query.data ? (
        <Pagination
          page={query.data.page}
          totalPages={query.data.totalPages}
          hasNext={query.data.hasNext}
          totalElements={query.data.totalElements}
          isFetching={query.isFetching}
          onPageChange={setPage}
        />
      ) : null}
    </>
  );
}
