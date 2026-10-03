/**
 * platform-10 · Резервы (холды) — почему сумма заморожена (телефон, работает).
 *
 * Экран отвечает на самый частый вопрос поддержки: почему доступно меньше, чем на счёте.
 * Данные — `GET /api/v1/accounts/{id}/holds?status=ACTIVE`: у каждого резерва видны сумма, причина,
 * срок и `referenceType` (заказ, поездка или запись). Полный цикл `reserve → capture / release`
 * живёт в `services/account-service`; ошибки состояния — `409 HOLD_NOT_ACTIVE`, `409 HOLD_EXPIRED`.
 * Запись из QTime здесь — пример будущего потребителя резерва: сейчас QTime создаётся без движения денег.
 */
import { Badge } from '../../components/ui/Badge';
import { Money, Notice, PhoneAppBar, PhoneBody, PhoneCard, PhoneTabBar, Row } from '../kit';

const TABS = ['Главная', 'История', 'Переводы', 'Профиль'];

const HOLDS: Array<{ title: string; hint: string; minor: number }> = [
  { title: 'ORTA Market · 01J8ZQ…7K', hint: 'ожидает продавца · истекает 8 окт, 22:30', minor: 120000 },
  { title: 'Запись в салон · QTime', hint: '9 окт, 15:30 · гарантия явки', minor: 30000 },
];

const CYCLE: Array<{ title: string; hint: string; tone: 'success' | 'neutral' | 'warning' }> = [
  { title: 'reserve — деньги зарезервированы', hint: 'Сумма уходит из доступного остатка, но остаётся на счёте', tone: 'success' },
  { title: 'capture — резерв становится списанием', hint: 'Заказ выполнен: деньги уходят продавцу одной проводкой', tone: 'neutral' },
  { title: 'release — резерв снимается', hint: 'Отмена или истечение: сумма снова доступна', tone: 'warning' },
];

export default function Platform10Screen() {
  return (
    <>
      <PhoneAppBar
        back
        title="Зарезервировано"
        subtitle="Почему сумма «заморожена»"
        right={<Badge tone="success">работает</Badge>}
      />
      <PhoneBody>
        <div className="rounded-2xl border border-amber-200 bg-warning-50 p-3">
          <div className="text-[11.5px] text-warning-700">На счёте всего</div>
          <div className="text-[24px] font-bold tabular-nums text-warning-700">5 000,00 ₸</div>
          <div className="mt-2 flex gap-6">
            <span>
              <span className="block text-[11px] text-ink-500">Доступно</span>
              <Money minor={350000} />
            </span>
            <span>
              <span className="block text-[11px] text-ink-500">Заморожено</span>
              <span className="font-semibold tabular-nums text-warning-700">1 500,00 ₸</span>
            </span>
          </div>
        </div>

        <PhoneCard title="Активные резервы" right={<Badge tone="warning">2 из 2</Badge>}>
          <div className="divide-y divide-ink-50">
            {HOLDS.map((hold) => (
              <div key={hold.title} className="flex items-center justify-between gap-2 py-2">
                <span className="min-w-0">
                  <span className="block truncate text-[12.5px] font-medium text-ink-800">{hold.title}</span>
                  <span className="block truncate text-[11px] text-ink-500">{hold.hint}</span>
                </span>
                <Money minor={hold.minor} />
              </div>
            ))}
          </div>
          <Row label="Истечение резерва" value="release без проводки" />
        </PhoneCard>

        <PhoneCard title="Что происходит дальше">
          <div className="space-y-2">
            {CYCLE.map((step) => (
              <div key={step.title} className="flex gap-2">
                <span
                  className={`mt-1.5 h-2 w-2 flex-none rounded-full ${
                    step.tone === 'success' ? 'bg-success-500' : step.tone === 'warning' ? 'bg-ink-300' : 'bg-ink-400'
                  }`}
                />
                <span className="min-w-0">
                  <span className="block text-[12.5px] font-medium text-ink-800">{step.title}</span>
                  <span className="block text-[11px] text-ink-500">{step.hint}</span>
                </span>
              </div>
            ))}
          </div>
        </PhoneCard>

        <Notice tone="neutral">
          <b>Почему нельзя «просто списать сразу».</b> Между нажатием «оплатить» и выполнением заказа проходит время.
          Если списывать сразу, каждый отказ превращается в возврат — отдельную операцию, срок банка и спор.
        </Notice>
      </PhoneBody>
      <PhoneTabBar items={TABS} active="Главная" />
    </>
  );
}
