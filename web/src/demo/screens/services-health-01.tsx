/**
 * ORTA Services — поиск «рядом со мной» (Ф2: раздел работает).
 *
 * Экран про поиск, а не про весь список: три карточки из четырёх компаний сида,
 * строка «Компаний: 4» — это `totalElements` ответа QTime. Названия, адреса,
 * рейтинги, отзывы и цены «от» — из `DemoQtimeSeeder`, не выдуманы.
 *
 * Чего ещё нет и что нарисовано как предложение: сортировки по расстоянию
 * (`sort=distance`) и фильтра «свободно сегодня» (`availableToday=true`) —
 * параметров под них в контракте нет, порядок идёт по рейтингу. Чипы «Рядом» и
 * «Сегодня» поэтому помечены, а не поданы как работающие.
 */
import { Badge } from '../../components/ui/Badge';
import { Chips, Money, Notice, PhoneAppBar, PhoneBody, PhoneCard, PhoneTabBar, Placeholder } from '../kit';

/** Компании Шымкента из сидера QTime: «Дентал Плюс» — четвёртая, ниже за прокруткой. */
const COMPANIES: Array<{
  name: string;
  thumb: string;
  meta: string;
  rating: string;
  windows: string;
  windowsTone: 'success' | 'warning';
  fromMinor: number;
}> = [
  {
    name: 'Салон красоты «Лотос»',
    thumb: 'Салон',
    meta: 'ул. Тауке хана, 83 · Красота',
    rating: '★ 4,8 · 312 отзывов · 3 мастера',
    windows: 'окна с 14:00',
    windowsTone: 'success',
    fromMinor: 450_000,
  },
  {
    name: 'Барбершоп «Король Бороды»',
    thumb: 'Барбер',
    meta: 'пр. Республики, 12 · Барбершоп',
    rating: '★ 4,8 · 208 отзывов · 3 барбера',
    windows: 'окна с 14:00',
    windowsTone: 'success',
    fromMinor: 250_000,
  },
  {
    name: 'Автосервис «Мотор-Сервис»',
    thumb: 'Авто',
    meta: 'ул. Байтурсынова, 45 · Авто',
    rating: '★ 4,6 · 147 отзывов · 3 мастера',
    windows: 'завтра с 09:30',
    windowsTone: 'warning',
    fromMinor: 300_000,
  },
];

export default function ServicesHealth01() {
  return (
    <>
      <PhoneAppBar title="ORTA Services" subtitle="Шымкент · запись через QTime" right={<Badge tone="info">Ф2</Badge>} />
      <PhoneBody>
        <div className="flex items-center gap-2 rounded-xl bg-white px-3 py-2.5 ring-1 ring-inset ring-ink-200">
          <span className="text-[11px] text-ink-400">поиск</span>
          <span className="text-[13px] text-ink-800">Маникюр</span>
          <span className="ml-auto text-[11px] text-ink-300">350 мс</span>
        </div>

        <Chips items={['Рядом', 'Рейтинг', 'Сегодня', 'Красота', 'Авто']} active="Рядом" />

        <div className="flex items-baseline justify-between">
          <span className="text-[12px] font-semibold text-ink-700">Компаний: 4 · страница 1 из 1</span>
          <span className="text-[12px] text-brand-600">На карте</span>
        </div>

        {COMPANIES.map((company) => (
          <PhoneCard key={company.name}>
            <div className="flex gap-3">
              <Placeholder label={company.thumb} className="h-11 w-11 flex-none" />
              <div className="min-w-0 flex-1">
                <div className="truncate text-[13px] font-semibold text-ink-900">{company.name}</div>
                <div className="truncate text-[11.5px] text-ink-500">{company.meta}</div>
                <div className="truncate text-[11.5px] text-ink-500">{company.rating}</div>
              </div>
            </div>
            <div className="mt-2 flex items-center justify-between">
              <Badge tone={company.windowsTone}>{company.windows}</Badge>
              <span className="text-[12px] text-ink-500">
                от <Money minor={company.fromMinor} />
              </span>
            </div>
          </PhoneCard>
        ))}

        <Notice tone="info">
          <b>Чипы «Рядом» и «Сегодня» — предложение.</b> Параметров <code>sort=distance</code> и{' '}
          <code>availableToday=true</code> в контракте нет: список идёт по рейтингу. Справочника категорий и
          городов тоже нет — фильтры собраны из уже загруженных компаний.
        </Notice>
      </PhoneBody>
      <PhoneTabBar items={['Услуги', 'Записи', 'Профиль']} active="Услуги" />
    </>
  );
}
