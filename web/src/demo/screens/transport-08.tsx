/**
 * transport-08 — ORTA Auto, СТО, мойки и шиномонтаж рядом.
 *
 * Витрина автосервисов рядом с домом. Контракт витрины изобретать не нужно: он
 * уже есть у QTime, — но самих СТО в базе нет, поэтому компании, рейтинги и
 * цены «от» демонстрационные.
 */
import { Chips, Notice, PhoneAppBar, PhoneBody, PhoneCard } from '../kit';
import { cx } from '../../lib/cx';

interface Place {
  key: string;
  mark: string;
  name: string;
  rating: string;
  reviews: string;
  services: string;
  meta: string;
  price: string;
  cta: string;
  primary: boolean;
}

const PLACES: Place[] = [
  {
    key: 'motor',
    mark: 'М',
    name: 'СТО «Мотор-Сервис»',
    rating: '4,8',
    reviews: '214 отзывов',
    services: 'Замена масла, диагностика, тормоза, кузовной',
    meta: '1,2 км · свободно сегодня 15:30 · мастер Асхат',
    price: 'от 8 500 ₸',
    cta: 'Записаться',
    primary: true,
  },
  {
    key: 'aqua',
    mark: 'А',
    name: 'Автомойка «Аква»',
    rating: '4,6',
    reviews: '188 отзывов',
    services: 'Комплекс 45 мин · детейлинг по записи',
    meta: '2,1 км · свободно сейчас · 3 поста',
    price: '3 500 ₸',
    cta: 'Записаться',
    primary: false,
  },
  {
    key: 'tyre',
    mark: 'Ш',
    name: 'Шиномонтаж на Байтурсынова',
    rating: '4,7',
    reviews: '96 отзывов',
    services: '4 колеса, балансировка, сезонное хранение',
    meta: '2,4 км · свободно сегодня 18:00',
    price: '6 000 ₸',
    cta: 'Записаться',
    primary: false,
  },
];

function PlaceCard({ place }: { place: Place }) {
  return (
    <PhoneCard className={place.primary ? 'ring-1 ring-inset ring-brand-200' : undefined}>
      <div className="flex items-start gap-3">
        <span
          className={cx(
            'grid h-9 w-9 flex-none place-items-center rounded-xl text-[13px] font-semibold',
            place.primary ? 'bg-gradient-to-br from-brand-500 to-brand-700 text-white' : 'bg-ink-100 text-ink-600',
          )}
        >
          {place.mark}
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex items-baseline gap-1.5">
            <span className="truncate text-[13px] font-semibold text-ink-900">{place.name}</span>
            <span className="flex-none text-[11.5px] font-medium text-ink-700">★ {place.rating}</span>
            <span className="flex-none text-[11px] text-ink-400">· {place.reviews}</span>
          </span>
          <span className="mt-0.5 block text-[11.5px] text-ink-500">{place.services}</span>
          <span className="block text-[11.5px] text-ink-500">{place.meta}</span>
          <span className="mt-2 flex items-center justify-between gap-2">
            <span className="text-[12.5px] font-semibold text-ink-900">{place.price}</span>
            <span
              className={cx(
                'rounded-full px-2.5 py-1 text-[11px] font-medium',
                place.primary ? 'bg-brand-500 text-white' : 'bg-ink-100 text-ink-600',
              )}
            >
              {place.cta}
            </span>
          </span>
        </span>
      </div>
    </PhoneCard>
  );
}

export default function Transport08() {
  return (
    <>
      <PhoneAppBar title="СТО и автомойки" subtitle="4 места рядом · демо-данные" back />
      <PhoneBody>
        <Chips items={['Все', 'СТО', 'Автомойка', 'Шиномонтаж']} active="Все" />

        <div className="space-y-2">
          {PLACES.map((place) => (
            <PlaceCard key={place.key} place={place} />
          ))}
        </div>

        <Notice tone="info">
          <b>Свободное время — из QTime.</b> Компании с рейтингом и ценой «от» витрина уже отдаёт анонимно;
          самих СТО и моек в базе пока нет — компании заведены только в вертикали услуг.
        </Notice>

        <div className="mt-auto" />
        <div className="rounded-xl bg-brand-500 px-4 py-3 text-center text-[13px] font-semibold text-white">
          Записаться в «Мотор-Сервис»
        </div>
      </PhoneBody>
    </>
  );
}
