/**
 * Раздел админки «Записи QTime».
 *
 * Работает на ответах qtime-service: заголовок, описание, список эндпоинтов и пометку
 * «только чтение» рисует оболочка (`src/admin/AdminPage.tsx` / `AdminLayout.tsx`), поэтому
 * раздел начинается с KPI, фильтра и таблицы.
 *
 * Что здесь честно названо узким местом контракта:
 *
 *  1. <b>Клиента в ответе нет.</b> `QtimeDtos.BookingResponse` не содержит ни id, ни имени
 *     клиента (в сущности `ClientUserId` есть, в DTO он не выведен), поэтому колонки
 *     «клиент» в таблице нет — вместо неё в детали виден комментарий клиента, единственный
 *     его след в контракте.
 *  2. <b>Истории переходов тоже нет.</b> QTime отдаёт только текущий статус: ни
 *     `cancelledAt`, ни `completedAt` в ответ приходят, поэтому в хронологии есть время
 *     создания (оно есть) и текущее состояние — без выдуманных отметок времени.
 *  3. <b>Агрегатов у сервиса нет.</b> «Всего» — счёт сервера (`Page.totalElements`),
 *     остальные числа — по выборке из последних 100 записей с тем же фильтром, и подписи
 *     говорят это прямо.
 *  4. <b>Отмена помечена `data-admin-write`</b> и отсутствует при `canWrite === false`:
 *     браузерная проверка `web/e2e/check-admin.mjs` требует, чтобы роль SUPPORT не видела
 *     ни одного элемента, способного изменить данные на сервере.
 *  5. <b>Деньги в QTime не двигаются</b> — «a booking is a claim on a window», предоплата
 *     через ORTA Pay только объявлена событием (`QtimeServiceApplication`), поэтому раздел
 *     показывает цену-снимок и не обещает ни оплаты, ни возврата.
 */
import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { fieldErrorOf, isApiError } from '../../api/errors';
import { fetchBookings } from '../../api/endpoints';
import { formatMoney } from '../../api/money';
import type { BookingQuery, QtimeBooking } from '../../api/types';
import { Alert, ErrorAlert } from '../../components/ui/Alerts';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { Card, CardBody, CardHeader, DetailRow } from '../../components/ui/Card';
import { CopyButton } from '../../components/ui/CopyButton';
import { EmptyState } from '../../components/ui/EmptyState';
import { SelectField, TextAreaField, TextField } from '../../components/ui/Field';
import { Pagination } from '../../components/ui/Pagination';
import { SkeletonRows, SkeletonText } from '../../components/ui/Skeleton';
import { Timeline, type TimelineEntry } from '../../components/ui/Timeline';
import { formatDurationMinutes } from '../../lib/cityTime';
import { formatDateTime, formatRelative, shortId, type Tone } from '../../lib/format';
import { useIdempotencyKey } from '../../lib/idempotency';
import { cancelAdminBooking, fetchAdminBooking } from '../api/tripAdmin';
import type { AdminBooking } from '../api/tripAdmin';
import type { AdminSectionProps } from '../sections';

/* ------------------------------------------------------------------ константы */

const PAGE_SIZE = 20;

/**
 * Размер выборки для KPI. `BookingController` зажимает `size` в 1..100 (`clamp(size)`),
 * поэтому 100 — максимум за один запрос.
 */
const KPI_SAMPLE_SIZE = 100;

/**
 * Статусы записи — enum `BookingStatus` из qtime-service (`domain/BookingStatus.java`:
 * CONFIRMED, COMPLETED, CANCELLED_BY_CLIENT, CANCELLED_BY_COMPANY, NO_SHOW). Справочника в
 * API нет, а `GET /qtime/bookings?status=` принимает ровно эти значения.
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

/** Ключи запросов раздела. Локальные: `src/lib/queryKeys.ts` — общий файл, его не трогаем. */
function bookingListKey(filters: { status: string; page: number; size: number }) {
  return ['admin', 'bookings', 'list', filters] as const;
}

function bookingKpiKey(status: string) {
  return ['admin', 'bookings', 'kpi', { status }] as const;
}

