/**
 * platform-08 · История операций с фильтрами (телефон, работает).
 *
 * Выписка — это записи леджжера, а не «журнал приложения»: у каждой операции видны `operation`,
 * `direction`, сумма, остаток после операции и ссылка на источник (`referenceType`/`referenceId`).
 * Резерв показан отдельной строкой и честно назван замороженной суммой, а не списанием.
 * Фильтры по типу и периоду пока клиентские: серверного фильтра в API нет — это подписано на экране.
 */
import { Badge } from '../../components/ui/Badge';
import { Chips, Notice, PhoneAppBar, PhoneBody, PhoneCard, PhoneTabBar, Row } from '../kit';

const TABS = ['Главная', 'История', 'Переводы', 'Профиль'];
const FILTERS = ['Все', 'Списания', 'Зачисления', 'Резервы', 'Возвраты'];

const TODAY: Array<{ title: string; hint: string; amount: string; tone: string; note: string }> = [
  {
    title: 'Перевод · Айгуль Т.',
    hint: '+7 701 555 22 11 · обед · TRANSFER',
    amount: '−1 500,00 ₸',
    tone: 'text-brand-700',
    note: 'остаток после операции: 5 000,00 ₸',
  },
  {
    title: 'Резерв под заказ · ORTA Market',
    hint: '01J8ZQ…7K · HOLD · истекает 8 окт, 22:30',
    amount: 'заморожено 1 200,00 ₸',
    tone: 'text-warning-700',
    note: 'это не списание: деньги остаются на счёте',
  },
];

const YESTERDAY: Array<{ title: string; hint: string; amount: string; tone: string }> = [
  {
    title: 'Возврат · заказ 01J8ZP…2M',
    hint: 'частичный · REFUND · 2 из 3 товаров',
    amount: '+2 490,00 ₸',
    tone: 'text-success-700',
  },
];

export default function Platform08Screen() {
  return (
    <>
      <PhoneAppBar
        back
        title="История операций"
        subtitle="Выписка по леджжеру · новые сверху"
        right={<Badge tone="success">работает</Badge>}
      />
      <PhoneBody>
        <Chips items={FILTERS} active="Все" />

        <div>
          <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-ink-400">8 октября 2026</div>
          <div className="space-y-2">
            {TODAY.map((item) => (
              <PhoneCard key={item.title}>
                <div className="flex items-start justify-between gap-2">
                  <span className="min-w-0">
                    <span className="block truncate text-[12.5px] font-medium text-ink-800">{item.title}</span>
                    <span className="block truncate text-[11px] text-ink-500">{item.hint}</span>
                  </span>
                  <span className={`flex-none text-[12px] font-semibold tabular-nums ${item.tone}`}>{item.amount}</span>
                </div>
                <p className="mt-1 text-[11px] text-ink-400">{item.note}</p>
              </PhoneCard>
            ))}
          </div>
        </div>

        <div>
          <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-ink-400">7 октября 2026</div>
          <div className="space-y-2">
            {YESTERDAY.map((item) => (
              <PhoneCard key={item.title}>
                <div className="flex items-start justify-between gap-2">
                  <span className="min-w-0">
                    <span className="block truncate text-[12.5px] font-medium text-ink-800">{item.title}</span>
                    <span className="block truncate text-[11px] text-ink-500">{item.hint}</span>
                  </span>
                  <span className={`flex-none text-[12px] font-semibold tabular-nums ${item.tone}`}>{item.amount}</span>
                </div>
              </PhoneCard>
            ))}
          </div>
        </div>

        <PhoneCard title="Ссылка на источник">
          <Row label="referenceType" value={<span className="font-mono text-[11.5px]">ORDER / TRIP / BOOKING</span>} />
          <Row label="referenceId" value={<span className="font-mono text-[11.5px]">01J8ZP…2M</span>} />
        </PhoneCard>

        <Notice tone="info">
          <b>Фильтры «Все / Списания / Зачисления» — клиентские.</b> Сервер отдаёт выписку постранично, но фильтра
          по типу и периоду в API нет: сейчас его делает приложение, и это надо заменить серверным.
        </Notice>
      </PhoneBody>
      <PhoneTabBar items={TABS} active="История" />
    </>
  );
}
