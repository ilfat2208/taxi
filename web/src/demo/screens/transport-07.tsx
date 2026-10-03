/**
 * transport-07 — ORTA Auto, мой автомобиль.
 *
 * Гараж как точка входа в авто-экосистему: карточка машины, пробег и полис,
 * четыре быстрых входа (все честно помечены «Скоро») и напоминание о том, что
 * автомобиль как сущность в коде ещё не заведён.
 */
import { Notice, PhoneAppBar, PhoneBody, PhoneCard, PhoneTabBar, Row } from '../kit';

const SHORTCUTS: Array<{ title: string; hint: string; mark: string }> = [
  { title: 'СТО и ремонт', hint: 'запись через QTime', mark: 'С' },
  { title: 'Автомойка', hint: 'комплекс и детейлинг', mark: 'М' },
  { title: 'Шиномонтаж', hint: 'сезонная смена', mark: 'Ш' },
  { title: 'Диагностика', hint: 'коды ошибок и смета', mark: 'Д' },
];

export default function Transport07() {
  return (
    <>
      <PhoneAppBar
        title="ORTA Auto"
        subtitle="Авто-экосистема · Шымкент · демо-данные"
        right={
          <span className="grid h-9 w-9 place-items-center rounded-xl bg-gradient-to-br from-ink-700 to-ink-900 text-[13px] font-bold text-white">
            A
          </span>
        }
      />
      <PhoneBody>
        <PhoneCard>
          <div className="flex items-center gap-3">
            <span className="grid h-11 w-11 flex-none place-items-center rounded-xl bg-gradient-to-br from-ink-700 to-ink-900 text-[15px] font-semibold text-white">
              T
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[13px] font-semibold text-ink-900">Toyota Camry 2.5</span>
              <span className="block truncate text-[11.5px] text-ink-500">727 ABC 02 · 2019 · 84 200 км</span>
            </span>
            <span className="flex-none rounded-full bg-ink-100 px-2 py-0.5 text-[11px] text-ink-600">в гараже</span>
          </div>
          <div className="mt-2 border-t border-ink-100 pt-1">
            <Row label="Следующее ТО" value="через 1 400 км" />
            <Row label="Страховка ОГПО" value="до 14.03.2027" />
          </div>
        </PhoneCard>

        <div>
          <div className="mb-2 text-[13px] font-semibold text-ink-800">Что нужно</div>
          <div className="grid grid-cols-2 gap-2">
            {SHORTCUTS.map((item) => (
              <div key={item.title} className="relative rounded-2xl border border-ink-200 bg-white p-3">
                <span className="absolute right-2 top-2 rounded-full bg-ink-100 px-2 py-0.5 text-[10px] text-ink-500">
                  Скоро
                </span>
                <span className="grid h-8 w-8 place-items-center rounded-xl bg-gradient-to-br from-brand-100 to-ink-200 text-[13px] font-semibold text-ink-700">
                  {item.mark}
                </span>
                <div className="mt-2 text-[13px] font-semibold text-ink-900">{item.title}</div>
                <div className="text-[11px] text-ink-500">{item.hint}</div>
              </div>
            ))}
          </div>
        </div>

        <Notice tone="neutral">
          <b>Автомобиль в коде ещё не смоделирован.</b> driver-service знает водителя и его документы со
          сроком, но не машину: марка, номер и пробег — демонстрационные данные макета. Четыре входа выше
          помечены «Скоро» честно.
        </Notice>

        <div className="mt-auto" />
        <div className="rounded-xl bg-brand-500 px-4 py-3 text-center text-[13px] font-semibold text-white">Записаться на ТО</div>
      </PhoneBody>
      <PhoneTabBar items={['Гараж', 'Запись', 'История', 'Профиль']} active="Гараж" />
    </>
  );
}
