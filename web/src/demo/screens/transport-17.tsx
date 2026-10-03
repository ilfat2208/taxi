/**
 * transport-17 — ORTA Delivery, пункт выдачи.
 *
 * Дешёвый тариф здесь честный по смыслу: последнюю милю проходит получатель,
 * поэтому доставка в пункт стоит 900 ₸ против 2 400 ₸ курьером — это продуктовая
 * гипотеза, а не расчёт. Пунктов выдачи и адресов в коде нет, а карта общая:
 * точки ложатся на ORTA Map так же, как машины диспетчерской.
 */
import { Notice, PhoneBody, PhoneCard, Placeholder, Row } from '../kit';
import { cx } from '../../lib/cx';

const POINTS: Array<{ key: string; num: string; name: string; meta: string; right: string; selected: boolean }> = [
  {
    key: 'orta',
    num: '1',
    name: 'ORTA ПВЗ · пр. Республики, 12',
    meta: '1,1 км · до 21:00 · свободно сейчас',
    right: 'выбран',
    selected: true,
  },
  {
    key: 'postamat',
    num: '2',
    name: 'Постамат · ТРЦ Shymkent Plaza',
    meta: '2,3 км · круглосуточно · ячейка 40 × 35 × 30 см',
    right: '2,3 км',
    selected: false,
  },
  {
    key: 'post',
    num: '3',
    name: 'Отделение 160012 · ул. Толе би, 8',
    meta: '3,0 км · до 18:00 · нужен паспорт',
    right: '3,0 км',
    selected: false,
  },
];

export default function Transport17() {
  return (
    <PhoneBody className="pt-3">
      <div className="relative">
        <Placeholder label="Карта · иллюстрация борда, не тайлы OSM" className="h-[150px]" />
        <span className="absolute left-3 top-3 rounded-full bg-white/95 px-2.5 py-1 text-[11px] text-ink-600 ring-1 ring-ink-200">
          3 пункта в 3 км
        </span>
        <span className="absolute bottom-3 left-3 flex flex-wrap items-center gap-2 rounded-xl bg-white/95 px-2.5 py-1.5 text-[10.5px] text-ink-600 ring-1 ring-ink-200">
          <span className="inline-flex items-center gap-1">
            <i className="h-2 w-2 rounded-full bg-brand-500" />
            Выбранный пункт
          </span>
          <span className="inline-flex items-center gap-1">
            <i className="h-2 w-2 rounded-full bg-info-500" />
            Другие пункты
          </span>
          <span className="text-ink-400">Иллюстрация, не тайлы OSM</span>
        </span>
      </div>

      <PhoneCard
        title="Пункт выдачи"
        right={<span className="rounded-full bg-brand-50 px-2 py-0.5 text-[11px] font-medium text-brand-700">дешевле курьера</span>}
      >
        <div className="space-y-1">
          {POINTS.map((point) => (
            <div
              key={point.key}
              className={cx(
                'flex items-center gap-3 rounded-xl px-2 py-2',
                point.selected ? 'bg-brand-50 ring-1 ring-inset ring-brand-200' : '',
              )}
            >
              <span className="grid h-7 w-7 flex-none place-items-center rounded-full bg-ink-100 text-[12px] font-semibold text-ink-600">
                {point.num}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[12.5px] font-semibold text-ink-900">{point.name}</span>
                <span className="block truncate text-[11px] text-ink-500">{point.meta}</span>
              </span>
              <span
                className={cx(
                  'flex-none text-[11px]',
                  point.selected ? 'font-medium text-brand-700' : 'text-ink-500',
                )}
              >
                {point.right}
              </span>
            </div>
          ))}
        </div>
      </PhoneCard>

      <PhoneCard>
        <Row label="Пункт" value="пр. Республики, 12" />
        <Row label="Код получения" value="D-8F42Q1" />
        <Row label="Хранится до" value="12.10.2026" />
        <Row label="Что взять" value="телефон и код" />
      </PhoneCard>

      <Notice tone="info">
        <b>Пункт выдачи — отдельная сущность.</b> Адресов, часов работы и лимитов хранения в коде нет; заводить
        их придётся вместе с направлением. Сама карта общая: точки ложатся на ORTA Map так же, как машины
        диспетчерской.
      </Notice>

      <div className="mt-auto" />
      <div className="rounded-xl bg-brand-500 px-4 py-3 text-center text-[13px] font-semibold text-white">
        Доставить в этот пункт · 900 ₸
      </div>
    </PhoneBody>
  );
}
