/**
 * Раздел админки «Поездки».
 *
 * Только реальные данные trip-service: заголовок, описание, список эндпоинтов и пометку
 * «только чтение» рисует оболочка (`src/admin/AdminPage.tsx` / `AdminLayout.tsx`), поэтому
 * раздел начинается с KPI, фильтра и таблицы, а не повторяет шапку.
 *
 * Четыре вещи сделаны намеренно честно:
 *
 *  1. <b>Агрегатов у сервиса нет.</b> «Всего по фильтру» — это `Page.totalElements`, то
 *     есть счёт сервера; остальные числа посчитаны по выборке из последних 100 поездок с
 *     тем же фильтром и подписаны именно так. Придумывать «в работе 37» по одной странице
 *     из 20 строк нельзя.
 *  2. <b>Карты здесь нет.</b> Раздел — это списочная работа с данными, а карта живёт в
 *     диспетчерской; маршрут показан адресами и координатами, рядом ссылка на `/dispatch`.
 *  3. <b>Каждое изменяющее действие помечено `data-admin-write`</b> — по этой пометке
 *     браузерная проверка `web/e2e/check-admin.mjs` убеждается, что роль SUPPORT не видит
 *     ни одного действия, способного изменить данные на сервере. Поэтому блок действий
 *     целиком отсутствует при `canWrite === false`, а не «выключен».
 *  4. <b>Недоступное действие объясняется, а не прячется.</b> Назначение водителя сервис
 *     принимает только для `SEARCHING` (`TripSagaService.assign`), отмена — до
 *     `ARRIVED` включительно: после начала поездки тариф уже должен быть оплачен
 *     (`TripStatus.isCancellable`), и никакая роль этого не меняет.
 */
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { fieldErrorOf, isApiError } from '../../api/errors';
import { fetchTrip, fetchTripReceipt, fetchTrips } from '../../api/endpoints';
import { formatMoney, sumMinor } from '../../api/money';
import type { Trip, TripPoint, TripQuery, TripReceipt, TripStatus } from '../../api/types';
import { Alert, ErrorAlert } from '../../components/ui/Alerts';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { Card, CardBody, CardHeader, DetailRow } from '../../components/ui/Card';
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
import { assignTripDriver, cancelTripAsOperator } from '../api/tripAdmin';
import type { AssignDriverBody, TripCanceller } from '../api/tripAdmin';
import type { AdminSectionProps } from '../sections';

/* ------------------------------------------------------------------ константы */

const PAGE_SIZE = 20;

/**
 * Размер выборки для KPI.
 *
 * `TripController.list` принимает `size` в диапазоне 1..100, поэтому 100 — это максимум,
 * который сервис отдаст за один запрос, и именно его имеет смысл взять для счётчиков,
 * которых у сервиса нет в виде агрегата.
 */
const KPI_SAMPLE_SIZE = 100;

/**
 * Значения `TripStatus` из trip-service (`domain/TripStatus.java`).
 *
 * Справочника статусов в API нет: `GET /trips?status=` принимает ровно это значение enum,
 * и любое другое сервис отвергнет с 400. Список нужен фильтру, а не данным.
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

/** Ключи запросов раздела. Локальные: `src/lib/queryKeys.ts` — общий файл, его не трогаем. */
function tripListKey(filters: { status: string; page: number; size: number }) {
  return ['admin', 'trips', 'list', filters] as const;
}

function tripKpiKey(status: string) {
  return ['admin', 'trips', 'kpi', { status }] as const;
}

function tripDetailKey(tripId: string) {
  return ['admin', 'trips', 'detail', tripId] as const;
}

function tripReceiptKey(tripId: string) {
  return ['admin', 'trips', 'receipt', tripId] as const;
}

/* -------------------------------------------------------------- мелкие детали */

/**
 * Бейдж статуса поездки.
 *
 * Китовый `StatusBadge` берёт подпись и тон из общей карты `lib/format.ts`, где статусов
 * поездки нет: для `SEARCHING` он показал бы код, а не «Ищем водителя». Подпись и тон
 * берём из `lib/trips.ts` (так же, как `TripHistoryRow`), сам бейдж — китовый.
 */
