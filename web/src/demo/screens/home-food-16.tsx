/**
 * home-food-16 · ORTA Build — бригады и услуги.
 *
 * Что на экране: категории работ и две карточки исполнителей — бригада под ключ и
 * проектировщик: рейтинг, число объектов, свободное время, ставка и цена за объём.
 *
 * Честно: сам список — макет, а вот расписание и запись работают: services/qtime-service
 * отдаёт компании, свободные окна и записи. Для стройки там не хватает двух вещей —
 * категории для бригад (сейчас BEAUTY, BARBERSHOP, AUTO, HEALTH, SERVICES) и записи
 * длиной в недели, а не в часы. Цены за м² — демо-сумма по демо-ставке.
 */
import { Badge } from '../../components/ui/Badge';
import { Chips, Money, Notice, PhoneAppBar, PhoneBody, PhoneCard, PhoneTabBar } from '../kit';

const TABS = ['Home', 'Food', 'Tickets', 'Build', 'Rent'];

const CATEGORIES = ['Ремонт', 'Бригады', 'Проектирование', 'Монтаж'];

const TEAMS = [
  {
    initial: 'А',
    name: 'Бригада «Ақ Орда»',
    rating: '4,8 · 214 объектов',
    line1: 'Ремонт под ключ · 5 человек · своя бригада электриков',
    line2: 'Свободны с 6 октября · от 6 500 ₸/м² · гарантия 2 года',
    priceMinor: 44_200_000,
    priceNote: 'за 68 м²',
  },
  {
    initial: 'Д',
    name: 'Аскар Д. · проектирование',
    rating: '4,9 · 63 проекта',
    line1: 'Планировка, перепланировка, согласование, рабочая документация',
    line2: 'Свободен завтра 10:00 · 3 дня на концепцию',
    priceMinor: 45_000_000,
    priceNote: 'за проект',
  },
];

export default function HomeFood16() {
  return (
    <>
      <PhoneAppBar title="Услуги и бригады" subtitle="Ремонт, строительство, проектирование · Шымкент" />
      <PhoneBody>
        <Chips items={CATEGORIES} active="Ремонт" />

        <PhoneCard title="Исполнители и свободное время" right={<Badge tone="brand">QTime</Badge>}>
          <div className="space-y-2.5">
            {TEAMS.map((team) => (
              <div key={team.name} className="flex gap-2.5">
                <span className="grid h-9 w-9 flex-none place-items-center rounded-full bg-brand-100 text-[13px] font-semibold text-brand-700">
                  {team.initial}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-baseline gap-1.5">
                    <span className="text-[12.5px] font-semibold text-ink-900">{team.name}</span>
                    <span className="text-[11.5px] font-semibold text-ink-700">{team.rating}</span>
                  </div>
                  <div className="text-[11px] text-ink-500">{team.line1}</div>
                  <div className="text-[11px] text-ink-500">{team.line2}</div>
                  <div className="mt-1.5 flex items-center gap-2">
                    <span className="text-[12px]">
                      <Money minor={team.priceMinor} />
                      <span className="text-ink-500"> {team.priceNote}</span>
                    </span>
                    <span className="flex-1" />
                    <Badge tone="neutral">Выбрать</Badge>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </PhoneCard>

        <Notice tone="info">
          Свободное время — из QTime, но не только оно: календарь, услуги и записи уже работают
          (services/qtime-service). Для стройки нужны категория для бригад и запись длиной в недели, а не в часы.
        </Notice>

        <div className="rounded-xl bg-brand-500 px-4 py-2.5 text-center text-[13px] font-semibold text-white">
          Запросить расчёт у бригады
        </div>

        <p className="text-[11px] text-ink-500">
          Показ 68 м² «под ключ» — 442 000 ₸ по ставке 6 500 ₸/м², сумма демо.
        </p>
      </PhoneBody>
      <PhoneTabBar items={TABS} active="Build" />
    </>
  );
}
