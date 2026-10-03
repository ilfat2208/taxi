/**
 * Раздел админ-панели «Справочники».
 *
 * Заказчик сравнил админку с демо-макетами, где есть «тарифы такси по городам, зоны
 * и наценки» и «справочники (города, категории, услуги)», и претензия справедлива
 * ровно в одной части: раздел был пустым. Поэтому здесь собрано то, что платформа
 * действительно знает, — и словами сказано то, чего в API нет.
 *
 * Что показывает раздел (всё — ответы сервисов, ни одной константы вместо данных):
 *  1. <b>Плитки.</b> Категорий в каталоге, товаров в каталоге, компаний QTime, услуг
 *     и мастеров выбранной компании. Счётчики — это `totalElements` настоящих
 *     листингов (`page=0&size=1`), а не «примерно столько».
 *  2. <b>Рейл категорий и таблица товаров.</b> Категории запрашиваются у
 *     `GET /api/v1/catalog/categories`, число товаров в каждой — отдельным
 *     `GET /api/v1/catalog/products?category=…&size=1` (см. `MAX_CATEGORY_COUNTS`).
 *     Клик по категории фильтрует таблицу товаров, у таблицы своя пагинация.
 *  3. <b>Компании QTime.</b> Список (`?page&size`), поиск по названию (`?query`,
 *     уходит на сервер только при непустом поле) и карточка выбранной компании:
 *     услуги, мастера, зона расписания и — по кнопке — сетка свободных окон дня.
 *  4. <b>Калькулятор котировки.</b> `POST /api/v1/trips/quote` считает настоящую
 *     цену по настоящему тарифу: класс, расстояние, время, разбор цены на части,
 *     комиссия и заработок водителя. Это единственный способ увидеть тариф в API:
 *     каталога тарифов у сервиса нет (см. панель «Чего в API нет»).
 *
 * Чего в разделе нет и почему: каталога тарифов, зон обслуживания, наценок (surge),
 * городов как справочника и управления ролями — таких ручек не существует, и
 * выдумывать их интерфейсом означало бы показывать оператору неправду. Список с
 * проверкой каждого пункта — `REFERENCE_API_GAPS` в `../api/reference`.
 *
 * Разметка, которую проверяет `e2e/check-admin.mjs`: плотность раздела считается по
 * `data-admin-panel` (панели кита `../kit`) и `data-admin-kpi` (плитки кита), все
 * таблицы живут внутри `className="relative overflow-x-auto"` (`relative`
 * обязателен: без него sr-only подпись таблицы растягивает документ на телефоне).
 * Изменяющих действий нет: котировка — расчёт, а не операция над данными, поэтому
 * `data-admin-write` здесь не нужен ни одному элементу.
 */
import { useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  fetchCategories,
  fetchProducts,
  fetchQtimeCompanies,
  fetchQtimeCompany,
  fetchQtimeSlots,
  requestTripQuote,
} from '../../api/endpoints';
import { formatMoney, sumMinor } from '../../api/money';
import type {
  Product,
  QtimeCompany,
  QtimeCompanyDetail,
  QtimeService,
  QtimeSpecialist,
  TripQuote,
  TripQuoteRequest,
} from '../../api/types';
import { Alert, ErrorAlert } from '../../components/ui/Alerts';
import { Badge, StatusBadge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { DetailRow } from '../../components/ui/Card';
import { CopyButton } from '../../components/ui/CopyButton';
import { EmptyState } from '../../components/ui/EmptyState';
import { SelectField, TextField } from '../../components/ui/Field';
import { Pagination } from '../../components/ui/Pagination';
import { Skeleton, SkeletonRows } from '../../components/ui/Skeleton';
import { useDebouncedValue } from '../../hooks/useDebouncedValue';
import { cityDayKey, cityTime, formatDurationMinutes } from '../../lib/cityTime';
import { cx } from '../../lib/cx';
import { formatDateTime, formatDistanceMeters, formatRelative, roleLabel, shortId } from '../../lib/format';
import { Chip, KpiTile, Panel, StatusRail, Toolbar } from '../kit';
import {
  MAX_CATEGORY_COUNTS,
  REFERENCE_API_GAPS,
  REFERENCE_COMPANIES_PAGE_SIZE,
  REFERENCE_PRODUCTS_PAGE_SIZE,
  REFERENCE_SEARCH_LIMIT,
  buildQuoteRequest,
  categoryCountNote,
  commissionPercent,
  fetchCatalogProductTotal,
  fetchCategoryProductCount,
  formatDurationSeconds,
  initialQuoteForm,
  quoteFailureHint,
  ratingOfFive,
  referenceKeys,
  referenceSnapshotJson,
  surgeLabel,
  tariffLabel,
  tariffOptions,
} from '../api/reference';
import type { QuoteForm, QuoteFormErrors } from '../api/reference';
import type { AdminSectionProps } from '../sections';

/** Справочники меняются редко: пять минут — цена одной лишней поездки в сервис. */
const REFERENCE_STALE_MS = 5 * 60_000;

const CATALOG_PATH = '/';
const SERVICES_PATH = '/services';

/* ------------------------------------------------------------ мелкие детали */

function Endpoint({ children }: { children: ReactNode }) {
  return <code className="font-mono text-xs">{children}</code>;
}

/**
 * Ошибка запроса: подпись говорит, что именно не получилось, а `ErrorAlert` — почему.
 * Без своего заголовка `ErrorAlert` берёт `humanMessage(error)`, то есть перевод кода
 * сервиса на русский, а не только английский `detail`.
 */
function RequestError({ label, error, onRetry }: { label: string; error: unknown; onRetry: () => void }) {
  return (
    <div className="space-y-2">
      <p className="text-sm font-medium text-ink-700">{label}</p>
      <ErrorAlert error={error} onRetry={onRetry} />
    </div>
  );
}

/**
 * Кнопка «Скопировать JSON».
 *
 * Данные — то, что уже на экране (`referenceSnapshotJson`), поэтому кнопка ничего не
 * выдумывает и никуда не ходит. `CopyButton` из кита рисует ссылку с пунктиром и не
 * подходит по виду к панели действий, а вот поведение у него правильное: если буфер
 * обмена недоступен (jsdom, http-контекст), об этом надо сказать, а не молчать.
 */
function CopyJsonButton({ value }: { value: string }) {
  const [state, setState] = useState<'idle' | 'copied' | 'failed'>('idle');

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setState('copied');
    } catch {
      setState('failed');
    }
    window.setTimeout(() => setState('idle'), 2_000);
  };

  return (
    <Button
      variant="secondary"
      size="sm"
      onClick={() => {
        void copy();
      }}
    >
      {state === 'copied' ? 'Скопировано' : state === 'failed' ? 'Буфер недоступен' : 'Скопировать JSON'}
    </Button>
  );
}

