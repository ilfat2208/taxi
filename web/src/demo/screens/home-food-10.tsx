/**
 * home-food-10 · ORTA Food — статус заказа.
 *
 * Что на экране: таймлайн заказа от оплаты до кухни, состав заказа, списанная сумма и
 * два действия — связь с заведением и отмена.
 *
 * Честно: шаг «курьер» серый, потому что курьерской вертикали не существует — доставка
 * есть только строкой в заказе маркета. Экран показывает этот шаг серым, а не рисует
 * «курьер в пути». Возврат при этом работает: POST /api/v1/payments/{id}/refund —
 * готовое ядро ORTA Pay; правила отмены для еды ещё не решены.
 */
import { Badge } from '../../components/ui/Badge';
import { cx } from '../../lib/cx';
import { Money, Notice, PhoneAppBar, PhoneBody, PhoneCard, PhoneTabBar, Row } from '../kit';

const TABS = ['Home', 'Food', 'Tickets', 'Build', 'Rent'];

type StepState = 'done' | 'current' | 'planned';

const STEPS: Array<{ title: string; sub: string; state: StepState }> = [
  { title: 'Оплачен · 7 300,00 ₸', sub: '9:45 · списано со счёта ORTA · KZT, платёж 01M4TS9K4D2Q', state: 'done' },
  { title: 'Заведение приняло заказ', sub: '9:47 · готовность 40–55 минут', state: 'done' },
  { title: 'Готовится', sub: '10:21 · плов и манты на кухне', state: 'current' },
  { title: 'Курьер не назначен', sub: 'ORTA Delivery — план: курьеров и трекинга в репозитории нет', state: 'planned' },
];

const DOT_CLASS: Record<StepState, string> = {
  done: 'bg-success-500',
  current: 'bg-brand-500',
  planned: 'bg-ink-300',
};

export default function HomeFood10() {
  return (
    <>
      <PhoneAppBar title="Заказ FOD-261002-5T2K" subtitle="Дастархан · оплачен в 9:45" />
      <PhoneBody>
        <PhoneCard>
          <div className="space-y-1.5">
            {STEPS.map((step) => (
              <div key={step.title} className="flex gap-2.5">
                <span className={cx('mt-1.5 h-2.5 w-2.5 flex-none rounded-full', DOT_CLASS[step.state])} />
                <div className="min-w-0 flex-1">
                  <div className={cx('text-[12.5px] font-semibold', step.state === 'planned' ? 'text-ink-400' : 'text-ink-900')}>
                    {step.title}
                  </div>
                  <div className="text-[11px] text-ink-500">{step.sub}</div>
                </div>
              </div>
            ))}
          </div>
        </PhoneCard>

        <Notice tone="danger">
          Доставка не сделана: курьерской вертикали не существует, доставка есть только строкой в заказе
          маркета. Возврат работает — POST /api/v1/payments/&#123;id&#125;/refund, но правила отмены для еды ещё не
          решены.
        </Notice>

        <PhoneCard title="Состав заказа" right={<Badge tone="warning">Готовится</Badge>}>
          <Row label="Плов с бараниной · 1" value={<Money minor={390_000} />} />
          <Row label="Манты с тыквой · 1" value={<Money minor={270_000} />} />
          <Row label="Доставка · Тауке хана, 83, кв. 12" value={<Money minor={70_000} />} />
          <Row label="Списано со счёта" value={<Money minor={730_000} />} strong />
        </PhoneCard>

        <div className="rounded-xl border border-ink-200 bg-white px-4 py-2.5 text-center text-[13px] font-semibold text-ink-700">
          Связаться с заведением
        </div>
        <div className="rounded-xl border border-brand-200 bg-brand-50 px-4 py-2.5 text-center text-[13px] font-semibold text-brand-700">
          Отменить заказ
        </div>
      </PhoneBody>
      <PhoneTabBar items={TABS} active="Food" />
    </>
  );
}
