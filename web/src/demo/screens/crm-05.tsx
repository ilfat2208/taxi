/**
 * crm-05 · Карточка записи.
 *
 * Экран показывает ровно то, что отдаёт GET /bookings/{id}: код QT-…, статус, услугу,
 * длительность и цену снапшотом, комментарий клиента. Снапшот — не деталь реализации:
 * цена и длительность копируются в запись при создании, поэтому новый прайс не
 * переписывает прошлый визит.
 *
 * Чего нет: имени и телефона клиента — в записи только client_user_id аккаунта ORTA ID,
 * и таблицы истории изменений: есть created_at, updated_at и version. События лежат в
 * outbox, но журналом для интерфейса они не являются.
 */
import { Badge } from '../../components/ui/Badge';
import { ConsolePanel, Notice, Row } from '../kit';

const TIMELINE = [
  {
    title: 'Запись создана',
    meta: '28.09.2026 19:12 · booking.created · окно занято уникальным индексом',
    tone: 'bg-success-500',
    last: false,
  },
  {
    title: 'Напоминание клиенту',
    meta: 'план: ни напоминаний, ни центра уведомлений нет',
    tone: 'bg-ink-300',
    last: false,
  },
  {
    title: 'Визит закрыт',
    meta: 'POST /internal/bookings/{id}/complete → COMPLETED',
    tone: 'bg-ink-300',
    last: true,
  },
];

export default function CrmBookingCard() {
  return (
    <>
      <div className="flex items-center gap-2">
        <div className="min-w-0">
          <div className="truncate text-[13px] font-semibold text-ink-900">
            Запись <span className="font-mono text-[12px] text-ink-600">QT-8F3J7P</span>
          </div>
          <div className="truncate text-[11.5px] text-ink-500">
            Пт, 2 октября 2026 · 10:30–12:30 · Asia/Almaty · Динара Ахметова · подтверждена
          </div>
        </div>
        <span className="ml-auto flex items-center gap-2">
          <Badge tone="success">CONFIRMED</Badge>
          <span className="rounded-full bg-white px-3 py-1.5 text-[12px] text-ink-600 ring-1 ring-ink-200">Отметить визит</span>
          <span className="rounded-full bg-white px-3 py-1.5 text-[12px] text-ink-600 ring-1 ring-ink-200">Отменить…</span>
        </span>
      </div>

      <div className="grid grid-cols-[minmax(0,1fr)_300px] gap-3">
        <ConsolePanel title="Что заказано и у кого" right={<span className="text-[11px] text-ink-500">значения — снимок на момент записи</span>}>
          <div className="flex items-center gap-2.5">
            <span className="grid h-9 w-9 flex-none place-items-center rounded-full bg-brand-100 text-[13px] font-semibold text-brand-700">
              К
            </span>
            <div className="min-w-0 flex-1">
              <div className="truncate text-[12.5px] font-medium text-ink-800">
                Клиент <span className="font-mono text-[11.5px] text-ink-600">demo-client-1</span>
              </div>
              <div className="truncate text-[11px] text-ink-500">аккаунт ORTA ID · имени и телефона в QTime нет</div>
            </div>
            <Badge tone="neutral">4 визита</Badge>
          </div>

          <div className="my-2 border-t border-ink-100" />
          <Row label="Услуга" value="Окрашивание в один тон" strong />
          <Row label="Мастер" value="Динара Ахметова" />
          <Row label="Компания" value="Салон красоты «Лотос»" />
          <Row label="Адрес" value="ул. Тауке хана, 83" />
          <Row label="Длительность" value="120 мин" />
          <Row label="Цена" value="15 000,00 ₸" />
          <Row label="Начало" value="02.10.2026 10:30" />
          <Row label="Окончание" value="02.10.2026 12:30" />

          <div className="my-2 border-t border-ink-100" />
          <div className="text-[11px] text-ink-500">Комментарий клиента</div>
          <div className="mt-1 rounded-xl bg-ink-50 px-2.5 py-1.5 text-[12.5px] text-ink-800">
            Хочу тон на два оттенка темнее прошлого раза, без аммиака.
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <Badge tone="brand">клиент записался 28.09, 19:12</Badge>
            <Badge tone="neutral">Idempotency-Key сохранён</Badge>
          </div>
        </ConsolePanel>

        <ConsolePanel title="История записи" right={<span className="text-[11px] text-ink-500">создана → ждём визит</span>}>
          <div className="space-y-0">
            {TIMELINE.map((step) => (
              <div key={step.title} className="flex gap-2">
                <div className="flex w-2 flex-none flex-col items-center pt-1.5">
                  <span className={`h-2 w-2 rounded-full ${step.tone}`} />
                  {!step.last ? <span className="w-px flex-1 bg-ink-200" /> : null}
                </div>
                <div className="min-w-0 flex-1 pb-2.5">
                  <div className="truncate text-[12.5px] font-medium text-ink-800">{step.title}</div>
                  <div className="text-[11px] leading-[15px] text-ink-500">{step.meta}</div>
                </div>
              </div>
            ))}
          </div>

          <Notice tone="info">
            <b>Истории изменений в модели нет.</b> В таблице booking только created_at, updated_at и version: outbox —
            это доставка событий, а не журнал для интерфейса. Предлагается отдельная{' '}
            <code className="rounded bg-black/5 px-1 font-mono text-[11px]">booking_change</code>.
          </Notice>

          <div className="mt-2 flex items-center gap-2">
            <span className="rounded-xl bg-white px-3 py-1.5 text-[12px] text-ink-700 ring-1 ring-ink-200">Завершить визит</span>
            <span className="rounded-xl bg-brand-50 px-3 py-1.5 text-[12px] font-medium text-brand-700 ring-1 ring-inset ring-brand-200">
              Отменить
            </span>
          </div>
        </ConsolePanel>
      </div>

      <Notice tone="neutral">
        Запись закрывается внутренним эндпоинтом{' '}
        <code className="rounded bg-black/5 px-1 font-mono text-[11px]">POST /api/v1/qtime/internal/bookings/&#123;id&#125;/complete</code>{' '}
        и событием <code className="rounded bg-black/5 px-1 font-mono text-[11px]">booking.completed</code>. Переноса в
        агрегате нет — только cancel, complete и markNoShow.
      </Notice>
    </>
  );
}
