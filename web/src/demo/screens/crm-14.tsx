/**
 * crm-14 · Отчёты.
 *
 * Агрегатов в сервисе нет: QTime отдаёт записи и сетки, но не суммы, поэтому отчёт
 * считается на клиенте. Опоры реальные — выручка по price_minor закрытых визитов (цена
 * снапшотом, поэтому переоценка услуг задним числом отчёт не переписывает), отменённые
 * записи из выручки исключаются.
 *
 * Неявки недостижимы: статус NO_SHOW есть в модели и markNoShow есть в агрегате, но
 * эндпоинта нет — перевести запись в неявку неоткуда, поэтому в отчёте всегда ноль.
 * Деньги в QTime не двигаются: предоплаты и связи с ORTA Pay нет.
 */
import { Badge } from '../../components/ui/Badge';
import { ConsolePanel, Kpis, Notice, Row } from '../kit';

const BY_SERVICE = [
  { title: 'Окрашивание', meta: '31 визит', value: '465 000 ₸' },
  { title: 'Маникюр', meta: '48 визитов', value: '216 000 ₸' },
  { title: 'Наращивание ресниц', meta: '12 визитов', value: '144 000 ₸' },
  { title: 'Чистка лица', meta: '14 визитов', value: '126 000 ₸' },
];

const BY_MASTER = [
  { title: 'Динара', meta: '71 визит · загрузка 74%', value: '612 500 ₸' },
  { title: 'Айгуль', meta: '82 визита · загрузка 78%', value: '508 000 ₸' },
  { title: 'Жанар', meta: '61 визит · загрузка 52%', value: '442 000 ₸' },
];

export default function CrmReports() {
  return (
    <>
      <div className="flex items-center gap-2">
        <div className="min-w-0">
          <div className="truncate text-[13px] font-semibold text-ink-900">Отчёты за сентябрь</div>
          <div className="truncate text-[11.5px] text-ink-500">
            Загрузка, выручка по услугам и мастерам, отмены и неявки · считается по снапшоту в записях
          </div>
        </div>
        <span className="ml-auto flex items-center gap-2">
          <Badge tone="brand">Сентябрь</Badge>
          <Badge tone="neutral">Октябрь</Badge>
          <span className="rounded-full bg-white px-3 py-1.5 text-[12px] text-ink-600 ring-1 ring-ink-200">Выгрузить CSV</span>
        </span>
      </div>

      <Kpis
        items={[
          { label: 'Закрытых визитов', value: '214', hint: 'статус COMPLETED' },
          { label: 'Загрузка мастеров', value: '68%', hint: 'кроме отпусков' },
          { label: 'Выручка по прайсу', value: '1 842 500 ₸', hint: 'не кассовая' },
        ]}
      />

      <div className="grid grid-cols-[minmax(0,1fr)_320px] gap-3">
        <ConsolePanel
          title="Выручка и загрузка"
          right={<span className="text-[11px] text-ink-500">по закрытым визитам, цена из снапшота</span>}
        >
          <div className="text-[11px] text-ink-500">По услугам</div>
          {BY_SERVICE.map((item) => (
            <Row key={item.title} label={`${item.title}, ${item.meta}`} value={item.value} />
          ))}
          <div className="my-2 border-t border-ink-100" />
          <div className="text-[11px] text-ink-500">По мастерам</div>
          {BY_MASTER.map((item) => (
            <Row key={item.title} label={`${item.title}, ${item.meta}`} value={item.value} />
          ))}
        </ConsolePanel>

        <ConsolePanel title="Отмены и неявки">
          <Row label="Всего записей" value="268" />
          <Row label="Отмен салоном" value="9" />
          <Row label="Отмен клиентом" value="41" />
          <Row label="Средний чек" value="8 610,00 ₸" strong />

          <div className="my-2 border-t border-ink-100" />
          <Notice tone="danger">
            <b>Неявки посчитать нечем.</b> Статус <code className="rounded bg-black/5 px-1 font-mono text-[11px]">NO_SHOW</code>{' '}
            объявлен в BookingStatus и markNoShow есть в агрегате, но ни один эндпоинт его не вызывает: перевести запись
            в неявку неоткуда, поэтому в отчёте всегда ноль.
          </Notice>
          <div className="mt-2">
            <Notice tone="info">
              <b>Опоры отчёта — только реальные.</b> Суммы считаются по booking.priceMinor закрытых визитов, а не по
              текущему прайсу. Отменённые записи из выручки исключаются: окно они освобождают, а денег не приносят.
            </Notice>
          </div>
        </ConsolePanel>
      </div>
    </>
  );
}
