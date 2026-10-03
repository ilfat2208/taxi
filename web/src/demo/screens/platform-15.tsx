/**
 * platform-15 · ORTA Map — зоны обслуживания и лицензия карт (телефон, в работе).
 *
 * PostGIS в коде работает — но под треки и геозоны такси, а не под «зоны всех направлений», поэтому
 * контуры на экране помечены как иллюстрация: границы продуктом не утверждены. Отдельным блоком
 * вынесена лицензия: данные OSM под ODbL требуют атрибуции, публичные тайлы OSM непригодны для
 * мобильного приложения под нагрузкой, а дорожный маршрут — это OSRM или коммерческий провайдер.
 * Это решение до запуска, а не деталь вёрстки.
 */
import { Badge } from '../../components/ui/Badge';
import { Notice, PhoneAppBar, PhoneBody, PhoneCard, PhoneTabBar, Placeholder, Row } from '../kit';

const TABS = ['Главная', 'История', 'Переводы', 'Профиль'];

export default function Platform15Screen() {
  return (
    <>
      <PhoneAppBar
        back
        title="Зоны обслуживания"
        subtitle="Пилот: Шымкент · контуры — иллюстрация"
        right={<Badge tone="warning">в работе</Badge>}
      />
      <PhoneBody>
        <Placeholder
          label="Схема зон: A — центр (подача до 60 мин), B — окраины (до 90 мин)"
          className="h-[200px] text-center"
        />

        <PhoneCard title="Зоны">
          <Row label="Зона A · центр" value="такси, доставка, услуги" />
          <Row label="Зона B · окраины" value="только такси и доставка" />
          <Row label="Хранение" value="PostGIS — зоны такси" />
        </PhoneCard>

        <Notice tone="danger">
          <b>Где здесь честность и где лицензия.</b> Геозоны и PostGIS в коде есть, но обслуживают такси:
          границы зон продуктом не утверждены, поэтому полигоны — рисунок. Подложка в консоли —
          OpenStreetMap под ODbL (нужна атрибуция), публичные тайлы для мобильного приложения непригодны —
          нужен свой сервер или провайдер. Маршрут — OSRM: сейчас он рисуется прямой линией.
        </Notice>

        <p className="text-[11px] leading-snug text-ink-500">
          Предлагаемые ручки: <code className="rounded bg-ink-100 px-1">GET /api/v1/geo/zones?lat&amp;lon</code>,{' '}
          <code className="rounded bg-ink-100 px-1">GET /api/v1/geo/route?from&amp;to</code>. Работает радиус и кандидаты:{' '}
          <code className="rounded bg-ink-100 px-1">GET /api/v1/dispatch/nearest</code>.
        </p>
      </PhoneBody>
      <PhoneTabBar items={TABS} active="Главная" />
    </>
  );
}
