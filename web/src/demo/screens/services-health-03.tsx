/**
 * ORTA Services — специалисты и прайс (Ф2: раздел работает).
 *
 * Шаги «Специалист» и «Услуга» живут на `/services/:companyId` и кормятся одним
 * ответом компании: `specialists` и `services`. Рейтинг — базисные пункты
 * (49000 = 4,90), цена — `priceMinor` + `currency`, длительность — минуты.
 *
 * Услуга с `specialistId = null` оказывается всеми мастерами, персональная —
 * одним: «Наращивание ресниц» есть только у Айгуль. Чужая услуга вернула бы
 * `SERVICE_NOT_OFFERED_BY_SPECIALIST`, но приложение показывает прайс выбранного
 * мастера и до ошибки не доводит.
 */
import { Badge } from '../../components/ui/Badge';
import { Money, Notice, PhoneAppBar, PhoneBody, PhoneCard, Row } from '../kit';

const SPECIALISTS: Array<{ initial: string; name: string; about: string; selected?: boolean }> = [
  { initial: 'А', name: 'Айгуль Смагулова', about: 'мастер маникюра · стаж 6 лет · ★ 4,9', selected: true },
  { initial: 'Д', name: 'Динара Ахметова', about: 'парикмахер-стилист · стаж 9 лет · ★ 4,8' },
  { initial: 'Ж', name: 'Жанар Оспанова', about: 'косметолог · стаж 4 года · ★ 4,7' },
];

/** Прайс выбранного мастера: цены и длительности — из прайса компании. */
const AIGUL_PRICE: Array<{ name: string; duration: string; priceMinor: number }> = [
  { name: 'Маникюр с покрытием', duration: '1 ч 30 мин', priceMinor: 450_000 },
  { name: 'Педикюр', duration: '1 ч 15 мин', priceMinor: 550_000 },
  { name: 'Наращивание ресниц', duration: '2 ч', priceMinor: 1_200_000 },
];

export default function ServicesHealth03() {
  return (
    <>
      <PhoneAppBar title="Шаг 1. Специалист" subtitle="Салон красоты «Лотос» · 3 мастера" back />
      <PhoneBody>
        {SPECIALISTS.map((master) => (
          <PhoneCard key={master.name}>
            <div className="flex items-center gap-3">
              <span className="grid h-10 w-10 flex-none place-items-center rounded-full bg-brand-100 text-[14px] font-semibold text-brand-700">
                {master.initial}
              </span>
              <div className="min-w-0 flex-1">
                <div className="truncate text-[13px] font-semibold text-ink-900">{master.name}</div>
                <div className="truncate text-[11.5px] text-ink-500">{master.about}</div>
              </div>
              {master.selected ? <Badge tone="brand">Выбрана</Badge> : null}
            </div>
          </PhoneCard>
        ))}

        <div className="flex items-baseline justify-between">
          <span className="text-[12px] font-semibold text-ink-700">Шаг 2. Услуга · прайс Айгуль</span>
          <span className="text-[12px] text-brand-600">3 услуги</span>
        </div>

        <PhoneCard>
          {AIGUL_PRICE.map((service) => (
            <Row
              key={service.name}
              label={`${service.name} · ${service.duration}`}
              value={<Money minor={service.priceMinor} />}
            />
          ))}
        </PhoneCard>

        <Notice>
          <b>«Наращивание ресниц» — только у Айгуль.</b> У Динары этого пункта нет: услуга закреплена за
          мастером. Чужая услуга вернула бы <code>SERVICE_NOT_OFFERED_BY_SPECIALIST</code>.
        </Notice>

        <div className="mt-auto space-y-2">
          <div className="rounded-xl bg-brand-500 py-3 text-center text-[13px] font-semibold text-white">
            Выбрать услугу
          </div>
          <p className="text-center text-[11px] text-ink-400">
            «Свободна сегодня с 14:00» не подсказываем: подсказка требует эндпоинта{' '}
            <code>next-available</code>, которого нет
          </p>
        </div>
      </PhoneBody>
    </>
  );
}
