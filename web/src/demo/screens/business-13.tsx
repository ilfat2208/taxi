/**
 * ORTA Business · Отзывы и рейтинг.
 *
 * Статус на борде «План»: отзывов как API нет. Рейтинг существует только числом —
 * ratingBasisPoints у мерчанта, ratingBp и reviewsCount у компании QTime, рейтинг
 * водителя в базисных пунктах в driver-service.
 *
 * Поэтому экран не рисует работающую кнопку «Ответить»: он показывает, как это
 * должно выглядеть, и отдельно перечисляет правила — в том числе то, что правил
 * понижения за низкий рейтинг нет и их придётся решить до кода, иначе низкий
 * рейтинг станет молчаливым понижением в выдаче.
 */
import { Badge } from '../../components/ui/Badge';
import { Chips, ConsolePanel, Notice, Row } from '../kit';

const RATING_BARS = [
  { stars: '5★', count: 38, width: '79%' },
  { stars: '4★', count: 8, width: '17%' },
  { stars: '3★', count: 1, width: '3%' },
  { stars: '2★', count: 1, width: '3%' },
  { stars: '1★', count: 0, width: '0%' },
];

const RULES = [
  { label: 'Кто может оставить отзыв', value: 'после DELIVERED или COMPLETED' },
  { label: 'Ответ на отзыв', value: 'виден публично, оценку не меняет' },
  { label: 'Изменение оценки', value: 'нельзя, только новый отзыв по новому заказу' },
  { label: 'Влияние на выдачу', value: 'порядок каталога — по рейтингу и числу отзывов' },
  { label: 'Понижение за низкий рейтинг', value: 'правил нет' },
  { label: 'Срок ответа', value: 'не ограничен' },
];

export default function Business13() {
  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      <div className="flex flex-none items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[16px] font-bold text-ink-900">Отзывы и рейтинг</div>
          <div className="truncate text-[12px] text-ink-500">
            4,7 из 5 · 48 отзывов · 3 без ответа · последний 03.10.2026
          </div>
        </div>
        <div className="flex flex-none items-center gap-2">
          <Chips items={['Только без ответа']} active="Только без ответа" />
          <span className="rounded-full bg-ink-100 px-3 py-1.5 text-[12px] text-ink-400">Ответить</span>
        </div>
      </div>

      <div className="flex-none">
        <Notice tone="warning">
          Отзывов как API нет — в коде есть только числа рейтинга (<code>ratingBasisPoints</code> у мерчанта,{' '}
          <code>ratingBp</code> и <code>reviewsCount</code> у компании QTime). Предлагается{' '}
          <code>{'GET /api/v1/reviews?merchantId'}</code> и <code>{'POST /api/v1/reviews/{id}/reply'}</code> с правилом
          «отзыв только по завершённой сделке».
        </Notice>
      </div>

      <div className="flex min-h-0 flex-1 gap-3">
        <div className="flex min-h-0 flex-1 flex-col gap-3">
          <ConsolePanel title="Рейтинг" className="flex-none">
            <div className="flex items-end gap-3">
              <span className="text-[34px] font-bold leading-none text-ink-900">4,7</span>
              <span className="pb-1 text-[12px] text-ink-500">48 отзывов · из них 3 без ответа</span>
            </div>
            <div className="mt-2 space-y-1">
              {RATING_BARS.map((row) => (
                <div key={row.stars} className="flex items-center gap-2">
                  <span className="w-6 flex-none text-[11px] text-ink-500">{row.stars}</span>
                  <span className="h-1.5 flex-1 rounded-full bg-ink-100">
                    <span className="block h-1.5 rounded-full bg-brand-500" style={{ width: row.width }} />
                  </span>
                  <span className="w-6 flex-none text-right text-[11px] tabular-nums text-ink-600">{row.count}</span>
                </div>
              ))}
            </div>
          </ConsolePanel>

          <ConsolePanel
            title="Отзывы"
            right={<span className="text-[11px] text-ink-400">ответ виден в карточке компании и в выдаче</span>}
            className="min-h-0 flex-1 overflow-hidden"
          >
            <div className="divide-y divide-ink-50">
              <div className="py-2">
                <div className="flex items-center justify-between gap-3">
                  <span className="text-[13px] font-medium text-ink-800">Данияр С.</span>
                  <span className="text-[12px] text-warning-500">★★★★★</span>
                </div>
                <div className="text-[11.5px] text-ink-500">
                  03.10 · заказ <span className="font-mono">ORD-241003-8F3K</span>
                </div>
                <p className="mt-1 text-[12.5px] text-ink-700">
                  «Забрал в тот же день, всё запечатано. Продавец позвонил и предупредил, что чехол только прозрачный.»
                </p>
                <div className="mt-1 rounded-xl bg-ink-50 px-2.5 py-1.5 text-[11.5px] text-ink-600">
                  ответ 03.10 · «Спасибо! Прозрачные снова в наличии.»
                </div>
              </div>

              <div className="py-2">
                <div className="flex items-center justify-between gap-3">
                  <span className="text-[13px] font-medium text-ink-800">Асель Ж.</span>
                  <span className="text-[12px] text-warning-500">★★</span>
                </div>
                <div className="text-[11.5px] text-ink-500">01.10 · запись QTime · педикюр</div>
                <p className="mt-1 text-[12.5px] text-ink-700">
                  «Мастер хороший, но ждала 20 минут: предыдущая запись затянулась. Предупредите заранее.»
                </p>
                <div className="mt-1 flex items-center justify-between gap-3">
                  <Badge tone="warning">без ответа 2 дня</Badge>
                  <span className="rounded-full bg-ink-100 px-3 py-1 text-[12px] text-ink-400">Ответить</span>
                </div>
              </div>
            </div>
          </ConsolePanel>
        </div>

        <div className="flex w-[320px] flex-none flex-col gap-3">
          <ConsolePanel title="Правила рейтинга и выдачи" className="flex-none">
            {RULES.map((rule) => (
              <Row key={rule.label} label={rule.label} value={rule.value} />
            ))}
          </ConsolePanel>

          <Notice tone="warning">
            Пока это только макет: самих отзывов, ответов и правил выдачи нет ни в одном сервисе. «Как рейтинг влияет
            на выдачу» придётся решить до кода — иначе низкий рейтинг станет молчаливым понижением без объяснения
            продавцу.
          </Notice>
        </div>
      </div>
    </div>
  );
}
