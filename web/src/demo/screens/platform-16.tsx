/**
 * platform-16 · ORTA AI — ассистент в приложении (телефон, план).
 *
 * AI-слоя в коде нет, и раньше платформы он появиться не может: чтобы предложить окно, он вызывает
 * QTime, чтобы посчитать время — ORTA Map, чтобы зарезервировать деньги — ORTA Pay. На экране три
 * сценария: подсказка по расходам, повтор прошлого заказа и запись на услугу. Ключевое слово —
 * «черновик»: ассистент показывает найденное, но не выполняет. Все суммы и окна — демо.
 */
import { Badge } from '../../components/ui/Badge';
import { Notice, PhoneAppBar, PhoneBody, PhoneCard, PhoneTabBar, Row } from '../kit';

const TABS = ['Главная', 'История', 'Переводы', 'Профиль'];

const WINDOWS: Array<{ time: string; place: string; hint: string; price: string }> = [
  { time: '12:30', place: 'Студия «Айгуль»', hint: '1,4 км · Айгуль, 4,9 ★ · маникюр 90 мин · QTime', price: '8 000 ₸' },
  { time: '15:00', place: 'Салон «Мия»', hint: '2,2 км · Дина, 4,7 ★ · маникюр 75 мин', price: '6 500 ₸' },
  { time: '18:00', place: 'Студия «Айгуль»', hint: '1,4 км · Айгуль, 4,9 ★ · 90 мин', price: '8 000 ₸' },
];

export default function Platform16Screen() {
  return (
    <>
      <PhoneAppBar title="ORTA AI" subtitle="Ассистент · черновик, не действие" right={<Badge tone="neutral">план</Badge>} />
      <PhoneBody>
        <div className="rounded-2xl border border-ink-200 bg-white px-3 py-2 text-[12px] text-ink-700">
          Расходы выросли на 18%: такси — 4 поездки, две по одному маршруту в 08:40.
        </div>
        <div className="rounded-2xl border border-ink-200 bg-white px-3 py-2 text-[12px] text-ink-700">
          Повторить прошлый заказ продуктов? 14 позиций, доставка 19:00–20:00.
        </div>
        <div className="ml-auto max-w-[300px] rounded-2xl bg-brand-500 px-3 py-2 text-[12px] text-white">
          Запиши меня на маникюр в субботу
        </div>

        <PhoneCard title="Нашёл три окна на субботу, 11 октября" right={<Badge tone="neutral">черновик</Badge>}>
          <div className="divide-y divide-ink-50">
            {WINDOWS.map((slot) => (
              <div key={`${slot.time}-${slot.place}`} className="flex items-center gap-2 py-2">
                <span className="grid h-6 w-6 flex-none place-items-center rounded-full bg-ink-100 text-[11px] font-semibold text-ink-600">
                  {slot.time.slice(0, 2)}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[12.5px] font-medium text-ink-800">
                    {slot.time} · {slot.place}
                  </span>
                  <span className="block truncate text-[11px] text-ink-500">{slot.hint}</span>
                </span>
                <span className="flex-none text-[12px] font-semibold tabular-nums text-ink-900">{slot.price}</span>
              </div>
            ))}
          </div>
          <div className="my-1 h-px bg-ink-100" />
          <Row label="Время с дорогой" value="ORTA Map · 22 мин" />
          <Row label="Оплата" value="резерв после подтверждения" />
        </PhoneCard>

        <Notice tone="warning">
          <b>Ничего не выполнено.</b> Окна взяты из расписания, но не заняты: без нажатия «Записаться» ни записи,
          ни резерва нет. Перечень критических действий для ассистента продуктом ещё не утверждён — следующий экран.
        </Notice>
      </PhoneBody>
      <PhoneTabBar items={TABS} active="Главная" />
    </>
  );
}
