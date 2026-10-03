/**
 * ORTA Services — перенос и отмена (отмена Ф2, перенос — предложение).
 *
 * Отмена работает: `POST /api/v1/qtime/bookings/{bookingId}/cancel`, причина
 * обязательна, окно освобождается сразу, статус меняется на `CANCELLED_BY_CLIENT`.
 * Отмена завершённой записи — `409 BOOKING_NOT_CANCELLABLE`.
 *
 * Перенос — предложение: эндпоинта переноса нет, и экран не делает вид, что есть.
 * Это последовательность «cancel → POST /bookings» с новым `Idempotency-Key`,
 * потому что изменилось окно. Побочный эффект настоящий: прежнее окно
 * освобождается до того, как занято новое, и если новое успеют занять, вторая
 * часть вернёт `409 SLOT_TAKEN`, а запись останется отменённой.
 */
import { Badge } from '../../components/ui/Badge';
import { Money, Notice, PhoneAppBar, PhoneBody, PhoneCard, Row } from '../kit';

export default function ServicesHealth08() {
  return (
    <>
      <PhoneAppBar title="Перенести запись" subtitle="Салон «Лотос» · Айгуль · 1 ч 30 мин" back />
      <PhoneBody>
        <PhoneCard title="Сейчас" right={<Badge tone="success">CONFIRMED</Badge>}>
          <Row label="пт, 3 октября, 15:30" value={<span className="font-mono">QT-4F8A2C31</span>} />
          <div className="my-1 text-center text-[14px] text-ink-300">↓</div>
          <div className="mb-1 flex items-center justify-between">
            <span className="text-[12px] font-semibold text-ink-700">Станет</span>
            <Badge tone="neutral">черновик переноса</Badge>
          </div>
          <Row label="сб, 4 октября, 11:30–13:00" value={<Money minor={450_000} />} strong />
        </PhoneCard>

        <PhoneCard title="Причина отмены прежней" right={<Badge tone="danger">обязательна</Badge>}>
          <div className="rounded-xl border border-ink-200 px-3 py-2">
            <div className="text-[11px] text-ink-500">Причина</div>
            <div className="text-[13px] text-ink-800">Не смогу прийти в это время</div>
          </div>
          <p className="mt-2 text-[11px] text-ink-500">
            Без причины запрос не уходит: поле обязательное, причина остаётся в истории записи.
          </p>
        </PhoneCard>

        <Notice tone="danger">
          <b>Прежнее окно освободится сразу.</b> Перенос — это отмена плюс новая запись: отдельного «переноса»
          в контракте нет. Окно 15:30 станет доступно другим до того, как занято новое.
        </Notice>

        <Notice tone="neutral">
          <b>Спорное место борда:</b> нужен ли <code>POST /bookings/{'{id}'}/reschedule</code> одной
          транзакцией, чтобы перенос не мог закончиться «отменил, но не записался».
        </Notice>

        <div className="mt-auto space-y-2">
          <div className="rounded-xl bg-brand-500 py-3 text-center text-[13px] font-semibold text-white">
            Перенести на сб, 11:30
          </div>
          <div className="rounded-xl bg-brand-50 py-2.5 text-center text-[13px] font-semibold text-brand-700 ring-1 ring-inset ring-brand-200">
            Только отменить запись
          </div>
          <div className="rounded-xl bg-white py-2.5 text-center text-[13px] font-medium text-ink-700 ring-1 ring-inset ring-ink-200">
            Оставить как было
          </div>
        </div>
      </PhoneBody>
    </>
  );
}