/* ------------------------------------------------------------------- каталог */

function ProductsTable({ products }: { products: Product[] }) {
  return (
    <div className="relative overflow-x-auto">
      <table className="w-full min-w-[46rem] border-collapse text-sm">
        <caption className="sr-only">
          Товары каталога: название, магазин, категория, цена, статус и остаток
        </caption>
        <thead>
          <tr className="border-b border-ink-200 text-left text-xs text-ink-500">
            <th scope="col" className="py-2 pr-3 font-medium">Товар</th>
            <th scope="col" className="py-2 pr-3 font-medium">Магазин</th>
            <th scope="col" className="py-2 pr-3 font-medium">Категория</th>
            <th scope="col" className="py-2 pr-3 font-medium">Цена</th>
            <th scope="col" className="py-2 pr-3 font-medium">Статус</th>
            <th scope="col" className="py-2 font-medium">Остаток</th>
          </tr>
        </thead>
        <tbody>
          {products.map((product) => (
            <tr key={product.id} className="border-b border-ink-100 align-top">
              <td className="py-2 pr-3">
                <span className="block text-ink-900">{product.title}</span>
                <span className="mt-0.5 block font-mono text-xs text-ink-500">
                  {product.sku ? `${product.sku} · ` : ''}
                  {shortId(product.id)}
                </span>
              </td>
              <td className="py-2 pr-3 text-ink-700">{product.merchantName}</td>
              <td className="py-2 pr-3 text-ink-700">{product.category ?? '—'}</td>
              <td className="tnum py-2 pr-3 text-ink-900">
                {formatMoney(product.priceMinor, product.currency)}
              </td>
              <td className="py-2 pr-3">
                <StatusBadge status={product.status} />
              </td>
              <td className="tnum py-2 text-ink-700">
                {product.availableQuantity}
                {typeof product.onHand === 'number' ? (
                  <span className="ml-1 text-xs text-ink-500">из {product.onHand}</span>
                ) : null}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ------------------------------------------------------------------- QTime */

function companyPlace(company: QtimeCompany): string {
  const parts = [company.city, company.address].filter((part): part is string => Boolean(part));
  return parts.length > 0 ? parts.join(' · ') : 'адрес не указан';
}

function CompaniesTable({
  companies,
  selectedId,
  onSelect,
}: {
  companies: QtimeCompany[];
  selectedId: string | null;
  onSelect: (companyId: string) => void;
}) {
  return (
    <div className="relative overflow-x-auto">
      <table className="w-full min-w-[50rem] border-collapse text-sm">
        <caption className="sr-only">
          Компании QTime: категория, адрес, рейтинг, число услуг и мастеров, цена от
        </caption>
        <thead>
          <tr className="border-b border-ink-200 text-left text-xs text-ink-500">
            <th scope="col" className="py-2 pr-3 font-medium">Компания</th>
            <th scope="col" className="py-2 pr-3 font-medium">Категория</th>
            <th scope="col" className="py-2 pr-3 font-medium">Где</th>
            <th scope="col" className="py-2 pr-3 font-medium">Рейтинг</th>
            <th scope="col" className="py-2 pr-3 font-medium">Услуги и мастера</th>
            <th scope="col" className="py-2 pr-3 font-medium">Цена от</th>
            <th scope="col" className="py-2 font-medium">Карточка</th>
          </tr>
        </thead>
        <tbody>
          {companies.map((company) => {
            const rating = ratingOfFive(company.ratingBp);
            return (
              <tr key={company.companyId} className="border-b border-ink-100 align-top">
                <td className="py-2 pr-3">
                  <span className="block text-ink-900">{company.name}</span>
                  <span className="mt-0.5 block font-mono text-xs text-ink-500">
                    {shortId(company.companyId)}
                  </span>
                </td>
                <td className="py-2 pr-3">
                  {company.category ? (
                    <Badge tone="neutral">{company.category}</Badge>
                  ) : (
                    <span className="text-ink-500">—</span>
                  )}
                </td>
                <td className="py-2 pr-3 text-ink-700">{companyPlace(company)}</td>
                <td className="tnum py-2 pr-3 text-ink-700">
                  {rating ? (
                    <>
                      ★ {rating}
                      <span className="ml-1 text-xs text-ink-500">
                        {company.reviewsCount === null ? '' : `отзывов: ${company.reviewsCount}`}
                      </span>
                    </>
                  ) : (
                    // Рейтинга нет — так и пишем: «0,0» был бы выдумкой.
                    <span className="text-ink-500">нет оценки</span>
                  )}
                </td>
                <td className="tnum py-2 pr-3 text-ink-700">
                  {company.servicesCount === null ? 'услуг: —' : `услуг: ${company.servicesCount}`}
                  {' · '}
                  {company.specialistsCount === null ? 'мастеров: —' : `мастеров: ${company.specialistsCount}`}
                </td>
                <td className="tnum py-2 pr-3 text-ink-700">
                  {company.minPriceMinor === null
                    ? 'нет прайса'
                    : formatMoney(company.minPriceMinor, 'KZT', { trimZeroFraction: true })}
                </td>
                <td className="py-2">
                  <Button
                    variant={selectedId === company.companyId ? 'primary' : 'secondary'}
                    size="sm"
                    onClick={() => onSelect(company.companyId)}
                  >
                    {selectedId === company.companyId ? 'Открыта' : 'Открыть'}
                  </Button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function ServicesTable({ services }: { services: QtimeService[] }) {
  return (
    <div className="relative overflow-x-auto">
      <table className="w-full min-w-[28rem] border-collapse text-sm">
        <caption className="sr-only">Услуги компании: название, длительность и цена</caption>
        <thead>
          <tr className="border-b border-ink-200 text-left text-xs text-ink-500">
            <th scope="col" className="py-2 pr-3 font-medium">Услуга</th>
            <th scope="col" className="py-2 pr-3 font-medium">Длительность</th>
            <th scope="col" className="py-2 font-medium">Цена</th>
          </tr>
        </thead>
        <tbody>
          {services.map((service) => (
            <tr key={service.serviceId} className="border-b border-ink-100">
              <td className="py-2 pr-3 text-ink-900">{service.name}</td>
              <td className="tnum py-2 pr-3 text-ink-700">
                {formatDurationMinutes(service.durationMinutes) ?? '—'}
              </td>
              <td className="tnum py-2 text-ink-900">
                {service.priceMinor === null ? '—' : formatMoney(service.priceMinor, service.currency)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function SpecialistsList({ specialists }: { specialists: QtimeSpecialist[] }) {
  return (
    <ul className="divide-y divide-ink-100">
      {specialists.map((specialist) => {
        const rating = ratingOfFive(specialist.ratingBp);
        return (
          <li key={specialist.specialistId} className="flex flex-wrap items-start justify-between gap-2 py-2">
            <span className="min-w-0">
              <span className="block text-sm text-ink-900">{specialist.name}</span>
              <span className="mt-0.5 flex flex-wrap items-center gap-2">
                {specialist.specialization ? <Chip tone="info">{specialist.specialization}</Chip> : null}
                <span className="font-mono text-xs text-ink-500">{shortId(specialist.specialistId)}</span>
              </span>
            </span>
            <span className="tnum shrink-0 text-right text-xs text-ink-600">
              {rating ? (
                <span className="block">★ {rating}</span>
              ) : (
                <span className="block text-ink-500">без оценки</span>
              )}
              {specialist.experienceYears === null ? null : (
                <span className="block text-ink-500">опыт {specialist.experienceYears} лет</span>
              )}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

/**
 * Окна дня мастера — то самое «окно работы» из брифа.
 *
 * Запрос уходит только по кнопке: у ручки три параметра (мастер, услуга, день), и
 * автоматический пересчёт на каждое переключение — это три лишних вызова сервиса на
 * каждое движение. Ответ содержит все клетки рабочего дня, свободные и занятые:
 * клиент, по документации ручки, должен видеть занятое время, а не пустое место.
 */
function SlotsBlock({ company }: { company: QtimeCompanyDetail }) {
  const [specialistId, setSpecialistId] = useState(company.specialists[0]?.specialistId ?? '');
  const [serviceId, setServiceId] = useState(company.services[0]?.serviceId ?? '');
  const [date, setDate] = useState(() => cityDayKey());
  const [requested, setRequested] = useState<{ specialistId: string; serviceId: string; date: string } | null>(
    null,
  );

  const enabled = specialistId !== '' && serviceId !== '' && date !== '';

  const query = useQuery({
    queryKey: referenceKeys.slots(
      requested?.specialistId ?? '',
      requested?.serviceId ?? '',
      requested?.date ?? '',
    ),
    queryFn: () =>
      fetchQtimeSlots({
        specialistId: requested?.specialistId ?? '',
        serviceId: requested?.serviceId ?? '',
        date: requested?.date ?? '',
      }),
    enabled: requested !== null,
    staleTime: 60_000,
  });

  const data = query.data;
  const free = data?.slots.filter((slot) => slot.available).length ?? 0;

  return (
    <div className="space-y-3 rounded-xl border border-ink-100 p-3">
      <div className="min-w-0">
        <p className="text-sm font-medium text-ink-900">Окно работы мастера</p>
        <p className="text-xs text-ink-500">
          Зона расписания компании:{' '}
          <span className="font-mono">{company.timezone ?? 'сервис не назвал'}</span>. Часов работы в карточке
          компании API не отдаёт — окна дня считает{' '}
          <Endpoint>GET /api/v1/qtime/specialists/&#123;id&#125;/slots</Endpoint> (её нет в объявленном списке
          эндпоинтов раздела: реестр разделов правят не здесь).
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <SelectField
          id="reference-slot-specialist"
          label="Мастер"
          value={specialistId}
          options={company.specialists.map((specialist) => ({
            value: specialist.specialistId,
            label: specialist.name,
          }))}
          onChange={(event) => setSpecialistId(event.target.value)}
        />
        <SelectField
          id="reference-slot-service"
          label="Услуга"
          value={serviceId}
          options={company.services.map((service) => ({ value: service.serviceId, label: service.name }))}
          onChange={(event) => setServiceId(event.target.value)}
        />
        <TextField
          id="reference-slot-date"
          label="День"
          type="date"
          value={date}
          hint="Дата — в зоне компании, а не в зоне браузера"
          onChange={(event) => setDate(event.target.value)}
        />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          disabled={!enabled}
          loading={query.isFetching}
          onClick={() => setRequested({ specialistId, serviceId, date })}
        >
          Показать окна
        </Button>
        {requested ? (
          <Button variant="ghost" size="sm" onClick={() => setRequested(null)}>
            Убрать
          </Button>
        ) : (
          <span className="text-xs text-ink-500">
            Запрос уходит по кнопке: у ручки три параметра, и каждый пересчёт — отдельный вызов сервиса.
          </span>
        )}
      </div>

      {requested !== null && query.isPending ? <SkeletonRows count={2} /> : null}

      {query.isError ? (
        <RequestError
          label="Окна этого дня получить не получилось"
          error={query.error}
          onRetry={() => void query.refetch()}
        />
      ) : null}

      {data ? (
        data.slots.length === 0 ? (
          <p className="rounded-xl border border-dashed border-ink-200 px-3 py-4 text-center text-sm text-ink-500">
            На {data.date} сервис не вернул ни одной клетки: день вне расписания мастера — это пустой список,
            а не ошибка. Зона ответа: <span className="font-mono">{data.timezone}</span>
            {formatDurationMinutes(data.durationMinutes)
              ? `, услуга занимает ${formatDurationMinutes(data.durationMinutes)}`
              : ''}
            .
          </p>
        ) : (
          <div className="space-y-2">
            <p className="text-xs text-ink-500">
              {data.date} · свободно {free} из {data.slots.length} · зона{' '}
              <span className="font-mono">{data.timezone}</span>
            </p>
            <ul className="flex flex-wrap gap-1.5">
              {data.slots.map((slot) => (
                <li key={slot.startsAt}>
                  <span
                    title={slot.reason ?? (slot.available ? 'свободно' : 'занято')}
                    className={cx(
                      'tnum inline-block rounded-full px-2.5 py-1 text-xs',
                      slot.available
                        ? 'bg-success-50 text-success-700 ring-1 ring-inset ring-emerald-200'
                        : 'bg-ink-100 text-ink-400 line-through',
                    )}
                  >
                    {cityTime(slot.startsAt)}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )
      ) : null}
    </div>
  );
}

/* -------------------------------------------------------------- котировка */

function QuoteResult({ quote }: { quote: TripQuote }) {
  const partsSum = sumMinor([
    quote.breakdown.baseMinor,
    quote.breakdown.distanceMinor,
    quote.breakdown.timeMinor,
  ]);
  const consistent = partsSum === quote.priceMinor;
  const percent = commissionPercent(quote.commissionBp);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone="brand">{tariffLabel(quote.tariff)}</Badge>
        <Badge tone={consistent ? 'success' : 'danger'}>
          {consistent
            ? 'части цены складываются в итог'
            : `части дают ${formatMoney(partsSum, quote.currency)}, а итог — ${formatMoney(quote.priceMinor, quote.currency)}`}
        </Badge>
        <Badge tone="neutral">{surgeLabel(quote.surgeBp)}</Badge>
      </div>

      <dl className="grid gap-x-8 sm:grid-cols-2">
        <DetailRow label="Расстояние">{formatDistanceMeters(quote.distanceM)}</DetailRow>
        <DetailRow label="В пути">{formatDurationSeconds(quote.durationS)}</DetailRow>
        <DetailRow label="Итого">{formatMoney(quote.priceMinor, quote.currency)}</DetailRow>
        <DetailRow label="Посадка (base)">{formatMoney(quote.breakdown.baseMinor, quote.currency)}</DetailRow>
        <DetailRow label="За расстояние">{formatMoney(quote.breakdown.distanceMinor, quote.currency)}</DetailRow>
        <DetailRow label="За время">{formatMoney(quote.breakdown.timeMinor, quote.currency)}</DetailRow>
        <DetailRow label="Комиссия платформы">
          {percent ? `${percent} · ` : ''}
          {formatMoney(quote.commissionMinor, quote.currency)}
        </DetailRow>
        <DetailRow label="Водителю">{formatMoney(quote.driverNetMinor, quote.currency)}</DetailRow>
        <DetailRow label="Котировка">
          <span className="font-mono text-xs">{shortId(quote.quoteId)}</span>
          <CopyButton value={quote.quoteId} />
        </DetailRow>
        <DetailRow label="Действует до">
          {formatDateTime(quote.expiresAt)}
          <span className="ml-2 text-xs text-ink-500">{formatRelative(quote.expiresAt)}</span>
        </DetailRow>
      </dl>

      <p className="text-xs text-ink-500">
        Класс поездки и цена — результат расчёта `FareCalculator` по конфигурации trip-service. Каталога
        тарифов в API нет, поэтому увидеть применённый тариф можно только так.
      </p>
    </div>
  );
}

function QuoteCalculator({ onQuote }: { onQuote: (quote: TripQuote) => void }) {
  const [form, setForm] = useState<QuoteForm>(() => initialQuoteForm());
  const [errors, setErrors] = useState<QuoteFormErrors>({});

  /**
   * `useMutation`, а не `useQuery`: расчёт запускается нажатием, его результат нельзя
   * переиспользовать между разными полями, и он не должен обновляться сам по себе.
   * Изменяющим действием это не является: котировка ничего не резервирует — сервис
   * лишь сохраняет цену на 5 минут, чтобы по ней можно было заказать поездку.
   */
  const quote = useMutation({
    mutationFn: (body: TripQuoteRequest) => requestTripQuote(body),
    onSuccess: (data) => onQuote(data),
  });

  const setField = (field: keyof QuoteForm, value: string) => {
    setForm((current) => ({ ...current, [field]: value }));
  };

  const submit = () => {
    const check = buildQuoteRequest(form);
    setErrors(check.errors);
    if (check.ok) {
      quote.mutate(check.body);
    }
  };

  const hint = quote.isError ? quoteFailureHint(quote.error) : null;

  return (
    <Panel
      title="Калькулятор котировки поездки"
      subtitle={
        <>
          <Endpoint>POST /api/v1/trips/quote</Endpoint> (<Endpoint>TripController.quote</Endpoint>) · тело —
          координаты двух точек и класс поездки, ответ — цена с разбором на части, комиссия и заработок
          водителя
        </>
      }
      action={
        <Button
          variant="secondary"
          size="sm"
          onClick={() => {
            setForm(initialQuoteForm(form.tariff));
            setErrors({});
          }}
        >
          Центр Шымкента
        </Button>
      }
      bodyClassName="space-y-4"
    >
      <Alert tone="warning" title="Котировка требует роль CUSTOMER">
        Цена привязывается к кошельку, с которого поездка будет оплачена, поэтому trip-service требует роль
        CUSTOMER (<Endpoint>TripAccess.requireRider</Endpoint>). Токен админ-панели несёт ADMIN и SUPPORT, и
        на запрос с таким токеном сервис ответит 403{' '}
        <span className="font-mono">FORBIDDEN_TRIP_ACCESS</span> — раздел покажет это как есть, вместе с
        кодом и correlation id. Роль CUSTOMER добавляется на экране входа при получении токена: с ней тот же
        расчёт вернёт настоящий класс поездки и разбор цены.
      </Alert>

      <form
        className="space-y-4"
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        <div className="grid gap-4 lg:grid-cols-2">
          <fieldset className="space-y-3 rounded-xl border border-ink-100 p-3">
            <legend className="px-1 text-xs font-medium text-ink-500">Откуда (pickup)</legend>
            <div className="grid gap-3 sm:grid-cols-2">
              <TextField
                id="reference-quote-pickup-lat"
                label="Широта"
                inputMode="decimal"
                value={form.pickupLat}
                error={errors.pickupLat}
                hint="-90 … 90"
                onChange={(event) => setField('pickupLat', event.target.value)}
              />
              <TextField
                id="reference-quote-pickup-lon"
                label="Долгота"
                inputMode="decimal"
                value={form.pickupLon}
                error={errors.pickupLon}
                hint="-180 … 180"
                onChange={(event) => setField('pickupLon', event.target.value)}
              />
            </div>
            <TextField
              id="reference-quote-pickup-address"
              label="Адрес подачи"
              value={form.pickupAddress}
              error={errors.pickupAddress}
              hint="Необязателен: сервис его сохраняет и возвращает в чеке"
              onChange={(event) => setField('pickupAddress', event.target.value)}
            />
          </fieldset>

          <fieldset className="space-y-3 rounded-xl border border-ink-100 p-3">
            <legend className="px-1 text-xs font-medium text-ink-500">Куда (dropoff)</legend>
            <div className="grid gap-3 sm:grid-cols-2">
              <TextField
                id="reference-quote-dropoff-lat"
                label="Широта"
                inputMode="decimal"
                value={form.dropoffLat}
                error={errors.dropoffLat}
                hint="-90 … 90"
                onChange={(event) => setField('dropoffLat', event.target.value)}
              />
              <TextField
                id="reference-quote-dropoff-lon"
                label="Долгота"
                inputMode="decimal"
                value={form.dropoffLon}
                error={errors.dropoffLon}
                hint="-180 … 180"
                onChange={(event) => setField('dropoffLon', event.target.value)}
              />
            </div>
            <TextField
              id="reference-quote-dropoff-address"
              label="Адрес назначения"
              value={form.dropoffAddress}
              error={errors.dropoffAddress}
              hint="Необязателен, длина до 256 символов"
              onChange={(event) => setField('dropoffAddress', event.target.value)}
            />
          </fieldset>
        </div>

        <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
          <SelectField
            id="reference-quote-tariff"
            label="Класс поездки (tariff)"
            value={form.tariff}
            options={tariffOptions()}
            hint="ECONOMY и COMFORT — значения enum Tariff из кода trip-service: каталога тарифов в API нет."
            onChange={(event) =>
              setForm((current) => ({ ...current, tariff: event.target.value as QuoteForm['tariff'] }))
            }
          />
          <Button type="submit" loading={quote.isPending}>
            Рассчитать котировку
          </Button>
        </div>
      </form>

      {quote.isPending ? <SkeletonRows count={3} /> : null}

      {quote.isError ? (
        <ErrorAlert
          error={quote.error}
          title={hint ?? 'Котировку посчитать не вышло'}
          onRetry={() => {
            const check = buildQuoteRequest(form);
            if (check.ok) {
              quote.mutate(check.body);
            }
          }}
        />
      ) : null}

      {quote.data ? <QuoteResult quote={quote.data} /> : null}

      {!quote.data && !quote.isError && !quote.isPending ? (
        <p className="text-sm text-ink-500">
          Поля заполнены центром Шымкента: 42.3155, 69.5867 → 42.3355, 69.6067. Котировка денег не держит —
          сервис только запоминает цену на 5 минут, поэтому расчёт можно повторять сколько нужно.
        </p>
      ) : null}
    </Panel>
  );
}

/* ------------------------------------------------------------ сам раздел */

export default function ReferenceSection({ role, canWrite }: AdminSectionProps) {
  const queryClient = useQueryClient();

  const [category, setCategory] = useState<string | null>(null);
  const [productsPage, setProductsPage] = useState(0);
  const [companiesPage, setCompaniesPage] = useState(0);
  const [companySearch, setCompanySearch] = useState('');
  const [companyId, setCompanyId] = useState<string | null>(null);
  const [lastQuote, setLastQuote] = useState<TripQuote | null>(null);

  /* Категории каталога: публичная ручка, отдаёт массив имён. */
  const categoriesQuery = useQuery({
    queryKey: referenceKeys.categories(),
    queryFn: fetchCategories,
    staleTime: REFERENCE_STALE_MS,
  });
  const categories = useMemo(() => categoriesQuery.data ?? [], [categoriesQuery.data]);
  /**
   * Имена категорий отдельно от объектов: `fetchCategories` нормализует ответ
   * (строки из API становятся `{name, slug}`), а ключи запросов, рейл и фильтр
   * товаров работают с именем — по нему же фильтрует `?category=` в каталоге.
   */
  const categoryNames = useMemo(() => categories.map((item) => item.name), [categories]);

  /* Товаров в каталоге: одна страница из одного товара ради totalElements. */
  const catalogTotalQuery = useQuery({
    queryKey: referenceKeys.catalogTotal(),
    queryFn: fetchCatalogProductTotal,
    staleTime: REFERENCE_STALE_MS,
  });

  /* Счётчики по категориям — по запросу на категорию, но не больше предела. */
  const countedCategories = useMemo(() => categoryNames.slice(0, MAX_CATEGORY_COUNTS), [categoryNames]);
  const countQueries = useQueries({
    queries: countedCategories.map((name) => ({
      queryKey: referenceKeys.categoryCount(name),
      queryFn: () => fetchCategoryProductCount(name),
      staleTime: REFERENCE_STALE_MS,
    })),
  });

  const counts: Record<string, number | null> = {};
  countedCategories.forEach((name, index) => {
    counts[name] = countQueries[index]?.data ?? null;
  });
  const countsPending = countedCategories.length > 0 && countQueries.some((query) => query.isPending);
  const failedCount = countQueries.find((query) => query.isError);
  const countNote = categoryCountNote(categoryNames.length, countedCategories.length);

  /* Товары выбранной категории. */
  const productsQuery = useQuery({
    queryKey: referenceKeys.products(category, productsPage),
    queryFn: () =>
      fetchProducts({
        category: category ?? undefined,
        page: productsPage,
        size: REFERENCE_PRODUCTS_PAGE_SIZE,
      }),
    staleTime: 60_000,
  });

  /* Компании QTime: список страницами, поиск — отдельным запросом и только с текстом. */
  const search = useDebouncedValue(companySearch).trim();
  const companiesQuery = useQuery({
    queryKey: referenceKeys.companies(companiesPage),
    queryFn: () => fetchQtimeCompanies({ page: companiesPage, size: REFERENCE_COMPANIES_PAGE_SIZE }),
    enabled: search === '',
    staleTime: 60_000,
  });
  const searchQuery = useQuery({
    queryKey: referenceKeys.companySearch(search),
    queryFn: () => fetchQtimeCompanies({ query: search, page: 0, size: REFERENCE_SEARCH_LIMIT }),
    // Пустое поле не уходит на сервер: список страницами уже загружен, а `query=`
    // без текста вернул бы тот же список ещё раз.
    enabled: search !== '',
    staleTime: 60_000,
  });

  const searchMode = search !== '';
  const activeList = searchMode ? searchQuery : companiesQuery;
  const visibleCompanies = activeList.data?.items ?? [];

  const companyQuery = useQuery({
    queryKey: referenceKeys.company(companyId ?? ''),
    queryFn: () => fetchQtimeCompany(companyId ?? ''),
    enabled: companyId !== null,
    staleTime: 60_000,
  });
  const company = companyQuery.data ?? null;

  const contextOptions = useMemo(() => {
    const options = visibleCompanies.map((item) => ({ value: item.companyId, label: item.name }));
    if (companyId && !options.some((option) => option.value === companyId)) {
      options.unshift({ value: companyId, label: company?.name ?? shortId(companyId) });
    }
    return options;
  }, [visibleCompanies, companyId, company]);

  const snapshot = referenceSnapshotJson({
    categories,
    categoryCounts: counts,
    catalogTotal: catalogTotalQuery.data ?? null,
    category,
    products: productsQuery.data ?? null,
    companies: visibleCompanies,
    companiesTotal: companiesQuery.data?.totalElements ?? null,
    company,
    quote: lastQuote,
  });

  const servicesCount = company ? company.services.length : null;
  const specialistsCount = company ? company.specialists.length : null;

  return (
    <div className="space-y-4">
      <Alert tone="info" title="Раздел ничего не меняет">
        Здесь четыре чтения (<Endpoint>GET /api/v1/catalog/categories</Endpoint>,{' '}
        <Endpoint>/catalog/products</Endpoint>, <Endpoint>/qtime/companies</Endpoint>,{' '}
        <Endpoint>/qtime/companies/&#123;id&#125;</Endpoint>) и один расчёт —{' '}
        <Endpoint>POST /api/v1/trips/quote</Endpoint>. Котировка денег не резервирует, поэтому изменяющих
        действий в разделе нет ни у {roleLabel('ADMIN')}, ни у {roleLabel('SUPPORT')}
        {canWrite ? ' — и у вас роль ADMIN, но менять здесь всё равно нечего' : ''}. Вы вошли как{' '}
        {roleLabel(role)}.
      </Alert>

      {/* Полоса контекста: сколько нашлось, компания дня, обновление и снимок данных. */}
      <Toolbar
        right={
          <>
            <Button variant="secondary" size="sm" onClick={() => void queryClient.invalidateQueries({ queryKey: referenceKeys.all })}>
              Обновить
            </Button>
            <CopyJsonButton value={snapshot} />
          </>
        }
      >
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone="info">товаров в выборке: {productsQuery.data?.totalElements ?? '—'}</Badge>
          <Badge tone="neutral">компаний QTime: {companiesQuery.data?.totalElements ?? '—'}</Badge>
          <Badge tone="neutral">категорий: {categoriesQuery.isPending ? '—' : categories.length}</Badge>
        </div>
        <div className="w-full sm:w-72">
          <SelectField
            id="reference-company-context"
            label="Компания QTime"
            placeholder="— не выбрана —"
            value={companyId ?? ''}
            options={contextOptions}
            hint="Список — компании загруженной страницы: ручки «все компании одним списком» у QTime нет."
            onChange={(event) => setCompanyId(event.target.value === '' ? null : event.target.value)}
          />
        </div>
      </Toolbar>

      {/* Плитки: 4 в ряд на широком экране, как в эталонной админке. */}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiTile
          icon="🗂"
          tone="brand"
          label="Категорий в каталоге"
          value={categories.length}
          caption="GET /api/v1/catalog/categories — категории, в которых есть активный товар"
          loading={categoriesQuery.isPending}
        />
        <KpiTile
          icon="📦"
          tone="info"
          label="Товаров в каталоге"
          value={catalogTotalQuery.data === undefined ? '—' : catalogTotalQuery.data}
          caption="totalElements от /catalog/products: серверный итог, а не размер страницы"
          loading={catalogTotalQuery.isPending}
        />
        <KpiTile
          icon="🏢"
          tone="success"
          label="Компаний QTime"
          value={companiesQuery.data === undefined ? '—' : companiesQuery.data.totalElements}
          caption="totalElements от /qtime/companies: активные компании, лучшие по рейтингу первыми"
          loading={!searchMode && companiesQuery.isPending}
        />
        <KpiTile
          icon="🧾"
          tone="warning"
          label="Услуг у выбранной компании"
          value={servicesCount === null ? '—' : servicesCount}
          caption={
            specialistsCount === null
              ? 'компания не выбрана — откройте карточку в списке ниже'
              : `мастеров: ${specialistsCount} · ${company?.name ?? ''}`
          }
          loading={companyId !== null && companyQuery.isPending}
        />
      </div>

      {/* Рейл категорий слева, таблица товаров справа. */}
      <div className="grid gap-4 lg:grid-cols-[18rem_minmax(0,1fr)]">
        <Panel
          title="Категории каталога"
          subtitle="Клик по категории фильтрует таблицу справа"
          // `min-w-0` обязателен: у grid-элемента `min-width: auto`, и таблица
          // соседней панели (min-w-[46rem]) растянула бы страницу на телефоне.
          className="min-w-0"
          bodyClassName="space-y-3"
        >
          {categoriesQuery.isPending ? <SkeletonRows count={4} /> : null}

          {categoriesQuery.isError ? (
            <RequestError
              label="Категории каталога не загрузились"
              error={categoriesQuery.error}
              onRetry={() => void categoriesQuery.refetch()}
            />
          ) : null}

          {categoriesQuery.data ? (
            categories.length === 0 ? (
              <EmptyState
                title="Категорий нет"
                description="Каталог вернул пустой список: категория появляется в витрине только тогда, когда в ней есть хотя бы один активный товар."
              />
            ) : (
              <>
                <StatusRail
                  ariaLabel="Категории каталога"
                  allLabel="Все категории"
                  allCount={catalogTotalQuery.data}
                  active={category ?? ''}
                  items={categoryNames.map((name) => ({
                    value: name,
                    label: name,
                    count: counts[name] ?? undefined,
                  }))}
                  onSelect={(value) => {
                    setCategory(value === '' ? null : value);
                    setProductsPage(0);
                  }}
                />
                {countsPending ? (
                  <p className="flex items-center gap-2 text-xs text-ink-500">
                    <Skeleton className="h-3 w-3 rounded-full" />
                    считаем товары по категориям: на каждую — свой запрос
                  </p>
                ) : null}
                {failedCount ? (
                  <RequestError
                    label="Часть счётчиков не посчиталась"
                    error={failedCount.error}
                    onRetry={() => void failedCount.refetch()}
                  />
                ) : null}
                {catalogTotalQuery.isError ? (
                  <RequestError
                    label="Итог по каталогу не пришёл"
                    error={catalogTotalQuery.error}
                    onRetry={() => void catalogTotalQuery.refetch()}
                  />
                ) : null}
                {countNote ? <p className="text-xs text-ink-500">{countNote}</p> : null}
              </>
            )
          ) : null}
        </Panel>

        <Panel
          title={category === null ? 'Товары: все категории' : `Товары: ${category}`}
          subtitle={
            <>
              <Endpoint>GET /api/v1/catalog/products</Endpoint> · страница {productsPage + 1} по{' '}
              {REFERENCE_PRODUCTS_PAGE_SIZE} строк
            </>
          }
          action={
            <Link to={CATALOG_PATH} className="text-sm font-medium text-brand-700 hover:underline">
              Витрина
            </Link>
          }
          className="min-w-0"
          bodyClassName="space-y-3"
        >
          {productsQuery.isPending ? <SkeletonRows count={REFERENCE_PRODUCTS_PAGE_SIZE} /> : null}

          {productsQuery.isError ? (
            <RequestError
              label="Товары этой категории не загрузились"
              error={productsQuery.error}
              onRetry={() => void productsQuery.refetch()}
            />
          ) : null}

          {productsQuery.data ? (
            productsQuery.data.items.length === 0 ? (
              <EmptyState
                title="Ни одного товара"
                description={
                  category === null
                    ? 'Каталог ответил пустой страницей: активных товаров нет вовсе.'
                    : `В категории «${category}» сервис не вернул ни одного товара на этой странице.`
                }
              />
            ) : (
              <>
                <ProductsTable products={productsQuery.data.items} />
                <Pagination
                  page={productsQuery.data.page}
                  totalPages={productsQuery.data.totalPages}
                  hasNext={productsQuery.data.hasNext}
                  totalElements={productsQuery.data.totalElements}
                  isFetching={productsQuery.isFetching}
                  onPageChange={setProductsPage}
                />
              </>
            )
          ) : null}
        </Panel>
      </div>

      {/* Компании QTime: список с поиском и пагинацией. */}
      <Panel
        title="Компании QTime"
        subtitle={
          <>
            <Endpoint>GET /api/v1/qtime/companies</Endpoint> · поиск по названию уходит в сервис только с
            непустым текстом
          </>
        }
        action={
          <Chip tone={searchMode ? 'info' : 'neutral'}>
            {searchMode ? `поиск: ${search}` : 'список страницами'}
          </Chip>
        }
        bodyClassName="space-y-3"
      >
        <div className="w-full sm:w-80">
          <TextField
            id="reference-company-search"
            label="Поиск компаний по названию"
            placeholder="например, Лотос"
            value={companySearch}
            hint="Пока поле пустое, запрос с query не отправляется — показывается список по страницам."
            onChange={(event) => setCompanySearch(event.target.value)}
          />
        </div>

        {activeList.isPending && searchMode ? <SkeletonRows count={3} /> : null}
        {companiesQuery.isPending && !searchMode ? <SkeletonRows count={3} /> : null}

        {activeList.isError ? (
          <RequestError
            label={searchMode ? `Поиск «${search}» не удался` : 'Компании QTime не загрузились'}
            error={activeList.error}
            onRetry={() => void activeList.refetch()}
          />
        ) : null}

        {activeList.data ? (
          visibleCompanies.length === 0 ? (
            <EmptyState
              title={searchMode ? 'Ничего не нашлось' : 'Компаний нет'}
              description={
                searchMode
                  ? `По запросу «${search}» сервис не вернул ни одной компании. Поиск идёт по подстроке названия.`
                  : 'QTime вернул пустую страницу: активных компаний нет.'
              }
            />
          ) : (
            <>
              {searchMode ? (
                <p className="text-xs text-ink-500">
                  Поиск возвращает первые {REFERENCE_SEARCH_LIMIT} совпадений: страниц у него нет, а сузить
                  выбор можно уточнением названия.
                </p>
              ) : null}
              <CompaniesTable companies={visibleCompanies} selectedId={companyId} onSelect={setCompanyId} />
              {!searchMode ? (
                <Pagination
                  page={activeList.data.page}
                  totalPages={activeList.data.totalPages}
                  hasNext={activeList.data.hasNext}
                  totalElements={activeList.data.totalElements}
                  isFetching={companiesQuery.isFetching}
                  onPageChange={setCompaniesPage}
                />
              ) : null}
            </>
          )
        ) : null}
      </Panel>

      {/* Карточка компании: слева услуги, справа мастера и окно работы. */}
      {companyId === null ? (
        <Panel
          title="Карточка компании"
          subtitle={
            <>
              Данные — из <Endpoint>GET /api/v1/qtime/companies/&#123;companyId&#125;</Endpoint>: услуги,
              мастера и зона расписания
            </>
          }
        >
          <EmptyState
            title="Компания не выбрана"
            description="Нажмите «Открыть» в списке выше — раздел покажет услуги с ценой и длительностью, мастеров и окно работы выбранной компании."
          />
        </Panel>
      ) : (
        <div className="grid gap-4 xl:grid-cols-2">
          <Panel
            title={company?.name ?? `Компания ${shortId(companyId)}`}
            subtitle={company ? `${companyPlace(company)}` : companyId}
            action={
              <>
                <Chip tone="brand">
                  услуг: {servicesCount === null ? '—' : servicesCount}
                </Chip>
                <Link
                  to={`${SERVICES_PATH}/${encodeURIComponent(companyId)}`}
                  className="text-sm font-medium text-brand-700 hover:underline"
                >
                  В каталоге
                </Link>
                <Button variant="ghost" size="sm" onClick={() => setCompanyId(null)}>
                  Закрыть
                </Button>
              </>
            }
            className="min-w-0"
            bodyClassName="space-y-3"
          >
            {companyQuery.isPending ? <SkeletonRows count={4} /> : null}

            {companyQuery.isError ? (
              <RequestError
                label="Карточка компании не загрузилась"
                error={companyQuery.error}
                onRetry={() => void companyQuery.refetch()}
              />
            ) : null}

            {company ? (
              <>
                <dl className="grid gap-x-8 sm:grid-cols-2">
                  <DetailRow label="Категория">{company.category ?? '—'}</DetailRow>
                  <DetailRow label="Город">{company.city ?? '—'}</DetailRow>
                  <DetailRow label="Адрес">{company.address ?? '—'}</DetailRow>
                  <DetailRow label="Координаты">
                    {company.lat === null || company.lon === null ? '—' : `${company.lat}, ${company.lon}`}
                  </DetailRow>
                  <DetailRow label="Рейтинг">
                    {ratingOfFive(company.ratingBp) ?? 'нет оценки'}
                    {company.reviewsCount === null ? '' : ` · отзывов: ${company.reviewsCount}`}
                  </DetailRow>
                  <DetailRow label="Зона расписания">
                    <span className="font-mono text-xs">{company.timezone ?? '—'}</span>
                  </DetailRow>
                </dl>

                {company.services.length === 0 ? (
                  <EmptyState
                    title="Услуг нет"
                    description="Сервис вернул карточку без единой услуги: у компании пока нет опубликованного прайса."
                  />
                ) : (
                  <ServicesTable services={company.services} />
                )}
              </>
            ) : null}
          </Panel>

          <Panel
            title="Мастера и окно работы"
            subtitle="Специалисты компании и свободные окна дня — из тех же публичных ручек QTime"
            action={<Chip tone="info">мастеров: {specialistsCount === null ? '—' : specialistsCount}</Chip>}
            className="min-w-0"
            bodyClassName="space-y-4"
          >
            {companyQuery.isPending ? <SkeletonRows count={3} /> : null}

            {companyQuery.isError ? (
              <RequestError
                label="Мастеров получить не удалось"
                error={companyQuery.error}
                onRetry={() => void companyQuery.refetch()}
              />
            ) : null}

            {company ? (
              <>
                {company.specialists.length === 0 ? (
                  <EmptyState
                    title="Мастеров нет"
                    description="В карточке компании нет ни одного специалиста, поэтому и окна запрашивать не у кого."
                  />
                ) : (
                  <SpecialistsList specialists={company.specialists} />
                )}

                {company.specialists.length > 0 && company.services.length > 0 ? (
                  // key — чтобы выбор мастера и услуги не переезжал с компании на компанию.
                  <SlotsBlock key={company.companyId} company={company} />
                ) : (
                  <p className="text-sm text-ink-500">
                    Окна не запрашиваются: ручке нужны и мастер, и услуга, а в карточке этой компании чего-то
                    из них нет.
                  </p>
                )}
              </>
            ) : null}
          </Panel>
        </div>
      )}

      <QuoteCalculator onQuote={setLastQuote} />

      {/* Честный список того, чего в API нет. */}
      <Panel
        title="Чего в API нет"
        subtitle="Это не пробел в вёрстке раздела: таких данных не отдаёт ни один сервис, поэтому здесь их и нет"
      >
        <ul className="space-y-3">
          {REFERENCE_API_GAPS.map((gap) => (
            <li key={gap.title} className="rounded-xl border border-ink-100 p-3">
              <p className="flex flex-wrap items-center gap-2 text-sm font-medium text-ink-900">
                {gap.title}
                <Chip tone="warning">нет ручки</Chip>
              </p>
              <p className="mt-1 text-sm text-ink-600">{gap.detail}</p>
              <p className="mt-1 font-mono text-xs text-ink-400">{gap.checked}</p>
            </li>
          ))}
        </ul>
      </Panel>
    </div>
  );
}
