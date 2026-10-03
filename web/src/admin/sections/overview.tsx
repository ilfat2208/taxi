/**
 * Раздел «Обзор» админ-панели: что происходит на платформе прямо сейчас.
 *
 * Принцип раздела: каждая цифра — это ответ сервиса, а не украшение экрана.
 *  - счётчики берутся из настоящих листингов (`page=0&size=1` ради одного
 *    `totalElements`, сами строки обзору не нужны);
 *  - каждый блок живёт со своим запросом и своей ошибкой: упавший payment-service
 *    не должен гасить цифры по поездкам, поэтому общих запросов здесь нет;
 *  - нет ответа — так и написано («нет данных» + причина), нули вместо ошибки не
 *    подставляются;
 *  - состояние вертикалей — это факт удачного ответа их листинга, а не health-проба:
 *    публичного health у сервисов нет, через шлюз открыт только его собственный
 *    `/actuator/health`. Так и написано в карточке;
 *  - графиков нет: рисовать их не по чему — исторических точек API не отдаёт.
 */
import { useQuery } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { fetchBookings, fetchPayments, fetchProducts, fetchTrips } from '../../api/endpoints';
import { humanMessage } from '../../api/errors';
import { Alert, ErrorAlert } from '../../components/ui/Alerts';
import { Badge } from '../../components/ui/Badge';
import { Button, buttonClass } from '../../components/ui/Button';
import { Card, CardBody, CardHeader } from '../../components/ui/Card';
import { EmptyState } from '../../components/ui/EmptyState';
import { Skeleton, SkeletonRows } from '../../components/ui/Skeleton';
import { formatRelative, type Tone } from '../../lib/format';
import { fetchGatewayHealth } from '../api/gatewayHealth';
import type { AdminSectionProps } from '../sections';

/* ------------------------------------------------------------------ запросы */

/**
 * Состояние одного блока: загрузка, ошибка, текст ошибки.
 *
 * Блоки получают это по отдельности, а не общий `isLoading` раздела — иначе
 * недоступность одного сервиса выглядела бы как «обзор не загрузился».
 */
interface BlockState {
  isPending: boolean;
  isError: boolean;
  error: unknown;
}

function stateOf(query: BlockState): BlockState {
  return { isPending: query.isPending, isError: query.isError, error: query.error };
}

/**
 * Счётчик платежей платформы (`GET /api/v1/payments?page=0&size=1`).
 *
 * ADMIN видит все платежи платформы — это прямо записано в `PaymentController.list`
 * («an ADMIN sees every payment»), поэтому `totalElements` здесь — цифра по всей
 * платформе, а не по счетам вошедшего.
 */
function usePaymentsProbe(status?: string) {
  return useQuery({
    queryKey: ['admin', 'overview', 'payments', { status: status ?? 'ALL' }],
    queryFn: () => fetchPayments({ page: 0, size: 1, status }),
    staleTime: 30_000,
  });
}

/** Счётчик поездок; SUPPORT и ADMIN видят все поездки любого статуса. */
function useTripsProbe(status?: string) {
  return useQuery({
    queryKey: ['admin', 'overview', 'trips', { status: status ?? 'ALL' }],
    queryFn: () => fetchTrips({ page: 0, size: 1, status }),
    staleTime: 30_000,
  });
}

/** Счётчик записей QTime; SUPPORT и ADMIN видят записи всех клиентов. */
function useBookingsProbe(status?: string) {
  return useQuery({
    queryKey: ['admin', 'overview', 'bookings', { status: status ?? 'ALL' }],
    queryFn: () => fetchBookings({ page: 0, size: 1, status }),
    staleTime: 30_000,
  });
}

/**
 * Каталог: единственная витрина, которую можно опросить списком без идентификатора
 * (публичный `GET /api/v1/catalog/products`). Списка заказов в API нет — заказ
 * открывается только по идентификатору, о чём карточка сервисов говорит прямо.
 */
function useCatalogProbe() {
  return useQuery({
    queryKey: ['admin', 'overview', 'catalog'],
    queryFn: () => fetchProducts({ page: 0, size: 1 }),
    staleTime: 30_000,
  });
}

function useGatewayProbe() {
  return useQuery({
    queryKey: ['admin', 'overview', 'gateway'],
    queryFn: () => fetchGatewayHealth(),
    staleTime: 15_000,
  });
}

/* ------------------------------------------------------------ мелкие детали */

const GATEWAY_TONES: Record<string, Tone> = {
  UP: 'success',
  DOWN: 'danger',
  OUT_OF_SERVICE: 'warning',
  UNKNOWN: 'warning',
};

