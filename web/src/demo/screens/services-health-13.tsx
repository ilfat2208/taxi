/**
 * ORTA Health — клиники и подбор врача (план).
 *
 * Экрана нет. Из кода под ним есть ровно одна компания: стоматология «Дентал Плюс»
 * с категорией `HEALTH` в `qtime.company` (сидер `DemoQtimeSeeder`), три врача с
 * реальными специализациями (стоматолог, ортопед, гигиенист) и прайс: консультация
 * 3 000 ₸ / 30 мин, лечение кариеса 18 000 ₸, чистка 12 000 ₸.
 *
 * «Гиппократ» и телемедицина — иллюстрация: врачей с расписанием по специальностям,
 * ДМС и телемедицины в ORTA нет. Специальность как фильтр — отдельный справочник,
 * которого у QTime нет: там специализация это свободный текст в карточке врача.
 *
 * Медицинские данные — особая категория, поэтому экран показывает требования, а не
 * сделанное: согласие, разделение доступа, срок хранения.
 */
import { Badge } from '../../components/ui/Badge';
import { Chips, Money, Notice, PhoneAppBar, PhoneBody, PhoneCard, Placeholder } from '../kit';

const CLINICS: Array<{ name: string; thumb: string; meta: string; when: string; tone: 'success' | 'neutral'; fromMinor: number }> = [
  {
    name: 'Стоматология «Дентал Плюс»',
    thumb: 'Дентал',
    meta: 'ул. Желтоксан, 20 · ★ 4,9 · 401 отзыв · 3 врача',
    when: 'сегодня с 14:00',
    tone: 'success',
    fromMinor: 300_000,
  },
  {
    name: 'Клиника «Гиппократ»',
    thumb: 'Клиника',
    meta: 'пр. Кунаева, 44 · ★ 4,6 · 265 отзывов · 11 специальностей',
    when: 'завтра, терапевт',
    tone: 'neutral',
    fromMinor: 400_000,
  },
  {
    name: 'Телемедицина ORTA Health',
    thumb: 'Видео',
    meta: 'видеоприём без поездки · терапевт, педиатр, дерматолог',
    when: 'сегодня после 18:00',
    tone: 'neutral',
    fromMinor: 500_000,
  },
];

export default function ServicesHealth13() {
  return (
    <>
      <PhoneAppBar
        title="ORTA Health"
        subtitle="Клиники, врачи и запись на приём"
        right={<Badge tone="neutral">План</Badge>}
      />
      <PhoneBody>
        <div className="flex items-center gap-2 rounded-xl bg-white px-3 py-2.5 ring-1 ring-inset ring-ink-200">
          <span className="text-[11px] text-ink-400">поиск</span>
          <span className="text-[13px] text-ink-800">Стоматолог</span>
        </div>

        <Chips items={['Сегодня', 'Рядом', 'ДМС', 'Дети']} active="Сегодня" />

        <div className="flex items-baseline justify-between">
          <span className="text-[12px] font-semibold text-ink-700">Клиники и специальности</span>
          <span className="text-[12px] text-ink-400">всего 11 — справочника нет</span>
        </div>

        {CLINICS.map((clinic) => (
          <PhoneCard key={clinic.name}>
            <div className="flex items-center gap-3">
              <Placeholder label={clinic.thumb} className="h-10 w-10 flex-none" />
              <div className="min-w-0 flex-1">
                <div className="truncate text-[13px] font-semibold text-ink-900">{clinic.name}</div>
                <div className="truncate text-[11.5px] text-ink-500">{clinic.meta}</div>
              </div>
            </div>
            <div className="mt-2 flex items-center justify-between">
              <Badge tone={clinic.tone}>{clinic.when}</Badge>
              <span className="text-[12px] text-ink-500">
                от <Money minor={clinic.fromMinor} />
              </span>
            </div>
          </PhoneCard>
        ))}

        <Notice>
          <b>Медицинские данные — особая категория: это требование, а не сделанное.</b> До запуска нужны
          отдельное согласие с отзывом, разделение доступа (врачу — приём, администратору — расписание без
          диагнозов), заданный срок хранения и журнал доступа. «Дентал Плюс» — реальная компания QTime,
          «Гиппократ» и телемедицина — иллюстрация.
        </Notice>
      </PhoneBody>
    </>
  );
}
