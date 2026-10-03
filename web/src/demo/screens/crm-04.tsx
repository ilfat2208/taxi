/**
 * crm-04 · Календарь недели — конфликты и подбор окна.
 *
 * Четыре конфликта, которые консоль обязана показывать: записи на день отпуска мастера,
 * записи вне смены после правки шаблона, проигранная гонка за окно и время ближе
 * минимального запаса. Первых двух API сегодня не видит: исключение закрывает день для
 * новых записей, но подтверждённые записи остаются CONFIRMED и держат окна. Подбор окна
 * справа опирается на настоящий ответ сетки (available и reason), а не на догадку интерфейса.
 */
import { Badge } from '../../components/ui/Badge';
import { ConsolePanel, Notice, Row } from '../kit';

type Tone = 'danger' | 'warning' | 'info' | 'neutral';

interface Conflict {
  title: string;
  tone: Tone;
  tag: string;
  text: string;
}

const CONFLICTS: Conflict[] = [
  {
    title: 'Записи на день отпуска: Айгуль, понедельник 5 октября',
    tone: 'danger',
    tag: 'блокирует',
    text: 'Исключение VACATION закрывает день, но две подтверждённые записи остаются CONFIRMED и продолжают держать окна частичным индексом. Новые записи сюда не пройдут (422 OUTSIDE_WORKING_HOURS, причина DAY_OFF), а старые никто не отменяет.',
  },
  {
    title: 'Записи вне смены после правки шаблона: Динара, среда 7 октября',
    tone: 'warning',
    tag: 'проверить вручную',
    text: 'Времена проверяются один раз — в момент бронирования. Если рабочие часы изменить после, созданные записи не перепроверяются, и в календаре появится визит за пределами смены.',
  },
  {
    title: 'Гонка за окно: Жанар, суббота 10 октября, 15:30',
    tone: 'info',
    tag: 'обработано',
    text: 'Два клиента нажали одно окно: одного пропустил частичный уникальный индекс, второй получил 409 SLOT_TAKEN. Это не сбой, а работающая защита «одно окно — одна запись».',
  },
  {
    title: 'Слишком поздно: окно ближе 30 минут',
    tone: 'neutral',
    tag: 'правило сервиса',
    text: 'Клетки ближе минимального запаса не отдаются вообще, а прямой запрос получает 422 BOOKING_TOO_SOON. Запас — 30 минут на весь сервис.',
  },
];

const TONE_RING: Record<Tone, string> = {
  danger: 'ring-brand-200 bg-brand-50/40',
  warning: 'ring-amber-200 bg-warning-50/50',
  info: 'ring-blue-200 bg-info-50/50',
  neutral: 'ring-ink-200 bg-white',
};

const WINDOWS = [
  { n: '1', who: 'Динара · вт 6 окт', when: '11:00, 14:30' },
  { n: '2', who: 'Динара · чт 8 окт', when: '10:00, 12:00, 16:30' },
  { n: '3', who: 'Жанар · сб 10 окт', when: '14:00, 16:00' },
];

export default function CrmWeekConflicts() {
  return (
    <>
      <div className="flex items-center gap-2">
        <div>
          <div className="text-[13px] font-semibold text-ink-900">Конфликты недели · 5–11 октября</div>
          <div className="text-[11.5px] text-ink-500">Четыре проверки перед публикацией расписания</div>
        </div>
        <span className="ml-auto flex items-center gap-2">
          <Badge tone="danger">2 конфликта</Badge>
          <span className="rounded-full bg-white px-3 py-1.5 text-[12px] text-ink-600 ring-1 ring-ink-200">Пересчитать</span>
        </span>
      </div>

      <div className="grid grid-cols-[minmax(0,1fr)_300px] gap-3">
        <ConsolePanel title="Что нашлось" right={<span className="text-[11px] text-ink-500">проверки, которых в API нет</span>}>
          <div className="space-y-2">
            {CONFLICTS.map((conflict) => (
              <div key={conflict.title} className={`rounded-xl px-3 py-2 ring-1 ring-inset ${TONE_RING[conflict.tone]}`}>
                <div className="flex items-center gap-2">
                  <span className="min-w-0 flex-1 truncate text-[12.5px] font-semibold text-ink-800">{conflict.title}</span>
                  <Badge tone={conflict.tone === 'neutral' ? 'neutral' : conflict.tone}>{conflict.tag}</Badge>
                </div>
                <p className="mt-1 text-[11.5px] leading-[16px] text-ink-600">{conflict.text}</p>
              </div>
            ))}
          </div>
        </ConsolePanel>

        <ConsolePanel title="Найти окно" right={<Badge tone="brand">из реальной сетки</Badge>}>
          <Row label="Услуга" value="Окрашивание в один тон" />
          <Row label="Длительность" value="120 мин" strong />
          <Row label="Мастер" value="любой свободный" />
          <Row label="Даты" value="5–11 октября" />
          <Row label="Свободных окон" value="9" />
          <div className="my-2 border-t border-ink-100" />
          <div className="space-y-1">
            {WINDOWS.map((window) => (
              <div key={window.n} className="flex items-center gap-2 py-1">
                <span className="grid h-5 w-5 flex-none place-items-center rounded-full bg-brand-50 text-[10.5px] font-semibold text-brand-700">
                  {window.n}
                </span>
                <span className="min-w-0 flex-1 truncate text-[12.5px] text-ink-800">{window.who}</span>
                <span className="text-[11px] text-ink-500">{window.when}</span>
              </div>
            ))}
          </div>
          <div className="mt-2">
            <Notice tone="info">
              Каждый ответ сетки несёт <code className="rounded bg-black/5 px-1 font-mono text-[11px]">available</code> и причину
              отказа: «занято», «перерыв», «не хватает времени». Длительность услуги входит в расчёт.
            </Notice>
          </div>
        </ConsolePanel>
      </div>

      <Notice tone="warning">
        <b>Проверок конфликтов в сервисе нет.</b> Исключение в{' '}
        <code className="rounded bg-black/5 px-1 font-mono text-[11px]">schedule_exception</code> закрывает день для новых
        записей, но подтверждённые записи на этот день остаются <b>CONFIRMED</b> и держат окна: автоматической отмены и
        предупреждения нет. Предлагается{' '}
        <code className="rounded bg-black/5 px-1 font-mono text-[11px]">GET /companies/&#123;id&#125;/conflicts?from=&amp;to=</code>.
      </Notice>
    </>
  );
}
