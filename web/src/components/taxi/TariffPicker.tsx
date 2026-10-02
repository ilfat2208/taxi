import { formatMoney } from '../../api/money';
import type { TripQuote, TripTariff } from '../../api/types';
import { Badge } from '../ui/Badge';
import { Skeleton } from '../ui/Skeleton';
import { Spinner } from '../ui/Spinner';
import { CITY_TIME_LABEL, cityTime } from '../../lib/cityTime';import { cx } from '../../lib/cx';
import { formatAgeSeconds, formatDistanceMeters } from '../../lib/format';
import { TARIFF_OPTIONS, surgeLabel, tariffLabel } from '../../lib/trips';
import type { TripQuotes } from '../../hooks/useTrips';

/**
 * Tariff cards.
 *
 * The contract quotes one tariff per call, so both cards show a *server* price:
 * the second number is a second quote, not a percentage invented by the client.
 * Every extra figure on a card (`посадка`, `пробег`, `время`) comes from the
 * quote breakdown; nothing is derived locally.
 */

interface TariffCardProps {
  quote: TripQuote | undefined;
  tariff: TripTariff;
  description: string;
  selected: boolean;
  isPending: boolean;
  isError: boolean;
  onSelect: (tariff: TripTariff) => void;
}

function TariffCard({
  quote,
  tariff,
  description,
  selected,
  isPending,
  isError,
  onSelect,
}: TariffCardProps) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      aria-label={`${tariffLabel(tariff)}, ${quote ? formatMoney(quote.priceMinor, quote.currency) : 'цена не получена'}`}
      onClick={() => onSelect(tariff)}
      className={cx(
        'w-full rounded-card border p-3 text-left transition-colors',
        selected ? 'border-brand-500 bg-brand-50 ring-1 ring-brand-500' : 'border-ink-200 bg-white hover:bg-ink-50',
      )}
    >
      <span className="flex items-baseline justify-between gap-3">
        <span className="min-w-0">
          <span className="block text-sm font-semibold text-ink-900">{tariffLabel(tariff)}</span>
          <span className="block text-xs text-ink-500">{description}</span>
        </span>
        <span className="text-right">
          {isPending ? (
            <Spinner className="h-4 w-4 text-ink-400" />
          ) : quote ? (
            <span className="tnum block text-base font-semibold text-ink-900">
              {formatMoney(quote.priceMinor, quote.currency)}
            </span>
          ) : (
            <span className="block text-xs text-ink-500">цена не получена</span>
          )}
        </span>
      </span>

      {quote && surgeLabel(quote.surgeBp) ? (
        <span className="mt-2 inline-flex">
          <Badge tone="warning">Повышенный спрос {surgeLabel(quote.surgeBp)}</Badge>
        </span>
      ) : null}

      {isError ? (
        <span className="mt-2 block text-xs text-brand-700">
          Тариф не удалось оценить — цену пересчитает сервис при заказе.
        </span>
      ) : null}

      {quote ? (
        <span className="mt-2 block space-y-0.5 text-xs text-ink-600">
          <span className="tnum block">
            Посадка {formatMoney(quote.breakdown.baseMinor, quote.currency)}
          </span>
          <span className="tnum block">
            Пробег {formatMoney(quote.breakdown.distanceMinor, quote.currency)}
          </span>
          <span className="tnum block">Время {formatMoney(quote.breakdown.timeMinor, quote.currency)}</span>
        </span>
      ) : null}
    </button>
  );
}

export interface TariffPickerProps {
  quotes: TripQuotes;
  selected: TripTariff;
  onSelect: (tariff: TripTariff) => void;
}

/** Both tariff cards plus the route facts they were priced from. */
export function TariffPicker({ quotes, selected, onSelect }: TariffPickerProps) {
  const selectedQuote = selected === 'ECONOMY' ? quotes.economy.data : quotes.comfort.data;
  const routeQuote = selectedQuote ?? quotes.economy.data ?? quotes.comfort.data;

  return (
    <div>
      <div className="mb-2 flex items-baseline justify-between gap-3">
        <p className="text-sm font-medium text-ink-800">Тариф</p>
        {routeQuote ? (
          <p className="tnum text-xs text-ink-500">
            {formatDistanceMeters(routeQuote.distanceM)} · {formatAgeSeconds(routeQuote.durationS)} в пути
          </p>
        ) : null}
      </div>

      <div role="radiogroup" aria-label="Тариф" className="grid gap-2 sm:grid-cols-2">
        {TARIFF_OPTIONS.map((option) => {
          const query = option.value === 'ECONOMY' ? quotes.economy : quotes.comfort;
          return (
            <TariffCard
              key={option.value}
              quote={query.data}
              tariff={option.value}
              description={option.description}
              selected={selected === option.value}
              isPending={query.isPending && query.fetchStatus !== 'idle'}
              isError={query.isError}
              onSelect={onSelect}
            />
          );
        })}
      </div>

      {quotes.isLoading ? (
        <p className="mt-2 flex items-center gap-2 text-xs text-ink-500">
          <Spinner className="h-3.5 w-3.5" />
          Считаем цену по обоим тарифам…
        </p>
      ) : null}

      {routeQuote ? (
        <p className="mt-2 text-xs text-ink-500">
          Расстояние и время — из котировки сервиса. Котировка действует до{' '}
          {cityTime(routeQuote.expiresAt)} ({CITY_TIME_LABEL}).
        </p>
      ) : (
        <Skeleton className="mt-2 h-3 w-2/3" />
      )}
    </div>
  );
}
