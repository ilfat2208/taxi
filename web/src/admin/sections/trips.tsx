/**
 * Раздел админки «Поездки».
 *
 * Плотный рабочий экран, а не одна таблица на весь экран: сверху тулбар с фильтром, ниже
 * сводка и структура выборки, под ними — рейл статусов и список слева, деталь поездки справа
 * (`xl`; на узких экранах колонки складываются в одну). Заголовок, описание и список
 * эндпоинтов рисует оболочка (`src/admin/AdminPage.tsx` / `AdminLayout.tsx`), поэтому раздел
 * начинается с данных.
 *
 * Крупные блоки берутся из общего набора админки (`src/admin/kit.tsx`): он несёт атрибуты
 * плотности (`data-admin-panel`, `data-admin-kpi`), по которым считает блоки браузерная
 * проверка `web/e2e/check-admin.mjs`, и делает разделы похожими друг на друга, а не на семь
 * разных продуктов.
 *
 * Пять вещей сделаны намеренно честно:
 *
 *  1. <b>Агрегатов у сервиса нет.</b> «Всего по фильтру» и числа в рейле статусов — это
 *     `Page.totalElements` (счёт сервера: для рейла он берётся отдельным запросом `size=1`
 *     по каждому статусу). «В работе», «завершено», «отменено», сумма, средний чек и доля
 *     отмен посчитаны клиентом по выборке из последних 100 поездок с тем же фильтром — и
 *     подписаны именно так. Придумывать «в работе 37» по одной странице из 20 строк нельзя.
 *  2. <b>Карты здесь нет.</b> Раздел — это списочная работа с данными, а карта живёт в
 *     диспетчерской; маршрут показан пронумерованными точками с адресами и координатами,
 *     рядом ссылка на `/dispatch`.
 *  3. <b>Каждое изменяющее действие помечено `data-admin-write`</b> — по этой пометке
 *     браузерная проверка убеждается, что роль SUPPORT не видит ни одного действия,
 *     способного изменить данные на сервере. Поэтому блок действий целиком отсутствует при
 *     `canWrite === false`, а не «выключен».
 *  4. <b>Недоступное действие объясняется, а не прячется.</b> Назначение водителя сервис
 *     принимает только для `SEARCHING` (`TripSagaService.assign`), отмена — до `ARRIVED`
 *     включительно: после начала поездки тариф уже должен быть оплачен
 *     (`TripStatus.isCancellable`), и никакая роль этого не меняет.
 *  5. <b>Экспорт — это копирование того, что видно.</b> Кнопка «Экспорт CSV» кладёт в буфер
 *     обмена загруженные строки: серверной выгрузки у trip-service нет, и раздел не делает
 *     вид, что выгружает всю базу.
 */
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { fieldErrorOf, isApiError } from '../../api/errors';
import { fetchTrip, fetchTripReceipt, fetchTrips } from '../../api/endpoints';
import { formatMoney, sumMinor } from '../../api/money';
import type { Trip, TripPoint, TripQuery, TripReceipt, TripStatus } from '../../api/types';
import {
  DispatchIcon,
  LogoutIcon,
  OrdersIcon,
  PaymentsIcon,
  ShieldIcon,
  TaxiIcon,
  TransferIcon,
  WalletIcon,
} from '../../components/layout/icons';
import { Alert, ErrorAlert } from '../../components/ui/Alerts';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { DetailRow } from '../../components/ui/Card';
import { CopyButton } from '../../components/ui/CopyButton';
import { EmptyState } from '../../components/ui/EmptyState';
import { CheckboxField, SelectField, TextAreaField, TextField } from '../../components/ui/Field';
import { Pagination } from '../../components/ui/Pagination';
import { SkeletonRows, SkeletonText } from '../../components/ui/Skeleton';
import { Timeline, type TimelineEntry } from '../../components/ui/Timeline';
import { cx } from '../../lib/cx';
import {
  formatAgeSeconds,
  formatDateTime,
  formatDistanceMeters,
  formatRelative,
  shortId,
} from '../../lib/format';
import {
  TRIP_ACTIVE_STATUSES,
  TRIP_CANCELLABLE_STATUSES,
  actorLabel,
  commissionBpLabel,
  surgeLabel,
  tariffLabel,
  tripStatusLabel,
  tripStatusTone,
} from '../../lib/trips';
import { BarList, Chip, Donut, KpiTile, Panel, StatusRail, Toolbar } from '../kit';
import { assignTripDriver, cancelTripAsOperator, toCsv } from '../api/tripAdmin';
import type { AssignDriverBody, TripCanceller } from '../api/tripAdmin';
import type { AdminSectionProps } from '../sections';

/* ------------------------------------------------------------------ константы */

const PAGE_SIZE = 20;

/**
 * Размер выборки для сводки и диаграмм.
 *
 * `TripController.list` принимает `size` в диапазоне 1..100, поэтому 100 — это максимум,
 * который сервис отдаст за один запрос, и именно его имеет смысл взять для чисел, которых у
 * сервиса нет в виде агрегата.
 */
const KPI_SAMPLE_SIZE = 100;

/**
 * Значения `TripStatus` из trip-service (`domain/TripStatus.java`).
 *
 * Справочника статусов в API нет: `GET /trips?status=` принимает ровно это значение enum, и
 * любое другое сервис отвергнет с 400. Список нужен фильтру, рейлу статусов и диаграммам, а
 * не данным.
 */
const TRIP_STATUSES: TripStatus[] = [
  'SEARCHING',
  'ASSIGNED',
  'ARRIVED',
  'IN_PROGRESS',
  'COMPLETED',
  'CANCELLED_BY_RIDER',
  'CANCELLED_BY_DRIVER',
  'NO_DRIVERS_FOUND',
];

const TRIP_STATUS_FILTER_OPTIONS = TRIP_STATUSES.map((status) => ({
  value: status,
  label: tripStatusLabel(status),
}));

const PAGE_SIZE_OPTIONS = [10, 20, 50, 100].map((value) => ({
  value: String(value),
  label: `${value} строк`,
}));

/** Колонки CSV-экспорта: то, что видно в таблице, плюс идентификаторы для сверки. */
const CSV_HEADER = [
  'tripId',
  'tripNumber',
  'status',
  'tariff',
  'riderUserId',
  'driverId',
  'driverName',
  'vehiclePlate',
  'priceMinor',
  'currency',
  'requestedAt',
];

/** Ключи запросов раздела. Локальные: `src/lib/queryKeys.ts` — общий файл, его не трогаем. */
function tripListKey(filters: { status: string; page: number; size: number }) {
  return ['admin', 'trips', 'list', filters] as const;
}

function tripKpiKey(status: string) {
  return ['admin', 'trips', 'kpi', { status }] as const;
}

function tripCountsKey() {
  return ['admin', 'trips', 'status-counts'] as const;
}

function tripDetailKey(tripId: string) {
  return ['admin', 'trips', 'detail', tripId] as const;
}

function tripReceiptKey(tripId: string) {
  return ['admin', 'trips', 'receipt', tripId] as const;
}

/** Счёт сервера по каждому статусу: ключ `''` — «все статусы». */
export type TripStatusCounts = Record<string, number>;

/**
 * Серверный счёт поездок по каждому статусу.
 *
 * Агрегатного эндпоинта у trip-service нет, но `GET /trips?status=` отдаёт
 * `Page.totalElements` для своего фильтра. Поэтому рейл статусов делает по одному запросу
 * `size=1` на статус: тело ответа крошечное, а число берётся у сервера, а не считается по
 * выборке из 100 строк. Именно на это указывает подпись «счёт сервера» в рейле.
 */
