/**
 * crm-06 · Отмена записи с причиной.
 *
 * Отмена работает и освобождает окно сразу: статус становится CANCELLED_BY_COMPANY, а
 * уникальность окна держит частичный индекс только по CONFIRMED, поэтому ничего не
 * удаляется. Причина необязательна (до 255 символов) и уходит в событие как cancelReason.
 *
 * Честно про права: привязки «мерчант ↔ компания» в QTime нет, поэтому роль MERCHANT
 * может отменить любую запись любой компании. Это документированная дыра в QtimeAccess,
 * а не норма — и на экране она показана именно так.
 */
import { Badge } from '../../components/ui/Badge';
import { Chips, ConsolePanel, Notice } from '../kit';

const REASONS = ['Мастер заболел', 'Клиент попросил', 'Не подошло время', 'Ошибка салона', 'Другое'];

const EFFECTS = [
  { text: 'Окно вернётся в сетку', note: 'индекс частичный — только CONFIRMED' },
  { text: 'Запись не удаляется', note: 'история видна' },
  { text: 'Клиент получит уведомление', note: 'план: пушей нет' },
  { text: 'Причина уходит в событие', note: 'cancelReason' },
];

export default function CrmCancelBooking() {
  return (
    <>
      <div className="flex items-center gap-2">
        <div className="min-w-0">
          <div className="truncate text-[13px] font-semibold text-ink-900">Отмена с причиной</div>
          <div className="truncate text-[11.5px] text-ink-500">
            Запись <span className="font-mono">QT-8F3J7P</span> · 2 октября, 10:30–12:30 · Динара Ахметова · 15 000 ₸
          </div>
        </div>
        <span className="ml-auto flex items-center gap-2">
          <Badge tone="success">API работает</Badge>
          <span className="rounded-full bg-white px-3 py-1.5 text-[12px] text-ink-600 ring-1 ring-ink-200">Вернуться</span>
        </span>
      </div>

      <div className="grid grid-cols-[minmax(0,1fr)_300px] gap-3">
        <ConsolePanel
          title="Причина отмены"
          right={<span className="text-[11px] text-ink-500">необязательна, до 255 символов</span>}
        >
          <Chips items={REASONS} active="Мастер заболел" />

          <div className="mt-3 text-[11px] text-ink-500">Комментарий для истории и клиента</div>
          <div className="mt-1 rounded-xl bg-ink-50 px-2.5 py-1.5 text-[12.5px] text-ink-800">
            Динара на больничном, предложили 6 октября в 11:00 к Жанар
          </div>

          <div className="my-3 border-t border-ink-100" />
          <div className="space-y-1">
            <div className="flex items-center justify-between gap-3">
              <span className="text-[12px] text-ink-500">Статус после отмены</span>
              <span className="text-[12.5px] font-semibold text-ink-900">CANCELLED_BY_COMPANY</span>
            </div>
            <div className="flex items-center justify-between gap-3">
              <span className="text-[12px] text-ink-500">Окно 10:30–12:30</span>
              <span className="text-[12.5px] text-ink-800">освободится сразу</span>
            </div>
            <div className="flex items-center justify-between gap-3">
              <span className="text-[12px] text-ink-500">Событие</span>
              <span className="text-[12.5px] text-ink-800">booking.cancelled → qtime.events</span>
            </div>
            <div className="flex items-center justify-between gap-3">
              <span className="text-[12px] text-ink-500">Повтор запроса</span>
              <span className="text-[12.5px] text-ink-800">безопасен с Idempotency-Key</span>
            </div>
          </div>

          <div className="mt-3 flex items-center gap-2">
            <span className="rounded-xl bg-brand-500 px-3 py-1.5 text-[12px] font-medium text-white">Отменить запись</span>
            <span className="rounded-xl bg-white px-3 py-1.5 text-[12px] text-ink-700 ring-1 ring-ink-200">Оставить</span>
          </div>
        </ConsolePanel>

        <ConsolePanel title="Что произойдёт и чего нельзя">
          <div className="space-y-1.5">
            {EFFECTS.map((effect) => (
              <div key={effect.text} className="flex items-center justify-between gap-2">
                <span className="min-w-0 truncate text-[12.5px] text-ink-800">{effect.text}</span>
                <span className="flex-none text-[11px] text-ink-500">{effect.note}</span>
              </div>
            ))}
          </div>

          <div className="my-3 border-t border-ink-100" />
          <p className="text-[11.5px] leading-[16px] text-ink-600">
            Завершённую, уже отменённую или неявившуюся запись отменить нельзя: сервис отвечает{' '}
            <code className="rounded bg-black/5 px-1 font-mono text-[11px]">409 BOOKING_NOT_CANCELLABLE</code>. Политики
            отмены — за сколько часов и со штрафом ли — в модели нет вообще.
          </p>

          <div className="mt-2">
            <Notice tone="danger">
              <b>Роль MERCHANT может отменить любую запись — это дыра.</b> Привязки «мерчант ↔ компания» в QTime нет:
              салон «Лотос» технически может отменить запись стоматологии «Дентал Плюс». Нужна связь компании с
              аккаунтом и проверка владельца — это незакрытый вопрос, а не правило.
            </Notice>
          </div>
        </ConsolePanel>
      </div>

      <Notice tone="neutral">
        <b>Что реально:</b> причина необязательна и доходит до события как
        cancelReason; отмена идемпотентна, если передан{' '}
        <code className="rounded bg-black/5 px-1 font-mono text-[11px]">Idempotency-Key</code>, иначе повтор вернёт
        409 BOOKING_NOT_CANCELLABLE.
      </Notice>
    </>
  );
}
