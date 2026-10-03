/**
 * transport-02 — ORTA Cargo, выбор транспорта.
 *
 * Четыре варианта машин под груз из предыдущего экрана: имя, ограничения по
 * весу и объёму, цена и время подачи. Варианты и суммы выдуманы для
 * правдоподобности — справочника типов транспорта в репозитории нет.
 */
import { Notice, PhoneAppBar, PhoneBody, PhoneCard, Money } from '../kit';
import { cx } from '../../lib/cx';

interface VehicleOption {
  key: string;
  mark: string;
  name: string;
  detail: string;
  minor: number;
  eta: string;
  selected: boolean;
}

const VEHICLES: VehicleOption[] = [
  {
    key: 'gazelle',
    mark: 'Г',
    name: 'Газель · тент 3,0 м',
    detail: 'до 1,5 т · 8 м³ · борт откидной',
    minor: 1_840_000,
    eta: 'подача 25 мин',
    selected: true,
  },
  {
    key: 'van',
    mark: 'Ф',
    name: 'Фургон · изотермический',
    detail: 'до 1 т · 6 м³ · без холода',
    minor: 2_190_000,
    eta: 'подача 30 мин',
    selected: false,
  },
  {
    key: 'board',
    mark: 'Б',
    name: 'Бортовой · манипулятор',
    detail: 'до 5 т · 20 м³ · кран 3 т',
    minor: 3_250_000,
    eta: 'подача 40 мин',
    selected: false,
  },
  {
    key: 'reefer',
    mark: 'Р',
    name: 'Рефрижератор',
    detail: 'до 3 т · 14 м³ · режим −18 °C',
    minor: 3_870_000,
    eta: 'подача 50 мин',
    selected: false,
  },
];

function VehicleRow({ item }: { item: VehicleOption }) {
  return (
    <div
      className={cx(
        'flex items-center gap-3 rounded-xl px-2 py-2',
        item.selected ? 'bg-brand-50 ring-1 ring-inset ring-brand-200' : '',
      )}
    >
      <span
        className={cx(
          'grid h-9 w-9 flex-none place-items-center rounded-xl text-[13px] font-semibold',
          item.selected ? 'bg-gradient-to-br from-brand-500 to-brand-700 text-white' : 'bg-ink-100 text-ink-500',
        )}
      >
        {item.mark}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13px] font-semibold text-ink-900">{item.name}</span>
        <span className="block truncate text-[11.5px] text-ink-500">{item.detail}</span>
      </span>
      <span className="flex-none text-right">
        <span className="block text-[12.5px]">
          <Money minor={item.minor} />
        </span>
        <span className="block text-[11px] text-ink-400">{item.eta}</span>
      </span>
    </div>
  );
}

export default function Transport02() {
  return (
    <>
      <PhoneAppBar title="Подходящий транспорт" subtitle="2,4 м³ · ≈ 180 кг · 10,4 км" back />
      <PhoneBody>
        <div className="text-[13px] font-semibold text-ink-800">Что войдёт по габаритам</div>

        <PhoneCard>
          <div className="space-y-1">
            {VEHICLES.map((item) => (
              <VehicleRow key={item.key} item={item} />
            ))}
          </div>
        </PhoneCard>

        <Notice tone="info">
          <b>Варианты и цены — демо-макет.</b> Отсекать машины по габаритам и весу должен сервис, а не
          интерфейс: иначе перегруз заметит водитель у подъезда. Цена фиксируется снимком с ограниченным
          сроком — как котировка поездки в такси.
        </Notice>

        <div className="mt-auto" />
        <div className="rounded-xl bg-brand-500 px-4 py-3 text-center text-[13px] font-semibold text-white">
          Выбрать «Газель» · 18 400 ₸
        </div>
        <div className="text-center text-[11px] text-ink-500">Цена — из котировки, срок жизни снимка цены 10 минут</div>
      </PhoneBody>
    </>
  );
}