export async function fetchTripStatusCounts(): Promise<TripStatusCounts> {
  const [all, ...byStatus] = await Promise.all([
    fetchTrips({ page: 0, size: 1 }),
    ...TRIP_STATUSES.map((status) => fetchTrips({ status, page: 0, size: 1 })),
  ]);

  const counts: TripStatusCounts = { '': all.totalElements };
  TRIP_STATUSES.forEach((status, index) => {
    counts[status] = byStatus[index].totalElements;
  });
  return counts;
}

/* -------------------------------------------------------------- мелкие детали */

/**
 * Бейдж статуса поездки.
 *
 * Китовый `StatusBadge` берёт подпись и тон из общей карты `lib/format.ts`, где статусов
 * поездки нет: для `SEARCHING` он показал бы код, а не «Ищем водителя». Подпись и тон берём
 * из `lib/trips.ts` (так же, как `TripHistoryRow`), сам бейдж — китовый.
 */
function TripStatusBadge({ status }: { status: string | null | undefined }) {
  return <Badge tone={tripStatusTone(status)}>{tripStatusLabel(status)}</Badge>;
}

/** ID с копированием: в детали идентификаторы нужны целиком, но не занимают экран. */
function IdLine({ value }: { value: string | null | undefined }) {
  if (!value) {
    return null;
  }
  return (
    <span className="inline-flex items-center gap-1">
      <span className="font-mono text-xs break-all">{shortId(value)}</span>
      <CopyButton value={value} />
    </span>
  );
}

/**
 * Относительное время — только когда оно отличается от абсолютного.
 *
 * `formatRelative` для отметок старше суток возвращает ту же строку, что
 * `formatDateTime` (см. `lib/format.ts`): в плотной строке это выглядело бы дублем даты,
 * поэтому такой дубль раздел не печатает.
 */
function relativeOrNothing(value: string | null): string | null {
  if (!value) {
    return null;
  }
  const relative = formatRelative(value);
  return relative === formatDateTime(value) ? null : relative;
}

/* ---------------------------------------------------------------- диаграммы */

interface StatusSlice {
  status: string;
  label: string;
  count: number;
}

/**
 * Структура выборки по статусам.
 *
 * Считается по строкам, которые уже загружены в браузер (`size=100`), и подписана как «по
 * загруженной выборке»: у trip-service нет агрегата по статусам, и выдавать эту картинку за
 * состояние всей базы раздел не будет.
 */
function tripStatusSlices(rows: Trip[]): StatusSlice[] {
  return TRIP_STATUSES.map((status) => ({
    status,
    label: tripStatusLabel(status),
    count: rows.filter((trip) => trip.status === status).length,
  }));
}

/** Распределение: полосы по статусам и кольцо с общим числом в центре. */
function DistributionPanel({ rows, onlyActive }: { rows: Trip[]; onlyActive: boolean }) {
  const slices = useMemo(() => tripStatusSlices(rows), [rows]);
  const total = rows.length;

  return (
    <Panel
      id="admin-trips-distribution"
      title="Распределение по статусам"
      subtitle={`по загруженной выборке · строк: ${total} · size=${KPI_SAMPLE_SIZE}${
        onlyActive ? ' · после отбора «только активные»' : ''
      }`}
      bodyClassName="space-y-4"
    >
      {total === 0 ? (
        <EmptyState
          title="Данных не найдено"
          description={`В выборке из последних ${KPI_SAMPLE_SIZE} поездок с текущим фильтром нет ни одной строки — распределять нечего. Снимите фильтр статуса.`}
        />
      ) : (
        <div className="grid gap-5 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
          <BarList
            items={slices.map((slice) => ({
              key: slice.status,
              label: slice.label,
              value: slice.count,
              hint: `${Math.round((slice.count / total) * 100)}%`,
              tone: tripStatusTone(slice.status),
            }))}
          />
          <Donut
            size={150}
            centerValue={total}
            centerLabel="поездок в выборке"
            segments={slices.map((slice) => ({
              key: slice.status,
              label: slice.label,
              value: slice.count,
              tone: tripStatusTone(slice.status),
            }))}
          />
        </div>
      )}
    </Panel>
  );
}

/** Опубликовать CSV загруженных строк в буфер обмена — реальное действие, не картинка. */
function ExportCsvButton({ rows }: { rows: Trip[] }) {
  const [state, setState] = useState<'idle' | 'done' | 'failed'>('idle');

  const exportRows = async () => {
    const csv = toCsv(
      CSV_HEADER,
      rows.map((trip) => [
        trip.tripId,
        trip.tripNumber,
        trip.status,
        trip.tariff,
        trip.riderUserId,
        trip.driverId,
        trip.driverName,
        trip.vehiclePlate,
        trip.priceMinor,
        trip.currency,
        trip.requestedAt,
      ]),
    );
    try {
      await navigator.clipboard.writeText(csv);
      setState('done');
    } catch {
      // Буфер обмена недоступен (http-контекст, отказ в разрешении) — говорим об этом
      // словами: молча «ничего не произошло» здесь хуже ошибки.
      setState('failed');
    }
  };

  return (
    <span className="inline-flex items-center gap-2">
      <Button
        variant="secondary"
        size="sm"
        disabled={rows.length === 0}
        onClick={() => void exportRows()}
      >
        Экспорт CSV
      </Button>
      <span aria-live="polite" className="text-xs text-ink-500">
        {state === 'done'
          ? `скопировано строк: ${rows.length}`
          : state === 'failed'
            ? 'буфер обмена недоступен'
            : ''}
      </span>
    </span>
  );
}

/* ----------------------------------------------------------------------- KPI */

interface TripKpis {
  total: number;
  active: number;
  completed: number;
  cancelled: number;
  noDrivers: number;
  fareMinor: number;
  averageMinor: number | null;
  cancelledShare: number | null;
  currency: string;
  priced: number;
  withoutPrice: number;
  sampleSize: number;
}

/**
 * Счётчики по выборке.
 *
 * `total` берётся с сервера (`Page.totalElements`) и только он; всё остальное считается по
 * строкам выборки — и на экране это написано словами. «Средний чек» делится на число поездок
 * **с ценой**, а не на всю выборку: иначе поездки без цены занижали бы среднее, и цифра
 * перестала бы значить «средняя стоимость поездки».
 */
function tripKpis(sample: Trip[], serverTotal: number, onlyActive: boolean): TripKpis {
  const rows = onlyActive
    ? sample.filter((trip) => TRIP_ACTIVE_STATUSES.includes(trip.status))
    : sample;

  const withPrice = rows.filter(
    (trip): trip is Trip & { priceMinor: number } => trip.priceMinor !== null,
  );

  const cancelled = rows.filter(
    (trip) => trip.status === 'CANCELLED_BY_RIDER' || trip.status === 'CANCELLED_BY_DRIVER',
  ).length;
  const fareMinor = sumMinor(withPrice.map((trip) => trip.priceMinor));

  return {
    total: onlyActive ? rows.length : serverTotal,
    active: rows.filter((trip) => TRIP_ACTIVE_STATUSES.includes(trip.status)).length,
    completed: rows.filter((trip) => trip.status === 'COMPLETED').length,
    cancelled,
    noDrivers: rows.filter((trip) => trip.status === 'NO_DRIVERS_FOUND').length,
    fareMinor,
    averageMinor: withPrice.length > 0 ? Math.round(fareMinor / withPrice.length) : null,
    cancelledShare: rows.length > 0 ? Math.round((cancelled / rows.length) * 100) : null,
    currency: withPrice[0]?.currency ?? rows[0]?.currency ?? 'KZT',
    priced: withPrice.length,
    withoutPrice: rows.length - withPrice.length,
    sampleSize: rows.length,
  };
}

/* ------------------------------------------------------- назначение водителя */

