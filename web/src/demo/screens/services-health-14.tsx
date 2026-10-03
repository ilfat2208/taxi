/**
 * ORTA Health — запись на приём и подготовка (план).
 *
 * Экрана нет, но механика записи у QTime уже есть и вертикально-нейтральна: сетка
 * окон, «одно окно — одна запись», отмена. Приём врача пошёл бы через те же
 * `GET /api/v1/qtime/specialists/{id}/slots` и `POST /api/v1/qtime/bookings` с
 * `Idempotency-Key`; цена консультации 3 000 ₸ и 30 минут — из сида QTime,
 * инструкции по подготовке — поле карточки клиники, а не общий совет приложения.
 *
 * Чего в коде нет и что является требованием:
 *   · согласия — отдельное согласие на обработку медицинских данных и на передачу
 *     их клинике; отзыв согласия — такая же операция, как выдача;
 *   · разделение доступа — врачу только приём и его записи, администратору
 *     расписание без диагнозов; роль `MERCHANT`, которая сейчас по `QtimeAccess`
 *     может отменить любую запись, для медицины недопустима;
 *   · срок хранения — у анализов, заключений и переписки он разный, плюс удаление
 *     по требованию и журнал доступа к каждой записи;
 *   · где хранится — медицинские данные нельзя складывать в тот же контур, что
 *     заказы маркета, без отдельного решения по шифрованию и аудиту.
 *
 * Поэтому кнопка записи отключена намеренно, и это подписано на экране.
 */
import { Badge } from '../../components/ui/Badge';
import { cx } from '../../lib/cx';
import { Money, Notice, PhoneAppBar, PhoneBody, PhoneCard, Row } from '../kit';

/** Сетка приёма: свободно, выбрано, занято — занятые окна тоже приходят в ответе. */
const SLOTS: Array<{ time: string; state: 'free' | 'on' | 'busy' }> = [
  { time: '14:00', state: 'free' },
  { time: '14:30', state: 'on' },
  { time: '15:00', state: 'busy' },
  { time: '16:30', state: 'free' },
  { time: '17:00', state: 'free' },
  { time: '18:00', state: 'busy' },
];

export default function ServicesHealth14() {
  return (
    <>
      <PhoneAppBar
        title="Запись на приём"
        subtitle="«Дентал Плюс» · Айнур Бекова · врач-стоматолог"
        back
        right={<Badge tone="neutral">План</Badge>}
      />
      <PhoneBody>
        <div className="flex items-center gap-3">
          <span className="grid h-11 w-11 flex-none place-items-center rounded-full bg-success-50 text-[15px] font-semibold text-success-700 ring-1 ring-inset ring-emerald-200">
            А
          </span>
          <div className="min-w-0 flex-1">
            <div className="text-[13px] font-semibold text-ink-900">Айнур Бекова · ★ 4,9</div>
            <div className="text-[11.5px] text-ink-500">
              стаж 12 лет · приём 30 мин · <Money minor={300_000} />
            </div>
          </div>
        </div>

        <PhoneCard title="Окна на приём" right={<Badge tone="brand">QTime</Badge>}>
          <div className="grid grid-cols-3 gap-2">
            {SLOTS.map((slot) => (
              <span
                key={slot.time}
                className={cx(
                  'rounded-lg py-1.5 text-center text-[12px] ring-1 ring-inset',
                  slot.state === 'on' && 'bg-brand-500 font-semibold text-white ring-brand-500',
                  slot.state === 'busy' && 'bg-ink-100 text-ink-400 line-through ring-ink-200',
                  slot.state === 'free' && 'bg-white text-ink-800 ring-ink-200',
                )}
              >
                {slot.time}
              </span>
            ))}
          </div>
        </PhoneCard>

        <PhoneCard title="Подготовка к приёму" right={<Badge tone="neutral">от клиники</Badge>}>
          <Row label="За 2 часа" value="не есть плотно" />
          <Row label="С собой" value="удостоверение, снимки" />
          <Row label="Опоздание больше 10 минут" value="клиника переносит" />
        </PhoneCard>

        <Notice tone="warning">
          <b>Медицинские данные — особая категория. Это требование, а не сделанное.</b> Нужны отдельное
          согласие с возможностью отзыва, разделение доступа (врачу — приём, администратору — расписание без
          диагнозов), заданный срок хранения и журнал доступа. Роль <code>MERCHANT</code>, которая сейчас
          может отменить любую запись, для медицины недопустима.
        </Notice>

        <div className="mt-auto space-y-2">
          <div
            aria-disabled="true"
            className="rounded-xl bg-ink-200 py-3 text-center text-[13px] font-semibold text-ink-500"
          >
            Записаться на 14:30
          </div>
          <p className="text-center text-[11px] text-ink-400">
            Кнопка неактивна намеренно: без согласий и разделения доступа медицинская запись не запускается.
            Предлагаемые эндпоинты: <code>POST /health/consents</code>,{' '}
            <code>DELETE /health/consents/{'{id}'}</code>, <code>GET /health/access-log</code>
          </p>
        </div>
      </PhoneBody>
    </>
  );
}
