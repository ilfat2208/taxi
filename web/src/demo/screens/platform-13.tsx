/**
 * platform-13 · ORTA Map — «рядом со мной» (телефон, в работе).
 *
 * Работает нижний слой и одна метка из пяти: поиск машин через Redis GEO,
 * `GET /api/v1/dispatch/nearest?lat&lon&radiusM&limit`, живая карта диспетчера в
 * `web/src/pages/DispatchPage.tsx`. Слои компаний, мастеров и курьеров — макет: общей карты объектов
 * экосистемы в коде нет. Иллюстрация на экране — не тайлы OSM, а схема: публичные тайлы для
 * мобильного приложения непригодны, о лицензии — экран «Зоны и лицензия».
 */
import { Badge } from '../../components/ui/Badge';
import { Chips, PhoneAppBar, PhoneBody, PhoneCard, PhoneTabBar, Placeholder } from '../kit';

const TABS = ['Главная', 'История', 'Переводы', 'Профиль'];
const LAYERS = ['Всё', 'Машины', 'Мастера', 'Курьеры', 'Компании'];

const NEARBY: Array<{ title: string; hint: string; badge: string; tone: 'success' | 'warning' | 'neutral' }> = [
  {
    title: 'Машина такси · 4 мин',
    hint: '0,6 км · GET /api/v1/dispatch/nearest',
    badge: 'работает',
    tone: 'success',
  },
  {
    title: 'Мастер по кондиционерам',
    hint: '0,9 км · 4,8 ★ · свободен сегодня',
    badge: 'план',
    tone: 'warning',
  },
  {
    title: 'Курьер · 1,2 км',
    hint: 'вертикали доставки пока нет',
    badge: 'план',
    tone: 'neutral',
  },
];

export default function Platform13Screen() {
  return (
    <>
      <PhoneAppBar title="Рядом со мной" subtitle="Радиус 1,5 км · Шымкент" right={<Badge tone="warning">в работе</Badge>} />
      <PhoneBody>
        <Placeholder label="Схема района, не тайлы OSM · метки: машины, мастера, салоны, магазины" className="h-[220px] text-center" />

        <Chips items={LAYERS} active="Всё" />

        <PhoneCard title="Что нашлось рядом">
          <div className="divide-y divide-ink-50">
            {NEARBY.map((item) => (
              <div key={item.title} className="flex items-center justify-between gap-2 py-2">
                <span className="min-w-0">
                  <span className="block truncate text-[12.5px] font-medium text-ink-800">{item.title}</span>
                  <span className="block truncate text-[11px] text-ink-500">{item.hint}</span>
                </span>
                <Badge tone={item.tone}>{item.badge}</Badge>
              </div>
            ))}
          </div>
        </PhoneCard>

        <p className="text-[11px] leading-snug text-ink-500">
          Слои компаний, мастеров и курьеров — макет: карта умеет только машины такси. Гео в коде есть:
          Redis GEO для «кто рядом», PostGIS для треков и зон. Дорожный маршрут требует OSRM — сейчас это прямая линия.
        </p>
      </PhoneBody>
      <PhoneTabBar items={TABS} active="Главная" />
    </>
  );
}
