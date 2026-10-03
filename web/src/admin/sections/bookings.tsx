/**
 * Раздел админки «Записи QTime».
 *
 * Компоновка та же, что в «Поездках»: сверху тулбар с фильтром, ниже сводка и структура
 * выборки, под ними — рейл статусов и список слева, деталь записи справа (`xl`; на узких
 * экранах одна колонка). Заголовок, описание и список эндпоинтов рисует оболочка
 * (`src/admin/AdminPage.tsx` / `AdminLayout.tsx`), поэтому раздел начинается с данных.
 *
 * Крупные блоки берутся из общего набора админки (`src/admin/kit.tsx`): он несёт атрибуты
 * плотности (`data-admin-panel`, `data-admin-kpi`), по которым считает блоки браузерная
 * проверка `web/e2e/check-admin.mjs`, и делает разделы похожими друг на друга.
 *
 * Что здесь честно названо узким местом контракта:
 *
 *  1. <b>Клиента в ответе нет.</b> `QtimeDtos.BookingResponse` не содержит ни id, ни имени
 *     клиента (в сущности `ClientUserId` есть, в DTO он не выведен), поэтому колонки «клиент»
 *     в таблице нет — вместо неё в детали виден комментарий клиента, единственный его след в
 *     контракте.
 *  2. <b>Истории переходов тоже нет.</b> QTime отдаёт только текущий статус: ни `cancelledAt`,
 *     ни `completedAt` в ответ не приходят, поэтому хронология строится из времени создания
 *     (оно есть) и текущего состояния — без выдуманных отметок времени. Так она и подписана.
 *  3. <b>Агрегатов у сервиса нет.</b> «Всего» и числа в рейле статусов — счёт сервера
 *     (`Page.totalElements`; для рейла он берётся отдельным запросом `size=1` на статус),
 *     остальные числа — по выборке из последних 100 записей с тем же фильтром. Сумма цен
 *     считается по загруженной странице и подписана именно так.
 *  4. <b>Отмена помечена `data-admin-write`</b> и отсутствует при `canWrite === false`:
 *     браузерная проверка требует, чтобы роль SUPPORT не видела ни одного элемента, способного
 *     изменить данные на сервере.
 *  5. <b>Деньги в QTime не двигаются</b> — «a booking is a claim on a window», предоплата через
 *     ORTA Pay только объявлена событием (`QtimeServiceApplication`), поэтому раздел показывает
 *     цену-снимок и не обещает ни оплаты, ни возврата.
 */
import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { fieldErrorOf, isApiError } from '../../api/errors';
import { fetchBookings } from '../../api/endpoints';
import { formatMoney, sumMinor } from '../../api/money';
import type { BookingQuery, QtimeBooking } from '../../api/types';
import {
  DispatchIcon,
  LogoutIcon,
  OrdersIcon,
  ServicesIcon,
  ShieldIcon,
  StoreIcon,
  WalletIcon,
} from '../../components/layout/icons';
import { Alert, ErrorAlert } from '../../components/ui/Alerts';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { DetailRow } from '../../components/ui/Card';
import { CopyButton } from '../../components/ui/CopyButton';
import { EmptyState } from '../../components/ui/EmptyState';
import { SelectField, TextAreaField, TextField } from '../../components/ui/Field';
import { Pagination } from '../../components/ui/Pagination';
import { SkeletonRows, SkeletonText } from '../../components/ui/Skeleton';
import { Timeline, type TimelineEntry } from '../../components/ui/Timeline';
import { formatDurationMinutes } from '../../lib/cityTime';
import { cx } from '../../lib/cx';
import { formatDateTime, formatRelative, shortId, type Tone } from '../../lib/format';
import { useIdempotencyKey } from '../../lib/idempotency';
import { BarList, Chip, Donut, KpiTile, Panel, StatusRail, Toolbar } from '../kit';
import { cancelAdminBooking, fetchAdminBooking, toCsv } from '../api/tripAdmin';
import type { AdminBooking } from '../api/tripAdmin';
import type { AdminSectionProps } from '../sections';

/* ------------------------------------------------------------------ константы */

const PAGE_SIZE = 20;

/**
 * Размер выборки для сводки и диаграмм. `BookingController` зажимает `size` в 1..100
 * (`clamp(size)`), поэтому 100 — максимум за один запрос.
 */
const KPI_SAMPLE_SIZE = 100;

/**
 * Статусы записи — enum `BookingStatus` из qtime-service (`domain/BookingStatus.java`:
 * CONFIRMED, COMPLETED, CANCELLED_BY_CLIENT, CANCELLED_BY_COMPANY, NO_SHOW). Справочника в API
 * нет, а `GET /qtime/bookings?status=` принимает ровно эти значения.
 */
const BOOKING_STATUSES = [
  'CONFIRMED',
  'COMPLETED',
  'CANCELLED_BY_CLIENT',
  'CANCELLED_BY_COMPANY',
  'NO_SHOW',
] as const;

const BOOKING_STATUS_LABELS: Record<string, string> = {
  CONFIRMED: 'Подтверждена · окно занято',
  COMPLETED: 'Визит состоялся',
  CANCELLED_BY_CLIENT: 'Отменена клиентом',
  CANCELLED_BY_COMPANY: 'Отменена компанией',
  NO_SHOW: 'Клиент не пришёл',
};

