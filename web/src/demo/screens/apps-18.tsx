/**
 * apps-18 · Мерчант: ответ на отзыв (ORTA Business).
 *
 * Статус борда — «План»: отзывов и ответов в API нет — ни модели, ни ручек, ни в
 * catalog-service, ни в order-service. Рейтинг «4,8 · 1 240 продаж» на борде
 * помечен как пример, и здесь он помечен так же. Предлагаемые ручки:
 * GET /api/v1/merchants/me/reviews и POST …/{reviewId}/reply, событие
 * review.replied. Кабинет ORTA Business в web готов частично, приложения нет.
 *
 * Честность экрана: ни отзыва, ни ответа в системе не существует; текст ответа —
 * черновик макета. Данные демонстрационные.
 */
import { Badge } from '../../components/ui/Badge';
import { Notice, PhoneAppBar, PhoneBody, PhoneCard, PhoneTabBar, Row } from '../kit';

const MERCHANT_TABS = ['Заказы', 'Товары', 'Выплаты', 'Отзывы'];

const REVIEW = {
  author: 'Айгуль С.',
  order: 'O-01M3Y7QK2N4F',
  date: '01.10.2026',
  stars: 4,
  text: '«Всё пришло быстро, но упаковка помята: кофе в зёрнах приехал в мятой коробке.»',
};

const DRAFT = 'Спасибо за отзыв! Изменим упаковку кофе и передадим на склад — коробку заменим при следующем заказе.';

export default function Apps18() {
  return (
    <>
      <PhoneAppBar
        title="Отзывы покупателей"
        subtitle="FreshMarket · рейтинг — пример · демо"
        right={<Badge tone="neutral">План</Badge>}
      />
      <PhoneBody>
        <PhoneCard className="shrink-0">
          <div className="flex items-center gap-3">
            <span className="grid h-10 w-10 flex-none place-items-center rounded-full bg-gradient-to-br from-ink-400 to-ink-600 text-[14px] font-bold text-white">
              А
            </span>
            <div className="min-w-0 flex-1">
              <div className="truncate text-[13px] font-semibold text-ink-900">{REVIEW.author}</div>
              <div className="truncate text-[11px] text-ink-500">
                заказ <span className="font-mono">{REVIEW.order}</span> · {REVIEW.date}
              </div>
            </div>
            <span className="flex-none text-[13px] tracking-tight text-warning-500" aria-label={`${REVIEW.stars} из 5`}>
              {'★'.repeat(REVIEW.stars)}
              <span className="text-ink-300">{'★'.repeat(5 - REVIEW.stars)}</span>
            </span>
          </div>
          <div className="my-2.5 h-px bg-ink-100" />
          <p className="text-[12.5px] leading-5 text-ink-800">{REVIEW.text}</p>
        </PhoneCard>

        <div className="shrink-0 text-[11px] font-semibold uppercase tracking-wide text-ink-500">Ваш ответ</div>
        <PhoneCard className="shrink-0">
          <div className="rounded-xl border border-brand-300 bg-brand-50 px-3 py-2">
            <div className="text-[11px] text-brand-700">Ответ магазина · черновик демо</div>
            <div className="mt-1 text-[12.5px] leading-5 text-ink-800">{DRAFT}</div>
          </div>
          <div className="mt-1.5 text-[11px] text-ink-400">Ответ виден всем покупателям и не удаляется.</div>
        </PhoneCard>

        <PhoneCard className="shrink-0">
          <Row label="Рейтинг продавца (пример)" value="4,8 · 1 240 продаж" />
          <Row label="Отзывов за месяц (пример)" value="38" />
        </PhoneCard>

        <Notice tone="danger">
          <b>Отзывов в API нет.</b> Ни модели, ни ручек: рейтинг продавца выше — правдоподобный пример борда.
          Предлагаются <span className="font-mono">GET /api/v1/merchants/me/reviews</span> и{' '}
          <span className="font-mono">POST …/{'{reviewId}'}/reply</span> (событие review.replied).
        </Notice>

        <div className="shrink-0 rounded-xl bg-success-700 px-3 py-2.5 text-center text-[13px] font-semibold text-white">
          Отправить ответ — план
        </div>
      </PhoneBody>
      <PhoneTabBar items={MERCHANT_TABS} active="Отзывы" />
    </>
  );
}
