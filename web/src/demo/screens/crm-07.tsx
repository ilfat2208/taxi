/**
 * crm-07 · Мастера — список.
 *
 * Список приходит только внутри компании: имя, специализация, рейтинг в базисных пунктах
 * и стаж. Отдельного GET /specialists/{id} нет, создания и правки мастера тоже нет —
 * консоль показывает справочник, но не даёт его менять. Нагрузка за неделю считается на
 * клиенте по сеткам окон, потому что агрегата в сервисе нет.
 */
import { Badge } from '../../components/ui/Badge';
import { ConsolePanel, Notice, Row } from '../kit';

interface Master {
  initials: string;
  name: string;
  meta: string;
  rating: string;
  load: number;
  bookings: number;
  status: { label: string; tone: 'success' | 'warning' | 'neutral' };
  note: { label: string; tone: 'warning' | 'neutral' | 'info' };
}

const MASTERS: Master[] = [
  {
    initials: 'АС',
    name: 'Айгуль Смагулова',
    meta: 'мастер маникюра · стаж 6 лет · 3 услуги, из них 1 личная (наращивание ресниц)',
    rating: '4,90',
    load: 78,
    bookings: 27,
    status: { label: 'работает', tone: 'success' },
    note: { label: 'отпуск 5–7 октября', tone: 'warning' },
  },
  {
    initials: 'ДА',
    name: 'Динара Ахметова',
    meta: 'парикмахер-стилист · стаж 9 лет · 3 услуги, все общие для салона',
    rating: '4,82',
    load: 64,
    bookings: 22,
    status: { label: 'работает', tone: 'success' },
    note: { label: 'пн–сб 09:00–20:00', tone: 'neutral' },
  },
  {
    initials: 'ЖО',
    name: 'Жанар Оспанова',
    meta: 'косметолог · стаж 4 года · 2 услуги, доп. смена по субботам',
    rating: '4,75',
    load: 48,
    bookings: 13,
    status: { label: 'работает', tone: 'success' },
    note: { label: 'доп. смена 10 окт 12:00–16:00', tone: 'info' },
  },
];

export default function CrmMastersList() {
  return (
    <>
      <div className="flex items-center gap-2">
        <div className="min-w-0">
          <div className="truncate text-[13px] font-semibold text-ink-900">Мастера</div>
          <div className="truncate text-[11.5px] text-ink-500">
            Салон красоты «Лотос» · 3 мастера · 8 услуг · средний рейтинг 4,82
          </div>
        </div>
        <span className="ml-auto flex items-center gap-2">
          <Badge tone="neutral">Все</Badge>
          <Badge tone="brand">Работают</Badge>
          <Badge tone="neutral">В отпуске</Badge>
          <span className="rounded-full bg-white px-3 py-1.5 text-[12px] text-ink-600 ring-1 ring-ink-200">+ Мастер</span>
        </span>
      </div>

      <div className="grid grid-cols-[minmax(0,1fr)_286px] gap-3">
        <ConsolePanel title="Список мастеров" right={<span className="text-[11px] text-ink-500">нагрузка за неделю 5–11 октября</span>}>
          <div className="divide-y divide-ink-100">
            {MASTERS.map((master) => (
              <div key={master.name} className="flex items-center gap-3 py-2.5 first:pt-0 last:pb-0">
                <span className="grid h-9 w-9 flex-none place-items-center rounded-full bg-brand-100 text-[12px] font-semibold text-brand-700">
                  {master.initials}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[12.5px] font-semibold text-ink-800">{master.name}</div>
                  <div className="truncate text-[11px] text-ink-500">{master.meta}</div>
                  <div className="mt-1 flex flex-wrap items-center gap-1.5">
                    <Badge tone="warning">★ {master.rating}</Badge>
                    <Badge tone={master.status.tone}>{master.status.label}</Badge>
                    <Badge tone={master.note.tone}>{master.note.label}</Badge>
                  </div>
                </div>
                <div className="w-[92px] flex-none text-right">
                  <div className="text-[15px] font-bold tabular-nums text-ink-900">{master.load}%</div>
                  <div className="text-[10.5px] text-ink-500">{master.bookings} записей</div>
                  <div className="mt-1 h-1.5 rounded-full bg-ink-100">
                    <div className="h-full rounded-full bg-brand-500" style={{ width: `${master.load}%` }} />
                  </div>
                </div>
              </div>
            ))}
          </div>
        </ConsolePanel>

        <ConsolePanel title="Что API отдаёт уже сейчас">
          <Row label="Источник" value="GET /companies/{id}" />
          <Row label="Мастеров" value="3" />
          <Row label="Услуг" value="8" />
          <Row label="Рейтинг салона" value="4,80 · 312 отзывов" />
          <Row label="Адрес" value="ул. Тауке хана, 83" />
          <Row label="Часовой пояс" value="Asia/Almaty" strong />
          <div className="my-2 border-t border-ink-100" />
          <p className="text-[11.5px] leading-[16px] text-ink-600">
            Поля мастера в ответе: имя, специализация, рейтинг в базисных пунктах и стаж. Отдельного{' '}
            <code className="rounded bg-black/5 px-1 font-mono text-[11px]">GET /specialists/&#123;id&#125;</code> и операций
            правки нет — список показывается, но не редактируется.
          </p>
        </ConsolePanel>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <Notice tone="neutral">
          <b>Демо-данные, не реальные люди.</b> 12 мастеров в 4 компаниях Шымкента: салон «Лотос», барбершоп «Король
          Бороды», автосервис «Мотор-Сервис» и стоматология «Дентал Плюс». Имена, цены и рейтинги придуманы и лежат в
          сиде.
        </Notice>
        <Notice tone="warning">
          Процент загрузки и число записей консоль считает сама по сеткам окон: агрегата в сервисе нет, и{' '}
          <code className="rounded bg-black/5 px-1 font-mono text-[11px]">GET /companies/&#123;id&#125;/load</code> только
          предлагается.
        </Notice>
      </div>
    </>
  );
}