const BOOKING_STATUS_TONES: Record<string, Tone> = {
  CONFIRMED: 'success',
  COMPLETED: 'success',
  CANCELLED_BY_CLIENT: 'neutral',
  CANCELLED_BY_COMPANY: 'warning',
  NO_SHOW: 'danger',
};

const BOOKING_STATUS_FILTER_OPTIONS = BOOKING_STATUSES.map((status) => ({
  value: status,
  label: BOOKING_STATUS_LABELS[status],
}));

const PAGE_SIZE_OPTIONS = [10, 20, 50, 100].map((value) => ({
  value: String(value),
  label: `${value} строк`,
}));

/** Колонки CSV-экспорта: то, что видно в таблице, плюс идентификаторы для сверки. */
const CSV_HEADER = [
  'bookingId',
  'code',
  'status',
  'startsAt',
  'endsAt',
  'companyId',
  'companyName',
  'specialistName',
  'serviceName',
  'durationMinutes',
  'priceMinor',
  'currency',
];

/** Ключи запросов раздела. Локальные: `src/lib/queryKeys.ts` — общий файл, его не трогаем. */
function bookingListKey(filters: { status: string; page: number; size: number }) {
  return ['admin', 'bookings', 'list', filters] as const;
}

function bookingKpiKey(status: string) {
  return ['admin', 'bookings', 'kpi', { status }] as const;
}

function bookingCountsKey() {
  return ['admin', 'bookings', 'status-counts'] as const;
}

function bookingDetailKey(bookingId: string) {
  return ['admin', 'bookings', 'detail', bookingId] as const;
}

/** Счёт сервера по каждому статусу: ключ `''` — «все статусы». */
export type BookingStatusCounts = Record<string, number>;

/**
 * Серверный счёт записей по каждому статусу.
 *
 * Агрегатного эндпоинта у qtime-service нет, но `GET /qtime/bookings?status=` отдаёт
 * `Page.totalElements` для своего фильтра. Поэтому рейл статусов делает по одному запросу
 * `size=1` на статус: тело ответа крошечное, а число берётся у сервера, а не считается по
 * выборке из 100 строк.
 */
export async function fetchBookingStatusCounts(): Promise<BookingStatusCounts> {
  const [all, ...byStatus] = await Promise.all([
    fetchBookings({ page: 0, size: 1 }),
    ...BOOKING_STATUSES.map((status) => fetchBookings({ status, page: 0, size: 1 })),
  ]);

  const counts: BookingStatusCounts = { '': all.totalElements };
  BOOKING_STATUSES.forEach((status, index) => {
    counts[status] = byStatus[index].totalElements;
  });
  return counts;
}

/* -------------------------------------------------------------- мелкие детали */

function bookingStatusLabel(status: string | null | undefined): string {
  if (!status) {
    return '—';
  }
  return BOOKING_STATUS_LABELS[status] ?? status;
}

function bookingStatusTone(status: string | null | undefined): Tone {
  if (status && BOOKING_STATUS_TONES[status]) {
    return BOOKING_STATUS_TONES[status];
  }
  return 'neutral';
}

/**
 * Относительное время — только когда оно отличается от абсолютного.
 *
 * `formatRelative` для отметок старше суток возвращает ту же строку, что `formatDateTime`
 * (см. `lib/format.ts`): в плотной строке это выглядело бы дублем даты, поэтому такой дубль
 * раздел не печатает.
 */
function relativeOrNothing(value: string | null): string | null {
  if (!value) {
    return null;
  }
  const relative = formatRelative(value);
  return relative === formatDateTime(value) ? null : relative;
}

/**
 * Бейдж статуса записи.
 *
 * Китовый `StatusBadge` берёт подпись из общей карты `lib/format.ts`, где QTime-статусы
 * отсутствуют: `CANCELLED_BY_COMPANY` показался бы кодом. Подписи и тона статусов записи живут
 * рядом с разделом, сам бейдж — китовый.
 */
function BookingStatusBadge({ status }: { status: string | null | undefined }) {
  return <Badge tone={bookingStatusTone(status)}>{bookingStatusLabel(status)}</Badge>;
}

/* ---------------------------------------------------------------- диаграммы */

interface StatusSlice {
  status: string;
  label: string;
  count: number;
}

/** Структура выборки по статусам — по строкам, которые уже загружены в браузер. */
function bookingStatusSlices(rows: QtimeBooking[]): StatusSlice[] {
  return BOOKING_STATUSES.map((status) => ({
    status,
    label: bookingStatusLabel(status),
    count: rows.filter((booking) => booking.status === status).length,
  }));
}