function AssignDriverForm({ tripId }: { tripId: string }) {
  const queryClient = useQueryClient();
  const [driverId, setDriverId] = useState('');
  const [driverName, setDriverName] = useState('');
  const [vehiclePlate, setVehiclePlate] = useState('');
  const [localError, setLocalError] = useState<string | undefined>(undefined);

  const assign = useMutation({
    mutationFn: (body: AssignDriverBody) => assignTripDriver(tripId.trim(), body),
    retry: 0,
    onSuccess: () => {
      // Список, сводка, рейл статусов и деталь живут под префиксом ['admin','trips'].
      void queryClient.invalidateQueries({ queryKey: ['admin', 'trips'] });
      // Клиентские экраны такси держат те же данные под префиксом ['trips']
      // (см. `lib/queryKeys.ts`): после назначения их ответ устарел так же, как наш.
      void queryClient.invalidateQueries({ queryKey: ['trips'] });
    },
  });

  const submit = () => {
    if (tripId.trim() === '') {
      setLocalError('Сначала откройте поездку — назначение работает по конкретной поездке');
      return;
    }
    if (driverId.trim() === '') {
      setLocalError('Укажите driverId: сервис принимает назначение только по идентификатору водителя');
      return;
    }
    setLocalError(undefined);
    assign.mutate({
      driverId: driverId.trim(),
      driverName: driverName.trim() === '' ? undefined : driverName.trim(),
      vehiclePlate: vehiclePlate.trim() === '' ? undefined : vehiclePlate.trim(),
    });
  };

  return (
    <div className="space-y-3">
      <p className="text-sm text-ink-600">
        Сервис ждёт три поля (<span className="font-mono text-xs">TripDtos.AssignDriverRequest</span>):
        обязательный <span className="font-mono text-xs">driverId</span> и необязательные имя и номер
        машины. Поля <span className="font-mono text-xs">vehicleId</span> в контракте нет — поездка знает
        только водителя. Свободных водителей рядом показывает раздел «Парк и диспетчерская» (
        <span className="font-mono text-xs">GET /api/v1/dispatch/nearest</span>).
      </p>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-1">
        <TextField
          id="assign-driver-id"
          label="driverId"
          required
          value={driverId}
          placeholder="01M3Y1AYYJGHVVY7NCZQ690MJF"
          error={localError ?? fieldErrorOf(assign.error, 'driverId')}
          hint="ULID водителя"
          onChange={(event) => setDriverId(event.target.value)}
        />
        <TextField
          id="assign-driver-name"
          label="Имя водителя"
          value={driverName}
          maxLength={128}
          error={fieldErrorOf(assign.error, 'driverName')}
          hint="Не обязательно: без него сервис сам подставит имя из driver-service"
          onChange={(event) => setDriverName(event.target.value)}
        />
        <TextField
          id="assign-plate"
          label="Номер машины"
          value={vehiclePlate}
          maxLength={16}
          error={fieldErrorOf(assign.error, 'vehiclePlate')}
          hint="Не обязательно, до 16 символов"
          onChange={(event) => setVehiclePlate(event.target.value)}
        />
      </div>

      {assign.isError ? (
        <ErrorAlert error={assign.error} title="Назначить водителя не удалось" />
      ) : null}

      {assign.isSuccess ? (
        <Alert tone="success" title="Водитель назначен">
          {assign.data.driverName ?? assign.data.driverId ?? 'Сервис подтвердил назначение'} · статус:{' '}
          {tripStatusLabel(assign.data.status)}
        </Alert>
      ) : null}

      <Button
        loading={assign.isPending}
        disabled={assign.isPending}
        onClick={submit}
        data-admin-write="назначение водителя"
      >
        Назначить водителя
      </Button>
    </div>
  );
}

/* ------------------------------------------------------------ отмена поездки */

function CancelTripForm({ tripId }: { tripId: string }) {
  const queryClient = useQueryClient();
  const [reason, setReason] = useState('');
  const [cancelledBy, setCancelledBy] = useState<TripCanceller>('RIDER');
  const [localError, setLocalError] = useState<string | undefined>(undefined);

  const cancel = useMutation({
    mutationFn: (body: { reason: string; cancelledBy: TripCanceller }) =>
      cancelTripAsOperator(tripId.trim(), body),
    retry: 0,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['admin', 'trips'] });
      void queryClient.invalidateQueries({ queryKey: ['trips'] });
    },
  });

  const submit = () => {
    if (tripId.trim() === '') {
      setLocalError('Сначала откройте поездку — отменять нужно конкретную поездку');
      return;
    }
    if (reason.trim() === '') {
      setLocalError(
        'Причина обязательна: оператор отменяет чужую поездку, и причина — единственная запись об этом',
      );
      return;
    }
    setLocalError(undefined);
    cancel.mutate({ reason: reason.trim(), cancelledBy });
  };

  return (
    <div className="space-y-3">
      <p className="text-sm text-ink-600">
        Тело отмены — <span className="font-mono text-xs">TripDtos.CancelTripRequest</span>:{' '}
        <span className="font-mono text-xs">reason</span> (обязательна для оператора, ≤512 символов) и{' '}
        <span className="font-mono text-xs">cancelledBy</span> — чья сторона отменяет. От этого зависит
        итоговый статус: <span className="font-mono text-xs">CANCELLED_BY_RIDER</span> или{' '}
        <span className="font-mono text-xs">CANCELLED_BY_DRIVER</span>. Резерв на счёте пассажира сервис
        снимает сам.
      </p>

      <TextAreaField
        id="cancel-trip-reason"
        label="Причина отмены"
        required
        value={reason}
        maxLength={512}
        placeholder="Например: водитель не выехал, пассажир ждёт 20 минут"
        error={localError ?? fieldErrorOf(cancel.error, 'reason')}
        hint="Причина попадёт в историю поездки и в события сервиса"
        onChange={(event) => setReason(event.target.value)}
      />

      <SelectField
        id="cancel-trip-side"
        label="Чья сторона отменяет"
        value={cancelledBy}
        options={[
          { value: 'RIDER', label: 'Пассажир (RIDER)' },
          { value: 'DRIVER', label: 'Водитель (DRIVER)' },
        ]}
        hint="cancelledBy: сервис принимает только эти два значения"
        onChange={(event) => setCancelledBy(event.target.value as TripCanceller)}
      />

      {cancel.isError ? <ErrorAlert error={cancel.error} title="Отменить поездку не удалось" /> : null}

      {cancel.isSuccess ? (
        <Alert tone="success" title="Поездка отменена">
          Новый статус: {tripStatusLabel(cancel.data.status)}. Причина сохранена:{' '}
          {cancel.data.cancelReason ?? reason}
        </Alert>
      ) : null}

      <Button
        variant="danger"
        loading={cancel.isPending}
        disabled={cancel.isPending}
        onClick={submit}
        data-admin-write="отмена поездки"
      >
        Отменить поездку
      </Button>
    </div>
  );
}

/**
 * Блок изменяющих действий раздела.
 *
 * Действует по открытой поездке: её выбирают в списке или открывают по ID в детали — там же
 * видно, на какую поездку смотрит форма. Так у изменяющих форм один источник истины, и
 * «отменить не ту поездку» из-за разошедшихся полей не получается.
 *
 * Формы исчезают, когда статус поездки делает действие невозможным, — и вместо них
 * появляется объяснение, почему сервис его не примет.
 */
