/**
 * ORTA Beauty — подборки салонов (план).
 *
 * Экрана нет: вертикаль Beauty в приложении не начата, подборки и баннеры никто
 * не отдаёт. Что уже существует — компании с категориями `BEAUTY` и `BARBERSHOP`
 * в `qtime.company` и анонимный список
 * `GET /api/v1/qtime/companies?category=BEAUTY&city=Шымкент`. «Лотос» и «Король
 * Бороды» — реальные записи сидера, «Nail Bar» — иллюстрация.
 *
 * Предлагаемые эндпоинты: `GET /api/v1/beauty/collections`,
 * `GET /api/v1/beauty/collections/{id}`.
 *
 * Спорное место: фильтр «свободно сегодня» требует нового параметра контракта
 * QTime — окна считаются на пару «специалист + услуга + дата», а не на компанию,
 * поэтому «есть окна» в списке салонов придётся либо считать по каждому мастеру,
 * либо заводить агрегат.
 */
import { Badge } from '../../components/ui/Badge';
import { Chips, Money, Notice, PhoneAppBar, PhoneBody, PhoneCard, Placeholder } from '../kit';

const COLLECTION: Array<{ name: string; thumb: string; where: string; service: string; priceMinor: number }> =
  [
    {
      name: 'Салон красоты «Лотос»',
      thumb: 'Лотос',
      where: 'ул. Тауке хана, 83 · 350 м',
      service: '★ 4,8 · маникюр с покрытием',
      priceMinor: 450_000,
    },
    {
      name: 'Барбершоп «Король Бороды»',
      thumb: 'Барбер',
      where: 'пр. Республики, 12 · 1,2 км',
      service: '★ 4,8 · комплекс: стрижка и борода',
      priceMinor: 650_000,
    },
    {
      name: 'Студия «Nail Bar»',
      thumb: 'Nail',
      where: 'ТЦ «Мега», 2 этаж · 900 м',
      service: '★ 4,6 · маникюр без покрытия',
      priceMinor: 400_000,
    },
  ];

export default function ServicesHealth09() {
  return (
    <>
      <PhoneAppBar
        title="ORTA Beauty"
        subtitle="Салоны и барбершопы · подборки"
        right={<Badge tone="neutral">План</Badge>}
      />
      <PhoneBody>
        <Placeholder label="Подборка: маникюр на выходные" className="h-16 flex-none" />

        <Chips items={['Маникюр', 'Стрижка', 'Окрашивание']} active="Маникюр" />

        {COLLECTION.map((item) => (
          <PhoneCard key={item.name}>
            <div className="flex items-center gap-3">
              <Placeholder label={item.thumb} className="h-10 w-10 flex-none" />
              <div className="min-w-0 flex-1">
                <div className="truncate text-[13px] font-semibold text-ink-900">{item.name}</div>
                <div className="truncate text-[11.5px] text-ink-500">{item.where}</div>
              </div>
            </div>
            <div className="mt-2 flex items-center justify-between">
              <span className="truncate text-[11.5px] text-ink-500">{item.service}</span>
              <Money minor={item.priceMinor} />
            </div>
          </PhoneCard>
        ))}

        <Notice tone="info">
          <b>Подборок и фильтра «окна в субботу» в коде нет.</b> Компании BEAUTY и BARBERSHOP в QTime есть,
          но подборки, баннеры и признак «свободно сегодня» никто не отдаёт: агрегата окон на компанию нет.
        </Notice>
      </PhoneBody>
    </>
  );
}