/** Распределение: полосы по статусам и кольцо с общим числом в центре. */
function DistributionPanel({ rows }: { rows: QtimeBooking[] }) {
  const slices = useMemo(() => bookingStatusSlices(rows), [rows]);
  const total = rows.length;

  return (
    <Panel
      id="admin-bookings-distribution"
      title="Распределение по статусам"
      subtitle={`по загруженной выборке · строк: ${total} · size=${KPI_SAMPLE_SIZE}`}
      bodyClassName="space-y-4"
    >
      {total === 0 ? (
        <EmptyState
          title="Данных не найдено"
          description={`В выборке из последних ${KPI_SAMPLE_SIZE} записей с текущим фильтром нет ни одной строки — распределять нечего. Снимите фильтр статуса.`}
        />
      ) : (
        <div className="grid gap-5 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
          <BarList
            items={slices.map((slice) => ({
              key: slice.status,
              label: slice.label,
              value: slice.count,
              hint: `${Math.round((slice.count / total) * 100)}%`,
              tone: bookingStatusTone(slice.status),
            }))}
          />
          <Donut
            size={150}
            centerValue={total}
            centerLabel="записей в выборке"
            segments={slices.map((slice) => ({
              key: slice.status,
              label: slice.label,
              value: slice.count,
              tone: bookingStatusTone(slice.status),
            }))}
          />
        </div>
      )}
    </Panel>
  );
}

