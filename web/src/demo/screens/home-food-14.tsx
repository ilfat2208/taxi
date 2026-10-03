/**
 * home-food-14 · ORTA Tickets — билет с кодом входа и возврат.
 *
 * Что на экране: билет с кодом входа (место, ряд, цена), таймлайн оплаты и выдачи,
 * срок возврата и два действия — календарь и возврат билетов.
 *
 * Честно: генератора QR в приложении нет, поэтому вместо QR — плейсхолдер, а на экране
 * код входа, который контролёр вводит вручную. Возврат при этом работает: это готовое
 * ядро ORTA Pay (POST /api/v1/payments/{id}/refund с Idempotency-Key, включая частичный
 * возврат), но сроки и удержания задаёт организатор, и в контракте их пока нет.
 */
import type { ReactNode } from 'react';
import { Badge } from '../../components/ui/Badge';
import { cx } from '../../lib/cx';
import { Money, Notice, PhoneAppBar, PhoneBody, PhoneCard, PhoneTabBar, Placeholder } from '../kit';

const TABS = ['Home', 'Food', 'Tickets', 'Build', 'Rent'];

type StepState = 'done' | 'planned';

const STEPS: Array<{ title: ReactNode; sub: string; state: StepState }> = [
  {
    title: (
      <>
        Оплачено · <Money minor={735_000} />
      </>
    ),
    sub: '9:47 · списано со счёта ORTA · KZT',
    state: 'done',
  },
  { title: 'Билет выдан', sub: '9:47 · вход по коду, бумажный билет не нужен', state: 'done' },
  {
    title: 'Возврат доступен до 2 октября, 19:00',
    sub: 'позже — только по решению организатора',
    state: 'planned',
  },
];

const DOT_CLASS: Record<StepState, string> = {
  done: 'bg-success-500',
  planned: 'bg-ink-300',
};

export default function HomeFood14() {
  return (
    <>
      <PhoneAppBar title="Билеты куплены" subtitle="TKT-261002-4K7Q · 2 октября 2026, 9:47" />
      <PhoneBody>
        <PhoneCard title="«Қыз Жібек»" right={<Badge tone="success">оплачено</Badge>}>
          <div className="flex gap-3">
            <Placeholder
              label="QR — плейсхолдер"
              className="wrap-anywhere h-[96px] w-[96px] flex-none text-center text-[10px]! leading-tight"
            />
            <div className="min-w-0 flex-1">
              <div className="text-[12.5px] text-ink-800">3 октября, 19:00 · Основной зал</div>
              <div className="text-[11.5px] text-ink-500">Ряд 7, места 12 и 13 · партер</div>
              <div className="mt-1 font-mono text-[11.5px] text-ink-900">TKT-261002-4K7Q-0712</div>
              <div className="mt-1 text-[15px]">
                <Money minor={735_000} />
              </div>
            </div>
          </div>
        </PhoneCard>

        <PhoneCard>
          <div className="space-y-1.5">
            {STEPS.map((step, index) => (
              <div key={index} className="flex gap-2.5">
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

        <Notice tone="neutral">
          QR — плейсхолдер: генератора QR в приложении нет, поэтому на экране код входа, который контролёр
          вводит вручную. Возврат работает — ORTA Pay возвращает платёж, включая частичный, — но сроки и
          удержания задаёт организатор, и в контракте их пока нет.
        </Notice>

        <div className="rounded-xl border border-ink-200 bg-white px-4 py-2.5 text-center text-[13px] font-semibold text-ink-700">
          Добавить в календарь
        </div>
        <div className="rounded-xl border border-brand-200 bg-brand-50 px-4 py-2.5 text-center text-[13px] font-semibold text-brand-700">
          Вернуть билеты
        </div>
      </PhoneBody>
      <PhoneTabBar items={TABS} active="Tickets" />
    </>
  );
}
