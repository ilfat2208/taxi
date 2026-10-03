/**
 * apps-04 · Маршрут к пассажиру и начало поездки (приложение водителя).
 *
 * Статус борда — «В работе»: переходы поездки настоящие —
 * POST /api/v1/trips/internal/{tripId}/arrive и /start, события
 * trip.driver.arrived и trip.started. Приложения mobile/driver нет.
 *
 * Честность экрана: автомобиль в driver-service не смоделирован (ни марки, ни
 * номера), телефона пассажира в API поездки нет, отменить поездку водитель не
 * может — cancel открыт владельцу, диспетчеру, поддержке и админу.
 * Карта — схема на div'ах, не тайлы OSM. Данные демонстрационные.
 */
import { Badge } from '../../components/ui/Badge';
import { Money, Notice, PhoneAppBar, PhoneBody, PhoneCard } from '../kit';

/** Схема: водитель у точки А, пассажир ждёт у точки Б. Не тайлы OSM. */
function MapSketch() {
  return (
    <div className="relative h-[158px] shrink-0 overflow-hidden rounded-2xl bg-gradient-to-br from-[#EEF2F7] to-[#E3EAF3] ring-1 ring-ink-200">
      <div className="absolute left-4 top-4 h-10 w-14 rounded-md bg-[#DFE5EC]" />
      <div className="absolute left-26 top-2 h-9 w-16 rounded-md bg-[#DFE5EC]" />
      <div className="absolute left-48 top-4 h-11 w-14 rounded-md bg-[#DFE5EC]" />
      <div className="absolute left-70 top-2 h-9 w-16 rounded-md bg-[#DFE5EC]" />
      <div className="absolute left-8 top-24 h-10 w-14 rounded-md bg-[#DFE5EC]" />
      <div className="absolute left-36 top-26 h-10 w-16 rounded-md bg-[#DFE5EC]" />
      <div className="absolute left-64 top-24 h-11 w-16 rounded-md bg-[#DFE5EC]" />

      <div className="absolute -left-6 top-[86px] h-[11px] w-[420px] -rotate-[7deg] rounded-full bg-white" />
      <div className="absolute -left-6 top-[128px] h-[10px] w-[420px] -rotate-[7deg] rounded-full bg-white" />
      <div className="absolute left-[112px] -top-3 h-[220px] w-[11px] rotate-[6deg] rounded-full bg-white" />
      <div className="absolute left-[250px] -top-3 h-[220px] w-[10px] rotate-[6deg] rounded-full bg-white" />

      <div className="absolute left-[62px] top-[100px] h-0 w-[210px] -rotate-[6deg] border-t-[3px] border-dashed border-brand-500" />
      <div className="absolute left-[44px] top-[86px] grid h-[22px] w-[22px] place-items-center rounded-full bg-brand-500 text-[10px] font-bold text-white ring-[3px] ring-white">
        А
      </div>
      <div className="absolute left-[262px] top-[94px] grid h-[22px] w-[22px] place-items-center rounded-full bg-[#0E7C7B] text-[10px] font-bold text-white ring-[3px] ring-white">
        Б
      </div>

      <span className="absolute left-2.5 top-2.5 rounded-full bg-white/95 px-2.5 py-1 text-[11px] font-medium text-ink-800 shadow-sm">
        До пассажира 4 мин · 1,2 км
      </span>
      <span className="absolute right-2.5 top-2.5 rounded-full bg-white/95 px-2.5 py-1 text-[11px] text-ink-600 shadow-sm">
        GPS ±6 м
      </span>
      <div className="absolute bottom-2.5 left-2.5 flex items-center gap-3 rounded-full bg-white/95 px-2.5 py-1 text-[10.5px] text-ink-500 shadow-sm">
        <span className="flex items-center gap-1">
          <span className="h-2 w-2 rounded-full bg-brand-500" />вы
        </span>
        <span className="flex items-center gap-1">
          <span className="h-2 w-2 rounded-full bg-[#0E7C7B]" />пассажир
        </span>
        <span>схема, не тайлы OSM</span>
      </div>
    </div>
  );
}

export default function Apps04() {
  return (
    <>
      <PhoneAppBar
        title="К пассажиру"
        subtitle="подача выполнена в 10:12"
        back
        right={<Badge tone="success">ARRIVED</Badge>}
      />
      <PhoneBody>
        <MapSketch />

        <PhoneCard className="shrink-0" right={<Money minor={184800} />}>
          <div className="text-[12.5px] text-ink-600">
            Точка Б: пр. Республики, 12 · 6,4 км · 18 мин
          </div>
        </PhoneCard>

        <PhoneCard className="shrink-0">
          <div className="flex gap-2.5">
            <span className="mt-0.5 h-2.5 w-2.5 flex-none rounded-full bg-success-500" />
            <div className="min-w-0 flex-1">
              <div className="text-[12.5px] font-medium text-ink-800">Подал машину · ARRIVED</div>
              <div className="truncate font-mono text-[11px] text-ink-500">
                POST /api/v1/trips/internal/{'{tripId}'}/arrive
              </div>
            </div>
          </div>
          <div className="my-2.5 h-px bg-ink-100" />
          <div className="flex gap-2.5">
            <span className="mt-0.5 h-2.5 w-2.5 flex-none rounded-full bg-ink-300" />
            <div className="min-w-0 flex-1">
              <div className="text-[12.5px] font-medium text-ink-800">Начало поездки ждёт вас</div>
              <div className="text-[11px] text-ink-500">
                дальше — <span className="font-mono">POST …/start</span>, событие trip.started
              </div>
            </div>
          </div>
        </PhoneCard>

        <Notice tone="danger">
          <b>Чего у приложения нет.</b> Автомобиль в <span className="font-mono">driver-service</span> не
          смоделирован: ни марки, ни номера — пассажир машину не увидит, и показать её водителю тоже нечем.
          Телефона пассажира в API поездки нет — позвонить из приложения нельзя. Отменить поездку водитель не
          может: <span className="font-mono">POST /api/v1/trips/{'{tripId}'}/cancel</span> открыт владельцу,
          диспетчеру, поддержке и админу.
        </Notice>

        <div className="flex shrink-0 flex-col gap-2">
          <div className="rounded-xl bg-brand-500 px-3 py-2.5 text-center text-[13px] font-semibold text-white">
            Начать поездку
          </div>
          <div className="rounded-xl px-3 py-2 text-center text-[12.5px] text-ink-500">
            Пассажир не вышел — отмену оформляет диспетчер
          </div>
        </div>
      </PhoneBody>
    </>
  );
}
