/**
 * platform-18 · Единые рейтинги и отзывы (телефон, в работе).
 *
 * Работает только часть: рейтинг водителя в `services/driver-service` (в базисных пунктах, вместе
 * с долей принятых заказов) и история продаж продавца. Единой модели нет — экран показывает, как одна
 * оценка обслуживает водителя, салон и продавца одновременно: раздельно по типу сервиса и только
 * по завершённым заказам, чтобы рейтинг нельзя было выпрашивать или накручивать. Оценки и числа — демо.
 */
import { Badge } from '../../components/ui/Badge';
import { Notice, PhoneAppBar, PhoneBody, PhoneCard, PhoneTabBar, Row } from '../kit';

const TABS = ['Главная', 'История', 'Переводы', 'Профиль'];

const BY_SERVICE: Array<{ k: string; v: string }> = [
  { k: 'Поездки как пассажир', v: '4,8 · 96 оценок' },
  { k: 'Покупки в маркете', v: '4,6 · 21 оценка' },
  { k: 'Записи на услуги', v: '4,5 · 11 оценок' },
];

const REVIEWS: Array<{ name: string; hint: string; badge: string; tone: 'success' | 'warning' | 'neutral' }> = [
  { name: 'Ерлан К.', hint: 'поездка · водитель · «приехал за 3 минуты»', badge: 'завершён', tone: 'success' },
  { name: 'Дина М.', hint: 'маркет · продавец · «ждала замену 4 дня»', badge: 'спор', tone: 'warning' },
];

export default function Platform18Screen() {
  return (
    <>
      <PhoneAppBar
        title="Рейтинг и отзывы"
        subtitle="Один рейтинг на все направления · демо-данные"
        right={<Badge tone="warning">в работе</Badge>}
      />
      <PhoneBody>
        <PhoneCard>
          <div className="flex items-start justify-between gap-3">
            <span>
              <span className="block text-[11px] text-ink-500">Общая оценка</span>
              <span className="block text-[32px] font-bold leading-none text-ink-900">4,7</span>
            </span>
            <span className="text-right">
              <span className="block text-[14px] tracking-wide text-warning-500">★★★★<span className="text-ink-300">★</span></span>
              <span className="block text-[11px] text-ink-500">128 оценок · 340 завершённых заказов</span>
            </span>
          </div>
          <div className="my-2 h-px bg-ink-100" />
          <Row label="Рейтинг водителя" value="4,75 в базисных пунктах (47500)" />
          <Row label="Доля принятых заказов" value="92%" />
        </PhoneCard>

        <PhoneCard title="Раздельно по типу сервиса">
          {BY_SERVICE.map((item) => (
            <Row key={item.k} label={item.k} value={item.v} />
          ))}
          <p className="mt-1 text-[11px] leading-snug text-ink-500">
            «Пришёл вовремя» и «вылечил без боли» нельзя усреднить в одну цифру: иначе хороший мастер получит 3,9
            из-за отрасли, где все ставят 3.
          </p>
        </PhoneCard>

        <PhoneCard title="Последние отзывы">
          <div className="divide-y divide-ink-50">
            {REVIEWS.map((review) => (
              <div key={review.name} className="flex items-center justify-between gap-2 py-2">
                <span className="min-w-0">
                  <span className="block truncate text-[12.5px] font-medium text-ink-800">{review.name}</span>
                  <span className="block truncate text-[11px] text-ink-500">{review.hint}</span>
                </span>
                <Badge tone={review.tone}>{review.badge}</Badge>
              </div>
            ))}
          </div>
        </PhoneCard>

        <Notice tone="info">
          <b>Оценить можно только завершённый заказ.</b> Оценка привязана к заказу, поездке или записи,
          а не к человеку «в воздухе»: иначе она становится инструментом давления. Единого рейтинга
          по всем направлениям пока нет — это макет.
        </Notice>
      </PhoneBody>
      <PhoneTabBar items={TABS} active="Профиль" />
    </>
  );
}
