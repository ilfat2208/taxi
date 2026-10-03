/**
 * ORTA Beauty — портфолио мастера (план).
 *
 * Экрана нет. Что уже есть в коде: карточка специалиста в ответе компании —
 * `name`, `specialization`, `ratingBp` (49000 = 4,90), `experienceYears`, таблица
 * `qtime.specialist`; прайс мастера — `qtime.service_item` с персональной услугой
 * через `specialist_id`; ближайшие окна — запрос слотов.
 *
 * Чего нет ни в контракте, ни в схеме: фотографий работ, тегов, отзывов о мастере
 * и «1 240 процедур». Поэтому работы показаны плейсхолдерами: настоящих
 * фотографий нет — ни картинок, ни CDN.
 *
 * Предлагаемые эндпоинты: `GET /api/v1/beauty/specialists/{id}/portfolio`,
 * `POST /api/v1/beauty/specialists/{id}/portfolio`,
 * `GET /api/v1/reviews?specialistId=`. Загрузка изображений — не «ещё одна
 * таблица», а решение по хранению и модерации.
 */
import { Badge } from '../../components/ui/Badge';
import { Chips, Money, Notice, PhoneAppBar, PhoneBody, PhoneCard, Placeholder, Row } from '../kit';

/** Прайс мастера: «Наращивание ресниц» закреплено за Айгуль, у остальных его нет. */
const PRICE: Array<{ name: string; duration: string; priceMinor: number }> = [
  { name: 'Маникюр с покрытием', duration: '1 ч 30 мин', priceMinor: 450_000 },
  { name: 'Педикюр', duration: '1 ч 15 мин', priceMinor: 550_000 },
  { name: 'Наращивание ресниц', duration: '2 ч', priceMinor: 1_200_000 },
];

export default function ServicesHealth10() {
  return (
    <>
      <PhoneAppBar
        title="Айгуль Смагулова"
        subtitle="мастер маникюра · «Лотос» · ★ 4,9 · стаж 6 лет"
        back
        right={
          <span className="grid h-10 w-10 place-items-center rounded-full bg-brand-100 text-[14px] font-semibold text-brand-700">
            А
          </span>
        }
      />
      <PhoneBody>
        <div className="flex items-baseline justify-between">
          <span className="text-[12px] font-semibold text-ink-700">Портфолио</span>
          <span className="text-[12px] text-brand-600">Все 48 работ</span>
        </div>

        <div className="grid grid-cols-3 gap-2">
          <Placeholder label="нюд" className="h-[84px]" />
          <Placeholder label="френч" className="h-[84px]" />
          <Placeholder label="роспись" className="h-[84px]" />
        </div>

        <Chips items={['Маникюр', 'Гель-лак', 'Наращивание', 'Дизайн']} active="Маникюр" />

        <PhoneCard title="Прайс мастера" right={<Badge tone="brand">QTime</Badge>}>
          {PRICE.map((service) => (
            <Row
              key={service.name}
              label={`${service.name} · ${service.duration}`}
              value={<Money minor={service.priceMinor} />}
            />
          ))}
        </PhoneCard>

        <Notice tone="info">
          <b>Фотографий, тегов и отзывов о мастере в контракте нет.</b> У специалиста в QTime есть имя,
          специализация, рейтинг и стаж. Портфолио — новая область, и её нельзя сделать, не решив хранение и
          модерацию изображений.
        </Notice>

        <PhoneCard title="Что под портфолио уже есть" right={<Badge tone="neutral">без выдумок</Badge>}>
          <Row label="Мастер в ответе компании" value="имя, специализация, стаж, рейтинг" />
          <Row label="Окна на запись" value="мастер + услуга + дата" />
          <Row label="Чего нет и в схеме" value="фото, теги, «1 240 процедур»" strong />
        </PhoneCard>

        <div className="mt-auto">
          <div className="rounded-xl bg-brand-500 py-3 text-center text-[13px] font-semibold text-white">
            Записаться к Айгуль
          </div>
        </div>
      </PhoneBody>
    </>
  );
}