function TripActionsPanel({
  tripId,
  tripNumber,
  status,
  isLoading,
}: {
  tripId: string;
  tripNumber: string | undefined;
  status: TripStatus | undefined;
  isLoading: boolean;
}) {
  const statusUnknown = status === undefined;
  const assignable = statusUnknown || status === 'SEARCHING';
  const cancellable = statusUnknown || TRIP_CANCELLABLE_STATUSES.includes(status);

  return (
    <Panel
      id="admin-trips-actions"
      title="Действия по поездке"
      subtitle={
        tripId === ''
          ? 'Поездка не открыта — действия станут доступны после выбора строки или открытия по ID'
          : `Поездка ${tripNumber ? `№ ${tripNumber}` : shortId(tripId)}`
      }
      bodyClassName="space-y-4"
    >
      {isLoading ? <SkeletonText lines={4} /> : null}

      {!isLoading ? (
        <>
          <p className="text-xs text-ink-500">
            Назначение водителя сервис разрешает только DISPATCHER и ADMIN (
            <span className="font-mono">TripAccess.requireAssigner</span>), панель меняет данные под ролью
            Администратор. Если статус поездки действию не подходит, сервис ответит 409 — формы ниже
            исчезают заранее, чтобы не предлагать заведомый отказ.
          </p>

          {assignable ? (
            <div className="rounded-xl border border-ink-200 p-3">
              <p className="text-sm font-medium text-ink-800">Назначить водителя вручную</p>
              <p className="mt-1 mb-3 text-xs text-ink-500">
                Возможно только для статуса SEARCHING: сервис принимает назначение из него одного
                (<span className="font-mono">TripSagaService.assign</span>), а у поездки с машиной
                переопределить водителя нельзя.
              </p>
              <AssignDriverForm tripId={tripId} />
            </div>
          ) : (
            <Alert tone="info" title="Назначение водителя недоступно">
              Поездка в статусе «{tripStatusLabel(status)}». Сервис принимает ручное назначение только для
              SEARCHING и отвечает 409 <span className="font-mono text-xs">TRIP_NOT_ASSIGNABLE</span>, если
              машина уже есть или поездка началась. Свободную машину ищут в разделе «Парк и диспетчерская» (
              <span className="font-mono text-xs">GET /api/v1/dispatch/nearest</span>).
            </Alert>
          )}

          {cancellable ? (
            <div className="rounded-xl border border-ink-200 p-3">
              <p className="text-sm font-medium text-ink-800">Отменить поездку</p>
              <p className="mt-1 mb-3 text-xs text-ink-500">
                Возможно до начала поездки: статусы SEARCHING, ASSIGNED, ARRIVED (
                <span className="font-mono">TripStatus.isCancellable</span>).
              </p>
              <CancelTripForm tripId={tripId} />
            </div>
          ) : (
            <Alert tone="info" title="Отмена недоступна">
              {status === 'IN_PROGRESS'
                ? 'Поездка уже в пути: с этого момента тариф должен быть оплачен, и сервис отвечает 409 на отмену независимо от роли. Инцидент решается через поддержку, а не переходом статуса.'
                : 'Поездка в терминальном статусе — менять её состояние сервис не даёт (TripStatus.isTerminal).'}
            </Alert>
          )}
        </>
      ) : null}
    </Panel>
  );
}

/* ----------------------------------------------------------------------- чек */

function ReceiptRows({ receipt }: { receipt: TripReceipt }) {
  const commission = commissionBpLabel(receipt.commissionBp);
  const surge = surgeLabel(receipt.surgeBp);

  return (
    <dl className="sm:grid sm:grid-cols-2 sm:gap-x-6 xl:block">
      {receipt.tariff ? <DetailRow label="Тариф">{tariffLabel(receipt.tariff)}</DetailRow> : null}
      {receipt.distanceM !== null ? (
        <DetailRow label="Расстояние">
          <span className="tnum">{formatDistanceMeters(receipt.distanceM)}</span>
        </DetailRow>
      ) : null}
      {receipt.durationS !== null ? (
        <DetailRow label="В пути">
          <span className="tnum">{formatAgeSeconds(receipt.durationS)}</span>
        </DetailRow>
      ) : null}
      {receipt.breakdown ? (
        <>
          <DetailRow label="Посадка">
            <span className="tnum">{formatMoney(receipt.breakdown.baseMinor, receipt.currency)}</span>
          </DetailRow>
          <DetailRow label="За расстояние">
            <span className="tnum">{formatMoney(receipt.breakdown.distanceMinor, receipt.currency)}</span>
          </DetailRow>
          <DetailRow label="За время">
            <span className="tnum">{formatMoney(receipt.breakdown.timeMinor, receipt.currency)}</span>
          </DetailRow>
        </>
      ) : (
        <DetailRow label="Разбивка цены">сервис не прислал</DetailRow>
      )}
      {surge ? <DetailRow label="Надбавка за спрос">{surge}</DetailRow> : null}
      <DetailRow label="Итого списано">
        <span className="tnum">{formatMoney(receipt.priceMinor, receipt.currency)}</span>
      </DetailRow>
      {receipt.commissionMinor !== null ? (
        <DetailRow label={commission ? `Комиссия платформы ${commission}` : 'Комиссия платформы'}>
          <span className="tnum">{formatMoney(receipt.commissionMinor, receipt.currency)}</span>
        </DetailRow>
      ) : null}
      {receipt.driverNetMinor !== null ? (
        <DetailRow label="Начислено водителю">
          <span className="tnum">{formatMoney(receipt.driverNetMinor, receipt.currency)}</span>
        </DetailRow>
      ) : null}
      {receipt.holdId ? (
        <DetailRow label="Резерв">
          <IdLine value={receipt.holdId} />
        </DetailRow>
      ) : null}
      <DetailRow label="Движение по счёту">
        {receipt.transactionId ? <IdLine value={receipt.transactionId} /> : 'сервис не прислал'}
      </DetailRow>
      <DetailRow label="Платёжный документ">
        {receipt.paymentId ? (
          <span className="font-mono text-xs">{shortId(receipt.paymentId)}</span>
        ) : (
          'нет — поездка списана через счёт, а не через payment-service'
        )}
      </DetailRow>
      {receipt.completedAt ? (
        <DetailRow label="Чек выдан">
          <span className="tnum">{formatDateTime(receipt.completedAt)}</span>
        </DetailRow>
      ) : null}
      {receipt.driverDisplayName ? (
        <DetailRow label="Водитель в чеке">{receipt.driverDisplayName}</DetailRow>
      ) : null}
    </dl>
  );
}

/** Чек — отдельная панель: это документ, по которому сверяют деньги, а не строка детали. */
function ReceiptPanel({ trip }: { trip: Trip }) {
  const embedded = trip.receipt;
  const needsFetch = embedded === null && trip.status === 'COMPLETED';

  const query = useQuery({
    queryKey: tripReceiptKey(trip.tripId),
    queryFn: () => fetchTripReceipt(trip.tripId),
    enabled: needsFetch,
    retry: 0,
    staleTime: 60_000,
  });

  return (
    <Panel
      id="admin-trips-receipt"
      title="Чек"
      subtitle={
        embedded
          ? 'Чек пришёл вместе с деталью поездки: GET /api/v1/trips/{id} отдаёт его для завершённой поездки'
          : `Поездка № ${trip.tripNumber}`
      }
      bodyClassName="space-y-3"
    >
      {embedded ? <ReceiptRows receipt={embedded} /> : null}

      {needsFetch && query.isPending ? <SkeletonText lines={4} /> : null}

      {needsFetch && query.isError ? (
        <ErrorAlert
          error={query.error}
          title="Чек не удалось загрузить"
          onRetry={() => void query.refetch()}
        />
      ) : null}

      {needsFetch && query.isSuccess && query.data === null ? (
        <Alert tone="warning" title="Сервис не отдал чек">
          Поездка завершена, но в ответе нет суммы, которую можно напечатать: показывать нули вместо чека
          раздел не будет.
        </Alert>
      ) : null}

      {needsFetch && query.data ? <ReceiptRows receipt={query.data} /> : null}

      {!embedded && !needsFetch ? (
        <EmptyState
          title="Чека ещё нет"
          description="Чек появляется только у завершённой поездки: на остальные статусы сервис отвечает 409 TRIP_NOT_COMPLETED, поэтому раздел не запрашивает его зря."
        />
      ) : null}
    </Panel>
  );
}