function TripStatusBadge({ status }: { status: string | null | undefined }) {
  return <Badge tone={tripStatusTone(status)}>{tripStatusLabel(status)}</Badge>;
}

function KpiCard({ label, value, caption }: { label: string; value: string; caption: string }) {
  return (
    <Card>
      <CardBody>
        <p className="text-xs font-medium tracking-wide text-ink-500 uppercase">{label}</p>
        <p className="tnum mt-1 text-xl font-semibold text-ink-900">{value}</p>
        <p className="mt-1 text-xs text-ink-500">{caption}</p>
      </CardBody>
    </Card>
  );
}

/** Точка маршрута текстом: адрес плюс координаты, без карты. */
function PointBlock({ title, point }: { title: string; point: TripPoint | null }) {
  if (!point) {
    return (
      <div className="rounded-xl border border-dashed border-ink-200 p-3">
        <p className="text-sm font-medium text-ink-800">{title}</p>
        <p className="mt-1 text-sm text-ink-500">Точка в ответе сервиса не пришла.</p>
      </div>
    );
  }

  const hasCoordinates = Number.isFinite(point.lat) && Number.isFinite(point.lon);

  return (
    <div className="rounded-xl border border-ink-200 p-3">
      <p className="text-sm font-medium text-ink-800">{title}</p>
      <p className="mt-1 text-sm text-ink-900">
        {point.address !== '' ? point.address : 'Адрес не пришёл — в ответе только координаты'}
      </p>
      <p className="tnum mt-0.5 text-xs text-ink-500">
        {hasCoordinates ? `${point.lat.toFixed(5)}, ${point.lon.toFixed(5)}` : 'Координаты не пришли'}
      </p>
    </div>
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
    const note = [tripStatusLabel(entry.status), actor ? `кто: ${actor}` : null]
      .filter((part): part is string => part !== null)
      .join(' · ');
    return {
      key: `${entry.status}-${entry.at}-${index}`,
      status: entry.status,
      time: entry.at,
      note,
    };
  });
}

/* ----------------------------------------------------------------------- KPI */

interface TripKpis {
  total: number;
  active: number;
  completed: number;
  cancelled: number;
  noDrivers: number;
  fareMinor: number;
  currency: string;
  withoutPrice: number;
  sampleSize: number;
}

/**
 * Счётчики по выборке. `total` приходит с сервера (`Page.totalElements`), остальное
 * считается по строкам выборки — и на экране это написано словами.
 */