const GATEWAY_LABELS: Record<string, string> = {
  UP: 'работает',
  DOWN: 'не работает',
  OUT_OF_SERVICE: 'выведен из обслуживания',
  UNKNOWN: 'состояние неизвестно',
};

function gatewayTone(status: string): Tone {
  return GATEWAY_TONES[status.toUpperCase()] ?? 'neutral';
}

function gatewayLabel(status: string): string {
  return GATEWAY_LABELS[status.toUpperCase()] ?? `состояние «${status}»`;
}

/** Крупная цифра-счётчик. Значение либо настоящий `totalElements`, либо «нет данных». */
function KpiTile({
  title,
  source,
  value,
  state,
  footer,
}: {
  title: string;
  source: string;
  value: number | undefined;
  state: BlockState;
  footer?: ReactNode;
}) {
  return (
    <Card as="div">
      <CardBody>
        <p className="text-sm font-medium text-ink-600">{title}</p>

        {state.isPending ? <Skeleton className="mt-2 h-9 w-24" /> : null}

        {!state.isPending && state.isError ? (
          <p className="mt-1 text-2xl font-semibold text-ink-400">нет данных</p>
        ) : null}

        {!state.isPending && !state.isError ? (
          <p className="tnum mt-1 text-3xl font-semibold text-ink-900">{value ?? '—'}</p>
        ) : null}

        <p className="mt-2 text-xs text-ink-500">{source}</p>

        {state.isError ? (
          <p className="mt-1 text-xs text-brand-700">{humanMessage(state.error)}</p>
        ) : null}

        {footer ? <div className="mt-3">{footer}</div> : null}
      </CardBody>
    </Card>
  );
}

/** Строка блока «требует внимания»: сколько записей и куда идти разбираться. */
function AttentionRow({
  title,
  hint,
  count,
  state,
  to,
  linkLabel,
}: {
  title: string;
  hint: string;
  count: number | undefined;
  state: BlockState;
  to: string;
  linkLabel: string;
}) {
  const hasProblem = typeof count === 'number' && count > 0;
  return (
    <li className="border-b border-ink-100 py-3 last:border-b-0">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <p className="text-sm font-medium text-ink-900">{title}</p>
          <p className="mt-0.5 text-xs text-ink-500">{hint}</p>
        </div>
        <div className="flex shrink-0 items-center gap-3">
          {state.isPending ? <Skeleton className="h-6 w-10" /> : null}
          {!state.isPending && state.isError ? (
            <span className="text-xs font-medium text-brand-700">нет данных</span>
          ) : null}
          {!state.isPending && !state.isError ? (
            <span
              className={
                hasProblem
                  ? 'tnum text-lg font-semibold text-brand-700'
                  : 'tnum text-lg font-semibold text-ink-500'
              }
            >
              {count ?? '—'}
            </span>
          ) : null}
          <Link to={to} className={buttonClass({ variant: 'secondary', size: 'sm' })}>
            {linkLabel}
          </Link>
        </div>
      </div>
      {state.isError ? (
        <p className="mt-1 text-xs text-brand-700">{humanMessage(state.error)}</p>
      ) : null}
    </li>
  );
}

/** Строка карты сервисов: отвечает ли вертикаль на самом деле. */
function ServiceRow({
  title,
  endpoint,
  state,
  link,
}: {
  title: string;
  endpoint: string;
  state: BlockState;
  link?: { to: string; label: string };
}) {
  return (
    <li className="border-b border-ink-100 py-3 last:border-b-0">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <p className="text-sm font-medium text-ink-900">{title}</p>
          <p className="mt-0.5 font-mono text-xs break-words text-ink-400">{endpoint}</p>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          {state.isPending ? <Skeleton className="h-6 w-32" /> : null}
          {!state.isPending && state.isError ? <Badge tone="danger">нет данных</Badge> : null}
          {!state.isPending && !state.isError ? <Badge tone="success">данные приходят</Badge> : null}
          {link ? (
            <Link to={link.to} className={buttonClass({ variant: 'ghost', size: 'sm' })}>
              {link.label}
            </Link>
          ) : null}
        </div>
      </div>
      {state.isError ? (
        <p className="mt-1 text-xs text-brand-700">{humanMessage(state.error)}</p>
      ) : null}
    </li>
  );
}

/* ------------------------------------------------------------------- раздел */

