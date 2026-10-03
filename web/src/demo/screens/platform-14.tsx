/**
 * platform-14 · ORTA Map — выбор адреса (телефон, план).
 *
 * Макет: геокодера (текст → координаты) и обратного геокодера (координаты → адрес) в коде нет, как нет
 * и хранения адресов — это часть ORTA ID. Показаны две честные границы: подобранный адрес нужно
 * подтверждать глазами по карте, потому что геокодер ошибается на похожих номерах домов, и адрес
 * с деталями (подъезд, код) полезнее точных координат.
 */
import { Badge } from '../../components/ui/Badge';
import { Notice, PhoneAppBar, PhoneBody, PhoneCard, PhoneTabBar, Placeholder } from '../kit';

const TABS = ['Главная', 'История', 'Переводы', 'Профиль'];

const CANDIDATES: Array<{ title: string; hint: string; badge: string; tone: 'brand' | 'neutral' }> = [
  { title: 'пр. Тауке хана, 24', hint: 'Аль-Фарабийский район · подобран на карте', badge: 'точно', tone: 'brand' },
  { title: 'пр. Тауке хана, 24/1', hint: 'рядом 40 м · проверьте номер дома', badge: 'похожий', tone: 'neutral' },
];

export default function Platform14Screen() {
  return (
    <>
      <PhoneAppBar
        back
        title="Выбор адреса"
        subtitle="ORTA Map · геокодер — план"
        right={<Badge tone="neutral">план</Badge>}
      />
      <PhoneBody>
        <Placeholder label="Схема: точка, куда приедет исполнитель · подложка — рисунок" className="h-[200px] text-center" />

        <div className="flex items-center gap-2 rounded-xl border border-ink-200 bg-white px-3 py-2 text-[13px] text-ink-900">
          <span className="text-ink-400">🔍</span>
          <span className="min-w-0 flex-1 truncate">пр. Тауке хана, 24</span>
          <Badge tone="brand">найти</Badge>
        </div>

        <PhoneCard title="Найденные адреса">
          <div className="divide-y divide-ink-50">
            {CANDIDATES.map((item) => (
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

        <PhoneCard title="Детали адреса" right={<Badge tone="neutral">для курьера</Badge>}>
          <p className="text-[11.5px] leading-snug text-ink-600">
            кв. 42, подъезд 2, код 4200 · домофон не работает, звоните
          </p>
        </PhoneCard>

        <Notice tone="warning">
          <b>Адреса пока негде хранить.</b> «Мои адреса» относятся к ORTA ID, а его в коде нет: адрес вводится
          в поле заказа, но сохранить его как «Дом» — некуда. Предлагаемые ручки:{' '}
          <code className="rounded bg-white/60 px-1">GET /api/v1/geo/geocode</code>,{' '}
          <code className="rounded bg-white/60 px-1">POST /api/v1/me/addresses</code>.
        </Notice>
      </PhoneBody>
      <PhoneTabBar items={TABS} active="Главная" />
    </>
  );
}
