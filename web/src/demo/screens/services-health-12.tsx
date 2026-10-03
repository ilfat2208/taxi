/**
 * ORTA Beauty — повторная запись «как в прошлый раз» (план).
 *
 * Экрана нет, но половина данных под ним уже отдаётся: прошлые визиты —
 * `GET /api/v1/qtime/bookings?status=COMPLETED` (в записи есть компания, мастер,
 * услуга, время, длительность и цена), текущий прайс — ответ компании, свободные
 * окна — слоты, новая запись — `POST /bookings` с новым `Idempotency-Key`.
 *
 * Предлагаемый эндпоинт: `GET /api/v1/qtime/bookings/suggestions?companyId=` —
 * «тот же мастер, та же услуга, ближайшие окна», чтобы правило «как в прошлый раз»
 * жило в одном месте, а не в трёх клиентах по-разному. Предзаполнение сейчас —
 * работа клиента: серверной операции «повторить» нет.
 *
 * Цена из прошлого визита не действует: в записи хранится та цена, по которой
 * человек записался, поэтому повтор идёт по текущему прайсу — и разницу видно до
 * нажатия кнопки, а не в чеке.
 */
import { Badge } from '../../components/ui/Badge';
import { cx } from '../../lib/cx';
import { Money, Notice, PhoneAppBar, PhoneBody, PhoneCard, Placeholder, Row } from '../kit';

/** Кандидаты на визит: прошлое время повторяется на неделю вперёд и проверяется по сетке. */
const CANDIDATES: Array<{ label: string; state: 'free' | 'on' | 'busy' }> = [
  { label: 'сб 11:30', state: 'free' },
  { label: 'сб 15:30', state: 'on' },
  { label: 'пн 16:00', state: 'free' },
  { label: 'вс —', state: 'busy' },
  { label: 'пн 09:00', state: 'free' },
  { label: 'вт 15:30', state: 'free' },
];

export default function ServicesHealth12() {
  return (
    <>
      <PhoneAppBar title="Как в прошлый раз" subtitle="Салон «Лотос» · Айгуль · маникюр с покрытием" back />
      <PhoneBody>
        <PhoneCard>
          <div className="flex items-center gap-3">
            <Placeholder label="Визит" className="h-10 w-10 flex-none" />
            <div className="min-w-0 flex-1">
              <div className="text-[13px] font-semibold text-ink-900">Прошлый визит</div>
              <div className="text-[11.5px] text-ink-500">пт, 5 сентября · 15:30 · 1 ч 30 мин</div>
              <div className="text-[11.5px] text-ink-500">Айгуль Смагулова · 4 500 ₸</div>
            </div>
          </div>
          <div className="my-2 border-t border-ink-100" />
          <Row label="Мастер и услуга" value="те же" />
          <Row label="Время и цена сегодня" value={<Money minor={450_000} />} strong />
        </PhoneCard>

        <PhoneCard title="Кандидаты на визит" right={<Badge tone="brand">сетка QTime</Badge>}>
          <div className="grid grid-cols-3 gap-2">
            {CANDIDATES.map((slot) => (
              <span
                key={slot.label}
                className={cx(
                  'rounded-lg py-1.5 text-center text-[12px] ring-1 ring-inset',
                  slot.state === 'on' && 'bg-brand-500 font-semibold text-white ring-brand-500',
                  slot.state === 'busy' && 'bg-ink-100 text-ink-400 line-through ring-ink-200',
                  slot.state === 'free' && 'bg-white text-ink-800 ring-ink-200',
                )}
              >
                {slot.label}
              </span>
            ))}
          </div>
          <p className="mt-2 text-[11px] text-ink-500">
            Прошлое время повторяется на неделю вперёд и проверяется по сетке; вс — выходной, строки в
            расписании нет.
          </p>
        </PhoneCard>

        <Notice tone="info">
          <b>Это можно собрать уже сегодня.</b> Историю даёт{' '}
          <code>GET /bookings?status=COMPLETED</code>, прайс и мастеров — компания, окна — слоты.
          Предзаполнение делает клиент: серверной операции «повторить» нет.
        </Notice>

        <Notice tone="neutral">
          <b>Цена из прошлого визита не действует.</b> В записи хранится цена, по которой человек записался:
          переоценка прайса её не переписывает, повтор идёт по текущему прайсу.
        </Notice>

        <div className="mt-auto space-y-2">
          <div className="rounded-xl bg-brand-500 py-3 text-center text-[13px] font-semibold text-white">
            Записаться на сб, 15:30 · 4 500 ₸
          </div>
          <div className="rounded-xl bg-white py-2.5 text-center text-[13px] font-medium text-ink-700 ring-1 ring-inset ring-ink-200">
            Выбрать другое время
          </div>
        </div>
      </PhoneBody>
    </>
  );
}
