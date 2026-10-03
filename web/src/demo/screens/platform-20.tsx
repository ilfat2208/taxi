/**
 * platform-20 · Центр уведомлений (телефон, в работе).
 *
 * Из работающего здесь только источник событий: транзакционный outbox и Kafka
 * (`platform/common-kafka/.../KafkaTopics.java` — `payment.events`, `trip.events`, `driver.events` и DLT).
 * Сам центр, шаблоны, каналы и история — макет: превращать событие в пущ, SMS или письмо пока нечему.
 * Правило экрана: одно событие — одно сообщение, даже если в нём участвуют несколько сервисов.
 */
import { Badge } from '../../components/ui/Badge';
import { Chips, Notice, PhoneAppBar, PhoneBody, PhoneCard, PhoneTabBar } from '../kit';

const TABS = ['Главная', 'История', 'Переводы', 'Профиль'];
const TOPICS = ['Все', 'Заказы', 'Деньги', 'Записи', 'Безопасность'];

const TODAY: Array<{ title: string; hint: string; unread: boolean }> = [
  { title: 'Возврат 2 490,00 ₸ зачислен', hint: 'ORTA Pay · 14:02 · заказ 01J8ZP…2M', unread: true },
  { title: 'Заказ ждёт подтверждения продавца', hint: 'ORTA Market · 21:12 · резерв 1 200,00 ₸ до 22:30', unread: true },
  { title: 'Напоминание: маникюр завтра в 15:30', hint: 'QTime · 20:00 · мастер Айгуль, 1,4 км', unread: false },
  { title: 'Новый вход в аккаунт', hint: 'Chrome, Windows · Шымкент · 21:14', unread: false },
];

const YESTERDAY: Array<{ title: string; hint: string }> = [
  { title: 'Поездка завершена · чек готов', hint: 'ORTA Taxi · 18:42 · 905,72 ₸' },
];

export default function Platform20Screen() {
  return (
    <>
      <PhoneAppBar
        title="Уведомления"
        subtitle="Все сервисы в одном списке"
        right={<Badge tone="warning">в работе</Badge>}
      />
      <PhoneBody>
        <Chips items={TOPICS} active="Все" />

        <PhoneCard title="Сегодня" right={<Badge tone="info">2 новых</Badge>}>
          <div className="divide-y divide-ink-50">
            {TODAY.map((item) => (
              <div key={item.title} className="flex items-center justify-between gap-2 py-2">
                <span className="min-w-0">
                  <span className="block truncate text-[12.5px] font-medium text-ink-800">{item.title}</span>
                  <span className="block truncate text-[11px] text-ink-500">{item.hint}</span>
                </span>
                {item.unread ? <span className="h-2 w-2 flex-none rounded-full bg-info-500" /> : null}
              </div>
            ))}
          </div>
        </PhoneCard>

        <PhoneCard title="Вчера">
          <div className="divide-y divide-ink-50">
            {YESTERDAY.map((item) => (
              <div key={item.title} className="py-2">
                <span className="block truncate text-[12.5px] font-medium text-ink-800">{item.title}</span>
                <span className="block truncate text-[11px] text-ink-500">{item.hint}</span>
              </div>
            ))}
          </div>
        </PhoneCard>

        <Notice tone="info">
          <b>События уже ходят, пушей нет.</b> Outbox и Kafka работают: <span className="font-mono">payment.events</span>,{' '}
          <span className="font-mono">trip.events</span>, <span className="font-mono">driver.events</span> (+ DLT). Но превратить
          событие в пущ, SMS или письмо пока нечему. Правило списка: одно событие — одно сообщение, даже если в нём
          участвуют несколько сервисов.
        </Notice>
      </PhoneBody>
      <PhoneTabBar items={TABS} active="Главная" />
    </>
  );
}