function bookingDetailKey(bookingId: string) {
  return ['admin', 'bookings', 'detail', bookingId] as const;
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
 * Бейдж статуса записи.
 *
 * Китовый `StatusBadge` берёт подпись из общей карты `lib/format.ts`, где QTime-статусы
 * отсутствуют: `CANCELLED_BY_COMPANY` показался бы кодом. Подписи и тона статусов записи
 * живут рядом с разделом, сам бейдж — китовый.
 */
function BookingStatusBadge({ status }: { status: string | null | undefined }) {
  return <Badge tone={bookingStatusTone(status)}>{bookingStatusLabel(status)}</Badge>;
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

/* ----------------------------------------------------------------------- KPI */

interface BookingKpis {
  total: number;
  confirmed: number;
  completed: number;
  cancelled: number;
  noShow: number;
  sampleSize: number;
}

function bookingKpis(sample: QtimeBooking[], serverTotal: number): BookingKpis {
  return {
    total: serverTotal,
    confirmed: sample.filter((booking) => booking.status === 'CONFIRMED').length,
    completed: sample.filter((booking) => booking.status === 'COMPLETED').length,
    cancelled: sample.filter(
      (booking) =>
        booking.status === 'CANCELLED_BY_CLIENT' || booking.status === 'CANCELLED_BY_COMPANY',
    ).length,
    noShow: sample.filter((booking) => booking.status === 'NO_SHOW').length,
    sampleSize: sample.length,
  };
}

/* --------------------------------------------------------- отмена записи */

function CancelBookingForm({ bookingId }: { bookingId: string }) {
  const queryClient = useQueryClient();
  const [reason, setReason] = useState('');
  const [localError, setLocalError] = useState<string | undefined>(undefined);

  // Ключ идемпотентности: повтор той же отмены с той же причиной уходит с тем же ключом и
  // не превращается в 409 BOOKING_NOT_CANCELLABLE (см. javadoc `BookingController.cancel`).
  // Смена цели или причины — новое намерение, а значит новый ключ.
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
      setLocalError('Сначала укажите ID записи — отменять нужно конкретную запись');
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
        <span className="font-mono text-xs">reason</span> до 255 символов. Отменяет компания, поэтому запись
        получает статус <span className="font-mono text-xs">CANCELLED_BY_COMPANY</span> (так сервис считает
        сторону компании для роли ADMIN — <span className="font-mono text-xs">QtimeAccess.isCompanySide</span>
        ), а окно освобождается сразу.
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
 * Блок изменяющего действия раздела: цель — ID записи.
 *
 * ID задаётся полем, а не только выбором строки: в поддержку он часто приходит из обращения,
 * и заставлять искать его в таблице было бы лишней работой. Кнопка «Открыть» в таблице просто
 * подставляет ID сюда.
 *
 * Если статус записи отмену не допускает, форма исчезает и вместо неё появляется объяснение:
 * окно занимает только CONFIRMED, остальные состояния терминальные.
 */
function BookingActionsCard({
  bookingId,
  status,
  isLoading,
  onTargetChange,
}: {
  bookingId: string;
  status: string | undefined;
  isLoading: boolean;
  onTargetChange: (value: string) => void;
}) {
  const cancellable = status === undefined || status === 'CONFIRMED';

  return (
    <Card>
      <CardHeader
        title="Отмена записи"
        subtitle="Отмена освобождает окно немедленно, причина сохраняется в записи. Панель отменяет записи только под ролью Администратор."
      />
      <CardBody className="space-y-4">
        <div className="max-w-xl">
          <TextField
            id="admin-bookings-target"
            label="ID записи"
            required
            value={bookingId}
            placeholder="01M3Y1AYYJGHVVY7NCZQ690MJF"
            hint="Выберите запись в таблице или вставьте ULID из обращения — форма работает по этому идентификатору"
            onChange={(event) => onTargetChange(event.target.value)}
          />
        </div>

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
      </CardBody>
    </Card>
  );
}

/* ------------------------------------------------------------------- деталь */

function BookingDetail({
  booking,
  isPending,
  isError,
  error,
  onRetry,
  onClose,
}: {
  booking: AdminBooking | undefined;
  isPending: boolean;
  isError: boolean;
  error: unknown;
  onRetry: () => void;
  onClose: () => void;
}) {
  const notFound = isApiError(error) && error.isNotFound;
  const duration = booking ? formatDurationMinutes(booking.durationMinutes) : null;

  /**
   * Хронология только из фактов ответа: время создания есть, отметки времени отмены и
   * завершения сервис не присылает — вместо них словами сказано, что их нет.
   */
  const timeline: TimelineEntry[] = [];
  if (booking) {
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
  }

  return (
    <Card>
      <CardHeader
        title={booking ? `Запись ${booking.code}` : 'Запись'}
        subtitle={
          booking
            ? `Окно: ${formatDateTime(booking.startsAt)}${duration ? ` · ${duration}` : ''}`
            : 'Деталь записи'
        }
        action={
          <div className="flex items-center gap-2">
            {booking ? <BookingStatusBadge status={booking.status} /> : null}
            <Button variant="secondary" size="sm" onClick={onClose}>
              Закрыть
            </Button>
          </div>
        }
      />

      <CardBody className="space-y-4">
        {isPending ? <SkeletonText lines={7} /> : null}

        {isError && !notFound ? (
          <ErrorAlert error={error} title="Не удалось загрузить запись" onRetry={onRetry} />
        ) : null}

        {isError && notFound ? (
          <EmptyState
            title="Запись не найдена"
            description="Сервис ответил 404: записи с таким идентификатором нет. Проверьте ID — он приходит из таблицы или из обращения."
          />
        ) : null}

        {booking ? (
          <>
            <dl>
              <DetailRow label="Код записи">
                <span className="inline-flex items-center gap-1">
                  <span className="font-mono">{booking.code}</span>
                  <CopyButton value={booking.code} />
                </span>
              </DetailRow>
              <DetailRow label="Идентификатор">
                <span className="inline-flex items-center gap-1">
                  <span className="font-mono text-xs">{shortId(booking.bookingId)}</span>
                  <CopyButton value={booking.bookingId} />
                </span>
              </DetailRow>
              <DetailRow label="Статус">
                <BookingStatusBadge status={booking.status} />
              </DetailRow>
              <DetailRow label="Компания">
                {booking.companyName ?? 'название не пришло — возможно, компания удалена из каталога'}
              </DetailRow>
              {booking.companyId ? (
                <DetailRow label="companyId">
                  <span className="inline-flex items-center gap-1">
                    <span className="font-mono text-xs">{shortId(booking.companyId)}</span>
                    <CopyButton value={booking.companyId} />
                  </span>
                </DetailRow>
              ) : null}
              {booking.companyAddress ? <DetailRow label="Адрес">{booking.companyAddress}</DetailRow> : null}
              <DetailRow label="Мастер">
                {booking.specialistName ?? 'имя не пришло'}
                {booking.specialistId ? (
                  <span className="ml-2 font-mono text-xs text-ink-500">
                    {shortId(booking.specialistId)}
                  </span>
                ) : null}
              </DetailRow>
              <DetailRow label="Услуга">
                {booking.serviceName ?? 'название не пришло'}
                {booking.serviceId ? (
                  <span className="ml-2 font-mono text-xs text-ink-500">{shortId(booking.serviceId)}</span>
                ) : null}
              </DetailRow>
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
              <DetailRow label="Запись создана">
                <span className="tnum">{formatDateTime(booking.createdAt)}</span>
                {booking.createdAt ? (
                  <span className="ml-2 text-xs text-ink-500">{formatRelative(booking.createdAt)}</span>
                ) : null}
              </DetailRow>
            </dl>

            <Alert tone="info" title="Цена — снимок, а не ссылка на прайс">
              QTime хранит цену и длительность, скопированные у услуги в момент записи (
              <span className="font-mono text-xs">Booking.confirm</span>): переоценка услуги задним числом
              эту запись не переписывает. Деньги в QTime не двигаются — раздел показывает только сумму
              записи.
            </Alert>

            {booking.clientComment ? (
              <Alert tone="info" title="Комментарий клиента">
                {booking.clientComment}
              </Alert>
            ) : (
              <p className="text-sm text-ink-500">
                Комментарий клиента при записи не оставлен. Больше о клиенте в ответе нет ничего: ни id, ни
                имени — <span className="font-mono text-xs">QtimeDtos.BookingResponse</span> их не содержит,
                а запись знает клиента только по внутреннему{' '}
                <span className="font-mono text-xs">ClientUserId</span>.
              </p>
            )}

            {booking.cancelReason ? (
              <Alert tone="warning" title="Причина отмены">
                {booking.cancelReason}
              </Alert>
            ) : null}

            <div className="border-t border-ink-100 pt-4">
              <p className="text-sm font-medium text-ink-800">Хронология записи</p>
              <p className="mt-1 text-xs text-ink-500">
                Отдельной истории переходов у QTime нет: сервис отдаёт текущий статус и время создания.
                Поэтому в хронологии нет отметок времени отмены и завершения — их в контракте не существует.
              </p>
              <Timeline className="mt-3" entries={timeline} />
            </div>
          </>
        ) : null}
      </CardBody>
    </Card>
  );
}

/* ------------------------------------------------------------------- раздел */

export default function BookingsSection({ canWrite }: AdminSectionProps) {
  const [status, setStatus] = useState('');
  const [size, setSize] = useState(PAGE_SIZE);
  const [page, setPage] = useState(0);
  const [targetBookingId, setTargetBookingId] = useState('');

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

  const detailQuery = useQuery({
    queryKey: bookingDetailKey(trimmedTarget),
    queryFn: () => fetchAdminBooking(trimmedTarget),
    enabled: trimmedTarget !== '',
    retry: 0,
    staleTime: 10_000,
  });

  const items = useMemo(() => listQuery.data?.items ?? [], [listQuery.data]);
  const kpis = useMemo(
    () => (kpiQuery.data ? bookingKpis(kpiQuery.data.items, kpiQuery.data.totalElements) : null),
    [kpiQuery.data],
  );

  return (
    <div className="space-y-4">
      {/* ------------------------------------------------------------ KPI */}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard
          label="Всего по фильтру"
          value={kpis ? String(kpis.total) : '—'}
          caption="счёт сервера: Page.totalElements для текущего filter"
        />
        <KpiCard
          label="Подтверждено"
          value={kpis ? String(kpis.confirmed) : '—'}
          caption="CONFIRMED — окно занято, по выборке"
        />
        <KpiCard
          label="Завершено"
          value={kpis ? String(kpis.completed) : '—'}
          caption="COMPLETED — визит состоялся, по выборке"
        />
        <KpiCard
          label="Отменено"
          value={kpis ? String(kpis.cancelled) : '—'}
          caption="CANCELLED_BY_CLIENT + CANCELLED_BY_COMPANY, по выборке"
        />
        <KpiCard
          label="Неявки"
          value={kpis ? String(kpis.noShow) : '—'}
          caption="NO_SHOW — по выборке; публичного эндпоинта для отметки нет"
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
        Агрегатов у qtime-service нет: «Всего по фильтру» — счёт сервера, остальные числа считаются клиентом
        по выборке из последних {KPI_SAMPLE_SIZE} записей с тем же фильтром (
        <span className="font-mono text-xs">GET /api/v1/qtime/bookings?size={KPI_SAMPLE_SIZE}</span>). Сейчас
        в выборке {kpis ? `${kpis.sampleSize} записей` : '—'}. Это не «статистика по всей базе», и подписи
        говорят именно это.
      </Alert>

      {/* -------------------------------------------------------- фильтр */}
      <Card>
        <CardHeader
          title="Фильтр"
          subtitle="Сервис принимает один статус за раз и зажимает размер страницы в 1..100 (BookingController.clamp)"
        />
        <CardBody className="flex flex-wrap items-start gap-4">
          <div className="w-64">
            <SelectField
              id="admin-bookings-status"
              label="Статус"
              value={status}
              placeholder="Все статусы"
              options={BOOKING_STATUS_FILTER_OPTIONS}
              hint="Значения enum BookingStatus"
              onChange={(event) => {
                setStatus(event.target.value);
                setPage(0);
              }}
            />
          </div>

          <div className="w-40">
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
        </CardBody>
      </Card>

      {/* -------------------------------------------------------- таблица */}
      <Card>
        <CardHeader
          title="Записи"
          subtitle={
            listQuery.data
              ? `Найдено по фильтру: ${listQuery.data.totalElements} · на этой странице: ${items.length}`
              : 'Список записей'
          }
          action={listQuery.isFetching ? <span className="text-xs text-ink-500">Обновляем…</span> : null}
        />
        <CardBody className="space-y-3">
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
              title={status === '' ? 'Записей нет' : `Записей со статусом «${bookingStatusLabel(status)}» нет`}
              description={
                status === ''
                  ? 'Сервис вернул пустую страницу: записи появятся здесь, как только клиенты начнут занимать окна в QTime.'
                  : 'Снимите фильтр статуса или выберите другой — сервис вернул пустую страницу именно по этому статусу.'
              }
            />
          ) : null}

          {items.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[1000px] text-sm">
                <caption className="sr-only">Записи QTime по текущему фильтру</caption>
                <thead>
                  <tr className="border-b border-ink-200 text-left text-xs tracking-wide text-ink-500 uppercase">
                    <th scope="col" className="px-3 py-2 font-medium">
                      Запись
                    </th>
                    <th scope="col" className="px-3 py-2 font-medium">
                      Компания
                    </th>
                    <th scope="col" className="px-3 py-2 font-medium">
                      Мастер
                    </th>
                    <th scope="col" className="px-3 py-2 font-medium">
                      Услуга
                    </th>
                    <th scope="col" className="px-3 py-2 font-medium">
                      Окно
                    </th>
                    <th scope="col" className="px-3 py-2 text-right font-medium">
                      Цена
                    </th>
                    <th scope="col" className="px-3 py-2 font-medium">
                      Статус
                    </th>
                    <th scope="col" className="px-3 py-2 font-medium">
                      <span className="sr-only">Действия</span>
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-ink-100">
                  {items.map((booking) => {
                    const selected = booking.bookingId === trimmedTarget;
                    const duration = formatDurationMinutes(booking.durationMinutes);
                    return (
                      <tr key={booking.bookingId} className={selected ? 'bg-brand-50' : undefined}>
                        <td className="px-3 py-2">
                          <span className="block font-mono font-medium text-ink-900">{booking.code}</span>
                          <span className="font-mono text-xs text-ink-500">
                            {shortId(booking.bookingId)}
                          </span>
                        </td>
                        <td className="px-3 py-2 text-ink-700">
                          {booking.companyName ?? <span className="text-ink-400">не пришло</span>}
                        </td>
                        <td className="px-3 py-2 text-ink-700">
                          {booking.specialistName ?? <span className="text-ink-400">не пришло</span>}
                        </td>
                        <td className="px-3 py-2 text-ink-700">
                          {booking.serviceName ?? <span className="text-ink-400">не пришло</span>}
                        </td>
                        <td className="px-3 py-2 whitespace-nowrap text-ink-700">
                          <span className="tnum block">{formatDateTime(booking.startsAt)}</span>
                          <span className="block text-xs text-ink-500">
                            {duration ?? 'длительность не пришла'}
                          </span>
                        </td>
                        <td className="tnum px-3 py-2 text-right whitespace-nowrap text-ink-900">
                          {booking.priceMinor !== null
                            ? formatMoney(booking.priceMinor, booking.currency)
                            : '—'}
                        </td>
                        <td className="px-3 py-2">
                          <BookingStatusBadge status={booking.status} />
                        </td>
                        <td className="px-3 py-2">
                          <Button
                            variant={selected ? 'primary' : 'secondary'}
                            size="sm"
                            onClick={() => setTargetBookingId(booking.bookingId)}
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
            <p className="text-xs text-ink-500">
              Колонки «клиент» в таблице нет намеренно:{' '}
              <span className="font-mono">QtimeDtos.BookingResponse</span> не отдаёт ни идентификатор, ни имя
              клиента, и подставлять сюда что-то похожее раздел не будет. Комментарий клиента виден в детали
              записи. Время окна показано в часовом поясе браузера (
              <span className="font-mono">formatDateTime</span>): зону компании ответ записи не содержит — в
              клиентском приложении те же окна печатаются в зоне города (Asia/Almaty).
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

      {/* ------------------------------------------------------- действие */}
      {canWrite ? (
        <BookingActionsCard
          bookingId={targetBookingId}
          status={detailQuery.data?.status}
          isLoading={detailQuery.isLoading}
          onTargetChange={setTargetBookingId}
        />
      ) : null}

      {/* --------------------------------------------------------- деталь */}
      {trimmedTarget !== '' ? (
        <BookingDetail
          booking={detailQuery.data}
          isPending={detailQuery.isPending}
          isError={detailQuery.isError}
          error={detailQuery.error}
          onRetry={() => void detailQuery.refetch()}
          onClose={() => setTargetBookingId('')}
        />
      ) : (
        <p className="text-sm text-ink-500">
          Выберите запись в таблице: в детали будет компания, мастер, услуга, окно, цена-снимок, комментарий
          клиента
          {canWrite ? ', а форма отмены — в блоке выше' : ''}.
        </p>
      )}
    </div>
  );
}