function tripKpis(sample: Trip[], serverTotal: number, onlyActive: boolean): TripKpis {
  const rows = onlyActive
    ? sample.filter((trip) => TRIP_ACTIVE_STATUSES.includes(trip.status))
    : sample;

  const withPrice = rows.filter(
    (trip): trip is Trip & { priceMinor: number } => trip.priceMinor !== null,
  );

  return {
    total: onlyActive ? rows.length : serverTotal,
    active: rows.filter((trip) => TRIP_ACTIVE_STATUSES.includes(trip.status)).length,
    completed: rows.filter((trip) => trip.status === 'COMPLETED').length,
    cancelled: rows.filter(
      (trip) => trip.status === 'CANCELLED_BY_RIDER' || trip.status === 'CANCELLED_BY_DRIVER',
    ).length,
    noDrivers: rows.filter((trip) => trip.status === 'NO_DRIVERS_FOUND').length,
    fareMinor: sumMinor(withPrice.map((trip) => trip.priceMinor)),
    currency: withPrice[0]?.currency ?? rows[0]?.currency ?? 'KZT',
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
      // Список, KPI и деталь этой поездки живут под префиксом ['admin','trips'].
      void queryClient.invalidateQueries({ queryKey: ['admin', 'trips'] });
      // Клиентские экраны такси держат те же данные под префиксом ['trips']
      // (см. `lib/queryKeys.ts`): после назначения их ответ устарел так же, как наш.
      void queryClient.invalidateQueries({ queryKey: ['trips'] });
    },
  });

  const submit = () => {
    if (tripId.trim() === '') {
      setLocalError('Сначала укажите ID поездки — без него сервис назначить водителя не сможет');
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

      <div className="grid gap-3 sm:grid-cols-3">
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
      setLocalError('Сначала укажите ID поездки — отменять нужно конкретную поездку');
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

      <div className="w-72 max-w-full">
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
      </div>

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
 * Блок изменяющих действий раздела: цель — ID поездки.
 *
 * Цель задаётся полем, а не только выбором строки: у поддержки и диспетчера идентификатор
 * часто приходит из обращения, и заставлять искать его в таблице было бы лишней работой.
 * Кнопка «Открыть» в таблице просто подставляет ID сюда.
 *
 * Формы исчезают, когда статус поездки делает действие невозможным, — и вместо них
 * появляется объяснение, почему сервис его не примет.
 */
function TripActionsCard({
  tripId,
  status,
  isLoading,
  onTargetChange,
}: {
  tripId: string;
  status: TripStatus | undefined;
  isLoading: boolean;
  onTargetChange: (value: string) => void;
}) {
  const statusUnknown = status === undefined;
  const assignable = statusUnknown || status === 'SEARCHING';
  const cancellable = statusUnknown || TRIP_CANCELLABLE_STATUSES.includes(status);

  return (
    <Card>
      <CardHeader
        title="Действия по поездке"
        subtitle="Назначение водителя и отмена с причиной. Оба действия сервис записывает в историю поездки и в события."
      />
      <CardBody className="space-y-4">
        <div className="max-w-xl">
          <TextField
            id="admin-trips-target"
            label="ID поездки"
            required
            value={tripId}
            placeholder="01M3Y1AYYJGHVVY7NCZQ690MJF"
            hint="Выберите поездку в таблице или вставьте ULID из обращения — формы работают по этому идентификатору"
            onChange={(event) => onTargetChange(event.target.value)}
          />
        </div>

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
      </CardBody>
    </Card>
  );
}

/* ----------------------------------------------------------------------- чек */

function ReceiptRows({ receipt }: { receipt: TripReceipt }) {
  const commission = commissionBpLabel(receipt.commissionBp);
  const surge = surgeLabel(receipt.surgeBp);

  return (
    <dl className="mt-2">
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
          <span className="inline-flex items-center gap-1">
            <span className="font-mono text-xs">{shortId(receipt.holdId)}</span>
            <CopyButton value={receipt.holdId} />
          </span>
        </DetailRow>
      ) : null}
      <DetailRow label="Движение по счёту">
        {receipt.transactionId ? (
          <span className="inline-flex items-center gap-1">
            <span className="font-mono text-xs">{shortId(receipt.transactionId)}</span>
            <CopyButton value={receipt.transactionId} />
          </span>
        ) : (
          'сервис не прислал'
        )}
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

function ReceiptBlock({ trip }: { trip: Trip }) {
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
    <div className="border-t border-ink-100 pt-4">
      <p className="text-sm font-medium text-ink-800">Чек</p>

      {embedded ? (
        <>
          <p className="mt-1 text-xs text-ink-500">
            Чек пришёл вместе с деталью поездки: <span className="font-mono">GET /api/v1/trips/{'{id}'}</span>{' '}
            отдаёт его для завершённой поездки.
          </p>
          <ReceiptRows receipt={embedded} />
        </>
      ) : null}

      {!embedded && trip.status !== 'COMPLETED' ? (
        <p className="mt-1 text-sm text-ink-500">
          Чек появляется только у завершённой поездки: на остальные статусы сервис отвечает{' '}
          <span className="font-mono text-xs">409 TRIP_NOT_COMPLETED</span>, поэтому раздел не запрашивает его
          зря.
        </p>
      ) : null}

      {needsFetch && query.isPending ? <SkeletonText lines={4} className="mt-3" /> : null}

      {needsFetch && query.isError ? (
        <ErrorAlert
          error={query.error}
          title="Чек не удалось загрузить"
          className="mt-3"
          onRetry={() => void query.refetch()}
        />
      ) : null}

      {needsFetch && query.isSuccess && query.data === null ? (
        <Alert tone="warning" title="Сервис не отдал чек" className="mt-3">
          Поездка завершена, но в ответе нет суммы, которую можно напечатать: показывать нули вместо чека
          раздел не будет.
        </Alert>
      ) : null}

      {needsFetch && query.data ? <ReceiptRows receipt={query.data} /> : null}
    </div>
  );
}

/* ------------------------------------------------------------------- деталь */

function TripDetail({
  tripId,
  trip,
  isPending,
  isError,
  error,
  onRetry,
  onClose,
}: {
  tripId: string;
  trip: Trip | undefined;
  isPending: boolean;
  isError: boolean;
  error: unknown;
  onRetry: () => void;
  onClose: () => void;
}) {
  const notFound = isApiError(error) && error.isNotFound;

  return (
    <Card>
      <CardHeader
        title={trip ? `Поездка № ${trip.tripNumber}` : 'Поездка'}
        subtitle={
          trip
            ? `ID: ${trip.tripId} · создана ${formatDateTime(trip.requestedAt)} (${formatRelative(trip.requestedAt)})`
            : `Деталь поездки ${tripId}`
        }
        action={
          <div className="flex items-center gap-2">
            {trip ? <TripStatusBadge status={trip.status} /> : null}
            <Button variant="secondary" size="sm" onClick={onClose}>
              Закрыть
            </Button>
          </div>
        }
      />

      <CardBody className="space-y-4">
        {isPending ? <SkeletonText lines={8} /> : null}

        {isError && !notFound ? (
          <ErrorAlert error={error} title="Не удалось загрузить поездку" onRetry={onRetry} />
        ) : null}

        {isError && notFound ? (
          <EmptyState
            title="Поездка не найдена"
            description="Сервис ответил 404: поездки с таким идентификатором нет. Проверьте ID — он приходит из таблицы или из обращения."
          />
        ) : null}

        {trip ? (
          <>
            <dl>
              <DetailRow label="Статус">
                <TripStatusBadge status={trip.status} />
              </DetailRow>
              <DetailRow label="Номер и ID">
                <span className="inline-flex items-center gap-1">
                  <span className="tnum">№ {trip.tripNumber}</span>
                  <span className="font-mono text-xs text-ink-500">{shortId(trip.tripId)}</span>
                  <CopyButton value={trip.tripId} />
                </span>
              </DetailRow>
              <DetailRow label="Тариф">{tariffLabel(trip.tariff)}</DetailRow>
              <DetailRow label="Клиент">
                {trip.riderUserId ? (
                  <span className="inline-flex items-center gap-1">
                    <span className="font-mono text-xs">{shortId(trip.riderUserId)}</span>
                    <CopyButton value={trip.riderUserId} />
                  </span>
                ) : (
                  'сервис не прислал идентификатор'
                )}
              </DetailRow>
              <DetailRow label="Водитель">{trip.driverName ?? trip.driverId ?? 'не назначен'}</DetailRow>
              {trip.vehiclePlate ? <DetailRow label="Номер машины">{trip.vehiclePlate}</DetailRow> : null}
              {trip.driverId ? (
                <DetailRow label="driverId">
                  <span className="inline-flex items-center gap-1">
                    <span className="font-mono text-xs">{shortId(trip.driverId)}</span>
                    <CopyButton value={trip.driverId} />
                  </span>
                </DetailRow>
              ) : null}
              {trip.distanceM !== null ? (
                <DetailRow label="Расстояние">
                  <span className="tnum">{formatDistanceMeters(trip.distanceM)}</span>
                </DetailRow>
              ) : null}
              {trip.durationS !== null ? (
                <DetailRow label="Длительность">
                  <span className="tnum">{formatAgeSeconds(trip.durationS)}</span>
                </DetailRow>
              ) : null}
              <DetailRow label="Стоимость">
                {trip.priceMinor !== null ? (
                  <span className="tnum">{formatMoney(trip.priceMinor, trip.currency)}</span>
                ) : (
                  'сервис не прислал'
                )}
              </DetailRow>
              {trip.commissionMinor !== null ? (
                <DetailRow
                  label={
                    commissionBpLabel(trip.commissionBp)
                      ? `Комиссия платформы ${commissionBpLabel(trip.commissionBp)}`
                      : 'Комиссия платформы'
                  }
                >
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
                    <span className="font-mono text-xs">{shortId(trip.holdId)}</span>
                    <CopyButton value={trip.holdId} />
                  </span>
                  {trip.holdStatus ? (
                    <span className="ml-2 text-xs text-ink-500">{trip.holdStatus}</span>
                  ) : null}
                </DetailRow>
              ) : null}
              <DetailRow label="Создана">
                <span className="tnum">{formatDateTime(trip.requestedAt)}</span>
              </DetailRow>
              {trip.assignedAt ? (
                <DetailRow label="Назначен водитель">
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
              {trip.ratingStars !== null ? (
                <DetailRow label="Оценка пассажира">
                  {trip.ratingStars} / 5{trip.ratingComment ? ` · ${trip.ratingComment}` : ''}
                </DetailRow>
              ) : null}
            </dl>

            {trip.cancelReason ? (
              <Alert tone="warning" title="Причина отмены">
                {trip.cancelReason}
              </Alert>
            ) : null}

            <div className="border-t border-ink-100 pt-4">
              <p className="text-sm font-medium text-ink-800">Маршрут</p>
              <p className="mt-1 text-xs text-ink-500">
                Карты в разделе нет намеренно: маршрут показан адресами и координатами, а живая карта с
                машинами живёт в диспетчерской.
              </p>
              <div className="mt-2 grid gap-3 sm:grid-cols-2">
                <PointBlock title="Точка А (посадка)" point={trip.pickup} />
                <PointBlock title="Точка Б (высадка)" point={trip.dropoff} />
              </div>
              <p className="mt-2 text-xs text-ink-500">
                <Link to="/dispatch" className="font-medium text-brand-700 hover:underline">
                  Открыть диспетчерскую карту
                </Link>{' '}
                — экран доступен ролям диспетчера и оператора; позиции машин в этой детали нет, сервис её не
                отдаёт.
              </p>
            </div>

            <div className="border-t border-ink-100 pt-4">
              <p className="text-sm font-medium text-ink-800">История переходов</p>
              <p className="mt-1 text-xs text-ink-500">
                Массив <span className="font-mono">timeline</span> из ответа сервиса: код статуса, время и кто
                переход сделал.
              </p>
              <Timeline className="mt-3" entries={timelineEntries(trip)} />
            </div>

            <ReceiptBlock trip={trip} />
          </>
        ) : null}
      </CardBody>
    </Card>
  );
}

/* ------------------------------------------------------------------- раздел */

export default function TripsSection({ canWrite }: AdminSectionProps) {
  const [status, setStatus] = useState('');
  const [onlyActive, setOnlyActive] = useState(false);
  const [size, setSize] = useState(PAGE_SIZE);
  const [page, setPage] = useState(0);
  const [targetTripId, setTargetTripId] = useState('');

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

  const kpis = useMemo(
    () => (kpiQuery.data ? tripKpis(kpiQuery.data.items, kpiQuery.data.totalElements, onlyActive) : null),
    [kpiQuery.data, onlyActive],
  );

  const hiddenByActiveFilter = items.length - rows.length;

  return (
    <div className="space-y-4">
      {/* ------------------------------------------------------------ KPI */}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard
          label={onlyActive ? 'Активных в фильтре' : 'Всего по фильтру'}
          value={kpis ? String(kpis.total) : '—'}
          caption={
            onlyActive
              ? 'посчитано по выборке: сервер не умеет «любой из живых статусов»'
              : 'счёт сервера: Page.totalElements для текущего filter'
          }
        />
        <KpiCard
          label="В работе"
          value={kpis ? String(kpis.active) : '—'}
          caption="SEARCHING, ASSIGNED, ARRIVED, IN_PROGRESS — по выборке"
        />
        <KpiCard
          label="Завершено"
          value={kpis ? String(kpis.completed) : '—'}
          caption="статус COMPLETED — по выборке"
        />
        <KpiCard
          label="Отменено"
          value={kpis ? String(kpis.cancelled) : '—'}
          caption="CANCELLED_BY_RIDER + CANCELLED_BY_DRIVER — по выборке"
        />
        <KpiCard
          label="Сумма цен"
          value={kpis ? formatMoney(kpis.fareMinor, kpis.currency) : '—'}
          caption={
            kpis && kpis.withoutPrice > 0
              ? `по выборке; у ${kpis.withoutPrice} поездок цена не пришла и в сумму не вошла`
              : 'по выборке: сумма priceMinor'
          }
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
        Агрегатов у trip-service нет: «Всего по фильтру» — счёт сервера, а «в работе», «завершено», «отменено»
        и сумма считаются клиентом по выборке из последних {KPI_SAMPLE_SIZE} поездок с тем же фильтром (
        <span className="font-mono text-xs">GET /api/v1/trips?size={KPI_SAMPLE_SIZE}</span>, сортировка
        сервиса — новейшие первыми). Сейчас в выборке {kpis ? `${kpis.sampleSize} поездок` : '—'}
        {kpis && kpis.noDrivers > 0
          ? `, из них без свободных машин (NO_DRIVERS_FOUND): ${kpis.noDrivers}`
          : ''}
        . Это не «статистика по всей базе», и подписи говорят именно это.
      </Alert>

      {/* -------------------------------------------------------- фильтр */}
      <Card>
        <CardHeader
          title="Фильтр"
          subtitle="Сервер принимает один статус за раз и размер страницы от 1 до 100 (TripController.list)"
        />
        <CardBody className="flex flex-wrap items-start gap-4">
          <div className="w-56">
            <SelectField
              id="admin-trips-status"
              label="Статус"
              value={status}
              placeholder="Все статусы"
              options={TRIP_STATUS_FILTER_OPTIONS}
              hint="Значения enum TripStatus"
              onChange={(event) => {
                setStatus(event.target.value);
                setPage(0);
              }}
            />
          </div>

          <div className="w-40">
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

          <div className="pt-7">
            <CheckboxField
              id="admin-trips-active"
              label="Только активные"
              checked={onlyActive}
              hint="Отбор по загруженным строкам: API принимает только один статус, поэтому «любой из четырёх живых» сервер отфильтровать не может"
              onChange={(event) => setOnlyActive(event.target.checked)}
            />
          </div>
        </CardBody>
      </Card>

      {/* -------------------------------------------------------- таблица */}
      <Card>
        <CardHeader
          title="Поездки"
          subtitle={
            listQuery.data
              ? `Найдено по фильтру: ${listQuery.data.totalElements} · на этой странице: ${items.length}`
              : 'Список поездок'
          }
          action={listQuery.isFetching ? <span className="text-xs text-ink-500">Обновляем…</span> : null}
        />
        <CardBody className="space-y-3">
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
              title={status === '' ? 'Поездок нет' : `Поездок со статусом «${tripStatusLabel(status)}» нет`}
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
            <div className="overflow-x-auto">
              <table className="w-full min-w-[1000px] text-sm">
                <caption className="sr-only">Поездки по текущему фильтру</caption>
                <thead>
                  <tr className="border-b border-ink-200 text-left text-xs tracking-wide text-ink-500 uppercase">
                    <th scope="col" className="px-3 py-2 font-medium">
                      Поездка
                    </th>
                    <th scope="col" className="px-3 py-2 font-medium">
                      Тариф
                    </th>
                    <th scope="col" className="px-3 py-2 font-medium">
                      Клиент
                    </th>
                    <th scope="col" className="px-3 py-2 font-medium">
                      Водитель
                    </th>
                    <th scope="col" className="px-3 py-2 font-medium">
                      Статус
                    </th>
                    <th scope="col" className="px-3 py-2 text-right font-medium">
                      Сумма
                    </th>
                    <th scope="col" className="px-3 py-2 font-medium">
                      Запрошена
                    </th>
                    <th scope="col" className="px-3 py-2 font-medium">
                      <span className="sr-only">Действия</span>
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-ink-100">
                  {rows.map((trip) => {
                    const selected = trip.tripId === trimmedTarget;
                    return (
                      <tr key={trip.tripId} className={cx('align-top', selected && 'bg-brand-50')}>
                        <td className="px-3 py-2">
                          <span className="block font-medium text-ink-900">№ {trip.tripNumber}</span>
                          <span className="font-mono text-xs text-ink-500">{shortId(trip.tripId)}</span>
                        </td>
                        <td className="px-3 py-2 text-ink-700">{tariffLabel(trip.tariff)}</td>
                        <td className="px-3 py-2">
                          {trip.riderUserId ? (
                            <span className="font-mono text-xs text-ink-600">
                              {shortId(trip.riderUserId)}
                            </span>
                          ) : (
                            <span className="text-ink-400">не пришёл</span>
                          )}
                          <span className="mt-0.5 block text-xs text-ink-400">
                            имя клиента сервис не отдаёт
                          </span>
                        </td>
                        <td className="px-3 py-2">
                          {trip.driverName ?? trip.driverId ? (
                            <>
                              <span className="block text-ink-800">
                                {trip.driverName ?? shortId(trip.driverId ?? '')}
                              </span>
                              {trip.vehiclePlate ? (
                                <span className="tnum block text-xs text-ink-500">{trip.vehiclePlate}</span>
                              ) : null}
                            </>
                          ) : (
                            <span className="text-ink-400">не назначен</span>
                          )}
                        </td>
                        <td className="px-3 py-2">
                          <TripStatusBadge status={trip.status} />
                        </td>
                        <td className="tnum px-3 py-2 text-right whitespace-nowrap text-ink-900">
                          {trip.priceMinor !== null ? formatMoney(trip.priceMinor, trip.currency) : '—'}
                        </td>
                        <td className="px-3 py-2 whitespace-nowrap text-ink-700">
                          <span className="tnum block">{formatDateTime(trip.requestedAt)}</span>
                          <span className="block text-xs text-ink-500">
                            {formatRelative(trip.requestedAt)}
                          </span>
                        </td>
                        <td className="px-3 py-2">
                          <Button
                            variant={selected ? 'primary' : 'secondary'}
                            size="sm"
                            onClick={() => setTargetTripId(trip.tripId)}
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
              Фильтр «только активные» скрыл {hiddenByActiveFilter} из {items.length} строк этой страницы.
              Пагинация по-прежнему серверная: она листает все поездки фильтра, а не только активные.
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
        </CardBody>
      </Card>

      {/* ------------------------------------------------------- действия */}
      {canWrite ? (
        <TripActionsCard
          tripId={targetTripId}
          status={detailQuery.data?.status}
          isLoading={detailQuery.isLoading}
          onTargetChange={setTargetTripId}
        />
      ) : null}

      {/* --------------------------------------------------------- деталь */}
      {trimmedTarget !== '' ? (
        <TripDetail
          tripId={trimmedTarget}
          trip={detailQuery.data}
          isPending={detailQuery.isPending}
          isError={detailQuery.isError}
          error={detailQuery.error}
          onRetry={() => void detailQuery.refetch()}
          onClose={() => setTargetTripId('')}
        />
      ) : (
        <p className="text-sm text-ink-500">
          Выберите поездку в таблице: в детали будет маршрут точками, история переходов и чек
          {canWrite ? ', а формы назначения и отмены — в блоке действий выше' : ''}.
        </p>
      )}
    </div>
  );
}
