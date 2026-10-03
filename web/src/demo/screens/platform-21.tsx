/**
 * platform-21 · Настройки уведомлений: каналы, темы, тишина (телефон, план).
 *
 * Макет целиком: ни настроек, ни каналов, ни хранения истории в коде нет. Три решения на экране
 * стоит зафиксировать до разработки: SMS остаётся включённым для денег и безопасности, потому что
 * push доходит не всегда; ночная тишина не распространяется на списания и входы с новых устройств,
 * иначе она становится окном для мошенника; отписка от акций одна на всю экосистему, а не по направлению.
 */
import { Badge } from '../../components/ui/Badge';
import { Notice, PhoneAppBar, PhoneBody, PhoneCard, PhoneTabBar, Row } from '../kit';

const TABS = ['Главная', 'История', 'Переводы', 'Профиль'];

const CHANNELS: Array<{ title: string; hint: string; state: string; tone: 'success' | 'neutral' }> = [
  { title: 'Push в приложении', hint: 'основной канал, но доходит не всегда', state: 'включён', tone: 'success' },
  { title: 'SMS для денег и входов', hint: 'списания, переводы, новый вход', state: 'включён', tone: 'success' },
  { title: 'E-mail', hint: 'чеки и копии документов', state: 'выключен', tone: 'neutral' },
];

const TOPICS: Array<{ k: string; v: string }> = [
  { k: 'Заказы и доставка', v: 'push' },
  { k: 'Деньги и переводы', v: 'push + SMS' },
  { k: 'Записи и напоминания', v: 'push' },
  { k: 'Безопасность и входы', v: 'не отключается' },
];

export default function Platform21Screen() {
  return (
    <>
      <PhoneAppBar
        back
        title="Настройки уведомлений"
        subtitle="Каналы, темы, ночная тишина"
        right={<Badge tone="neutral">план</Badge>}
      />
      <PhoneBody>
        <PhoneCard title="Каналы">
          <div className="divide-y divide-ink-50">
            {CHANNELS.map((channel) => (
              <div key={channel.title} className="flex items-center justify-between gap-2 py-2">
                <span className="min-w-0">
                  <span className="block truncate text-[12.5px] font-medium text-ink-800">{channel.title}</span>
                  <span className="block truncate text-[11px] text-ink-500">{channel.hint}</span>
                </span>
                <Badge tone={channel.tone}>{channel.state}</Badge>
              </div>
            ))}
          </div>
          <p className="mt-1 text-[11px] text-ink-500">SMS включён для денег и входов: push доходит не всегда.</p>
        </PhoneCard>

        <PhoneCard title="Темы">
          {TOPICS.map((topic) => (
            <Row key={topic.k} label={topic.k} value={topic.v} />
          ))}
        </PhoneCard>

        <PhoneCard title="Тишина по ночам" right={<Badge tone="success">22:00 — 08:00</Badge>}>
          <Row label="Не беспокоить" value="акции, напоминания, статусы заказов" />
          <Row label="Деньги и безопасность" value="не молчат" strong />
          <div className="mt-1 flex items-center justify-between gap-2">
            <span className="min-w-0">
              <span className="block text-[12.5px] font-medium text-ink-800">Отписаться от акций</span>
              <span className="block text-[11px] text-ink-500">Одно нажатие — во всех сервисах</span>
            </span>
            <Badge tone="danger">отписаться</Badge>
          </div>
        </PhoneCard>

        <Notice tone="neutral">
          <b>Этого раздела в коде нет.</b> Ни шаблонов, ни очереди отправки, ни истории, ни настроек — всё это макет;
          уведомление будет собираться из событий Kafka.
        </Notice>
      </PhoneBody>
      <PhoneTabBar items={TABS} active="Профиль" />
    </>
  );
}
