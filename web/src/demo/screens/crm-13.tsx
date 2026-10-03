/**
 * crm-13 · Отзывы.
 *
 * Отзывов как сущности нет: есть только агрегаты company.rating_bp и reviews_count
 * (демо: 4,80 · 312) и specialist.rating_bp. Оценка хранится в базисных пунктах, где
 * 50 000 = 5,00, и в демо проставляется сидом, а не отзывами.
 *
 * Влияние на выдачу при этом настоящее: компании сортируются по rating_bp desc через
 * индекс company_rating_idx. Точка, где отзыв может появиться, уже есть — событие
 * booking.completed при закрытии визита. Примеры отзывов ниже придуманы для макета.
 */
import { Badge } from '../../components/ui/Badge';
import { ConsolePanel, Kpis, Notice, Row } from '../kit';

const REVIEWS = [
  {
    initial: 'А',
    name: 'Асель Н. · после визита 28 сентября',
    service: 'Динара Ахметова · окрашивание в один тон',
    stars: '★★★★★',
    text: 'Цвет ровно тот, что обсуждали. Отдельное спасибо, что не торопили.',
    state: { label: 'ответ салона отправлен', tone: 'neutral' as const },
  },
  {
    initial: 'М',
    name: 'Мадина Т. · после визита 26 сентября',
    service: 'Айгуль Смагулова · педикюр',
    stars: '★★★☆☆',
    text: 'Ждала 15 минут, хотя записывалась заранее.',
    state: { label: 'без ответа 5 дней', tone: 'warning' as const },
  },
];

export default function CrmReviews() {
  return (
    <>
      <div className="flex items-center gap-2">
        <div className="min-w-0">
          <div className="truncate text-[13px] font-semibold text-ink-900">Отзывы и рейтинг</div>
          <div className="truncate text-[11.5px] text-ink-500">Рейтинг салона и мастеров · влияет на порядок в поиске ORTA</div>
        </div>
        <span className="ml-auto flex items-center gap-2">
          <Badge tone="danger">отзывов как сущности нет</Badge>
          <span className="rounded-full bg-white px-3 py-1.5 text-[12px] text-ink-600 ring-1 ring-ink-200">
            Запросить отзывы у клиентов
          </span>
        </span>
      </div>

      <Kpis
        items={[
          { label: 'Рейтинг салона', value: '4,80', hint: '48 000 базисных пунктов' },
          { label: 'Отзывов', value: '312', hint: 'reviews_count из сида' },
          { label: 'Оценок за месяц', value: '18', hint: 'в модели их нет' },
        ]}
      />

      <div className="grid grid-cols-[minmax(0,1fr)_286px] gap-3">
        <ConsolePanel
          title="Последние оценки"
          right={<span className="text-[11px] text-ink-500">пример макета: в базе лежит только агрегат</span>}
        >
          <div className="space-y-2">
            {REVIEWS.map((review) => (
              <div key={review.name} className="rounded-xl px-3 py-2 ring-1 ring-inset ring-ink-200">
                <div className="flex items-center gap-2.5">
                  <span className="grid h-8 w-8 flex-none place-items-center rounded-full bg-brand-100 text-[12px] font-semibold text-brand-700">
                    {review.initial}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[12.5px] font-medium text-ink-800">{review.name}</div>
                    <div className="truncate text-[11px] text-ink-500">{review.service}</div>
                  </div>
                  <span className="flex-none text-[15px] text-warning-500">{review.stars}</span>
                </div>
                <p className="mt-1.5 text-[12px] text-ink-700">{review.text}</p>
                <div className="mt-1.5 flex items-center gap-2">
                  <Badge tone={review.state.tone}>{review.state.label}</Badge>
                  <span className="text-[12px] text-brand-600">Ответить</span>
                </div>
              </div>
            ))}
          </div>
        </ConsolePanel>

        <ConsolePanel title="Как рейтинг влияет на выдачу">
          <Row label="Поле" value="company.rating_bp" />
          <Row label="Максимум" value="50 000 = 5,00" />
          <Row label="Сортировка" value="rating_bp desc" strong />
          <Row label="Индекс" value="company_rating_idx" />
          <Row label="Отзывы мастера" value="specialist.rating_bp" />

          <div className="my-2 border-t border-ink-100" />
          <p className="text-[11.5px] leading-[16px] text-ink-600">
            Влияние настоящее: список компаний сортируется по рейтингу (
            <code className="rounded bg-black/5 px-1 font-mono text-[11px]">GET /api/v1/qtime/companies</code>), и это же
            число видит клиент в приложении. Оценка хранится в базисных пунктах рядом с деньгами.
          </p>

          <div className="mt-2">
            <Notice tone="danger">
              <b>Отзыв — это ещё не сущность.</b> В модели только агрегаты rating_bp и reviews_count, и в демо они
              проставлены сидом. Точка появления отзыва — событие{' '}
              <code className="rounded bg-black/5 px-1 font-mono text-[11px]">booking.completed</code>. Ответ салона,
              жалобы и модерация — план.
            </Notice>
          </div>
        </ConsolePanel>
      </div>
    </>
  );
}
