/**
 * transport-12 — ORTA Auto, напоминания, ТО и техосмотр.
 *
 * Напоминание имеет смысл только как связка «срок → запись»: из карточки человек
 * уходит в окна QTime. Отправка — через единые уведомления, которых пока нет:
 * работает событийный контур outbox → Kafka, документы со сроком есть только у
 * водителя (VEHICLE_INSPECTION — документ водителя, а не автомобиля).
 */
import { Notice, PhoneAppBar, PhoneBody, PhoneCard, PhoneTabBar } from '../kit';
import { cx } from '../../lib/cx';

const REMINDERS: Array<{
  key: string;
  title: string;
  detail: string;
  badge: string;
  tone: 'warning' | 'success';
  progress?: number;
  note?: string;
}> = [
  {
    key: 'oil',
    title: 'Замена масла',
    detail: 'через 1 400 км или до 12.11.2026 — что раньше',
    badge: 'скоро',
    tone: 'warning',
    progress: 86,
    note: 'Пробег 84 200 км из 85 600 км до следующего ТО.',
  },
  {
    key: 'inspection',
    title: 'Техосмотр',
    detail: 'до 01.12.2026 · осталось 60 дней',
    badge: 'истекает',
    tone: 'warning',
    note: 'Просроченный техосмотр равен отсутствующему: так это правило уже работает для документов водителя.',
  },
  {
    key: 'osgo',
    title: 'ОГПО · страхование',
    detail: 'полис до 14.03.2027 · продление онлайн',
    badge: 'действует',
    tone: 'success',
  },
];

export default function Transport12() {
  return (
    <>
      <PhoneAppBar
        title="Напоминания"
        subtitle="ТО, техосмотр и страховка · демо-данные"
        right={
          <span className="grid h-9 w-9 place-items-center rounded-xl bg-ink-100 text-[12px] font-semibold text-ink-600">
            !
          </span>
        }
      />
      <PhoneBody>
        {REMINDERS.map((item) => (
          <PhoneCard key={item.key}>
            <div className="flex items-center gap-3">
              <span
                className={cx(
                  'grid h-9 w-9 flex-none place-items-center rounded-xl text-[13px] font-semibold',
                  item.tone === 'success' ? 'bg-success-50 text-success-700' : 'bg-warning-50 text-warning-700',
                )}
              >
                {item.tone === 'success' ? '✓' : '!'}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-[13px] font-semibold text-ink-900">{item.title}</span>
                <span className="block text-[11.5px] text-ink-500">{item.detail}</span>
              </span>
              <span
                className={cx(
                  'flex-none rounded-full px-2 py-0.5 text-[11px] font-medium',
                  item.tone === 'success' ? 'bg-success-50 text-success-700' : 'bg-warning-50 text-warning-700',
                )}
              >
                {item.badge}
              </span>
            </div>
            {typeof item.progress === 'number' ? (
              <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-ink-100">
                <div className="h-full rounded-full bg-warning-500" style={{ width: `${item.progress}%` }} />
              </div>
            ) : null}
            {item.note ? <p className="mt-2 text-[11px] text-ink-500">{item.note}</p> : null}
          </PhoneCard>
        ))}

        <Notice tone="info">
          <b>Напоминания — план, события уже есть.</b> Пушей и центра уведомлений в коде нет: работает
          событийный контур outbox → Kafka. Даты, пробег и полис — демонстрационные данные макета.
        </Notice>

        <div className="mt-auto" />
        <div className="rounded-xl bg-brand-500 px-4 py-3 text-center text-[13px] font-semibold text-white">Записаться заранее</div>
        <div className="text-center text-[11px] text-ink-500">Окна для записи отдаёт готовое ядро QTime</div>
      </PhoneBody>
      <PhoneTabBar items={['Гараж', 'Запись', 'История', 'Профиль']} active="Запись" />
    </>
  );
}
