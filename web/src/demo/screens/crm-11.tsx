/**
 * crm-11 · Услуги и прайс.
 *
 * Услуги, длительность и цена приходят в ответе компании. Длительность — не украшение
 * карточки, а арифметика окна: 90-минутная услуга не влезает в получасовое окно перед
 * обедом и получает 422 с причиной BREAK, а 30-минутная в то же время проходит. Цена
 * хранится в минорных единицах и снапшотится в запись, поэтому правка прайса не
 * переписывает прошлые визиты.
 *
 * Чего нет: признак «общая услуга салона или личная мастера» в ответе не передаётся,
 * хотя в базе он есть (service_item.specialist_id); создания и правки услуг тоже нет.
 */
import { Badge } from '../../components/ui/Badge';
import { ConsolePanel, ConsoleTable, Money, Notice } from '../kit';

const COLUMNS = ['Услуга', 'Длительность', 'Цена', 'Кому'];

const SERVICES: Array<{ title: string; minutes: number; minor: number; owner: string; personal: boolean }> = [
  { title: 'Маникюр с покрытием', minutes: 90, minor: 450000, owner: 'общая услуга салона', personal: false },
  { title: 'Педикюр', minutes: 75, minor: 550000, owner: 'общая услуга салона', personal: false },
  { title: 'Женская стрижка', minutes: 60, minor: 600000, owner: 'общая услуга салона', personal: false },
  { title: 'Окрашивание в один тон', minutes: 120, minor: 1500000, owner: 'общая услуга салона', personal: false },
  { title: 'Укладка волос', minutes: 45, minor: 400000, owner: 'общая услуга салона', personal: false },
  { title: 'Чистка лица', minutes: 60, minor: 900000, owner: 'общая услуга салона', personal: false },
  { title: 'Наращивание ресниц', minutes: 120, minor: 1200000, owner: 'личная · Айгуль Смагулова', personal: true },
  { title: 'Пилинг лица', minutes: 45, minor: 700000, owner: 'личная · Жанар Оспанова', personal: true },
];

const ROWS = SERVICES.map((service) => [
  <span className="text-ink-800">{service.title}</span>,
  `${service.minutes} мин`,
  <Money minor={service.minor} />,
  <span className={service.personal ? 'font-medium text-brand-700' : 'text-ink-500'}>{service.owner}</span>,
]);

export default function CrmServices() {
  return (
    <>
      <div className="flex items-center gap-2">
        <div className="min-w-0">
          <div className="truncate text-[13px] font-semibold text-ink-900">Услуги и прайс</div>
          <div className="truncate text-[11.5px] text-ink-500">
            Салон красоты «Лотос» · 8 услуг · от 4 000 ₸ · цена и минуты — снапшот в записи
          </div>
        </div>
        <span className="ml-auto flex items-center gap-2">
          <Badge tone="brand">Все</Badge>
          <span className="rounded-full bg-white px-3 py-1.5 text-[12px] text-ink-600 ring-1 ring-ink-200">+ Услуга</span>
        </span>
      </div>

      <ConsolePanel
        title="Прайс салона"
        right={<span className="text-[11px] text-ink-500">6 общих услуг и 2 личные · durationMinutes, priceMinor, currency</span>}
      >
        <ConsoleTable columns={COLUMNS} rows={ROWS} />
      </ConsolePanel>

      <div className="grid grid-cols-2 gap-3">
        <Notice tone="info">
          <b>Длительность — это арифметика окна.</b> 90-минутный маникюр не влезает в получасовое окно перед обедом и
          получает <code className="rounded bg-black/5 px-1 font-mono text-[11px]">422 OUTSIDE_WORKING_HOURS</code> с
          причиной <code className="rounded bg-black/5 px-1 font-mono text-[11px]">BREAK</code>. Пересечение считается по
          интервалам, а не по времени начала. Ограничения модели: 5–1 440 минут, price_minor ≥ 0.
        </Notice>
        <Notice tone="warning">
          <b>Чего в ответе API нет.</b> Деление на общие и личные услуги живёт в базе
          (<code className="rounded bg-black/5 px-1 font-mono text-[11px]">service_item.specialist_id</code>), но в
          ServiceView не передаётся: чтобы показать это в консоли, поле нужно добавить в контракт. Создания и правки услуг
          в API тоже нет — прайс показывается, но не редактируется.
        </Notice>
      </div>
    </>
  );
}
