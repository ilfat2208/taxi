/**
 * home-food-22 · ORTA Rent — возврат и состояние вещи.
 *
 * Что на экране: акт возврата (комплект и повреждение), судьба залога — сколько
 * освобождено и сколько удержано, таймлайн capture и release и два действия: оспорить
 * удержание и скачать акт.
 *
 * Честно: холд залога закрывают работающие services/account-service —
 * POST /api/v1/accounts/internal/holds/{holdId}/capture и .../release, поэтому эти шаги
 * подписаны как готовое ядро. А вот кто оценивает ущерб — не решено: удержание назначил
 * пункт выдачи, регламента оценки и спора нет, поэтому кнопка «оспорить» здесь обязательна.
 */
import type { ReactNode } from 'react';
import { Badge } from '../../components/ui/Badge';
import { cx } from '../../lib/cx';
import { Money, Notice, PhoneAppBar, PhoneBody, PhoneCard, PhoneTabBar, Row } from '../kit';

const TABS = ['Home', 'Food', 'Tickets', 'Build', 'Rent'];

type StepState = 'done' | 'current';

const STEPS: Array<{ title: ReactNode; sub: string; state: StepState }> = [
  {
    title: (
      <>
        Аренда списана · <Money minor={513_000} />
      </>
    ),
    sub: 'capture из холда при выдаче 3 октября',
    state: 'done',
  },
  {
    title: (
      <>
        Холд залога: <Money minor={2_600_000} /> освобождено
      </>
    ),
    sub: 'release · деньги снова доступны на счёте',
    state: 'done',
  },
  {
    title: (
      <>
        Холд залога: <Money minor={400_000} /> списано
      </>
    ),
    sub: 'частичный capture · удержание по акту возврата',
    state: 'current',
  },
];

const DOT_CLASS: Record<StepState, string> = {
  done: 'bg-success-500',
  current: 'bg-brand-500',
};

export default function HomeFood22() {
  return (
    <>
      <PhoneAppBar title="Вещь возвращена" subtitle="6 октября 2026, 11:12 · пункт Тауке хана, 83" />
      <PhoneBody>
        <PhoneCard title="Акт возврата">
          <div className="space-y-2">
            <div className="flex items-center justify-between gap-2">
              <div className="min-w-0">
                <div className="truncate text-[12.5px] text-ink-800">Комплект полный</div>
                <div className="truncate text-[11.5px] text-ink-500">перфоратор, кейс, 3 бура, ключ</div>
              </div>
              <Badge tone="success">ок</Badge>
            </div>
            <div className="flex items-center justify-between gap-2">
              <div className="min-w-0">
                <div className="truncate text-[12.5px] text-ink-800">Царапина на корпусе, 2 см</div>
                <div className="truncate text-[11.5px] text-ink-500">не было в акте выдачи, оценка пункта</div>
              </div>
              <Badge tone="warning">удержание</Badge>
            </div>
          </div>
        </PhoneCard>

        <PhoneCard>
          <Row label="Залог зарезервирован" value={<Money minor={3_000_000} />} />
          <Row label="Удержание за царапину" value={<Money minor={400_000} />} />
          <Row label="Возврат залога" value={<Money minor={2_600_000} />} strong />
        </PhoneCard>

        <PhoneCard>
          <div className="space-y-1.5">
            {STEPS.map((step, index) => (
              <div key={index} className="flex gap-2.5">
                <span className={cx('mt-1.5 h-2.5 w-2.5 flex-none rounded-full', DOT_CLASS[step.state])} />
                <div className="min-w-0 flex-1">
                  <div className="text-[12.5px] font-semibold text-ink-900">{step.title}</div>
                  <div className="text-[11px] text-ink-500">{step.sub}</div>
                </div>
              </div>
            ))}
          </div>
        </PhoneCard>

        <Notice tone="danger">
          Кто оценивает ущерб — не решено: удержание назначил пункт выдачи, регламента оценки и спора нет,
          поэтому кнопка «оспорить» обязательна. Сам холд закрывают работающие services/account-service.
        </Notice>

        <div className="rounded-xl border border-ink-200 bg-white px-4 py-2.5 text-center text-[13px] font-semibold text-ink-700">
          Оспорить удержание 4 000,00 ₸
        </div>
        <div className="rounded-xl px-4 py-2.5 text-center text-[13px] font-semibold text-brand-600">
          Скачать акт и чек
        </div>
      </PhoneBody>
      <PhoneTabBar items={TABS} active="Rent" />
    </>
  );
}