/* ------------------------------------------------------------------- деталь */

/** Точка маршрута: нумерованный шаг с адресом и координатами — карты в разделе нет. */
function RouteStep({ step, title, point }: { step: number; title: string; point: TripPoint | null }) {
  const hasCoordinates = point !== null && Number.isFinite(point.lat) && Number.isFinite(point.lon);

  return (
    <li className="flex gap-2.5 rounded-xl border border-ink-200 p-2.5">
      <span
        className="tnum mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-brand-50 text-xs font-semibold text-brand-700 ring-1 ring-brand-200"
        aria-hidden="true"
      >
        {step}
      </span>
      <div className="min-w-0">
        <p className="text-xs font-medium tracking-wide text-ink-500 uppercase">{title}</p>
        <p className="text-sm break-words text-ink-900">
          {point === null
            ? 'Точка в ответе сервиса не пришла.'
            : point.address !== ''
              ? point.address
              : 'Адрес не пришёл — в ответе только координаты'}
        </p>
        <p className="tnum mt-0.5 text-xs break-all text-ink-500">
          {hasCoordinates && point !== null
            ? `${point.lat.toFixed(5)}, ${point.lon.toFixed(5)}`
            : 'Координаты не пришли'}
        </p>
      </div>
    </li>
  );
}

/**
 * Переходы статусов из `timeline` поездки.
 *
 * `Timeline` берёт подпись из общей карты статусов, поэтому в `note` кладём русскую
 * расшифровку и того, кто переход сделал: код статуса остаётся видимым (по нему поддержка
 * сверяется с логами), но читать историю можно и без справочника.
 */
function timelineEntries(trip: Trip): TimelineEntry[] {
  return trip.timeline.map((entry, index) => {
    const actor = actorLabel(entry.actor);
    const note = [tripStatusLabel(entry.status), actor ? `кто: ${actor}` : '']
      .filter((part) => part !== '')
      .join(' · ');
    return {
      key: `${entry.status}-${entry.at}-${index}`,
      status: entry.status,
      time: entry.at,
      note,
    };
  });
}

/** Тело детали: маршрут, деньги, водитель, история переходов — блоками, а не одной простыней. */
function TripDetailBody({ trip, canWrite }: { trip: Trip; canWrite: boolean }) {
  const commission = commissionBpLabel(trip.commissionBp);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <TripStatusBadge status={trip.status} />
        <Chip>{tariffLabel(trip.tariff)}</Chip>
        <span className="tnum text-xs text-ink-500">
          создана {formatDateTime(trip.requestedAt)}
          {relativeOrNothing(trip.requestedAt) ? ` · ${relativeOrNothing(trip.requestedAt)}` : ''}
        </span>
      </div>

      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-500">
        <span className="inline-flex items-center gap-1">
          ID: <IdLine value={trip.tripId} />
        </span>
        <span>
          Клиент:{' '}
          {trip.riderUserId ? (
            <IdLine value={trip.riderUserId} />
          ) : (
            'сервис не прислал идентификатор — имя клиента сервис не отдаёт'
          )}
        </span>
      </div>

      {trip.cancelReason ? (
        <Alert tone="warning" title="Причина отмены">
          {trip.cancelReason}
        </Alert>
      ) : null}

      <div>
        <h3 className="text-sm font-semibold text-ink-800">Маршрут</h3>
        <p className="mt-0.5 text-xs text-ink-500">
          Карты в разделе нет намеренно: маршрут — адресами и координатами, а живая карта с машинами живёт в
          диспетчерской.
        </p>
        <ol className="mt-2 space-y-2">
          <RouteStep step={1} title="Точка А (посадка)" point={trip.pickup} />
          <RouteStep step={2} title="Точка Б (высадка)" point={trip.dropoff} />
        </ol>
        <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-ink-600">
          <span>
            Расстояние:{' '}
            <span className="tnum font-medium text-ink-800">
              {trip.distanceM !== null ? formatDistanceMeters(trip.distanceM) : 'сервис не прислал'}
            </span>
          </span>
          <span>
            В пути:{' '}
            <span className="tnum font-medium text-ink-800">
              {trip.durationS !== null ? formatAgeSeconds(trip.durationS) : 'сервис не прислал'}
            </span>
          </span>
          <Link to="/dispatch" className="font-medium text-brand-700 hover:underline">
            Открыть в диспетчерской
          </Link>
        </div>
      </div>

      <div className="border-t border-ink-100 pt-3">
        <h3 className="text-sm font-semibold text-ink-800">Тариф и деньги</h3>
        <dl className="mt-1 sm:grid sm:grid-cols-2 sm:gap-x-6 xl:block">
          <DetailRow label="Стоимость">
            {trip.priceMinor !== null ? (
              <span className="tnum">{formatMoney(trip.priceMinor, trip.currency)}</span>
            ) : (
              'сервис не прислал'
            )}
          </DetailRow>
          {trip.commissionMinor !== null ? (
            <DetailRow label={commission ? `Комиссия платформы ${commission}` : 'Комиссия платформы'}>
              <span className="tnum">{formatMoney(trip.commissionMinor, trip.currency)}</span>
            </DetailRow>
          ) : null}
          {trip.driverNetMinor !== null ? (
            <DetailRow label="Начислено водителю">
              <span className="tnum">{formatMoney(trip.driverNetMinor, trip.currency)}</span>
            </DetailRow>
          ) : null}
          {trip.holdId ? (
            <DetailRow label="Резерв средств">
              <span className="inline-flex items-center gap-1">
                <IdLine value={trip.holdId} />
                {trip.holdStatus ? <span className="text-xs text-ink-500">{trip.holdStatus}</span> : null}
              </span>
            </DetailRow>
          ) : null}
          {trip.ratingStars !== null ? (
            <DetailRow label="Оценка пассажира">
              {trip.ratingStars} / 5{trip.ratingComment ? ` · ${trip.ratingComment}` : ''}
            </DetailRow>
          ) : null}
        </dl>
      </div>

      <div className="border-t border-ink-100 pt-3">
        <h3 className="text-sm font-semibold text-ink-800">Водитель и машина</h3>
        <dl className="mt-1 sm:grid sm:grid-cols-2 sm:gap-x-6 xl:block">
          <DetailRow label="Водитель">
            {trip.driverName ?? (trip.driverId ? 'имя сервис не прислал' : 'не назначен')}
          </DetailRow>
          <DetailRow label="Номер машины">
            {trip.vehiclePlate ? <span className="tnum">{trip.vehiclePlate}</span> : 'сервис не прислал'}
          </DetailRow>
          {trip.driverId ? (
            <DetailRow label="driverId">
              <IdLine value={trip.driverId} />
            </DetailRow>
          ) : null}
          {trip.assignedAt ? (
            <DetailRow label="Назначен">
              <span className="tnum">{formatDateTime(trip.assignedAt)}</span>
            </DetailRow>
          ) : null}
          {trip.arrivedAt ? (
            <DetailRow label="Машина на месте">
              <span className="tnum">{formatDateTime(trip.arrivedAt)}</span>
            </DetailRow>
          ) : null}
          {trip.startedAt ? (
            <DetailRow label="Поездка началась">
              <span className="tnum">{formatDateTime(trip.startedAt)}</span>
            </DetailRow>
          ) : null}
          {trip.completedAt ? (
            <DetailRow label="Поездка завершена">
              <span className="tnum">{formatDateTime(trip.completedAt)}</span>
            </DetailRow>
          ) : null}
          {trip.cancelledAt ? (
            <DetailRow label="Отменена">
              <span className="tnum">{formatDateTime(trip.cancelledAt)}</span>
            </DetailRow>
          ) : null}
        </dl>
      </div>

      <div className="border-t border-ink-100 pt-3">
        <h3 className="text-sm font-semibold text-ink-800">История переходов</h3>
        <p className="mt-0.5 text-xs text-ink-500">
          Массив <span className="font-mono">timeline</span> из ответа сервиса: код статуса, время и кто
          переход сделал.
        </p>
        <Timeline className="mt-3" entries={timelineEntries(trip)} />
      </div>

      <p className="text-xs text-ink-500">
        {canWrite
          ? 'Формы назначения водителя и отмены — в блоке «Действия по поездке» ниже: они работают по этой открытой поездке.'
          : 'Действия, меняющие поездку, доступны роли Администратор: под ролью Поддержка формы не рисуются вовсе, а не выключаются.'}
      </p>
    </div>
  );
}

