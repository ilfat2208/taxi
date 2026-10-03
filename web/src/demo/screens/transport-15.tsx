/**
 * transport-15 — ORTA Delivery, курьер и трекинг посылки.
 *
 * Позиция курьера — та же механика, что уже работает для машин (приём позиции в
 * Redis GEO и поиск ближайших), но переносить её на курьеров «бесплатно» нельзя:
 * dispatch-service привязан к водителям. Курьер, номер отправления и карта —
 * демонстрационные.
 */
import { Notice, PhoneBody, PhoneCard, Placeholder } from '../kit';
import { cx } from '../../lib/cx';

const TRACKING_NUMBER = 'D-8F42Q1';

const STEPS: Array<{ title: string; text: string; tone: 'done' | 'active' | 'muted'; last: boolean }> = [
  { title: 'Заказ создан', text: '13:05 · котировка 2 900,00 ₸, резерв на счёте', tone: 'done', last: false },
  { title: 'Посылка у курьера', text: '13:24 · принята на пр. Республики, 12', tone: 'done', last: false },
  {
    title: 'Вручение по коду получателя',
    text: 'после этого — списание и закрытие заказа',
    tone: 'muted',
    last: true,
  },
];

export default function Transport15() {
  return (
    <PhoneBody className="pt-3">
      <div className="relative">
        <Placeholder label="Карта · иллюстрация борда: прямой маршрут между точками" className="h-[150px]" />
        <span className="absolute left-3 top-3 inline-flex items-center gap-1.5 rounded-full bg-white/95 px-2.5 py-1 text-[11px] font-medium text-success-700 ring-1 ring-ink-200">
          <span className="h-1.5 w-1.5 rounded-full bg-success-500" />
          Курьер назначен
        </span>
        <span className="absolute right-3 top-3 rounded-full bg-white/95 px-2.5 py-1 text-[11px] text-ink-600 ring-1 ring-ink-200">
          доставит к 14:20
        </span>
      </div>

      <PhoneCard>
        <div className="flex items-start gap-3">
          <span className="grid h-10 w-10 flex-none place-items-center rounded-full bg-gradient-to-br from-brand-600 to-brand-800 text-[15px] font-semibold text-white">
            Д
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-[13px] font-semibold text-ink-900">Данияр</span>
            <span className="block text-[11.5px] text-ink-500">★ 4,91 · 340 доставок</span>
            <span className="mt-0.5 block text-[11.5px] text-ink-500">пешком · 1,2 км от точки отправления</span>
          </span>
          <span className="flex-none rounded-full bg-brand-50 px-2 py-0.5 text-[11px] font-medium text-brand-700">к 14:20</span>
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

      <PhoneCard title="Ход доставки">
        {STEPS.map((step) => (
          <div key={step.title} className="flex gap-3">
            <span className="flex flex-col items-center">
              <span
                className={cx(
                  'mt-1 h-2.5 w-2.5 flex-none rounded-full',
                  step.tone === 'done' ? 'bg-emerald-500' : 'bg-ink-300',
                )}
              />
              {step.last ? null : <span className="w-px flex-1 bg-ink-200" />}
            </span>
            <div className="min-w-0 pb-2.5">
              <div className={cx('text-[12.5px] font-medium', step.tone === 'muted' ? 'text-ink-500' : 'text-ink-900')}>
                {step.title}
              </div>
              <div className="text-[11px] text-ink-500">{step.text}</div>
            </div>
          </div>
        ))}
      </PhoneCard>

      <PhoneCard>
        <div className="flex items-center gap-3">
          <span className="min-w-0 flex-1">
            <span className="block text-[11px] text-ink-500">Номер отправления</span>
            <span className="block font-mono text-[13px] font-semibold text-ink-900">{TRACKING_NUMBER}</span>
          </span>
          <span className="flex-none text-[12px] font-medium text-brand-600">Копировать</span>
        </div>
      </PhoneCard>

      <Notice tone="warning">
        <b>Трекинга посылок в коде нет:</b> курьер, номер отправления и карта демонстрационные. Номер — то, что
        человек называет поддержке, если посылка задержится. Позиции курьеров пришлось бы заводить отдельно:
        dispatch-service привязан к водителям.
      </Notice>
    </PhoneBody>
  );
}
