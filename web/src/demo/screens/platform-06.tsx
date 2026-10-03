/**
 * platform-06 · ORTA Pay — счёт и баланс (телефон, работает).
 *
 * Три числа на карточке — не украшение: `availableMinor = balanceMinor − heldMinor`
 * (3 500,00 = 5 000,00 − 1 500,00), и именно доступную сумму проверяет резервирование.
 * Суммы демо, в минорных единицах; движение денег — только двойной записью, поэтому экран
 * не «рисует баланс», а показывает то, что вернул леджжер `services/account-service`.
 */
import { Badge } from '../../components/ui/Badge';
import { Money, Notice, PhoneAppBar, PhoneBody, PhoneCard, PhoneTabBar, Row } from '../kit';

const TABS = ['Главная', 'История', 'Переводы', 'Профиль'];

const ACCOUNTS: Array<{ title: string; hint: string; tone: string }> = [
  { title: 'Основной · KZT', hint: 'CUSTOMER · доступно 3 500,00 ₸', tone: 'from-brand-500 to-brand-700' },
  { title: 'Продажи · KZT', hint: 'MERCHANT · выплаты маркетплейса', tone: 'from-info-500 to-brand-700' },
];

export default function Platform06Screen() {
  return (
    <>
      <PhoneAppBar title="ORTA Pay" subtitle="Счёт, баланс и доступная сумма" right={<Badge tone="success">работает</Badge>} />
      <PhoneBody>
        <div className="rounded-2xl bg-gradient-to-br from-brand-500 to-brand-800 p-3 text-white">
          <div className="text-[11.5px] text-white/80">Основной счёт · KZT · CUSTOMER</div>
          <div className="mt-1 text-[28px] font-bold tabular-nums leading-none">5 000,00 ₸</div>
          <div className="mt-2 flex gap-6">
            <span>
              <span className="block text-[11px] text-white/80">Доступно</span>
              <span className="block text-[14px] font-semibold tabular-nums">3 500,00 ₸</span>
            </span>
            <span>
              <span className="block text-[11px] text-white/80">Зарезервировано</span>
              <span className="block text-[14px] font-semibold tabular-nums">1 500,00 ₸</span>
            </span>
          </div>
          <div className="mt-2 text-[11px] text-white/80">3 500,00 = 5 000,00 − 1 500,00 · суммы демо, в минорных единицах</div>
        </div>

        <div className="flex gap-2">
          <span className="flex-1 rounded-xl bg-brand-500 py-2.5 text-center text-[13px] font-medium text-white">Перевести</span>
          <span className="flex-1 rounded-xl border border-ink-200 bg-white py-2.5 text-center text-[13px] font-medium text-ink-700">
            Пополнить
          </span>
        </div>

        <PhoneCard title="Счёт">
          <Row label="Номер счёта" value={<span className="font-mono text-[11.5px]">01J8ZCQ7Y4R3F0N5G8</span>} />
          <Row label="CUSTOMER · KZT" value={<Badge tone="success">ACTIVE</Badge>} />
          <Row label="Итог по леджжеру" value={<Money minor={500000} />} strong />
        </PhoneCard>

        <PhoneCard title="Все счета">
          <div className="divide-y divide-ink-50">
            {ACCOUNTS.map((account) => (
              <div key={account.title} className="flex items-center gap-3 py-2">
                <span className={`grid h-9 w-9 flex-none place-items-center rounded-xl bg-gradient-to-br ${account.tone} text-[13px] font-semibold text-white`}>
                  ₸
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[12.5px] font-medium text-ink-800">{account.title}</span>
                  <span className="block truncate text-[11px] text-ink-500">{account.hint}</span>
                </span>
                <Badge tone="success">активен</Badge>
              </div>
            ))}
          </div>
        </PhoneCard>

        <Notice tone="info">
          <b>Деньги двигаются только двойной записью:</b> в каждой проводке <span className="font-mono">СУММА(debit) = СУММА(credit)</span>.
          Поэтому «зарезервировано» — не списание, а уменьшение доступного остатка.
        </Notice>
      </PhoneBody>
      <PhoneTabBar items={TABS} active="Главная" />
    </>
  );
}
