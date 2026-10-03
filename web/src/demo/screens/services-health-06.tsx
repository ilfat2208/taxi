/**
 * ORTA Services — запись создана (Ф2: раздел работает).
 *
 * Блок `BookingSuccess` на `/services/:companyId` показывается по ответу
 * `POST /api/v1/qtime/bookings`: человекочитаемый код `QT-XXXXXXXX` рядом с
 * техническим ULID, время, статус, названия компании, мастера и услуги,
 * длительность, цена и адрес.
 *
 * Цена и длительность скопированы в запись (`qtime.booking`), поэтому переоценка
 * прайса не переписывает уже созданную запись. Прочитать её точечно можно
 * через `GET /api/v1/qtime/bookings/{bookingId}`.
 *
 * Чего ещё нет: QR визита и подтверждения на входе, напоминаний и пушей — центр
 * уведомлений это план. Единственное, что уже уходит, — событие
 * `booking.created` в `qtime.events` через outbox.
 */
import { Badge } from '../../components/ui/Badge';
import { Money, Notice, PhoneBody, PhoneCard, Row } from '../kit';

export default function ServicesHealth06() {
  return (
    <>
      <PhoneBody>
        <div className="flex flex-col items-center pt-3 text-center">
          <span className="grid h-13 w-13 place-items-center rounded-full bg-success-50 text-[22px] text-success-500 ring-1 ring-inset ring-emerald-200">
            ✓
          </span>
          <div className="mt-2 text-[17px] font-bold text-ink-900">Запись создана</div>
          <div className="text-[12px] text-ink-500">Салон «Лотос» · пт, 3 октября, 15:30 · Asia/Almaty</div>
        </div>

        <PhoneCard title="Что записано">
          <Row label="Код записи" value={<span className="font-mono">QT-4F8A2C31</span>} />
          <Row label="Специалист и услуга" value="Айгуль · маникюр с покрытием" />
          <Row label="Длительность" value="1 ч 30 мин" />
          <Row label="Стоимость" value={<Money minor={450_000} />} strong />
          <Row label="Адрес" value="ул. Тауке хана, 83" />
        </PhoneCard>

        <Notice tone="info">
          <b>Окно 15:30 больше никому не достанется.</b> Это держит не проверка в коде, а частичный
          уникальный индекс в базе: вторая запись на то же окно не вставится и получит{' '}
          <code>409 SLOT_TAKEN</code>. Отменённая запись остаётся в истории, но окно освобождает.
        </Notice>

        <Notice tone="neutral">
          <b>Напоминаний и QR пока нет.</b> Пушей, шаблонов и центра уведомлений в коде нет — надёжный способ
          не забыть сейчас один: код записи и раздел «Мои записи». Напоминание появится поверх готовой шины{' '}
          <code>qtime.events</code>, а не вместо неё.
        </Notice>

        <div className="mt-auto space-y-2">
          <div className="rounded-xl bg-brand-500 py-3 text-center text-[13px] font-semibold text-white">
            Мои записи
          </div>
          <div className="rounded-xl bg-white py-2.5 text-center text-[13px] font-medium text-ink-700 ring-1 ring-inset ring-ink-200">
            К списку компаний
          </div>
          <p className="text-center text-[11px] text-ink-400">
            Запись в статусе <Badge tone="success">CONFIRMED</Badge>
          </p>
        </div>
      </PhoneBody>
    </>
  );
}
