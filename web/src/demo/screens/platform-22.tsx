/**
 * platform-22 · ORTA Search — один поиск по экосистеме (телефон, в работе).
 *
 * Работает поиск по каталогу: `GET /api/v1/catalog/products` с `sort=relevance` — полнотекстовый поиск
 * Postgres по `search_vector`. Услуги и окна приходят из QTime. Сквозной поиск по поездкам,
 * недвижимости и вакансиям — проект, и его качество зависит не от поисковика, а от того, насколько
 * единообразно направления описывают свои сущности: пока модели разные, «один поиск» собирается
 * из несопоставимых результатов — это и есть главный риск раздела.
 */
import { Badge } from '../../components/ui/Badge';
import { Chips, Notice, PhoneAppBar, PhoneBody, PhoneCard, PhoneTabBar } from '../kit';

const TABS = ['Главная', 'История', 'Переводы', 'Профиль'];
const TYPES = ['Всё', 'Услуги', 'Товары', 'Поездки', 'Недвижимость', 'Работа'];

const OTHER: Array<{ title: string; hint: string; badge: string; tone: 'warning' | 'neutral' }> = [
  { title: 'Поездки по адресу или месту', hint: 'ORTA Taxi · поиска по поездкам нет', badge: 'план', tone: 'warning' },
  { title: 'Помещение под студию', hint: 'ORTA Home · вертикали нет', badge: 'план', tone: 'neutral' },
];

export default function Platform22Screen() {
  return (
    <>
      <PhoneAppBar
        title="Поиск"
        subtitle="Один запрос — все направления"
        right={<Badge tone="warning">в работе</Badge>}
      />
      <PhoneBody>
        <div className="flex items-center gap-2 rounded-xl border border-ink-200 bg-white px-3 py-2">
          <span className="text-ink-400">🔍</span>
          <span className="min-w-0 flex-1 truncate text-[13px] text-ink-900">маникюр</span>
          <Badge tone="brand">Рядом</Badge>
        </div>

        <Chips items={TYPES} active="Всё" />

        <PhoneCard title="Услуги · рядом со мной" right={<Badge tone="success">QTime</Badge>}>
          <div className="flex items-center gap-3">
            <span className="grid h-9 w-9 flex-none place-items-center rounded-full bg-gradient-to-br from-info-500 to-brand-700 text-[13px] font-semibold text-white">
              А
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[12.5px] font-medium text-ink-800">Студия «Айгуль» · маникюр</span>
              <span className="block truncate text-[11px] text-ink-500">1,4 км · Айгуль, 4,9 ★ · свободно сб 12:30 · 8 000 ₸</span>
            </span>
          </div>
        </PhoneCard>

        <PhoneCard title="Товары" right={<Badge tone="success">каталог</Badge>}>
          <div className="flex items-center gap-3">
            <span className="grid h-9 w-9 flex-none place-items-center rounded-xl bg-gradient-to-br from-brand-100 to-ink-200 text-[11px] font-semibold text-ink-500">
              ₸
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[12.5px] font-medium text-ink-800">Набор для маникюра, 12 предметов</span>
              <span className="block truncate text-[11px] text-ink-500">ИП «Сейтказы» · 4,6 ★ · остаток 8</span>
            </span>
            <span className="flex-none text-[12.5px] font-semibold tabular-nums text-ink-900">9 900 ₸</span>
          </div>
        </PhoneCard>

        <PhoneCard title="Другие направления">
          <div className="divide-y divide-ink-50">
            {OTHER.map((item) => (
              <div key={item.title} className="flex items-center justify-between gap-2 py-2">
                <span className="min-w-0">
                  <span className="block truncate text-[12.5px] font-medium text-ink-800">{item.title}</span>
                  <span className="block truncate text-[11px] text-ink-500">{item.hint}</span>
                </span>
                <Badge tone={item.tone}>{item.badge}</Badge>
              </div>
            ))}
          </div>
        </PhoneCard>

        <Notice tone="info">
          <b>Сегодня поиск сквозной только по каталогу.</b> Работает{' '}
          <code className="rounded bg-white/60 px-1">GET /api/v1/catalog/products?query=…&amp;sort=relevance</code> —
          полнотекстовый поиск Postgres по <code className="rounded bg-white/60 px-1">search_vector</code>. Сквозной поиск
          по поездкам, недвижимости и вакансиям — проект.
        </Notice>
      </PhoneBody>
      <PhoneTabBar items={TABS} active="Главная" />
    </>
  );
}
