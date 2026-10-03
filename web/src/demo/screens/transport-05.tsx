/**
 * transport-05 — ORTA Cargo, груз в пути и сопровождение.
 *
 * Ответ на вопрос «где мой груз»: прогресс перевозки, что уже сделано, что
 * будет дальше и связь с экспедитором. Фото груза при погрузке здесь
 * сознательно не нарисованы: хранилища файлов в репозитории нет.
 */
import { Notice, PhoneBody, PhoneCard, Placeholder } from '../kit';
import { cx } from '../../lib/cx';

function Step({ title, text, tone, last }: { title: string; text: string; tone: 'done' | 'active' | 'muted'; last?: boolean }) {
  return (
    <div className="flex gap-3">
      <span className="flex flex-col items-center">
        <span
          className={cx(
            'mt-1 h-2.5 w-2.5 flex-none rounded-full',
            tone === 'done' ? 'bg-emerald-500' : tone === 'active' ? 'bg-brand-500' : 'bg-ink-300',
          )}
        />
        {last ? null : <span className="w-px flex-1 bg-ink-200" />}
      </span>
      <div className="min-w-0 pb-2.5">
        <div className={cx('text-[12.5px] font-medium', tone === 'muted' ? 'text-ink-500' : 'text-ink-900')}>{title}</div>
        <div className="text-[11px] text-ink-500">{text}</div>
      </div>
    </div>
  );
}

export default function Transport05() {
  return (
    <PhoneBody className="pt-3">
      <div className="relative">
        <Placeholder label="Карта · иллюстрация борда: прямой маршрут между точками" className="h-[150px]" />
        <span className="absolute left-3 top-3 inline-flex items-center gap-1.5 rounded-full bg-white/95 px-2.5 py-1 text-[11px] font-medium text-success-700 ring-1 ring-ink-200">
          <span className="h-1.5 w-1.5 rounded-full bg-success-500" />
          Груз в пути
        </span>
        <span className="absolute right-3 top-3 rounded-full bg-white/95 px-2.5 py-1 text-[11px] text-ink-600 ring-1 ring-ink-200">
          2,2 км до выгрузки
        </span>
      </div>

      <PhoneCard
        title="Сопровождение груза"
        right={<span className="rounded-full bg-brand-50 px-2 py-0.5 text-[11px] font-medium text-brand-700">≈ 14 мин</span>}
      >
        <div className="h-1.5 w-full overflow-hidden rounded-full bg-ink-100">
          <div className="h-full w-[79%] rounded-full bg-brand-500" />
        </div>
        <div className="mt-1.5 flex justify-between text-[11px] text-ink-500">
          <span>Загружено · 10:12</span>
          <span>Выгрузка · пр. Байтурсынова, 14</span>
        </div>
      </PhoneCard>

      <PhoneCard>
        <Step tone="done" title="Погрузка завершена" text="10:12 · 2,4 м³, вес по накладной ≈ 180 кг" />
        <Step tone="active" title="Груз в пути" text="10:26 · экспедитор Асхат на связи, груз закреплён" />
        <Step tone="muted" title="Разгрузка · 4 этаж, лифт есть" text="по прибытии; подъём входит в работу грузчиков" />
        <Step tone="muted" last title="Акт и чек" text="после выгрузки: вес по факту и списание денег" />
      </PhoneCard>

      <Notice tone="warning">
        <b>Вес по факту — не «на месте».</b> Если фактический вес больше заявленного, доплата считается по чеку
        и показывается в приложении, а не называется водителем у подъезда. Трека перевозки и фото груза в коде
        нет: экран демонстрационный.
      </Notice>

      <div className="mt-auto" />
      <div className="rounded-xl border border-ink-200 bg-white px-4 py-2.5 text-center text-[13px] font-medium text-ink-700">
        Связаться с экспедитором
      </div>
    </PhoneBody>
  );
}