/**
 * Панель детали. Существует всегда — это правая половина компоновки «список + деталь», и
 * пустое место в ней тоже состояние: здесь написано, что нужно выбрать поездку.
 */
function TripDetailPanel({
  tripId,
  trip,
  isPending,
  isError,
  error,
  canWrite,
  onRetry,
  onClose,
  lookupDraft,
  onLookupDraftChange,
  onOpen,
}: {
  tripId: string;
  trip: Trip | undefined;
  isPending: boolean;
  isError: boolean;
  error: unknown;
  canWrite: boolean;
  onRetry: () => void;
  onClose: () => void;
  lookupDraft: string;
  onLookupDraftChange: (value: string) => void;
  onOpen: (value: string) => void;
}) {
  const notFound = isApiError(error) && error.isNotFound;
  const opened = tripId !== '';

  return (
    <Panel
      id="admin-trips-detail"
      title={
        <span className="flex items-center gap-2">
          <span
            className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-brand-50 text-brand-700"
            aria-hidden="true"
          >
            <TaxiIcon className="h-4 w-4" />
          </span>
          <span className="min-w-0 truncate">
            {trip ? `Поездка № ${trip.tripNumber}` : 'Деталь поездки'}
          </span>
        </span>
      }
      subtitle={
        opened ? `ID: ${shortId(tripId)}` : 'Поездка открывается кликом по строке списка или по ID'
      }
      action={
        opened ? (
          <Button variant="secondary" size="sm" onClick={onClose}>
            Закрыть
          </Button>
        ) : null
      }
      bodyClassName="space-y-3"
    >
      <form
        className="flex items-end gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          onOpen(lookupDraft);
        }}
      >
        <div className="min-w-0 flex-1">
          <TextField
            id="admin-trips-lookup"
            label="Открыть поездку по ID"
            value={lookupDraft}
            placeholder="ULID из обращения"
            hint="Чтение: доступно и роли Поддержка"
            onChange={(event) => onLookupDraftChange(event.target.value)}
          />
        </div>
        <Button type="submit" variant="secondary">
          Открыть
        </Button>
      </form>

      {opened && isPending ? <SkeletonText lines={6} /> : null}

      {opened && isError && !notFound ? (
        <ErrorAlert error={error} title="Не удалось загрузить поездку" onRetry={onRetry} />
      ) : null}

      {opened && isError && notFound ? (
        <EmptyState
          title="Поездка не найдена"
          description="Сервис ответил 404: поездки с таким идентификатором нет. Проверьте ID — он приходит из таблицы или из обращения."
        />
      ) : null}

      {!opened ? (
        <EmptyState
          title="Поездка не выбрана"
          description="Выберите строку в списке слева или вставьте ULID в поле выше: в детали будут маршрут точками, разбор денег, водитель с номером машины, история переходов и чек."
        />
      ) : null}

      {trip ? <TripDetailBody trip={trip} canWrite={canWrite} /> : null}
    </Panel>
  );
}

/* ------------------------------------------------------------------- раздел */

