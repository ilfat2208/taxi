/**
 * apps-03 · Оффер: цена, адреса, таймер (приложение водителя).
 *
 * Статус борда — «План»: матчинга и веера офферов нет, они в Ф3. Ручки
 * POST /api/v1/drivers/offers/{id}/accept и /decline предлагаются, событие
 * offer.created — тоже предложение. Водителю цена пока не доставляется:
 * push-канала офферов не существует, поэтому экран показывает, как это будет
 * выглядеть, а не как это работает.
 *
 * Цена не выдумана: 1 848,00 ₸ — ответ POST /api/v1/trips/quote, сумма к
 * начислению 1 626,24 ₸ — из чека поездки (комиссия платформы 12%).
 * Карта — схема на div'ах, не тайлы OSM. Данные демонстрационные.
 */
import { Badge } from '../../components/ui/Badge';
import { Money, Notice, PhoneAppBar, PhoneBody, PhoneCard } from '../kit';

/** Схема маршрута: подача → точка Б. Не тайлы OSM. */
function MapSketch() {
  return (
    <div className="relative h-[150px] shrink-0 overflow-hidden rounded-2xl bg-gradient-to-br from-[#EEF2F7] to-[#E3EAF3] ring-1 ring-ink-200">
      <div className="absolute left-4 top-4 h-10 w-14 rounded-md bg-[#DFE5EC]" />
      <div className="absolute left-24 top-2 h-9 w-16 rounded-md bg-[#DFE5EC]" />
      <div className="absolute left-48 top-5 h-11 w-14 rounded-md bg-[#DFE5EC]" />
      <div className="absolute left-72 top-3 h-9 w-16 rounded-md bg-[#DFE5EC]" />
      <div className="absolute left-8 top-24 h-10 w-14 rounded-md bg-[#DFE5EC]" />
      <div className="absolute left-32 top-28 h-9 w-16 rounded-md bg-[#DFE5EC]" />
      <div className="absolute left-64 top-24 h-11 w-16 rounded-md bg-[#DFE5EC]" />

      <div className="absolute -left-6 top-[92px] h-[11px] w-[420px] -rotate-[7deg] rounded-full bg-white" />
      <div className="absolute -left-6 top-[134px] h-[10px] w-[420px] -rotate-[7deg] rounded-full bg-white" />
      <div className="absolute left-[104px] -top-3 h-[220px] w-[11px] rotate-[6deg] rounded-full bg-white" />
      <div className="absolute left-[246px] -top-3 h-[220px] w-[10px] rotate-[6deg] rounded-full bg-white" />

      <div className="absolute left-[74px] top-[96px] h-0 w-[196px] -rotate-[8deg] border-t-[3px] border-dashed border-brand-500" />
      <div className="absolute left-[54px] top-[82px] grid h-[22px] w-[22px] place-items-center rounded-full bg-brand-500 text-[10px] font-bold text-white ring-[3px] ring-white">
        А
      </div>
      <div className="absolute left-[252px] top-[92px] h-3.5 w-3.5 rounded-full bg-white ring-[3px] ring-brand-500" />

      <span className="absolute left-2.5 top-2.5 rounded-full bg-white/95 px-2.5 py-1 text-[11px] font-medium text-ink-800 shadow-sm">
        Подача 4 мин · 1,2 км
      </span>
      <div className="absolute bottom-2.5 left-2.5 flex items-center gap-3 rounded-full bg-white/95 px-2.5 py-1 text-[10.5px] text-ink-500 shadow-sm">
        <span className="flex items-center gap-1">
          <span className="h-2 w-2 rounded-full bg-brand-500" />А · вы
        </span>
        <span className="flex items-center gap-1">
          <span className="h-2 w-2 rounded-full ring-1 ring-brand-500" />Б · пассажир
        </span>
        <span>схема, не тайлы OSM</span>
      </div>
    </div>
  );
}

export default function Apps03() {
  return (
    <>
      <PhoneAppBar
        title="Новый заказ"
        subtitle="Комфорт · веер на 3 водителей"
        back
        right={<Badge tone="brand">0:12</Badge>}
      />
      <PhoneBody>
        <MapSketch />

        <PhoneCard className="shrink-0">
          <div className="flex items-baseline justify-between gap-3">
            <div className="text-[24px] font-bold leading-7">
              <Money minor={184800} />
            </div>
            <span className="text-[11.5px] text-ink-500">цель поездки 6,4 км · 18 мин</span>
          </div>
          <div className="mt-2.5 h-1.5 w-full overflow-hidden rounded-full bg-ink-100">
            <span className="block h-full w-4/5 rounded-full bg-brand-500" />
          </div>
          <div className="mt-1.5 text-[11px] text-ink-400">оффер держится 15 секунд · осталось 12</div>
        </PhoneCard>

        <PhoneCard title="Адреса" className="shrink-0">
          <div className="flex gap-2.5">
            <div className="flex flex-none flex-col items-center pt-1">
              <span className="h-2.5 w-2.5 rounded-full bg-brand-500" />
              <span className="my-1 h-5 w-0.5 bg-ink-200" />
              <span className="h-2.5 w-2.5 rounded-[3px] bg-[#0E7C7B]" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-[13px] font-semibold text-ink-900">пр. Тауке хана, 60</div>
              <div className="text-[11.5px] text-ink-500">подача 4 мин · площадь Ордабасы</div>
              <div className="mt-2 text-[13px] font-semibold text-ink-900">пр. Республики, 12</div>
              <div className="text-[11.5px] text-ink-500">точка Б · центр Шымкента</div>
            </div>
          </div>
        </PhoneCard>

        <Notice tone="warning">
          <b>Офферов в API нет — это план.</b> Ни матчинга, ни таймаута, ни push-события{' '}
          <span className="font-mono">offer.created</span>: до водителя цена сейчас не доставляется вообще.
          Предлагаемые ручки — <span className="font-mono">POST /api/v1/drivers/offers/{'{id}'}/accept</span> и{' '}
          <span className="font-mono">/decline</span>. Суммы выше настоящие: 1 848,00 ₸ отвечает{' '}
          <span className="font-mono">POST /api/v1/trips/quote</span>, доход 1 626,24 ₸ — из чека поездки.
        </Notice>

        <div className="flex shrink-0 gap-2.5">
          <div className="flex-1 rounded-xl bg-ink-100 px-3 py-2.5 text-center text-[13px] font-semibold text-ink-700">
            Отклонить
          </div>
          <div className="flex-1 rounded-xl bg-brand-500 px-3 py-2.5 text-center text-[13px] font-semibold text-white">
            Принять
          </div>
        </div>
      </PhoneBody>
    </>
  );
}
