/**
 * home-food-02 · ORTA Home — карточка объекта.
 *
 * Что на экране: галерея объекта (плейсхолдер), цена и цена за метр, характеристики,
 * планировка, продавец и два действия — запись на просмотр и переход к проверке.
 *
 * Честно: фотографии и планировка — градиентные плейсхолдеры, загрузки медиа в ORTA ID
 * нет; цена — демо-число. Кнопки нарисованы, но никуда не ведут: экран макета.
 */
import { Badge } from '../../components/ui/Badge';
import { Money, Notice, PhoneAppBar, PhoneBody, PhoneCard, PhoneTabBar, Placeholder, Row } from '../kit';

const TABS = ['Home', 'Food', 'Tickets', 'Build', 'Rent'];

const SPECS: Array<{ label: string; value: string }> = [
  { label: 'Площадь', value: '68 м² · жилая 44 м² · кухня 9 м²' },
  { label: 'Комнаты · санузел', value: '2 · раздельный' },
  { label: 'Этаж', value: '4 из 9 · панельный дом, 2019 г.' },
  { label: 'Ремонт · мебель · отопление', value: 'есть · частично · центральное' },
];

export default function HomeFood02() {
  return (
    <>
      <PhoneAppBar title="2-комн. квартира, 68 м²" subtitle="ID 01M7HM4K2Q · ул. Тауке хана, 83" back />
      <PhoneBody>
        <div className="relative">
          <Placeholder
            label="фото 1 из 12 — плейсхолдер"
            className="wrap-anywhere h-[44px] w-full px-6 text-center leading-tight"
          />
          <span className="absolute bottom-2 right-2 rounded-full bg-white/90 px-2 py-1 text-[10px] text-ink-700 shadow-sm">
            12 фото · 1 планировка
          </span>
        </div>

        <PhoneCard title="Об объекте" right={<Badge tone="success">Без обременений</Badge>}>
          <div className="space-y-1">
            <div className="flex items-baseline justify-between gap-2">
              <Money minor={2_490_000_000} />
              <Badge tone="neutral">Продажа · торг уместен</Badge>
            </div>
            <div className="text-[11.5px] text-ink-500">
              <Money minor={36_617_600} /> за м² · демо-цена
            </div>
            <div className="pt-1">
              {SPECS.map((spec) => (
                <Row key={spec.label} label={spec.label} value={spec.value} />
              ))}
            </div>
          </div>
        </PhoneCard>

        <PhoneCard title="Планировка">
          <div className="flex items-center gap-2.5">
            <Placeholder
              label="план — плейсхолдер"
              className="wrap-anywhere h-[40px] w-[64px] flex-none text-center text-[10px]! leading-tight"
            />
            <div className="min-w-0 flex-1">
              <div className="text-[12px] text-ink-700">Кухня-гостиная 26 · спальня 16 · спальня 14 · санузел 4 м²</div>
            </div>
            <span className="text-[12px] font-medium text-brand-600">Открыть</span>
          </div>
        </PhoneCard>

        <PhoneCard title="Продавец">
          <div className="flex items-center gap-2.5">
            <span className="grid h-9 w-9 flex-none place-items-center rounded-full bg-brand-100 text-[13px] font-semibold text-brand-700">
              Ш
            </span>
            <div className="min-w-0 flex-1">
              <div className="truncate text-[12.5px] font-semibold text-ink-900">Агентство «Шымкент-Недвижимость»</div>
              <div className="truncate text-[11.5px] text-ink-500">4,6 · 318 объявлений · отвечает за 12 минут</div>
            </div>
          </div>
        </PhoneCard>

        <Notice>Фото и планировка — плейсхолдеры: медиа в ORTA ID нет.</Notice>

        <div className="rounded-xl bg-brand-500 px-4 py-1.5 text-center text-[13px] font-semibold text-white">
          Записаться на просмотр
        </div>
        <div className="rounded-xl border border-ink-200 bg-white px-4 py-1.5 text-center text-[13px] font-semibold text-ink-700">
          Проверить собственность
        </div>
      </PhoneBody>
      <PhoneTabBar items={TABS} active="Home" />
    </>
  );
}
