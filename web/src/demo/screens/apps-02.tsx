/**
 * apps-02 · Карта и ожидание заказа (приложение водителя).
 *
 * Статус борда — «В работе»: приём позиций в dispatch-service работает
 * (Redis GEO), смена — в driver-service, а приложения mobile/driver нет.
 *
 * Честность экрана: карта — схема на div'ах, а не тайлы OSM. Позиция уходит
 * каждые 4 секунды (POST /api/v1/locations); без сети телефон копит точки и
 * отдаёт их пачкой (POST /api/v1/locations/batch), у каждой точки своё время.
 * Живой парк водителю не виден: GET /api/v1/dispatch/drivers доступен только
 * диспетчеру и поддержке, водителю — 403 FORBIDDEN_FLEET_ACCESS.
 *
 * Данные демонстрационные: запросов к API экран не делает.
 */
import { Badge } from '../../components/ui/Badge';
import { Notice, PhoneAppBar, PhoneBody, PhoneCard, PhoneTabBar, Row } from '../kit';

const DRIVER_TABS = ['Смена', 'Поездки', 'Деньги', 'Профиль'];

/** Схема местности: кварталы, дороги, радиус поиска и своя метка. */
function MapSketch() {
  return (
    <div className="relative h-[186px] shrink-0 overflow-hidden rounded-2xl bg-gradient-to-br from-[#EEF2F7] to-[#E3EAF3] ring-1 ring-ink-200">
      <div className="absolute left-4 top-5 h-11 w-16 rounded-md bg-[#DFE5EC]" />
      <div className="absolute left-24 top-3 h-8 w-14 rounded-md bg-[#DFE5EC]" />
      <div className="absolute left-44 top-6 h-12 w-16 rounded-md bg-[#DFE5EC]" />
      <div className="absolute left-64 top-2 h-10 w-20 rounded-md bg-[#DFE5EC]" />
      <div className="absolute left-6 top-24 h-10 w-14 rounded-md bg-[#DFE5EC]" />
      <div className="absolute left-28 top-20 h-12 w-16 rounded-md bg-[#DFE5EC]" />
      <div className="absolute left-52 top-24 h-10 w-14 rounded-md bg-[#DFE5EC]" />
      <div className="absolute left-72 top-20 h-12 w-16 rounded-md bg-[#DFE5EC]" />
      <div className="absolute left-8 top-40 h-10 w-16 rounded-md bg-[#DAE9DC]" />
      <div className="absolute left-32 top-44 h-10 w-16 rounded-md bg-[#DFE5EC]" />
      <div className="absolute left-60 top-42 h-10 w-16 rounded-md bg-[#DFE5EC]" />

      {/* дороги */}
      <div className="absolute -left-6 top-[116px] h-[11px] w-[420px] -rotate-[7deg] rounded-full bg-white" />
      <div className="absolute -left-6 top-[172px] h-[11px] w-[420px] -rotate-[7deg] rounded-full bg-white" />
      <div className="absolute left-[104px] -top-3 h-[280px] w-[11px] rotate-[6deg] rounded-full bg-white" />
      <div className="absolute left-[240px] -top-3 h-[280px] w-[10px] rotate-[6deg] rounded-full bg-white" />

      {/* радиус поиска и маршрут */}
      <div className="absolute left-[124px] top-[38px] h-[86px] w-[86px] rounded-full border border-dashed border-brand-500/45" />
      <div className="absolute left-[132px] top-[52px] h-[58px] w-[58px] rounded-full border border-dashed border-brand-500/25" />
      <div className="absolute left-[86px] top-[142px] h-0 w-[168px] -rotate-[10deg] border-t-[3px] border-dashed border-brand-500" />

      {/* подписи улиц — это схема, не настоящие тайлы */}
      <span className="absolute left-3 top-[104px] text-[8.5px] text-ink-400">пр. Тауке хана</span>
      <span className="absolute left-2 top-[196px] text-[8.5px] text-ink-400">пр. Республики</span>
      <span className="absolute right-3 bottom-[26px] text-[8.5px] text-ink-400">Шымкент</span>

      {/* метки */}
      <div className="absolute left-[152px] top-[80px] h-4 w-4 rounded-full bg-brand-500 ring-[3px] ring-white" />
      <div className="absolute left-[58px] top-[128px] grid h-[22px] w-[22px] place-items-center rounded-full bg-brand-500 text-[10px] font-bold text-white ring-[3px] ring-white">
        А
      </div>

      <span className="absolute left-2.5 top-2.5 rounded-full bg-white/95 px-2.5 py-1 text-[11px] font-medium text-ink-800 shadow-sm">
        На линии · 12:04
      </span>
      <span className="absolute right-2.5 top-2.5 rounded-full bg-white/95 px-2.5 py-1 text-[11px] text-ink-600 shadow-sm">
        GPS ±6 м
      </span>
      <div className="absolute bottom-2.5 left-2.5 flex items-center gap-3 rounded-full bg-white/95 px-2.5 py-1 text-[10.5px] text-ink-500 shadow-sm">
        <span className="flex items-center gap-1">
          <span className="h-2 w-2 rounded-full bg-brand-500" />вы
        </span>
        <span className="flex items-center gap-1">
          <span className="h-2 w-2 rounded-full border border-dashed border-brand-500" />радиус поиска
        </span>
        <span>схема, не тайлы OSM</span>
      </div>
    </div>
  );
}

export default function Apps02() {
  return (
    <>
      <PhoneAppBar
        title="Ожидание заказа"
        subtitle="Шымкент · на линии с 12:04"
        right={<Badge tone="success">ONLINE</Badge>}
      />
      <PhoneBody>
        <MapSketch />

        <PhoneCard className="shrink-0">
          <Row label="Позиция ушла" value="3 секунды назад" />
          <Row label="Координаты" value={<span className="font-mono">42.3155, 69.5867</span>} />
          <Row label="Отправка" value="каждые 4 секунды" />
          <Row label="Машин рядом" value="не показываются" strong />
        </PhoneCard>

        <Notice tone="info">
          <b>Связь пропала — точки не теряются.</b> Телефон копит позиции и отдаёт их пачкой:{' '}
          <span className="font-mono">POST /api/v1/locations/batch</span>. У каждой точки своё время — устаревшая
          не выдаст себя за свежую.
        </Notice>

        <Notice tone="warning">
          <b>Пробел: живой парк водителю не виден.</b>{' '}
          <span className="font-mono">GET /api/v1/dispatch/drivers</span> и{' '}
          <span className="font-mono">/dispatch/nearest</span> открыты диспетчеру и поддержке, водителю ответ —
          <span className="font-mono"> 403 FORBIDDEN_FLEET_ACCESS</span>. Без смены позиция не принимается:
          <span className="font-mono"> 409 DRIVER_NOT_ON_DUTY</span>.
        </Notice>

        <div className="shrink-0 rounded-xl bg-ink-100 px-3 py-2.5 text-center text-[13px] font-semibold text-ink-700">
          Уйти с линии
        </div>
      </PhoneBody>
      <PhoneTabBar items={DRIVER_TABS} active="Смена" />
    </>
  );
}
