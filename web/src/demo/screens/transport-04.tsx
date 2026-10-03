/**
 * transport-04 — ORTA Cargo, подача и грузчики.
 *
 * Состояние ожидания машины: карта-иллюстрация, водитель, бригада грузчиков,
 * экспедитор и таймлайн «холд → машина выехала → погрузка». Деньги показаны
 * честно: зарезервированы, но не списаны.
 */
import { Money, Notice, PhoneBody, PhoneCard, Placeholder } from '../kit';
import { cx } from '../../lib/cx';

const HOLD_MINOR = 3_540_000;

function Step({ title, text, tone, last }: { title: string; text: string; tone: 'done' | 'active' | 'muted'; last?: boolean }) {
  return (
    <div className="flex gap-3">
      <span className="flex flex-col items-center">
        <span
          className={cx(
            'mt-1 h-2.5 w-2.5 flex-none rounded-full',
            tone === 'done' ? 'bg-emerald-500' : tone === 'active' ? 'bg-brand-500' : 'bg-ink-300',
          )}
        />
        {last ? null : <span className="w-px flex-1 bg-ink-200" />}
      </span>
      <div className="min-w-0 pb-2.5">
        <div className={cx('text-[12.5px] font-medium', tone === 'muted' ? 'text-ink-500' : 'text-ink-900')}>{title}</div>
        <div className="text-[11px] text-ink-500">{text}</div>
      </div>
    </div>
  );
}

export default function Transport04() {
  return (
    <PhoneBody className="pt-3">
      <div className="relative">
        <Placeholder label="Карта · иллюстрация борда: прямая линия вместо дорожной геометрии" className="h-[150px]" />
        <span className="absolute left-3 top-3 inline-flex items-center gap-1.5 rounded-full bg-white/95 px-2.5 py-1 text-[11px] font-medium text-success-700 ring-1 ring-ink-200">
          <span className="h-1.5 w-1.5 rounded-full bg-success-500" />
          Машина выехала
        </span>
        <span className="absolute right-3 top-3 rounded-full bg-white/95 px-2.5 py-1 text-[11px] text-ink-600 ring-1 ring-ink-200">
          Подача 6 мин
        </span>
      </div>

      <PhoneCard>
        <div className="flex items-start gap-3">
          <span className="grid h-10 w-10 flex-none place-items-center rounded-full bg-gradient-to-br from-brand-500 to-brand-700 text-[15px] font-semibold text-white">
            Е
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-[13px] font-semibold text-ink-900">Ерлан</span>
            <span className="block text-[11.5px] text-ink-500">★ 4,87 · 214 перевозок</span>
            <span className="mt-0.5 block text-[11.5px] text-ink-500">Газель · тент 3,0 м · 845 KZ 02</span>
          </span>
          <span className="flex-none rounded-full bg-brand-50 px-2 py-0.5 text-[11px] font-medium text-brand-700">6 мин</span>
        </div>
        <div className="mt-3 flex gap-2">
          <span className="flex-1 rounded-xl border border-ink-200 bg-white px-3 py-2 text-center text-[12px] font-medium text-ink-700">
            Позвонить
          </span>
          <span className="flex-1 rounded-xl border border-ink-200 bg-white px-3 py-2 text-center text-[12px] font-medium text-ink-700">
            Написать
          </span>
        </div>
      </PhoneCard>

      <PhoneCard>
        <div className="flex items-center gap-3">
          <span className="min-w-0 flex-1">
            <span className="block text-[12.5px] font-semibold text-ink-900">Грузчики · 2 человека</span>
            <span className="block text-[11px] text-ink-500">выйдут к машине вместе с водителем</span>
          </span>
          <span className="flex-none rounded-full bg-success-50 px-2 py-0.5 text-[11px] font-medium text-success-700">
            подтверждены
          </span>
        </div>
        <div className="mt-2 flex items-center gap-3">
          <span className="min-w-0 flex-1">
            <span className="block text-[12.5px] font-semibold text-ink-900">Экспедитор · Асхат</span>
            <span className="block text-[11px] text-ink-500">принимает груз, подписывает акт</span>
          </span>
          <span className="flex-none rounded-full bg-brand-50 px-2 py-0.5 text-[11px] font-medium text-brand-700">в пути</span>
        </div>
      </PhoneCard>

      <PhoneCard>
        <Step tone="done" title="Оплата зарезервирована" text="9:44 · на холде 35 400,00 ₸, списания ещё нет" />
        <Step tone="active" title="Машина выехала к складу" text="9:46 · 2,4 км до точки А, подача ≈ 6 мин" />
        <Step tone="muted" last title="Погрузка начнётся после подачи" text="40 минут работы двух грузчиков" />
      </PhoneCard>

      <Notice tone="warning">
        <b>Водитель, машина и бригада — демо-данные:</b> заказа перевозки в коде нет. Зарезервировано{' '}
        <Money minor={HOLD_MINOR} />, списания не было.
      </Notice>

      <div className="mt-auto" />
      <div className="rounded-xl px-4 py-2.5 text-center text-[13px] font-medium text-brand-600">Отменить перевозку</div>
    </PhoneBody>
  );
}
