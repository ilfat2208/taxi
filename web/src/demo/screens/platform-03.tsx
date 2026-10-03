/**
 * platform-03 · ORTA ID — согласия и персональные данные (телефон, план).
 *
 * Согласий и их журнала в коде нет — это макет. Согласие здесь не галочка, а запись с версией
 * редакции, временем, `userId` и устройством: предлагаемые ручки — `GET /api/v1/consents`,
 * `POST /api/v1/consents/{code}/grant` и `…/revoke`. Три правила экрана: геолокацию можно отозвать
 * без потери приложения; публичность профиля выключена по умолчанию; удаление аккаунта не стирает
 * денежную историю — об этом сказано до нажатия.
 */
import { Badge } from '../../components/ui/Badge';
import { Notice, PhoneAppBar, PhoneBody, PhoneCard, PhoneTabBar, Row } from '../kit';

const TABS = ['Главная', 'История', 'Переводы', 'Профиль'];

const CONSENTS: Array<{ title: string; hint: string; state: 'дано' | 'не дано' | 'нет'; note: string }> = [
  {
    title: 'Обработка персональных данных',
    hint: 'Имя, телефон, история заказов · редакция 1.0',
    state: 'дано',
    note: 'запись с версией редакции',
  },
  {
    title: 'Геолокация',
    hint: '«Рядом со мной», подача машины, зоны',
    state: 'дано',
    note: 'отзывается без потери приложения',
  },
  {
    title: 'Публичность профиля и рейтинга',
    hint: 'Имя, фото, оценки и отзывы — для других',
    state: 'не дано',
    note: 'выключена по умолчанию',
  },
  {
    title: 'Рекламные сообщения',
    hint: 'Push, SMS, e-mail об акциях и скидках',
    state: 'нет',
    note: 'сервисные отключаются отдельно',
  },
];

const DATA_ROWS: Array<{ title: string; hint: string }> = [
  { title: 'Скачать копию данных', hint: 'POST /api/v1/me/data-export' },
  { title: 'Журнал доступа к данным', hint: 'кто и когда читал профиль' },
  { title: 'Удалить аккаунт', hint: 'денежная история сохраняется' },
];

export default function Platform03Screen() {
  return (
    <>
      <PhoneAppBar
        back
        title="Согласия и данные"
        subtitle="Что ORTA может делать с вашими данными"
        right={<Badge tone="neutral">план</Badge>}
      />
      <PhoneBody>
        <PhoneCard title="Согласия" right={<Badge tone="neutral">редакция 1.0</Badge>}>
          <div className="divide-y divide-ink-50">
            {CONSENTS.map((item) => (
              <div key={item.title} className="flex items-center justify-between gap-2 py-2">
                <span className="min-w-0">
                  <span className="block truncate text-[12.5px] font-medium text-ink-800">{item.title}</span>
                  <span className="block truncate text-[11px] text-ink-500">{item.hint}</span>
                  <span className="block truncate text-[11px] text-ink-400">{item.note}</span>
                </span>
                <Badge tone={item.state === 'дано' ? 'success' : item.state === 'не дано' ? 'warning' : 'neutral'}>
                  {item.state}
                </Badge>
              </div>
            ))}
          </div>
        </PhoneCard>

        <PhoneCard title="Мои данные">
          <div className="divide-y divide-ink-50">
            {DATA_ROWS.map((item) => (
              <div key={item.title} className="flex items-center justify-between gap-2 py-2">
                <span className="min-w-0">
                  <span className="block truncate text-[12.5px] font-medium text-ink-800">{item.title}</span>
                  <span className="block truncate text-[11px] text-ink-500">{item.hint}</span>
                </span>
                <span className="text-ink-400">→</span>
              </div>
            ))}
          </div>
        </PhoneCard>

        <Notice tone="neutral">
          <b>Удаление аккаунта не стирает деньги.</b> Выписка, чеки и возвраты остаются: их требует
          не приложение, а отчётность.
        </Notice>
        <Row label="Сервисные и рекламные" value="отключаются раздельно" />
      </PhoneBody>
      <PhoneTabBar items={TABS} active="Профиль" />
    </>
  );
}