export default function TripsSection({ canWrite }: AdminSectionProps) {
  const [status, setStatus] = useState('');
  const [onlyActive, setOnlyActive] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(true);
  const [size, setSize] = useState(PAGE_SIZE);
  const [page, setPage] = useState(0);
  const [targetTripId, setTargetTripId] = useState('');
  const [lookupDraft, setLookupDraft] = useState('');

  const serverStatus = status === '' ? undefined : status;
  const trimmedTarget = targetTripId.trim();

  const query: TripQuery = { status: serverStatus, page, size };
  const listQuery = useQuery({
    queryKey: tripListKey({ status, page, size }),
    queryFn: () => fetchTrips(query),
    placeholderData: (previous) => previous,
  });

  const kpiQuery = useQuery({
    queryKey: tripKpiKey(status),
    queryFn: () => fetchTrips({ status: serverStatus, page: 0, size: KPI_SAMPLE_SIZE }),
    staleTime: 15_000,
  });

  const countsQuery = useQuery({
    queryKey: tripCountsKey(),
    queryFn: fetchTripStatusCounts,
    staleTime: 30_000,
  });

  const detailQuery = useQuery({
    queryKey: tripDetailKey(trimmedTarget),
    queryFn: () => fetchTrip(trimmedTarget),
    enabled: trimmedTarget !== '',
    retry: 0,
    staleTime: 5_000,
  });

  const items = useMemo(() => listQuery.data?.items ?? [], [listQuery.data]);
  const rows = useMemo(
    () => (onlyActive ? items.filter((trip) => TRIP_ACTIVE_STATUSES.includes(trip.status)) : items),
    [items, onlyActive],
  );

  const sampleRows = useMemo(() => {
    const sample = kpiQuery.data?.items ?? [];
    return onlyActive ? sample.filter((trip) => TRIP_ACTIVE_STATUSES.includes(trip.status)) : sample;
  }, [kpiQuery.data, onlyActive]);

  const kpis = useMemo(
    () => (kpiQuery.data ? tripKpis(kpiQuery.data.items, kpiQuery.data.totalElements, onlyActive) : null),
    [kpiQuery.data, onlyActive],
  );

  const hiddenByActiveFilter = items.length - rows.length;
  const detailTrip = detailQuery.data;
  const detailStatus = trimmedTarget === '' ? undefined : detailTrip?.status;

  /** Смена фильтра статуса: и рейл, и селект ведут сюда, поэтому страница сбрасывается. */
  const selectStatus = (next: string) => {
    setStatus(next);
    setPage(0);
  };

  const openTrip = (tripId: string) => {
    setTargetTripId(tripId);
    setLookupDraft(tripId);
  };

  const refresh = () => {
    void listQuery.refetch();
    void kpiQuery.refetch();
    void countsQuery.refetch();
    if (trimmedTarget !== '') {
      void detailQuery.refetch();
    }
  };

  const isFetching = listQuery.isFetching || kpiQuery.isFetching || countsQuery.isFetching;

  return (
    <div>
      {/* ----------------------------------------------------------- тулбар */}
      <Toolbar
        right={
          <>
            <Chip tone="brand">
              {listQuery.data ? `Найдено: ${listQuery.data.totalElements}` : 'Найдено: —'}
            </Chip>
            <Button
              variant="secondary"
              size="sm"
              aria-expanded={filtersOpen}
              onClick={() => setFiltersOpen((open) => !open)}
            >
              Фильтр
            </Button>
            <Button variant="secondary" size="sm" loading={isFetching} onClick={refresh}>
              Обновить
            </Button>
            <ExportCsvButton rows={rows} />
          </>
        }
      >
        {filtersOpen ? (
          <>
            <div className="w-full sm:w-52">
              <SelectField
                id="admin-trips-status"
                label="Статус"
                value={status}
                placeholder="Все статусы"
                options={TRIP_STATUS_FILTER_OPTIONS}
                hint="Значения enum TripStatus"
                onChange={(event) => selectStatus(event.target.value)}
              />
            </div>

            <div className="w-full sm:w-32">
              <SelectField
                id="admin-trips-size"
                label="На странице"
                value={String(size)}
                options={PAGE_SIZE_OPTIONS}
                onChange={(event) => {
                  setSize(Number(event.target.value));
                  setPage(0);
                }}
              />
            </div>

            <div className="min-w-0 flex-1 pt-1">
              <CheckboxField
                id="admin-trips-active"
                label="Только активные"
                checked={onlyActive}
                hint="Отбор по загруженным строкам: API принимает один статус за раз, поэтому «любой из четырёх живых» сервер отфильтровать не может"
                onChange={(event) => setOnlyActive(event.target.checked)}
              />
            </div>
          </>
        ) : (
          <p className="text-xs text-ink-500">
            Фильтр скрыт. Кнопка «Фильтр» возвращает выбор статуса, размера страницы и отбор активных.
          </p>
        )}
      </Toolbar>

      <div className="space-y-4">
        {/* --------------------------------------------------------- сводка */}
        <Panel
          id="admin-trips-summary"
          title="Сводка"
          subtitle={`Агрегатов у trip-service нет: «всего» — счёт сервера, остальные числа — по выборке из ${KPI_SAMPLE_SIZE} новейших поездок с текущим фильтром`}
          bodyClassName="space-y-3"
        >
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <KpiTile
              label={onlyActive ? 'Активных в выборке' : 'Всего по фильтру'}
              value={kpis ? String(kpis.total) : '—'}
              caption={
                onlyActive
                  ? 'посчитано по выборке: сервер не умеет «любой из живых статусов»'
                  : 'счёт сервера: Page.totalElements по текущему фильтру'
              }
              tone="brand"
              loading={!kpis}
              icon={<OrdersIcon className="h-5 w-5" />}
            />
            <KpiTile
              label="В работе"
              value={kpis ? String(kpis.active) : '—'}
              caption="SEARCHING, ASSIGNED, ARRIVED, IN_PROGRESS — по выборке"
              tone="info"
              loading={!kpis}
              icon={<TaxiIcon className="h-5 w-5" />}
            />
            <KpiTile
              label="Завершено"
              value={kpis ? String(kpis.completed) : '—'}
              caption="статус COMPLETED — по выборке"
              tone="success"
              loading={!kpis}
              icon={<ShieldIcon className="h-5 w-5" />}
            />
            <KpiTile
              label="Отменено"
              value={kpis ? String(kpis.cancelled) : '—'}
              caption="CANCELLED_BY_RIDER + CANCELLED_BY_DRIVER — по выборке"
              tone="neutral"
              loading={!kpis}
              icon={<LogoutIcon className="h-5 w-5" />}
            />
            <KpiTile
              label="Свободных машин нет"
              value={kpis ? String(kpis.noDrivers) : '—'}
              caption="NO_DRIVERS_FOUND — по выборке; такие заявки чаще всего и разбирает поддержка"
              tone="danger"
              loading={!kpis}
              icon={<DispatchIcon className="h-5 w-5" />}
            />
            <KpiTile
              label="Сумма цен"
              value={kpis ? formatMoney(kpis.fareMinor, kpis.currency) : '—'}
              caption={
                kpis && kpis.withoutPrice > 0
                  ? `по выборке: сумма priceMinor; цена не пришла у строк: ${kpis.withoutPrice}`
                  : 'по выборке: сумма priceMinor'
              }
              tone="brand"
              loading={!kpis}
              icon={<WalletIcon className="h-5 w-5" />}
            />
            <KpiTile
              label="Средний чек"
              value={kpis?.averageMinor != null ? formatMoney(kpis.averageMinor, kpis.currency) : '—'}
              caption={
                kpis
                  ? `сумма цен ÷ строк с ценой: ${kpis.priced} — по выборке`
                  : 'по выборке: сумма цен, делённая на число строк с ценой'
              }
              tone="success"
              loading={!kpis}
              icon={<PaymentsIcon className="h-5 w-5" />}
            />
            <KpiTile
              label="Доля отмен"
              value={kpis?.cancelledShare != null ? `${kpis.cancelledShare}%` : '—'}
              caption={
                kpis
                  ? `отменённые ÷ строки выборки (${kpis.sampleSize}) — не от всей базы`
                  : 'по выборке: доля отменённых поездок'
              }
              tone="warning"
              loading={!kpis}
              icon={<TransferIcon className="h-5 w-5" />}
            />
          </div>

          {kpiQuery.isError ? (
            <ErrorAlert
              error={kpiQuery.error}
              title="Счётчики по фильтру не загрузились"
              onRetry={() => void kpiQuery.refetch()}
            />
          ) : null}

          <Alert tone="info" title="Что здесь посчитано, а что нет">
            Агрегатов у trip-service нет: «всего по фильтру» — счёт сервера, а «в работе», «завершено»,
            «отменено», сумма, средний чек и доля отмен считаются клиентом по выборке из последних{' '}
            {KPI_SAMPLE_SIZE} поездок с тем же фильтром (
            <span className="font-mono text-xs">GET /api/v1/trips?size={KPI_SAMPLE_SIZE}</span>, сортировка
            сервиса — новейшие первыми). Сейчас в выборке строк: {kpis ? kpis.sampleSize : '—'}
            {kpis && kpis.noDrivers > 0
              ? `, из них без свободных машин (NO_DRIVERS_FOUND): ${kpis.noDrivers}`
              : ''}
            . Это не «статистика по всей базе», и подписи говорят именно это.
          </Alert>
        </Panel>

        {/* ----------------------------------- список + деталь (две колонки) */}
        <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_20rem]">
          <div className="min-w-0 space-y-4">
            <DistributionPanel rows={sampleRows} onlyActive={onlyActive} />

            <Panel
              id="admin-trips-list"
              title="Поездки"
              subtitle={
                listQuery.data
                  ? `Страница ${listQuery.data.page + 1} из ${Math.max(listQuery.data.totalPages, 1)} · на этой странице ${items.length}`
                  : 'Список поездок по текущему фильтру'
              }
              action={
                <Link
                  to="/dispatch"
                  className="text-xs font-medium text-brand-700 hover:underline"
                >
                  Открыть в диспетчерской
                </Link>
              }
              bodyClassName="space-y-3"
            >
              <div className="grid gap-4 lg:grid-cols-[11rem_minmax(0,1fr)]">
                <div className="space-y-2">
                  <StatusRail
                    ariaLabel="Фильтр по статусу поездки"
                    allCount={countsQuery.data?.['']}
                    active={status}
                    onSelect={selectStatus}
                    items={TRIP_STATUSES.map((item) => ({
                      value: item,
                      label: tripStatusLabel(item),
                      count: countsQuery.data?.[item],
                    }))}
                  />

                  {countsQuery.isError ? (
                    <ErrorAlert
                      error={countsQuery.error}
                      title="Счёт по статусам не загрузился"
                      onRetry={() => void countsQuery.refetch()}
                    />
                  ) : (
                    <p className="text-xs leading-snug text-ink-500">
                      Числа в пилюлях — <span className="font-mono">Page.totalElements</span> сервера по
                      каждому статусу (один запрос <span className="font-mono">size=1</span> на статус). Они
                      не зависят от страницы ниже.
                    </p>
                  )}
                </div>

                <div className="min-w-0 space-y-3">
                  {listQuery.isPending ? <SkeletonRows count={6} /> : null}

                  {listQuery.isError ? (
                    <ErrorAlert
                      error={listQuery.error}
                      title="Не удалось загрузить поездки"
                      onRetry={() => void listQuery.refetch()}
                    />
                  ) : null}

                  {listQuery.isSuccess && items.length === 0 ? (
                    <EmptyState
                      title={
                        status === '' ? 'Поездок нет' : `Поездок со статусом «${tripStatusLabel(status)}» нет`
                      }
                      description={
                        status === ''
                          ? 'Сервис вернул пустую страницу: поездки появятся здесь, как только пассажиры начнут заказывать машины.'
                          : 'Снимите фильтр статуса или выберите другой — сервис вернул пустую страницу именно по этому статусу.'
                      }
                    />
                  ) : null}

                  {listQuery.isSuccess && items.length > 0 && rows.length === 0 ? (
                    <EmptyState
                      title="В загруженных строках нет активных поездок"
                      description={`Фильтр «только активные» скрыл все ${hiddenByActiveFilter} строк этой страницы: среди них нет ни SEARCHING, ни ASSIGNED, ни ARRIVED, ни IN_PROGRESS. Снимите галочку или откройте другую страницу.`}
                    />
                  ) : null}

                  {rows.length > 0 ? (
                    // `relative overflow-x-auto` — правило разделов админки: без `relative`
                    // `sr-only`-подпись таблицы растягивает документ на телефоне. К ним
                    // добавлены `max-h`/`overflow-y-auto`: без собственной вертикальной прокрутки
                    // `sticky`-заголовок таблицы не залипает (его scrollport — этот же контейнер).
                    <div className="relative max-h-[70vh] overflow-x-auto overflow-y-auto">
                      {/* `table-fixed`: ширины колонок заданы, длинные значения обрезаются с
                          подсказкой в `title`, а не распирают таблицу на пол-экрана. */}
                      <table className="w-full min-w-[540px] table-fixed text-sm">
                        <caption className="sr-only">Поездки по текущему фильтру</caption>
                        <thead className="sticky top-0 z-10 bg-white">
                          <tr className="border-b border-ink-200 text-left text-xs tracking-wide text-ink-500 uppercase">
                            <th scope="col" className="w-[6.75rem] px-2 py-1.5 font-medium">
                              Поездка
                            </th>
                            <th scope="col" className="w-[6.25rem] px-2 py-1.5 font-medium">
                              Статус
                            </th>
                            <th scope="col" className="w-[5rem] px-2 py-1.5 font-medium">
                              Водитель
                            </th>
                            <th scope="col" className="w-[6.25rem] px-2 py-1.5 text-right font-medium">
                              Сумма
                            </th>
                            <th scope="col" className="w-[5.75rem] px-2 py-1.5 font-medium">
                              Запрошена
                            </th>
                            <th scope="col" className="w-[5.75rem] px-2 py-1.5 font-medium">
                              <span className="sr-only">Действия</span>
                            </th>
                          </tr>
                        </thead>
                        <tbody>
                          {rows.map((trip, index) => {
                            const selected = trip.tripId === trimmedTarget;
                            const driver = trip.driverName ?? shortId(trip.driverId ?? '');
                            return (
                              <tr
                                key={trip.tripId}
                                onClick={() => openTrip(trip.tripId)}
                                className={cx(
                                  'cursor-pointer border-b border-ink-100 align-top',
                                  selected ? 'bg-brand-50' : index % 2 === 1 ? 'bg-ink-50/70' : 'bg-white',
                                )}
                              >
                                <td className="px-2 py-1.5">
                                  <span
                                    className="block truncate font-medium text-ink-900"
                                    title={`№ ${trip.tripNumber}`}
                                  >
                                    № {trip.tripNumber}
                                  </span>
                                  <span
                                    className="block truncate font-mono text-xs text-ink-500"
                                    title={trip.tripId}
                                  >
                                    {shortId(trip.tripId)}
                                  </span>
                                </td>
                                <td className="px-2 py-1.5">
                                  <TripStatusBadge status={trip.status} />
                                </td>
                                <td className="px-2 py-1.5">
                                  {trip.driverName ?? trip.driverId ? (
                                    <>
                                      <span className="block truncate text-ink-800" title={driver}>
                                        {driver}
                                      </span>
                                      {trip.vehiclePlate ? (
                                        <span className="tnum block truncate text-xs text-ink-500">
                                          {trip.vehiclePlate}
                                        </span>
                                      ) : null}
                                    </>
                                  ) : (
                                    <span className="text-ink-400">не назначен</span>
                                  )}
                                </td>
                                <td className="tnum px-2 py-1.5 text-right text-ink-900">
                                  <span className="block truncate">
                                    {trip.priceMinor !== null
                                      ? formatMoney(trip.priceMinor, trip.currency)
                                      : '—'}
                                  </span>
                                </td>
                                <td className="px-2 py-1.5 text-ink-700">
                                  <span className="tnum block">{formatDateTime(trip.requestedAt)}</span>
                                  {relativeOrNothing(trip.requestedAt) ? (
                                    <span className="block text-xs text-ink-500">
                                      {relativeOrNothing(trip.requestedAt)}
                                    </span>
                                  ) : null}
                                </td>
                                <td className="px-2 py-1.5">
                                  <Button
                                    variant={selected ? 'primary' : 'secondary'}
                                    size="sm"
                                    onClick={(event) => {
                                      event.stopPropagation();
                                      openTrip(trip.tripId);
                                    }}
                                    aria-label={`Открыть поездку № ${trip.tripNumber}`}
                                  >
                                    {selected ? 'Открыта' : 'Открыть'}
                                  </Button>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  ) : null}

                  {onlyActive && hiddenByActiveFilter > 0 && rows.length > 0 ? (
                    <p className="text-xs text-ink-500">
                      Фильтр «только активные» скрыл {hiddenByActiveFilter} из {items.length} строк этой
                      страницы. Пагинация по-прежнему серверная: она листает все поездки фильтра, а не
                      только активные.
                    </p>
                  ) : null}

                  {listQuery.data ? (
                    <Pagination
                      page={listQuery.data.page}
                      totalPages={listQuery.data.totalPages}
                      hasNext={listQuery.data.hasNext}
                      totalElements={listQuery.data.totalElements}
                      isFetching={listQuery.isFetching}
                      onPageChange={setPage}
                    />
                  ) : null}
                </div>
              </div>
            </Panel>
          </div>

          {/* --------------------------------- правая колонка: деталь и действия */}
          <aside className="min-w-0 space-y-4 xl:sticky xl:top-4 xl:max-h-[calc(100vh-2rem)] xl:self-start xl:overflow-y-auto xl:pr-1">
            <TripDetailPanel
              tripId={trimmedTarget}
              trip={detailTrip}
              isPending={detailQuery.isPending}
              isError={detailQuery.isError}
              error={detailQuery.error}
              canWrite={canWrite}
              onRetry={() => void detailQuery.refetch()}
              onClose={() => {
                setTargetTripId('');
                setLookupDraft('');
              }}
              lookupDraft={lookupDraft}
              onLookupDraftChange={setLookupDraft}
              onOpen={openTrip}
            />

            {detailTrip ? <ReceiptPanel trip={detailTrip} /> : null}

            {canWrite ? (
              <TripActionsPanel
                tripId={trimmedTarget}
                tripNumber={detailTrip?.tripNumber}
                status={detailStatus}
                isLoading={trimmedTarget !== '' && detailQuery.isLoading}
              />
            ) : null}
          </aside>
        </div>
      </div>
    </div>
  );
}
