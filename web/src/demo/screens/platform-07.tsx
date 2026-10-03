/**
 * platform-07 · ORTA Wallet — пополнение, карты, баллы (телефон, работает).
 *
 * Пополнение и зачисление работают: `POST /api/v1/accounts/{id}/top-up` проводит контр-запись через
 * системный счёт-подвеску, и леджжер остаётся сбалансированным. Но это демо-ручка роли `ADMIN`,
 * а не «пополнение картой»: приём денег от карт, QR и банков — работа лицензированного провайдера,
 * и до договора с ним кнопка «Пополнить» честно остаётся макетом. ORTA Points и кешбэк — Ф5.
 */
import { Badge } from '../../components/ui/Badge';
import { Chips, Notice, PhoneAppBar, PhoneBody, PhoneCard, PhoneTabBar, Row } from '../kit';

const TABS = ['Главная', 'История', 'Переводы', 'Профиль'];
const AMOUNTS = ['1 000 ₸', '5 000 ₸', '10 000 ₸', '20 000 ₸'];

const METHODS: Array<{ title: string; hint: string; badge: string; tone: 'neutral' | 'success' | 'warning' }> = [
  { title: 'Демо-ручка зачисления', hint: 'POST /api/v1/accounts/{id}/top-up · ADMIN', badge: 'работает', tone: 'success' },
  { title: 'Карта · Kaspi Gold ····4417', hint: 'нужен провайдер, лицензия партнёра', badge: 'план', tone: 'warning' },
  { title: 'Перевод по QR', hint: 'из другого банковского приложения', badge: 'план', tone: 'neutral' },
];

export default function Platform07Screen() {
  return (
    <>
      <PhoneAppBar
        back
        title="Пополнение и карты"
        subtitle="ORTA Wallet · способы оплаты"
        right={<Badge tone="success">работает</Badge>}
      />
      <PhoneBody>
        <PhoneCard title="Зачислим на счёт" right={<Badge tone="brand">Основной · KZT</Badge>}>
          <div className="rounded-xl border border-brand-200 bg-brand-50/50 px-3 py-2">
            <div className="text-[11px] text-ink-500">Сумма</div>
            <div className="text-[22px] font-semibold tabular-nums text-ink-900">10 000 ₸</div>
          </div>
          <div className="mt-2">
            <Chips items={AMOUNTS} active="5 000 ₸" />
          </div>
          <p className="mt-2 text-[11px] text-ink-500">Сумма демо. Минимум — 100 ₸, максимум за одну операцию — 200 000 ₸.</p>
        </PhoneCard>

        <PhoneCard title="Способ пополнения">
          <div className="divide-y divide-ink-50">
            {METHODS.map((method) => (
              <div key={method.title} className="flex items-center justify-between gap-2 py-2">
                <span className="min-w-0">
                  <span className="block truncate text-[12.5px] font-medium text-ink-800">{method.title}</span>
                  <span className="block truncate text-[11px] text-ink-500">{method.hint}</span>
                </span>
                <Badge tone={method.tone}>{method.badge}</Badge>
              </div>
            ))}
          </div>
        </PhoneCard>

        <PhoneCard title="Что произойдёт при зачислении">
          <Row label="Счёт-подвеска" value="системный, двойная запись" />
          <Row label="Доступно после операции" value="13 500,00 ₸" strong />
        </PhoneCard>

        <Notice tone="warning">
          <b>Пополнение сейчас — только демо-ручка.</b> Приём денег от банков — лицензированный провайдер: до договора
          с ним карта, QR и «Пополнить» остаются макетом, а не спрятанной кнопкой. ORTA Points и кешбэк — Ф5.
        </Notice>
      </PhoneBody>
      <PhoneTabBar items={TABS} active="Главная" />
    </>
  );
}
