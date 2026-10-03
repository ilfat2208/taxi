/**
 * ORTA Services — подтверждение записи (Ф2: раздел работает).
 *
 * Состав полей ровно такой, как в теле `POST /api/v1/qtime/bookings`:
 * `specialistId`, `serviceId`, `startsAt`, `comment`. Запрос уходит с
 * обязательным `Idempotency-Key`, который пересчитывается при смене мастера,
 * услуги, окна или комментария — повтор при обрыве связи не создаст вторую запись.
 *
 * Ошибки, которые уже приходят из кода и здесь не нарисованы кнопкой:
 * `409 SLOT_TAKEN`, `422 OUTSIDE_WORKING_HOURS`, `422 BOOKING_IN_PAST`,
 * `422 BOOKING_TOO_SOON`, `422 OUTSIDE_BOOKING_HORIZON`,
 * `400 SERVICE_NOT_OFFERED_BY_SPECIALIST`, `422 COMPANY_NOT_AVAILABLE`.
 *
 * Чего ещё нет: предоплаты и холда ORTA Pay — связи QTime с деньгами нет, поэтому
 * «Деньги пока не двигаются» это текст, а не кнопка. Сроки бесплатной отмены
 * задаёт компания, и в контракте они не приходят — приложение их не обещает.
 */
import { Badge } from '../../components/ui/Badge';
import { Money, Notice, PhoneAppBar, PhoneBody, PhoneCard, Row } from '../kit';

export default function ServicesHealth05() {
  return (
    <>
      <PhoneAppBar title="Подтверждение записи" subtitle="Проверьте перед отправкой" back />
      <PhoneBody>
        <PhoneCard>
          <Row label="Компания" value="Салон «Лотос»" />
          <Row label="Адрес" value="ул. Тауке хана, 83" />
          <Row label="Специалист" value="Айгуль Смагулова" />
          <Row label="Услуга" value="Маникюр с покрытием" />
          <Row label="Дата, время, длительность" value="пт 3 окт, 15:30 · 1 ч 30 мин" />
          <Row label="Стоимость" value={<Money minor={450_000} />} strong />
        </PhoneCard>

        <div className="rounded-xl border border-ink-200 bg-white px-3 py-2">
          <div className="text-[11px] text-ink-500">Комментарий · необязательно</div>
          <div className="text-[13px] text-ink-400">Например: нужно свободное окно у окна</div>
        </div>

        <Notice tone="info">
          <b>Деньги пока не двигаются.</b> Запись создаётся без предоплаты: цена сохраняется в записи, но
          связи QTime с ORTA Pay нет. Оплата — на месте, в компании.
        </Notice>

        <PhoneCard title="Запрос идемпотентен">
          <p className="text-[11.5px] text-ink-600">
            Ключ <code className="font-mono">Idempotency-Key</code> считается по паре «услуга + окно +
            комментарий»: повтор при обрыве связи вернёт ту же запись, а не вторую.
          </p>
        </PhoneCard>

        <Notice tone="neutral">
          Комментарий ограничен 500 символами. Роль — только <code>CUSTOMER</code>, иначе{' '}
          <code>403 CUSTOMER_ROLE_REQUIRED</code>.
        </Notice>

        <div className="mt-auto space-y-2">
          <div className="rounded-xl bg-brand-500 py-3 text-center text-[13px] font-semibold text-white">
            Записаться · 4 500 ₸
          </div>
          <div className="rounded-xl bg-white py-2.5 text-center text-[13px] font-medium text-ink-700 ring-1 ring-inset ring-ink-200">
            Изменить время
          </div>
          <p className="text-center text-[11px] text-ink-400">
            <Badge tone="neutral">бесплатная отмена</Badge> — сроки задаёт компания и в контракте их нет
          </p>
        </div>
      </PhoneBody>
    </>
  );
}