/** Опубликовать CSV загруженных строк в буфер обмена — реальное действие, не картинка. */
function ExportCsvButton({ rows }: { rows: QtimeBooking[] }) {
  const [state, setState] = useState<'idle' | 'done' | 'failed'>('idle');

  const exportRows = async () => {
    const csv = toCsv(
      CSV_HEADER,
      rows.map((booking) => [
        booking.bookingId,
        booking.code,
        booking.status,
        booking.startsAt,
        booking.endsAt,
        booking.companyId,
        booking.companyName,
        booking.specialistName,
        booking.serviceName,
        booking.durationMinutes,
        booking.priceMinor,
        booking.currency,
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

interface BookingKpis {
  total: number;
  confirmed: number;
  completed: number;
  cancelled: number;
  noShow: number;
  pageSumMinor: number;
  pagePriced: number;
  pageWithoutPrice: number;
  currency: string;
  sampleSize: number;
}

/**
 * Счётчики раздела.
 *
 * «Всего» — счёт сервера (`Page.totalElements`). Статусы считаются по выборке из 100 записей и
 * подписаны как выборка. Сумма цен — по загруженной странице (то, что видно в таблице), и это
 * тоже сказано словами: складывать выборку и страницу в одном числе нельзя.
 */
function bookingKpis(
  sample: QtimeBooking[],
  serverTotal: number,
  pageRows: QtimeBooking[],
): BookingKpis {
  const withPrice = pageRows.filter(
    (booking): booking is QtimeBooking & { priceMinor: number } => booking.priceMinor !== null,
  );

  return {
    total: serverTotal,
    confirmed: sample.filter((booking) => booking.status === 'CONFIRMED').length,
    completed: sample.filter((booking) => booking.status === 'COMPLETED').length,
    cancelled: sample.filter(
      (booking) =>
        booking.status === 'CANCELLED_BY_CLIENT' || booking.status === 'CANCELLED_BY_COMPANY',
    ).length,
    noShow: sample.filter((booking) => booking.status === 'NO_SHOW').length,
    pageSumMinor: sumMinor(withPrice.map((booking) => booking.priceMinor)),
    pagePriced: withPrice.length,
    pageWithoutPrice: pageRows.length - withPrice.length,
    currency: withPrice[0]?.currency ?? pageRows[0]?.currency ?? 'KZT',
    sampleSize: sample.length,
  };
}

/* --------------------------------------------------------- отмена записи */

function CancelBookingForm({ bookingId }: { bookingId: string }) {
  const queryClient = useQueryClient();
  const [reason, setReason] = useState('');
  const [localError, setLocalError] = useState<string | undefined>(undefined);

  // Ключ идемпотентности: повтор той же отмены с той же причиной уходит с тем же ключом и не
  // превращается в 409 BOOKING_NOT_CANCELLABLE (см. javadoc `BookingController.cancel`). Смена
  // цели или причины — новое намерение, а значит новый ключ.
  const idempotency = useIdempotencyKey(`${bookingId.trim()}|${reason.trim()}`);

  const cancel = useMutation({
    mutationFn: (body: { bookingId: string; reason: string; idempotencyKey: string }) =>
      cancelAdminBooking(body.bookingId, { reason: body.reason }, body.idempotencyKey),
    retry: 0,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['admin', 'bookings'] });
      // Клиентский экран «мои записи» держит те же данные под префиксом ['qtime'].
      void queryClient.invalidateQueries({ queryKey: ['qtime'] });
    },
  });

  const submit = () => {
    if (bookingId.trim() === '') {
      setLocalError('Сначала откройте запись — отменять нужно конкретную запись');
      return;
    }
    if (reason.trim() === '') {
      setLocalError(
        'Укажите причину: компания отменяет запись клиента, и причина — единственное объяснение',
      );
      return;
    }
    setLocalError(undefined);
    cancel.mutate({
      bookingId: bookingId.trim(),
      reason: reason.trim(),
      idempotencyKey: idempotency.acquire(),
    });
  };

  return (
    <div className="space-y-3">
      <p className="text-sm text-ink-600">
        Тело отмены — <span className="font-mono text-xs">QtimeDtos.CancelBookingRequest</span>:{' '}
        <span className="font-mono text-xs">reason</span> до 255 символов. Отменяет компания, поэтому
        запись получает статус <span className="font-mono text-xs">CANCELLED_BY_COMPANY</span> (так сервис
        считает сторону компании для роли ADMIN —{' '}
        <span className="font-mono text-xs">QtimeAccess.isCompanySide</span>), а окно освобождается сразу.
      </p>

      <TextAreaField
        id="cancel-booking-reason"
        label="Причина отмены"
        required
        value={reason}
        maxLength={255}
        placeholder="Например: мастер заболел, переносим запись"
        error={localError ?? fieldErrorOf(cancel.error, 'reason')}
        hint="Причина сохранится в записи и попадёт в событие booking.cancelled"
        onChange={(event) => setReason(event.target.value)}
      />

      {cancel.isError ? <ErrorAlert error={cancel.error} title="Отменить запись не удалось" /> : null}

      {cancel.isSuccess ? (
        <Alert tone="success" title="Запись отменена">
          Новый статус: {bookingStatusLabel(cancel.data.status)}. Окно освобождено
          {cancel.data.cancelReason ? `, причина сохранена: ${cancel.data.cancelReason}` : ''}.
        </Alert>
      ) : null}

      <Button
        variant="danger"
        loading={cancel.isPending}
        disabled={cancel.isPending}
        onClick={submit}
        data-admin-write="отмена записи"
      >
        Подтвердить отмену
      </Button>
    </div>
  );
}

/**
 * Блок изменяющего действия раздела.
 *
 * Действует по открытой записи: её выбирают в списке или открывают по ID в детали — там же
 * видно, на какую запись смотрит форма. Так у изменяющей формы один источник истины.
 *
 * Если статус записи отмену не допускает, форма исчезает и вместо неё появляется объяснение:
 * окно занимает только CONFIRMED, остальные состояния терминальные.
 */
function BookingActionsPanel({
  bookingId,
  bookingCode,
  status,
  isLoading,
}: {
  bookingId: string;
  bookingCode: string | undefined;
  status: string | undefined;
  isLoading: boolean;
}) {
  const cancellable = status === undefined || status === 'CONFIRMED';

  return (
    <Panel
      id="admin-bookings-actions"
      title="Отмена записи"
      subtitle={
        bookingId === ''
          ? 'Запись не открыта — отмена станет доступна после выбора строки или открытия по ID'
          : `Запись ${bookingCode ?? shortId(bookingId)} · окно освобождается сразу`
      }
      bodyClassName="space-y-3"
    >
      {isLoading ? <SkeletonText lines={3} /> : null}

      {!isLoading && cancellable ? <CancelBookingForm bookingId={bookingId} /> : null}

      {!isLoading && !cancellable ? (
        <Alert tone="info" title={`Отмена невозможна: статус «${bookingStatusLabel(status)}»`}>
          Окно занимает только статус CONFIRMED: остальные состояния терминальные (
          <span className="font-mono text-xs">BookingStatus</span>), и сервис ответит 409{' '}
          <span className="font-mono text-xs">BOOKING_NOT_CANCELLABLE</span>. Отменённая запись остаётся в
          истории — окно при этом уже свободно.
        </Alert>
      ) : null}
    </Panel>
  );
}

/* ------------------------------------------------------------------- деталь */

/**
 * Хронология только из фактов ответа: время создания есть, отметки времени отмены и завершения
 * сервис не присылает — вместо них словами сказано, что их нет. Поэтому это не «история
 * переходов», а именно хронология: создание плюс текущее состояние.
 */
function bookingTimeline(booking: AdminBooking): TimelineEntry[] {
  const timeline: TimelineEntry[] = [];

  if (booking.createdAt) {
    timeline.push({
      key: 'created',
      status: 'CONFIRMED',
      time: booking.createdAt,
      note: 'Запись создана: QTime заводит её сразу подтверждённой (Booking.confirm), окно занято',
    });
  }
  if (booking.status === 'CANCELLED_BY_CLIENT' || booking.status === 'CANCELLED_BY_COMPANY') {
    timeline.push({
      key: 'cancelled',
      status: booking.status,
      time: null,
      note: booking.cancelReason
        ? `Причина: ${booking.cancelReason}. Точное время отмены сервис не отдаёт`
        : 'Запись отменена; причину сервис не сохранил, времени отмены в ответе нет',
    });
  }
  if (booking.status === 'COMPLETED') {
    timeline.push({
      key: 'completed',
      status: 'COMPLETED',
      time: null,
      note: 'Визит отмечен как состоявшийся. Время отметки в ответе не приходит: завершает визит ORTA Business через внутренний эндпоинт',
    });
  }
  if (booking.status === 'NO_SHOW') {
    timeline.push({
      key: 'no-show',
      status: 'NO_SHOW',
      time: null,
      note: 'Клиент не пришёл. Публичного эндпоинта для этой отметки нет — её ставит компания',
    });
  }

  return timeline;
}

/** Тело детали: участники, окно, цена и хронология — блоками, а не одной простыней. */
function BookingDetailBody({ booking }: { booking: AdminBooking }) {
  const duration = formatDurationMinutes(booking.durationMinutes);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <BookingStatusBadge status={booking.status} />
        {duration ? <Chip>{duration}</Chip> : null}
        <span className="tnum text-xs text-ink-500">
          создана {formatDateTime(booking.createdAt)}
          {relativeOrNothing(booking.createdAt) ? ` · ${relativeOrNothing(booking.createdAt)}` : ''}
        </span>
      </div>

      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-500">
        <span className="inline-flex items-center gap-1">
          Код: <span className="font-mono">{booking.code}</span>
          <CopyButton value={booking.code} />
        </span>
        <span className="inline-flex items-center gap-1">
          ID: <span className="font-mono break-all">{shortId(booking.bookingId)}</span>
          <CopyButton value={booking.bookingId} />
        </span>
      </div>

      {booking.cancelReason ? (
        <Alert tone="warning" title="Причина отмены">
          {booking.cancelReason}
        </Alert>
      ) : null}

      <div>
        <h3 className="text-sm font-semibold text-ink-800">Компания</h3>
        <dl className="mt-1 sm:grid sm:grid-cols-2 sm:gap-x-6 xl:block">
          <DetailRow label="Название">
            {booking.companyName ?? 'название не пришло — возможно, компания удалена из каталога'}
          </DetailRow>
          {booking.companyId ? (
            <DetailRow label="companyId">
              <span className="inline-flex items-center gap-1">
                <span className="font-mono text-xs break-all">{shortId(booking.companyId)}</span>
                <CopyButton value={booking.companyId} />
              </span>
            </DetailRow>
          ) : null}
          {booking.companyAddress ? <DetailRow label="Адрес">{booking.companyAddress}</DetailRow> : null}
        </dl>
      </div>

      <div className="border-t border-ink-100 pt-3">
        <h3 className="text-sm font-semibold text-ink-800">Мастер и услуга</h3>
        <dl className="mt-1 sm:grid sm:grid-cols-2 sm:gap-x-6 xl:block">
          <DetailRow label="Мастер">
            {booking.specialistName ?? 'имя не пришло'}
            {booking.specialistId ? (
              <span className="ml-2 font-mono text-xs text-ink-500">{shortId(booking.specialistId)}</span>
            ) : null}
          </DetailRow>
          <DetailRow label="Услуга">
            {booking.serviceName ?? 'название не пришло'}
            {booking.serviceId ? (
              <span className="ml-2 font-mono text-xs text-ink-500">{shortId(booking.serviceId)}</span>
            ) : null}
          </DetailRow>
        </dl>
      </div>

      <div className="border-t border-ink-100 pt-3">
        <h3 className="text-sm font-semibold text-ink-800">Окно и цена</h3>
        <dl className="mt-1 sm:grid sm:grid-cols-2 sm:gap-x-6 xl:block">
          <DetailRow label="Окно (начало)">
            <span className="tnum">{formatDateTime(booking.startsAt)}</span>
          </DetailRow>
          <DetailRow label="Окно (конец)">
            <span className="tnum">{formatDateTime(booking.endsAt)}</span>
          </DetailRow>
          <DetailRow label="Длительность">{duration ?? 'сервис не прислал'}</DetailRow>
          <DetailRow label="Цена-снимок">
            {booking.priceMinor !== null ? (
              <span className="tnum">{formatMoney(booking.priceMinor, booking.currency)}</span>
            ) : (
              'сервис не прислал'
            )}
          </DetailRow>
        </dl>
        <p className="mt-2 text-xs leading-snug text-ink-500">
          Цена — снимок, а не ссылка на прайс: QTime хранит цену и длительность, скопированные у услуги в
          момент записи (<span className="font-mono">Booking.confirm</span>), и переоценка услуги задним
          числом эту запись не переписывает. Деньги в QTime не двигаются — раздел показывает только сумму
          записи.
        </p>
      </div>

      <div className="border-t border-ink-100 pt-3">
        <h3 className="text-sm font-semibold text-ink-800">Комментарий клиента</h3>
        {booking.clientComment ? (
          <p className="mt-1 rounded-xl border border-ink-200 bg-ink-50 p-3 text-sm break-words text-ink-800">
            {booking.clientComment}
          </p>
        ) : (
          <p className="mt-1 text-sm text-ink-500">
            Комментарий клиента при записи не оставлен. Больше о клиенте в ответе нет ничего: ни id, ни
            имени — <span className="font-mono text-xs">QtimeDtos.BookingResponse</span> их не содержит, а
            запись знает клиента только по внутреннему{' '}
            <span className="font-mono text-xs">ClientUserId</span>.
          </p>
        )}
      </div>

      <div className="border-t border-ink-100 pt-3">
        <h3 className="text-sm font-semibold text-ink-800">Хронология записи</h3>
        <p className="mt-0.5 text-xs text-ink-500">
          Отдельной истории переходов у QTime нет: сервис отдаёт текущий статус и время создания. Поэтому в
          хронологии нет отметок времени отмены и завершения — их в контракте не существует.
        </p>
        <Timeline className="mt-3" entries={bookingTimeline(booking)} />
      </div>
    </div>
  );
}

/**
 * Панель детали. Существует всегда — это правая половина компоновки «список + деталь», и пустое
 * место в ней тоже состояние: здесь написано, что нужно выбрать запись.
 */
function BookingDetailPanel({
  bookingId,
  booking,
  isPending,
  isError,
  error,
  onRetry,
  onClose,
  lookupDraft,
  onLookupDraftChange,
  onOpen,
}: {
  bookingId: string;
  booking: AdminBooking | undefined;
  isPending: boolean;
  isError: boolean;
  error: unknown;
  onRetry: () => void;
  onClose: () => void;
  lookupDraft: string;
  onLookupDraftChange: (value: string) => void;
  onOpen: (value: string) => void;
}) {
  const notFound = isApiError(error) && error.isNotFound;
  const opened = bookingId !== '';
  const duration = booking ? formatDurationMinutes(booking.durationMinutes) : null;

  return (
    <Panel
      id="admin-bookings-detail"
      title={
        <span className="flex items-center gap-2">
          <span
            className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-brand-50 text-brand-700"
            aria-hidden="true"
          >
            <StoreIcon className="h-4 w-4" />
          </span>
          <span className="min-w-0 truncate">
            {booking ? `Запись ${booking.code}` : 'Деталь записи'}
          </span>
        </span>
      }
      subtitle={
        booking
          ? `Окно: ${formatDateTime(booking.startsAt)}${duration ? ` · ${duration}` : ''}`
          : 'Запись открывается кликом по строке списка или по ID'
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
            id="admin-bookings-lookup"
            label="Открыть запись по ID"
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
        <ErrorAlert error={error} title="Не удалось загрузить запись" onRetry={onRetry} />
      ) : null}

      {opened && isError && notFound ? (
        <EmptyState
          title="Запись не найдена"
          description="Сервис ответил 404: записи с таким идентификатором нет. Проверьте ID — он приходит из таблицы или из обращения."
        />
      ) : null}

      {!opened ? (
        <EmptyState
          title="Запись не выбрана"
          description="Выберите строку в списке слева или вставьте ULID в поле выше: в детали будут компания, мастер, услуга, окно, цена-снимок, комментарий клиента и хронология."
        />
      ) : null}

      {booking ? <BookingDetailBody booking={booking} /> : null}
    </Panel>
  );
}

