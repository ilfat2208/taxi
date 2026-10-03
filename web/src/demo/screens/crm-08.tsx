/**
 * crm-08 · Карточка мастера.
 *
 * Специализация, стаж, рейтинг и деление услуг на личные и общие уже есть в модели:
 * личная услуга — это service_item.specialist_id, общая — тот же столбец со значением
 * null, и проверка «может ли мастер оказать услугу» работает.
 *
 * Чего нет: фотографий, сертификатов, отдельного GET /specialists/{id} и привязки мастера
 * к аккаунту. В таблице specialist нет user_id, поэтому мастер не может войти в консоль
 * и увидеть свой день — это незакрытый вопрос модели, а не забытая кнопка.
 */
import { Badge } from '../../components/ui/Badge';
import { cx } from '../../lib/cx';
import { ConsolePanel, Notice, Row } from '../kit';

const SERVICES = [
  { title: 'Маникюр с покрытием · 90 мин · 4 500 ₸', tag: 'общая услуга салона', personal: false },
  { title: 'Педикюр · 75 мин · 5 500 ₸', tag: 'общая услуга салона', personal: false },
  { title: 'Наращивание ресниц · 120 мин · 12 000 ₸', tag: 'личная услуга мастера', personal: true },
];

const LOAD = [
  { day: 'пн 5', percent: 0, note: 'отпуск' },
  { day: 'вт 6', percent: 62, note: '5 записей' },
  { day: 'ср 7', percent: 74, note: '6 записей' },
  { day: 'чт 8', percent: 48, note: '4 записи' },
  { day: 'пт 9', percent: 88, note: '7 записей' },
  { day: 'сб 10', percent: 66, note: '5 записей' },
];

const CAPABILITIES = [
  { text: 'Имя, специализация, стаж, рейтинг', tag: 'есть', tone: 'success' as const },
  { text: 'Личные и общие услуги', tag: 'в БД', tone: 'success' as const },
  { text: 'График работы', tag: 'нет API', tone: 'neutral' as const },
  { text: 'Фото и сертификаты', tag: 'нет модели', tone: 'neutral' as const },
  { text: 'Аккаунт мастера', tag: 'нет связи', tone: 'danger' as const },
];

export default function CrmMasterCard() {
  return (
    <>
      <div className="flex items-center gap-2">
        <div className="min-w-0">
          <div className="truncate text-[13px] font-semibold text-ink-900">Айгуль Смагулова</div>
          <div className="truncate text-[11.5px] text-ink-500">
            Мастер маникюра · салон красоты «Лотос» · 6 лет стажа · работает пн–сб 09:00–20:00
          </div>
        </div>
        <span className="ml-auto flex items-center gap-2">
          <Badge tone="success">работает</Badge>
          <Badge tone="warning">отпуск 5–7 октября (демо)</Badge>
          <span className="rounded-full bg-white px-3 py-1.5 text-[12px] text-ink-600 ring-1 ring-ink-200">График</span>
        </span>
      </div>

      <div className="grid grid-cols-[minmax(0,1fr)_296px] gap-3">
        <ConsolePanel
          title="Специализации, услуги и нагрузка"
          right={<span className="text-[11px] text-ink-500">личные услуги мастера и общие услуги салона</span>}
        >
          <div className="flex items-center gap-2.5">
            <span className="grid h-10 w-10 flex-none place-items-center rounded-full bg-brand-100 text-[14px] font-semibold text-brand-700">
              А
            </span>
            <div className="min-w-0 flex-1">
              <div className="truncate text-[12.5px] font-semibold text-ink-800">Айгуль Смагулова</div>
              <div className="truncate text-[11px] text-ink-500">мастер маникюра · специализация из QTime</div>
            </div>
            <div className="flex-none text-right">
              <div className="text-[15px] font-bold tabular-nums text-warning-500">★★★★☆</div>
              <div className="text-[10.5px] text-ink-500">4,90 · 49 000 базисных пунктов</div>
            </div>
          </div>

          <div className="my-2 border-t border-ink-100" />
          {SERVICES.map((service) => (
            <div key={service.title} className="flex items-center justify-between gap-3 py-1">
              <span className="min-w-0 truncate text-[12.5px] text-ink-800">{service.title}</span>
              <span className={cx('flex-none text-[11.5px]', service.personal ? 'font-medium text-brand-700' : 'text-ink-500')}>
                {service.tag}
              </span>
            </div>
          ))}

          <div className="my-2 border-t border-ink-100" />
          <div className="text-[11px] text-ink-500">Загрузка по дням недели 5–11 октября</div>
          <div className="mt-1.5 space-y-1">
            {LOAD.map((day) => (
              <div key={day.day} className="flex items-center gap-2">
                <span className="w-9 flex-none text-[11px] text-ink-600">{day.day}</span>
                <div className="h-2 min-w-0 flex-1 rounded-full bg-ink-100">
                  <div
                    className={cx('h-full rounded-full', day.percent === 0 ? 'bg-warning-500' : 'bg-brand-500')}
                    style={{ width: `${day.percent}%` }}
                  />
                </div>
                <span className="w-16 flex-none text-right text-[10.5px] text-ink-500">{day.note}</span>
              </div>
            ))}
          </div>
        </ConsolePanel>

        <ConsolePanel title="Что в API есть и чего нет">
          <div className="space-y-1.5">
            {CAPABILITIES.map((item) => (
              <div key={item.text} className="flex items-center justify-between gap-2">
                <span className="min-w-0 truncate text-[12.5px] text-ink-800">{item.text}</span>
                <Badge tone={item.tone}>{item.tag}</Badge>
              </div>
            ))}
          </div>

          <div className="my-2 border-t border-ink-100" />
          <Row label="Рейтинг в базисных пунктах" value="49 000 = 4,90" />
          <Row label="Личная услуга" value="service_item.specialist_id" />
          <Row label="Общая услуга" value="тот же столбец = null" />
          <Row label="Проверка услуги" value="400 SERVICE_NOT_OFFERED…" />

          <div className="mt-2">
            <Notice tone="danger">
              <b>Мастер не может войти в консоль.</b> В таблице specialist нет ссылки на аккаунт пользователя, поэтому
              «мой день» и правку своего графика он сегодня не увидит. Это незакрытый вопрос модели, а не забытая кнопка.
            </Notice>
          </div>
        </ConsolePanel>
      </div>

      <Notice tone="neutral">
        Демо-рейтинги и стаж проставлены сидом, а не отзывами: отзывов как сущности в QTime нет. Отдельного{' '}
        <code className="rounded bg-black/5 px-1 font-mono text-[11px]">GET /specialists/&#123;id&#125;</code> тоже нет —
        карточка собирается из ответа компании.
      </Notice>
    </>
  );
}
