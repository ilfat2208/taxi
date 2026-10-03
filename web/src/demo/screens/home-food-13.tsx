/**
 * home-food-13 · ORTA Tickets — выбор мест в зале и оплата.
 *
 * Что на экране: схема зала из данных (ряды прямоугольников), легенда, выбранные места,
 * счёт списания, лист оплаты с итогом и удержание мест.
 *
 * Честно: оплата и холды — готовое ядро (POST /api/v1/payments/merchant и
 * POST /api/v1/accounts/internal/holds), поэтому лист оплаты и удержание на 15 минут
 * подписаны как работающие. Сама схема зала — демо: ряд, место и цену отдаёт провайдер,
 * а билетные провайдеры ещё не выбраны.
 */
import { Badge } from '../../components/ui/Badge';
import { cx } from '../../lib/cx';
import { Money, Notice, PhoneAppBar, PhoneBody, PhoneCard, PhoneTabBar, Row } from '../kit';

const TABS = ['Home', 'Food', 'Tickets', 'Build', 'Rent'];

/** t — занято, f — свободно, c — выбрано покупателем. */
const HALL = [
  'ttfftfftft',
  'fftfftffft',
  'ftfftfftff',
  'tfftffftft',
  'ccfftftfff',
];

const SEAT_CLASS: Record<string, string> = {
  f: 'bg-brand-200',
  c: 'bg-brand-500',
  t: 'bg-ink-200',
};

const LEGEND: Array<{ label: string; className: string }> = [
  { label: 'свободно', className: 'bg-brand-200' },
  { label: 'ваш выбор', className: 'bg-brand-500' },
  { label: 'занято', className: 'bg-ink-200' },
];

export default function HomeFood13() {
  return (
    <>
      <PhoneAppBar title="Выбор мест" subtitle="«Қыз Жібек» · 3 октября, 19:00 · Основной зал" back />
      <PhoneBody>
        <PhoneCard title="Основной зал" right={<Badge tone="neutral">схема демо</Badge>}>
          <div className="text-center text-[10px] uppercase tracking-[0.2em] text-ink-500">Сцена</div>
          <div className="mx-auto my-2 h-1.5 w-full rounded-full bg-gradient-to-r from-ink-300 via-brand-300 to-ink-300" />
          <div className="grid grid-cols-10 gap-1">
            {HALL.flatMap((row, rowIndex) =>
              row.split('').map((seat, seatIndex) => (
                <span key={`${rowIndex}-${seatIndex}`} className={cx('h-[14px] rounded-[4px]', SEAT_CLASS[seat])} />
              )),
            )}
          </div>
          <div className="mt-2 flex flex-wrap gap-3">
            {LEGEND.map((item) => (
              <span key={item.label} className="flex items-center gap-1.5">
                <i className={cx('block h-3 w-3 rounded-[4px]', item.className)} />
                <span className="text-[11px] text-ink-500">{item.label}</span>
              </span>
            ))}
          </div>
          <div className="mt-1 text-[11px] text-ink-500">
            Схема нарисована прямоугольниками: ряд, место и цену провайдер отдаёт данными
          </div>
        </PhoneCard>

        <PhoneCard>
          <div className="flex items-center justify-between gap-2">
            <div className="min-w-0">
              <div className="truncate text-[12.5px] font-semibold text-ink-900">Ряд 7, места 12 и 13</div>
              <div className="text-[11.5px] text-ink-500">
                Партер · <Money minor={350_000} /> за место
              </div>
            </div>
            <Badge tone="warning">держатся 15:00</Badge>
          </div>
        </PhoneCard>

        <PhoneCard title="Лист оплаты">
          <Row
            label="Счёт списания"
            value={
              <>
                ORTA · KZT · <Money minor={409_465_210} />
              </>
            }
          />
          <Row label="Билеты (2 × 3 500,00 ₸)" value={<Money minor={700_000} />} />
          <Row label="Сервисный сбор 5%" value={<Money minor={35_000} />} />
          <Row label="Итого к оплате" value={<Money minor={735_000} />} strong />
        </PhoneCard>

        <div className="rounded-xl bg-brand-500 px-4 py-2.5 text-center text-[13px] font-semibold text-white">
          Оплатить · 7 350,00 ₸
        </div>

        <Notice tone="info">
          Места держатся 15 минут, а оплата идёт платежом мерчанту с Idempotency-Key — это готовое ядро
          ORTA Pay и холдов. Разметка зала — демо: ряда, места и цены из ответа провайдера пока нет.
        </Notice>
      </PhoneBody>
      <PhoneTabBar items={TABS} active="Tickets" />
    </>
  );
}
