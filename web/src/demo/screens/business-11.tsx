/**
 * ORTA Business · Клиенты, сегменты и повторные продажи.
 *
 * Статус на борде «План», и это главное: клиентской базы в коде нет. Телефон
 * существует только внутри заказа (orders.contactPhone), записи QTime знают
 * клиента по своему id — связка «один человек = один клиент бизнеса» пока не
 * собирается. Плюс правило доступа: чужие данные обязаны оставлять след, как это
 * уже сделано у поддержки (support_audit_record).
 *
 * Поэтому экран начинается с плашки о том, чего нет, а не с кнопки «Выгрузить базу».
 */
import { Badge } from '../../components/ui/Badge';
import { ConsolePanel, ConsoleRows, Kpis, Money, Notice, Row } from '../kit';

type Segment = 'постоянный' | 'новый' | 'спящий 90+';

const SEGMENT_TONE: Record<Segment, 'success' | 'info' | 'neutral'> = {
  'постоянный': 'success',
  'новый': 'info',
  'спящий 90+': 'neutral',
};

const CUSTOMERS: Array<{ name: string; meta: string; segment: Segment }> = [
  { name: 'Данияр Сериков', meta: '+7 705 118 77 03 · 6 заказов · 284 300,00 ₸ · 03.10', segment: 'постоянный' },
  { name: 'Алия Нурлановна', meta: '+7 701 445 21 08 · 1 заказ · 13 398,00 ₸ · 04.10', segment: 'новый' },
  { name: 'Мадина Ахметова', meta: '+7 702 330 91 46 · 4 заказа · 96 400,00 ₸ · 03.10', segment: 'постоянный' },
  { name: 'Тимур Оспанов', meta: '+7 708 556 04 12 · 3 заказа · 88 700,00 ₸ · 02.10', segment: 'постоянный' },
  { name: 'Асель Жумабаева', meta: '+7 700 214 60 77 · 2 заказа · 18 900,00 ₸ · 03.10', segment: 'спящий 90+' },
  { name: 'Гульнара Сапарова', meta: '+7 701 872 33 09 · 5 заказов · 132 400,00 ₸ · 27.09', segment: 'спящий 90+' },
];

/** Сегменты — одной строкой на сегмент: узкая колонка иначе выталкивает карточку. */
const SEGMENTS = [
  { title: 'Новые, первый заказ ≤14 дней', count: '38' },
  { title: 'Постоянные, 3+ заказа', count: '96' },
  { title: 'Спящие, 90+ дней без покупки', count: '148' },
  { title: 'Только запись, без покупок', count: '21' },
  { title: 'Остальные, 1–2 заказа', count: '109' },
];

const CLIENT_HISTORY = [
  { title: 'Заказ ORD-241003-8F3K · PAID', right: '03.10' },
  { title: 'Запись QTime · Маникюр · COMPLETED', right: '21.09' },
];

export default function Business11() {
  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      <div className="flex flex-none items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[16px] font-bold text-ink-900">Клиенты</div>
          <div className="truncate text-[12px] text-ink-500">
            412 клиентов · 96 с покупками за 30 дней · 64 записывались через QTime
          </div>
        </div>
        <div className="flex flex-none items-center gap-2">
          <span className="rounded-full bg-ink-100 px-3 py-1.5 text-[12px] text-ink-400">Сегменты</span>
          <span className="rounded-full bg-ink-100 px-3 py-1.5 text-[12px] text-ink-400">Выгрузить базу</span>
        </div>
      </div>

      <div className="flex-none">
        <Notice tone="warning">
          Клиентской базы в коде нет: телефон живёт только внутри заказа (<code>orders.contactPhone</code>), записи QTime
          знают клиента по своему id — «один человек = один клиент бизнеса» пока не собирается. Доступ к чужим данным
          обязан оставлять след (сейчас так работает только поддержка: <code>support_audit_record</code>). Предлагается{' '}
          <code>GET /api/v1/business/customers</code> с обязательным журналом.
        </Notice>
      </div>

      <div className="flex min-h-0 flex-1 gap-3">
        <div className="flex min-h-0 flex-1 flex-col gap-3">
          <div className="flex-none">
            <Kpis
              items={[
                { label: 'Повторные продажи', value: '34%', hint: 'выручка 30 дней от клиентов 3+ заказов' },
                { label: 'Средний интервал', value: '24 дня', hint: 'между покупками' },
                { label: 'Всего клиентов', value: '412', hint: 'за всё время' },
              ]}
            />
          </div>

          <ConsolePanel title="Клиенты" right={<span className="text-[11px] text-ink-400">последний контакт</span>} className="min-h-0 flex-1 overflow-hidden">
            <div className="flex items-center gap-2 rounded-xl border border-ink-200 bg-white px-3 py-1.5 text-[12px] text-ink-400">
              Имя или телефон клиента
            </div>
            <div className="mt-1.5">
              <ConsoleRows
                items={CUSTOMERS.map((customer) => ({
                  title: customer.name,
                  meta: customer.meta,
                  right: <Badge tone={SEGMENT_TONE[customer.segment]}>{customer.segment}</Badge>,
                }))}
              />
            </div>
          </ConsolePanel>
        </div>

        <div className="flex w-[320px] flex-none flex-col gap-3">
          <ConsolePanel title="Сегменты" right={<span className="text-[11px] text-ink-400">всего 412 клиентов</span>} className="flex-none">
            <ConsoleRows
              items={SEGMENTS.map((segment) => ({
                title: segment.title,
                right: <span className="text-[13px] font-semibold tabular-nums text-ink-900">{segment.count}</span>,
              }))}
            />
          </ConsolePanel>

          <ConsolePanel
            title="Данияр Сериков"
            right={<span className="text-[11px] text-ink-400">карточка клиента</span>}
            className="min-h-0 flex-1 overflow-hidden"
          >
            <Row label="Заказов" value="6 · 284 300,00 ₸" strong />
            <Row label="Средний чек" value={<Money minor={4738333} />} />
            <Row label="Визитов по записи" value="2" />
            <Row label="Последний контакт" value="03.10.2026" />
            <div className="mt-1 border-t border-ink-100 pt-1">
              <ConsoleRows
                items={CLIENT_HISTORY.map((item) => ({
                  title: item.title,
                  right: <span className="text-[11.5px] text-ink-500">{item.right}</span>,
                }))}
              />
            </div>
          </ConsolePanel>
        </div>
      </div>
    </div>
  );
}
