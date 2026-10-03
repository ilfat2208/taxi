/**
 * ops-12 · Админка · тарифы такси по городам, зоны и наценки.
 *
 * Честность экрана: таблиц тарифов, зон и наценок в коде нет — это предложение. Реально существуют
 * только следы: POST /api/v1/trips/quote принимает tariff строкой (иначе 400 INVALID_TARIFF), комиссия
 * считается в базисных пунктах (commissionBp 1200 = 12%), разбивка «база / километры / минуты»
 * приходит в котировке, а surgeBp в демо всегда 0. База 400,00 ₸, 150,00 ₸ за километр и комиссия 12%
 * видны в живом чеке; минимальная цена, зоны и множители — демо-предложение.
 */
import { Badge } from '../../components/ui/Badge';
import { Chips, ConsolePanel, Money, Notice, Row } from '../kit';

export default function Ops12Tariffs() {
  return (
    <>
      <div className="flex flex-none items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[15px] font-bold tracking-tight text-ink-900">Тарифы такси по городам</div>
          <div className="truncate text-[12px] text-ink-500">
            База, километр, минута, минимальная цена и комиссия в базисных пунктах
          </div>
        </div>
        <div className="flex flex-none items-center gap-2">
          <Badge tone="brand">пилот: Шымкент</Badge>
          <span className="rounded-xl bg-white px-3 py-1.5 text-[12px] text-ink-600 ring-1 ring-ink-200">
            Опубликовать
          </span>
        </div>
      </div>

      <div className="flex-none">
        <Chips items={['Эконом', 'Комфорт', 'Бизнес']} active="Эконом" />
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-2 gap-3">
        <ConsolePanel title="Тариф «Эконом» · Шымкент" right={<Badge tone="neutral">черновик</Badge>}>
          <Row label="Посадка (база)" value={<Money minor={40000} />} />
          <Row label="За километр" value={<Money minor={15000} />} />
          <Row label="За минуту" value={<Money minor={2700} />} />
          <Row label="Минимальная цена" value={<Money minor={50000} />} />
          <Row label="Комиссия платформы" value="1 200 bp · 12,00%" strong />
          <Row label="Валюта" value="KZT" />
          <div className="my-2 border-t border-ink-100" />
          <div className="flex items-center gap-2">
            <span className="rounded-xl bg-ink-100 px-3 py-2 text-[12px] font-medium text-ink-400">
              Сохранить · недоступно
            </span>
            <span className="rounded-xl bg-white px-3 py-2 text-[12px] font-medium text-ink-700 ring-1 ring-ink-200">
              Проверить маршрут
            </span>
          </div>
          <div className="mt-2">
            <Notice tone="warning">
              <b>Экран — предложение.</b> Таблицы тарифов в коде нет:{' '}
              <span className="font-mono">POST /api/v1/trips/quote</span> принимает{' '}
              <span className="font-mono">tariff</span> строкой (иначе{' '}
              <span className="font-mono">400 INVALID_TARIFF</span>), а разбивка приходит в ответе. Предлагаемые ручки:{' '}
              <span className="font-mono">GET/PUT /api/v1/admin/tariffs?city=</span>,{' '}
              <span className="font-mono">POST /api/v1/admin/tariffs/{'{id}'}/publish</span>.
            </Notice>
          </div>
        </ConsolePanel>

        <ConsolePanel title="Зоны и наценки">
          <div className="relative h-[132px] overflow-hidden rounded-xl bg-ink-50">
            <div className="absolute left-[33%] top-[26%] w-[34%] rounded-xl border-2 border-brand-500 bg-brand-100/70 px-2 py-1 text-[10px] font-semibold text-brand-700">
              Центр ×1,0
            </div>
            <div className="absolute left-[4%] top-[7%] w-[27%] rounded-xl border-2 border-dashed border-warning-500 bg-warning-50 px-2 py-1 text-[10px] font-semibold text-warning-700">
              Аэропорт ×1,3
            </div>
            <div className="absolute bottom-[7%] right-[4%] w-[27%] rounded-xl border-2 border-dashed border-info-500 bg-info-50 px-2 py-1 text-[10px] font-semibold text-info-700">
              Вокзал ×1,2
            </div>
          </div>
          <div className="mt-2">
            <Row label="Центр · постоянно" value="×1,0" />
            <Row label="Аэропорт · 05:00–24:00" value="×1,3" />
            <Row label="Вокзал · 07:00–22:00" value="×1,2" />
            <Row label="Час пик · 07:30–09:30" value="×1,15" />
          </div>
          <div className="mt-2 text-[11px] text-ink-500">
            Наценка уходит в котировку как <span className="font-mono">surgeBp</span>; в демо всегда 0. Схема зон —
            иллюстрация макета, не тайлы карты; множители — демо-предложение.
          </div>
        </ConsolePanel>
      </div>

      <Notice tone="info">
        <b>Что взято из живого чека, а что придумано.</b> База 400,00 ₸, километр 150,00 ₸ и комиссия 1 200 bp (12%)
        видны в чеке завершённой поездки: 400,00 + 960,00 + 488,00 = 1 848,00 ₸, водителю 1 626,24 ₸. Минимальная цена,
        минута (27,00 ₸) и множители зон — демо-предложение: таблицы тарифов в коде нет, тариф приходит строкой.
      </Notice>
    </>
  );
}
