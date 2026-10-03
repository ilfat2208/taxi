/**
 * apps-12 · Маршрут доставки (ORTA Delivery).
 *
 * Статус борда — «План»: позиции курьера слать некуда. POST /api/v1/locations
 * принимает только роль DRIVER и привязывает по проекции userId → driverId из
 * driver.events; у курьера такой проекции нет. Предлагаемые ручки:
 * POST /api/v1/couriers/me/locations и …/tasks/{id}/arrived.
 *
 * Честность экрана: маршрут нарисован как схема на div'ах (не тайлы OSM), а
 * расчёт расстояния приближённый — OSRM не подключён (ADR 0009), поэтому
 * «приближённый» стоит прямо в строке, а не в сноске. Данные демонстрационные.
 */
import { Badge } from '../../components/ui/Badge';
import { Notice, PhoneAppBar, PhoneBody, PhoneCard, PhoneTabBar, Row } from '../kit';

const COURIER_TABS = ['Задания', 'Карта', 'Деньги', 'Профиль'];

/** Схема маршрута доставки: от магазина к получателю. Не тайлы OSM. */
function MapSketch() {
  return (
    <div className="relative h-[186px] shrink-0 overflow-hidden rounded-2xl bg-gradient-to-br from-[#EDF2F5] to-[#E1EAF0] ring-1 ring-ink-200">
      <div className="absolute left-4 top-5 h-11 w-16 rounded-md bg-[#DDE5EA]" />
      <div className="absolute left-24 top-3 h-8 w-14 rounded-md bg-[#DDE5EA]" />
      <div className="absolute left-44 top-6 h-12 w-16 rounded-md bg-[#DDE5EA]" />
      <div className="absolute left-64 top-2 h-10 w-20 rounded-md bg-[#DDE5EA]" />
      <div className="absolute left-6 top-24 h-10 w-14 rounded-md bg-[#DDE5EA]" />
      <div className="absolute left-28 top-20 h-12 w-16 rounded-md bg-[#DDE5EA]" />
      <div className="absolute left-52 top-24 h-10 w-14 rounded-md bg-[#DDE5EA]" />
      <div className="absolute left-72 top-20 h-12 w-16 rounded-md bg-[#DDE5EA]" />
      <div className="absolute left-14 top-40 h-10 w-16 rounded-md bg-[#DDE5EA]" />
      <div className="absolute left-52 top-44 h-10 w-16 rounded-md bg-[#DDE5EA]" />

      <div className="absolute -left-6 top-[116px] h-[11px] w-[420px] -rotate-[7deg] rounded-full bg-white" />
      <div className="absolute -left-6 top-[164px] h-[11px] w-[420px] -rotate-[7deg] rounded-full bg-white" />
      <div className="absolute left-[104px] -top-3 h-[240px] w-[11px] rotate-[6deg] rounded-full bg-white" />
      <div className="absolute left-[240px] -top-3 h-[240px] w-[10px] rotate-[6deg] rounded-full bg-white" />

      <div className="absolute left-[68px] top-[142px] h-0 w-[216px] -rotate-[26deg] border-t-[3px] border-dashed border-[#0F6E8C]" />
      <div className="absolute left-[48px] top-[128px] h-3.5 w-3.5 rounded-full bg-white ring-[3px] ring-[#0F6E8C]" />
      <div className="absolute left-[262px] top-[88px] grid h-[22px] w-[22px] place-items-center rounded-full bg-[#0F6E8C] text-[10px] font-bold text-white ring-[3px] ring-white">
        Б
      </div>

      <span className="absolute left-2.5 top-2.5 rounded-full bg-white/95 px-2.5 py-1 text-[11px] font-medium text-ink-800 shadow-sm">
        4,2 км · 14 мин
      </span>
      <span className="absolute right-2.5 top-2.5 rounded-full bg-white/95 px-2.5 py-1 text-[11px] text-ink-600 shadow-sm">
        GPS ±8 м
      </span>
      <div className="absolute bottom-2.5 left-2.5 flex items-center gap-3 rounded-full bg-white/95 px-2.5 py-1 text-[10.5px] text-ink-500 shadow-sm">
        <span className="flex items-center gap-1">
          <span className="h-2 w-2 rounded-full bg-[#0F6E8C]" />маршрут доставки
        </span>
        <span>схема, не тайлы OSM</span>
      </div>
    </div>
  );
}

export default function Apps12() {
  return (
    <>
      <PhoneAppBar
        title="Маршрут доставки"
        subtitle="вы на пр. Республики · 15:02"
        right={<Badge tone="info">в пути</Badge>}
      />
      <PhoneBody>
        <MapSketch />

        <PhoneCard className="shrink-0">
          <Row label="Точка Б" value="ул. Байтурсынова, 42" strong />
          <Row label="Осталось" value="4,2 км · 14 мин" />
          <Row label="Расчёт маршрута" value="приближённый" />
        </PhoneCard>

        <Notice tone="info">
          <b>OSRM ещё не подключён.</b> Расстояние — по большому кругу с коэффициентом дороги, время — по средней
          скорости (ADR 0009); навигация уходит во внешние карты.
        </Notice>

        <Notice tone="warning">
          <b>Курьер в приём позиций не входит:</b>{' '}
          <span className="font-mono">POST /api/v1/locations</span> берёт только роль DRIVER. Предлагается{' '}
          <span className="font-mono">POST /api/v1/couriers/me/locations</span>.
        </Notice>

        <div className="flex shrink-0 flex-col gap-2">
          <div className="rounded-xl bg-[#0F6E8C] px-3 py-2.5 text-center text-[13px] font-semibold text-white">
            Открыть в навигации
          </div>
          <div className="rounded-xl bg-ink-100 px-3 py-2.5 text-center text-[13px] font-semibold text-ink-700">
            Я на месте
          </div>
        </div>
      </PhoneBody>
      <PhoneTabBar items={COURIER_TABS} active="Карта" />
    </>
  );
}