export default function OverviewSection({ section }: AdminSectionProps) {
  const payments = usePaymentsProbe();
  const failedPayments = usePaymentsProbe('FAILED');
  const trips = useTripsProbe();
  const noDriverTrips = useTripsProbe('NO_DRIVERS_FOUND');
  const driverCancelledTrips = useTripsProbe('CANCELLED_BY_DRIVER');
  const bookings = useBookingsProbe();
  const companyCancelledBookings = useBookingsProbe('CANCELLED_BY_COMPANY');
  const catalog = useCatalogProbe();
  const gateway = useGatewayProbe();

  return (
    <div className="space-y-5">
      {/* Шлюз отдельной карточкой: его состояние — не счётчик, а ответ о здоровье. */}
      <Card>
        <CardHeader
          title="Состояние шлюза"
          subtitle="Единственный публичный health-эндпоинт платформы: GET /actuator/health"
          action={
            <Button
              variant="secondary"
              size="sm"
              loading={gateway.isFetching}
              onClick={() => void gateway.refetch()}
            >
              Проверить снова
            </Button>
          }
        />
        <CardBody>
          {gateway.isPending ? <SkeletonRows count={2} /> : null}

          {gateway.isError ? (
            <ErrorAlert
              error={gateway.error}
              title="Шлюз недоступен"
              onRetry={() => void gateway.refetch()}
            />
          ) : null}

          {gateway.data ? (
            <div className="space-y-3">
              <div className="flex flex-wrap items-center gap-2">
                <Badge tone={gatewayTone(gateway.data.status)}>{gateway.data.status}</Badge>
                <span className="text-sm text-ink-600">{gatewayLabel(gateway.data.status)}</span>
                {gateway.data.httpStatus !== 200 ? (
                  <span className="text-xs text-ink-500">
                    HTTP {gateway.data.httpStatus}
                    {gateway.data.status.toUpperCase() === 'DOWN'
                      ? ' — так шлюз отвечает, когда его состояние DOWN, и это ответ, а не сбой запроса'
                      : ''}
                  </span>
                ) : null}
              </div>

              {gateway.data.components.length > 0 ? (
                <ul className="divide-y divide-ink-100">
                  {gateway.data.components.map((component) => (
                    <li
                      key={component.name}
                      className="flex items-center justify-between gap-3 py-2 text-sm"
                    >
                      <span className="font-mono text-xs text-ink-600">{component.name}</span>
                      <Badge tone={gatewayTone(component.status)}>{component.status}</Badge>
                    </li>
                  ))}
                </ul>
              ) : (
                <EmptyState
                  title="Шлюз ответил без детализации"
                  description="В ответе пришёл только итоговый статус, без списка проверок. Детали (база, Redis, диск) закрыты настройкой management.endpoint.health.show-details, поэтому по этому экрану нельзя сказать, какая именно зависимость шлюза лежит — видно только, что шлюз жив или нет."
                />
              )}

              {gateway.dataUpdatedAt > 0 ? (
                <p className="text-xs text-ink-500">
                  Проверено {formatRelative(new Date(gateway.dataUpdatedAt).toISOString())}. Ответ
                  кэшируется на 15 секунд, кнопка «Проверить снова» обновляет его сразу.
                </p>
              ) : null}
            </div>
          ) : null}
        </CardBody>
      </Card>

      {/* Счётчики: по одной карточке на сервис, каждая со своей ошибкой. */}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiTile
          title="Платежи"
          source="Всего платежей платформы по данным payment-service"
          value={payments.data?.totalElements}
          state={stateOf(payments)}
        />
        <KpiTile
          title="Поездки"
          source="Всего поездок по данным trip-service"
          value={trips.data?.totalElements}
          state={stateOf(trips)}
        />
        <KpiTile
          title="Записи QTime"
          source="Всего записей на услуги по данным qtime-service"
          value={bookings.data?.totalElements}
          state={stateOf(bookings)}
        />
        <KpiTile
          title="Платежи с ошибкой"
          source="Платежи в состоянии FAILED — деньги клиента не дошли"
          value={failedPayments.data?.totalElements}
          state={stateOf(failedPayments)}
          footer={
            <Link to="/admin/payments" className={buttonClass({ variant: 'ghost', size: 'sm' })}>
              Разобрать в «Платежах»
            </Link>
          }
        />
      </div>

      <Card>
        <CardHeader
          title="Требует внимания"
          subtitle="Записи, которые платформа довела не до конца: их видно в разделах, здесь — только количество"
        />
        <CardBody>
          <ul>
            <AttentionRow
              title="Платежи с ошибкой"
              hint="status=FAILED: списание не прошло, у платежа есть код и причина отказа"
              count={failedPayments.data?.totalElements}
              state={stateOf(failedPayments)}
              to="/admin/payments"
              linkLabel="Открыть платежи"
            />
            <AttentionRow
              title="Поездки без водителя"
              hint="status=NO_DRIVERS_FOUND: заказ клиента никто не принял"
              count={noDriverTrips.data?.totalElements}
              state={stateOf(noDriverTrips)}
              to="/admin/trips"
              linkLabel="Открыть поездки"
            />
            <AttentionRow
              title="Поездки, отменённые водителем"
              hint="status=CANCELLED_BY_DRIVER: причина отмены записана в поездке"
              count={driverCancelledTrips.data?.totalElements}
              state={stateOf(driverCancelledTrips)}
              to="/admin/trips"
              linkLabel="Открыть поездки"
            />
            <AttentionRow
              title="Записи, отменённые компанией"
              hint="status=CANCELLED_BY_COMPANY: клиент пришёл бы, но окно сняли на стороне компании"
              count={companyCancelledBookings.data?.totalElements}
              state={stateOf(companyCancelledBookings)}
              to="/admin/bookings"
              linkLabel="Открыть записи"
            />
          </ul>
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title="Карта сервисов"
          subtitle="Отвечает ли вертикаль через шлюз — по факту ответа, а не по health-проверке"
        />
        <CardBody>
          <ul>
            <ServiceRow
              title="Платежи (payment-service)"
              endpoint="GET /api/v1/payments?page=0&size=1"
              state={stateOf(payments)}
              link={{ to: '/admin/payments', label: 'Раздел' }}
            />
            <ServiceRow
              title="Поездки (trip-service)"
              endpoint="GET /api/v1/trips?page=0&size=1"
              state={stateOf(trips)}
              link={{ to: '/admin/trips', label: 'Раздел' }}
            />
            <ServiceRow
              title="Записи на услуги (qtime-service)"
              endpoint="GET /api/v1/qtime/bookings?page=0&size=1"
              state={stateOf(bookings)}
              link={{ to: '/admin/bookings', label: 'Раздел' }}
            />
            <ServiceRow
              title="Каталог: магазины и товары (catalog-service)"
              endpoint="GET /api/v1/catalog/products?page=0&size=1"
              state={stateOf(catalog)}
              link={{ to: '/admin/catalog', label: 'Раздел' }}
            />
          </ul>

          <Alert tone="info" className="mt-3" title="Про заказы и парк — отдельными строками не показаны">
            Списка заказов в API нет: заказ открывается по номеру или идентификатору в разделе
            «Заказы», а весь список сразу сервис не отдаёт. Парк и диспетчерская опрашиваются через
            «живые» эндпоинты (`/dispatch/drivers`, `/dispatch/nearest`), где состояние — это
            проекция: свежесть позиций видно только в самом разделе «Парк и диспетчерская».
          </Alert>

          <Alert tone="info" className="mt-3" title="Что означает «данные приходят»">
            Это факт успешного ответа листинга конкретного сервиса через шлюз, а не проверка
            здоровья: публичного health-эндпоинта у сервисов нет, через шлюз открыт только
            `/actuator/health` самого шлюза. Поэтому «нет данных» здесь означает «на этот запрос
            ответа не пришло» — причину показывает текст ошибки ниже строки.
          </Alert>

          <div className="mt-4 flex flex-wrap gap-2">
            <Link to="/admin/payments" className={buttonClass({ variant: 'secondary', size: 'sm' })}>
              Платежи и возвраты
            </Link>
            <Link to="/admin/trips" className={buttonClass({ variant: 'secondary', size: 'sm' })}>
              Поездки
            </Link>
            <Link to="/admin/bookings" className={buttonClass({ variant: 'secondary', size: 'sm' })}>
              Записи QTime
            </Link>
            <Link to="/admin/fleet" className={buttonClass({ variant: 'secondary', size: 'sm' })}>
              Парк и диспетчерская
            </Link>
            <Link to="/admin/orders" className={buttonClass({ variant: 'secondary', size: 'sm' })}>
              Заказы
            </Link>
          </div>
        </CardBody>
      </Card>

      {/* Реестр разделов обещает обзору ещё и расчёты — их листинга в клиенте нет.
          Пометку «только чтение» здесь не рисуем: её рисует оболочка (AdminLayout). */}
      {section.endpoints.includes('/settlements') ? (
        <p className="text-xs text-ink-500">
          Расчёты с мерчантами в обзор не входят: листинга расчётов в клиенте пока нет, поэтому цифр
          по ним здесь не появится — смотрите раздел «Расчёты с мерчантами».
        </p>
      ) : null}
    </div>
  );
}
