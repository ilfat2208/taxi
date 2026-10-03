/**
 * ORTA Beauty — напоминания (план).
 *
 * Экрана нет, и под ним нет контракта. Готовая часть — только факт записи: строка
 * `qtime.booking` и событие `booking.created` в `qtime.events` (outbox → Kafka).
 * Таймлайн отвечает на вопрос «что уже произошло и что должно произойти»: один
 * пункт зелёный (сделано кодом), два серые (не сделано ничем).
 *
 * Предлагаемые эндпоинты и события: `POST /api/v1/notifications/subscriptions`,
 * `GET /api/v1/notifications/settings`, `booking.reminder.due`, `booking.completed`,
 * `review.requested`.
 *
 * Что решить до кода: канал (push или SMS) и согласие на него — это отдельное
 * согласие пользователя, а не галочка «уведомления включены»; отмена записи
 * обязана снимать напоминание, иначе платформа шлёт людей в салон, куда они уже
 * не идут. SMS — это персональные данные и деньги компании.
 */
import { Badge } from '../../components/ui/Badge';
import { Chips, Notice, PhoneAppBar, PhoneBody, PhoneCard } from '../kit';

const TIMELINE: Array<{ title: string; note: string; done: boolean }> = [
  { title: 'Запись создана', note: 'код QT-4F8A2C31 · событие booking.created — уходит в qtime.events', done: true },
  { title: 'Напоминание за сутки', note: '2 октября — не отправлено: рассылки нет', done: false },
  { title: 'За 2 часа и просьба об отзыве', note: '3 октября — не отправлено: шаблонов и центра нет', done: false },
];

export default function ServicesHealth11() {
  return (
    <>
      <PhoneAppBar title="Напоминания о визите" subtitle="Салон «Лотос» · пт, 3 октября, 15:30" back />
      <PhoneBody>
        <Chips items={['В приложении', 'Push', 'SMS']} active="В приложении" />

        <PhoneCard title="Что уже произошло и что должно">
          <div className="space-y-2">
            {TIMELINE.map((step) => (
              <div key={step.title} className="flex gap-2">
                <span
                  className={
                    step.done
                      ? 'mt-1 h-2.5 w-2.5 flex-none rounded-full bg-success-500'
                      : 'mt-1 h-2.5 w-2.5 flex-none rounded-full bg-ink-300'
                  }
                />
                <div className="min-w-0">
                  <div className="text-[12.5px] text-ink-800">{step.title}</div>
                  <div className="text-[11px] text-ink-500">{step.note}</div>
                </div>
              </div>
            ))}
          </div>
        </PhoneCard>

        <PhoneCard title="Когда напоминать" right={<Badge tone="neutral">макет</Badge>}>
          <Chips items={['За 24 часа', 'За 2 часа', 'За 30 минут']} active="За 24 часа" />
          <p className="mt-2 text-[11px] text-ink-500">
            Согласие на канал спрашивается отдельно от настройки «напоминать»: SMS — это персональные данные
            и деньги компании.
          </p>
        </PhoneCard>

        <Notice tone="neutral">
          <b>Так выглядел бы push.</b> «Сегодня в 15:30 ждём вас в салоне „Лотос“: мастер Айгуль, код
          QT-4F8A2C31». Пушей, шаблонов и согласий на каналы в коде нет — пока напоминание это то, что видно
          внутри приложения.
        </Notice>

        <Notice>
          <b>Пушей и рассылок нет.</b> Есть только событие <code>booking.created</code> в{' '}
          <code>qtime.events</code> через outbox. Отмена записи обязана снимать напоминание — иначе платформа
          отправляет человека в салон, куда он уже не идёт.
        </Notice>

        <div className="mt-auto space-y-2">
          <div className="rounded-xl bg-brand-500 py-3 text-center text-[13px] font-semibold text-white">
            Сохранить напоминания
          </div>
          <div className="rounded-xl bg-white py-2.5 text-center text-[13px] font-medium text-ink-700 ring-1 ring-inset ring-ink-200">
            Добавить в календарь
          </div>
        </div>
      </PhoneBody>
    </>
  );
}