/* ------------------------------------------------------------------- раздел */

export default function BookingsSection({ canWrite }: AdminSectionProps) {
  const [status, setStatus] = useState('');
  const [size, setSize] = useState(PAGE_SIZE);
  const [page, setPage] = useState(0);
  const [filtersOpen, setFiltersOpen] = useState(true);
  const [targetBookingId, setTargetBookingId] = useState('');
  const [lookupDraft, setLookupDraft] = useState('');

  const serverStatus = status === '' ? undefined : status;
  const trimmedTarget = targetBookingId.trim();

  const query: BookingQuery = { status: serverStatus, page, size };
  const listQuery = useQuery({
    queryKey: bookingListKey({ status, page, size }),
    queryFn: () => fetchBookings(query),
    placeholderData: (previous) => previous,
  });

  const kpiQuery = useQuery({
    queryKey: bookingKpiKey(status),
    queryFn: () => fetchBookings({ status: serverStatus, page: 0, size: KPI_SAMPLE_SIZE }),
    staleTime: 15_000,
  });

  const countsQuery = useQuery({
    queryKey: bookingCountsKey(),
    queryFn: fetchBookingStatusCounts,
    staleTime: 30_000,
  });

  const detailQuery = useQuery({
    queryKey: bookingDetailKey(trimmedTarget),
    queryFn: () => fetchAdminBooking(trimmedTarget),
    enabled: trimmedTarget !== '',
    retry: 0,
    staleTime: 10_000,
  });

  const items = useMemo(() => listQuery.data?.items ?? [], [listQuery.data]);
  const sampleRows = useMemo(() => kpiQuery.data?.items ?? [], [kpiQuery.data]);

  const kpis = useMemo(
    () => (kpiQuery.data ? bookingKpis(kpiQuery.data.items, kpiQuery.data.totalElements, items) : null),
    [kpiQuery.data, items],
  );

  const detailBooking = detailQuery.data;
  const detailStatus = trimmedTarget === '' ? undefined : detailBooking?.status;

  /** Смена фильтра статуса: и рейл, и селект ведут сюда, поэтому страница сбрасывается. */
  const selectStatus = (next: string) => {
    setStatus(next);
    setPage(0);
  };

  const openBooking = (bookingId: string) => {
    setTargetBookingId(bookingId);
    setLookupDraft(bookingId);
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
            <ExportCsvButton rows={items} />
          </>
        }
      >
        {filtersOpen ? (
          <>
            <div className="w-full sm:w-64">
              <SelectField
                id="admin-bookings-status"
                label="Статус"
                value={status}
                placeholder="Все статусы"
                options={BOOKING_STATUS_FILTER_OPTIONS}
                hint="Значения enum BookingStatus"
                onChange={(event) => selectStatus(event.target.value)}
              />
            </div>

            <div className="w-full sm:w-32">
              <SelectField
                id="admin-bookings-size"
                label="На странице"
                value={String(size)}
                options={PAGE_SIZE_OPTIONS}
                onChange={(event) => {
                  setSize(Number(event.target.value));
                  setPage(0);
                }}
              />
            </div>
          </>
        ) : (
          <p className="text-xs text-ink-500">
            Фильтр скрыт. Кнопка «Фильтр» возвращает выбор статуса и размера страницы.
          </p>
        )}
      </Toolbar>

      <div className="space-y-4">
        {/* --------------------------------------------------------- сводка */}
        <Panel
          id="admin-bookings-summary"
          title="Сводка"
          subtitle={`Агрегатов у qtime-service нет: «всего» — счёт сервера, статусы — по выборке из ${KPI_SAMPLE_SIZE} новейших записей, сумма цен — по загруженной странице`}
          bodyClassName="space-y-3"
        >
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <KpiTile
              label="Всего по фильтру"
              value={kpis ? String(kpis.total) : '—'}
              caption="счёт сервера: Page.totalElements по текущему фильтру"
              tone="brand"
              loading={!kpis}
              icon={<OrdersIcon className="h-5 w-5" />}
            />
            <KpiTile
              label="Подтверждено"
              value={kpis ? String(kpis.confirmed) : '—'}
              caption="CONFIRMED — окно занято, по выборке"
              tone="success"
              loading={!kpis}
              icon={<ServicesIcon className="h-5 w-5" />}
            />
            <KpiTile
              label="Завершено"
              value={kpis ? String(kpis.completed) : '—'}
              caption="COMPLETED — визит состоялся, по выборке"
              tone="success"
              loading={!kpis}
              icon={<ShieldIcon className="h-5 w-5" />}
            />
            <KpiTile
              label="Отменено"
              value={kpis ? String(kpis.cancelled) : '—'}
              caption="CANCELLED_BY_CLIENT + CANCELLED_BY_COMPANY, по выборке"
              tone="neutral"
              loading={!kpis}
              icon={<LogoutIcon className="h-5 w-5" />}
            />
            <KpiTile
              label="Неявки"
              value={kpis ? String(kpis.noShow) : '—'}
              caption="NO_SHOW — по выборке; публичного эндпоинта для отметки нет"
              tone="danger"
              loading={!kpis}
              icon={<DispatchIcon className="h-5 w-5" />}
            />
            <KpiTile
              label="Сумма цен на странице"
              value={kpis ? formatMoney(kpis.pageSumMinor, kpis.currency) : '—'}
              caption={
                kpis
                  ? `по загруженной странице: с ценой — ${kpis.pagePriced}${
                      kpis.pageWithoutPrice > 0 ? `, без цены — ${kpis.pageWithoutPrice}` : ''
                    }`
                  : 'по загруженной странице: сумма priceMinor'
              }
              tone="brand"
              loading={!kpis}
              icon={<WalletIcon className="h-5 w-5" />}
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
            Агрегатов у qtime-service нет: «всего по фильтру» — счёт сервера, «подтверждено», «завершено»,
            «отменено» и «неявки» считаются клиентом по выборке из последних {KPI_SAMPLE_SIZE} записей с тем
            же фильтром (
            <span className="font-mono text-xs">
              GET /api/v1/qtime/bookings?size={KPI_SAMPLE_SIZE}
            </span>
            ), а «сумма цен на странице» — по {items.length} строкам, которые видно в таблице. Сейчас в
            выборке строк: {kpis ? kpis.sampleSize : '—'}. Это не «статистика по всей базе», и подписи
            говорят именно это.
          </Alert>
        </Panel>

        {/* ----------------------------------- список + деталь (две колонки) */}
        <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_20rem]">
          <div className="min-w-0 space-y-4">
            <DistributionPanel rows={sampleRows} />

            <Panel
              id="admin-bookings-list"
              title="Записи"
              subtitle={
                listQuery.data
                  ? `Страница ${listQuery.data.page + 1} из ${Math.max(listQuery.data.totalPages, 1)} · на этой странице ${items.length}`
                  : 'Список записей по текущему фильтру'
              }
              bodyClassName="space-y-3"
            >
              <div className="grid gap-4 lg:grid-cols-[11rem_minmax(0,1fr)]">
                <div className="space-y-2">
                  <StatusRail
                    ariaLabel="Фильтр по статусу записи"
                    allCount={countsQuery.data?.['']}
                    active={status}
                    onSelect={selectStatus}
                    items={BOOKING_STATUSES.map((item) => ({
                      value: item,
                      label: bookingStatusLabel(item),
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
                      title="Не удалось загрузить записи"
                      onRetry={() => void listQuery.refetch()}
                    />
                  ) : null}

                  {listQuery.isSuccess && items.length === 0 ? (
                    <EmptyState
                      title={
                        status === ''
                          ? 'Записей нет'
                          : `Записей со статусом «${bookingStatusLabel(status)}» нет`
                      }
                      description={
                        status === ''
                          ? 'Сервис вернул пустую страницу: записи появятся здесь, как только клиенты начнут занимать окна в QTime.'
                          : 'Снимите фильтр статуса или выберите другой — сервис вернул пустую страницу именно по этому статусу.'
                      }
                    />
                  ) : null}

                  {items.length > 0 ? (
                    // `relative overflow-x-auto` — правило разделов админки: без `relative`
                    // `sr-only`-подпись таблицы растягивает документ на телефоне. К ним
                    // добавлены `max-h`/`overflow-y-auto`: без собственной вертикальной прокрутки
                    // `sticky`-заголовок таблицы не залипает (его scrollport — этот же контейнер).
                    <div className="relative max-h-[70vh] overflow-x-auto overflow-y-auto">
                      {/* `table-fixed`: ширины колонок заданы, длинные значения обрезаются с
                          подсказкой в `title`, а не распирают таблицу на пол-экрана. */}
                      <table className="w-full min-w-[540px] table-fixed text-sm">
                        <caption className="sr-only">Записи QTime по текущему фильтру</caption>
                        <thead className="sticky top-0 z-10 bg-white">
                          <tr className="border-b border-ink-200 text-left text-xs tracking-wide text-ink-500 uppercase">
                            <th scope="col" className="w-[5.25rem] px-2 py-1.5 font-medium">
                              Запись
                            </th>
                            <th scope="col" className="w-[6.25rem] px-2 py-1.5 font-medium">
                              Компания
                            </th>
                            <th scope="col" className="w-[5.5rem] px-2 py-1.5 font-medium">
                              Окно
                            </th>
                            <th scope="col" className="w-[6.25rem] px-2 py-1.5 text-right font-medium">
                              Цена
                            </th>
                            <th scope="col" className="w-[6.25rem] px-2 py-1.5 font-medium">
                              Статус
                            </th>
                            <th scope="col" className="w-[5.75rem] px-2 py-1.5 font-medium">
                              <span className="sr-only">Действия</span>
                            </th>
                          </tr>
                        </thead>
                        <tbody>
                          {items.map((booking, index) => {
                            const selected = booking.bookingId === trimmedTarget;
                            const duration = formatDurationMinutes(booking.durationMinutes);
                            return (
                              <tr
                                key={booking.bookingId}
                                onClick={() => openBooking(booking.bookingId)}
                                className={cx(
                                  'cursor-pointer border-b border-ink-100 align-top',
                                  selected ? 'bg-brand-50' : index % 2 === 1 ? 'bg-ink-50/70' : 'bg-white',
                                )}
                              >
                                <td className="px-2 py-1.5">
                                  <span
                                    className="block truncate font-mono font-medium text-ink-900"
                                    title={booking.code}
                                  >
                                    {booking.code}
                                  </span>
                                  <span
                                    className="block truncate font-mono text-xs text-ink-500"
                                    title={booking.bookingId}
                                  >
                                    {shortId(booking.bookingId)}
                                  </span>
                                </td>
                                <td className="px-2 py-1.5 text-ink-700">
                                  {booking.companyName ? (
                                    <span className="block truncate" title={booking.companyName}>
                                      {booking.companyName}
                                    </span>
                                  ) : (
                                    <span className="text-ink-400">не пришло</span>
                                  )}
                                </td>
                                <td className="px-2 py-1.5 text-ink-700">
                                  <span className="tnum block">{formatDateTime(booking.startsAt)}</span>
                                  <span className="block truncate text-xs text-ink-500">
                                    {duration ?? 'длительность не пришла'}
                                  </span>
                                </td>
                                <td className="tnum px-2 py-1.5 text-right text-ink-900">
                                  <span className="block truncate">
                                    {booking.priceMinor !== null
                                      ? formatMoney(booking.priceMinor, booking.currency)
                                      : '—'}
                                  </span>
                                </td>
                                <td className="px-2 py-1.5">
                                  <BookingStatusBadge status={booking.status} />
                                </td>
                                <td className="px-2 py-1.5">
                                  <Button
                                    variant={selected ? 'primary' : 'secondary'}
                                    size="sm"
                                    onClick={(event) => {
                                      event.stopPropagation();
                                      openBooking(booking.bookingId);
                                    }}
                                    aria-label={`Открыть запись ${booking.code}`}
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

                  {items.length > 0 ? (
                    <p className="text-xs leading-snug text-ink-500">
                      Колонки «клиент» в таблице нет намеренно:{' '}
                      <span className="font-mono">QtimeDtos.BookingResponse</span> не отдаёт ни
                      идентификатор, ни имя клиента, и подставлять сюда что-то похожее раздел не будет.
                      Комментарий клиента виден в детали записи. Время окна показано в часовом поясе браузера
                      (<span className="font-mono">formatDateTime</span>): зону компании ответ записи не
                      содержит — в клиентском приложении те же окна печатаются в зоне города (Asia/Almaty).
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

          {/* --------------------------------- правая колонка: деталь и отмена */}
          <aside className="min-w-0 space-y-4 xl:sticky xl:top-4 xl:max-h-[calc(100vh-2rem)] xl:self-start xl:overflow-y-auto xl:pr-1">
            <BookingDetailPanel
              bookingId={trimmedTarget}
              booking={detailBooking}
              isPending={detailQuery.isPending}
              isError={detailQuery.isError}
              error={detailQuery.error}
              onRetry={() => void detailQuery.refetch()}
              onClose={() => {
                setTargetBookingId('');
                setLookupDraft('');
              }}
              lookupDraft={lookupDraft}
              onLookupDraftChange={setLookupDraft}
              onOpen={openBooking}
            />

            {canWrite ? (
              <BookingActionsPanel
                bookingId={trimmedTarget}
                bookingCode={detailBooking?.code}
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
