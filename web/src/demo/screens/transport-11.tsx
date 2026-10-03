/**
 * transport-11 — ORTA Auto, история обслуживания.
 *
 * Историю можно собрать из двух работающих источников: завершённые записи QTime
 * и чеки ORTA Pay. Чего нет — параметра «по автомобилю» и сервисной книжки по
 * VIN, поэтому весь список демонстрационный.
 */
import { Kpis, Notice, PhoneAppBar, PhoneBody, PhoneCard, Row } from '../kit';
import { cx } from '../../lib/cx';

const HISTORY: Array<{ title: string; text: string; last: boolean }> = [
  {
    title: '12 сентября 2026 · замена масла и фильтров',
    text: '8 500,00 ₸ · СТО «Мотор-Сервис» · 84 200 км · запись B-2214',
    last: false,
  },
  { title: '4 июня 2026 · шиномонтаж, 4 колеса', text: '6 000,00 ₸ · 79 100 км · балансировка входила', last: false },
  { title: '18 января 2026 · тормозные колодки, перед', text: '22 400,00 ₸ · 71 300 км · гарантия 12 мес.', last: false },
  {
    title: '12 декабря 2024 · первая запись в истории',
    text: '2 900,00 ₸ · 54 000 км · до этого сервис не через ORTA',
    last: true,
  },
];

export default function Transport11() {
  return (
    <>
      <PhoneAppBar title="История обслуживания" subtitle="Toyota Camry 2.5 · 84 200 км" back />
      <PhoneBody>
        <Kpis
          items={[
            { label: 'Работ в истории', value: '7' },
            { label: 'Всего потрачено', value: '74 300,00 ₸', hint: 'демо' },
            { label: 'Пробег', value: '84 200 км', hint: 'демо' },
          ]}
        />

        <PhoneCard title="Последние работы">
          {HISTORY.map((item) => (
            <div key={item.title} className="flex gap-3">
              <span className="flex flex-col items-center">
                <span className={cx('mt-1 h-2.5 w-2.5 flex-none rounded-full', item.last ? 'bg-ink-300' : 'bg-emerald-500')} />
                {item.last ? null : <span className="w-px flex-1 bg-ink-200" />}
              </span>
              <div className="min-w-0 pb-2.5">
                <div className={cx('text-[12.5px] font-medium', item.last ? 'text-ink-500' : 'text-ink-900')}>{item.title}</div>
                <div className="text-[11px] text-ink-500">{item.text}</div>
              </div>
            </div>
          ))}
        </PhoneCard>

        <PhoneCard>
          <Row label="Откуда данные" value="завершённые записи QTime" />
          <Row label="Оплата" value="чеки ORTA Pay" />
          <Row label="Сервисная книжка по VIN" value="не ведётся" />
        </PhoneCard>

        <Notice tone="neutral">
          <b>Честная оговорка.</b> История собирается из завершённых записей и платежей; агрегации «по
          автомобилю» нет — машина как сущность в коде не заведена, и весь список выше демонстрационный.
        </Notice>

        <div className="mt-auto" />
        <div className="rounded-xl border border-ink-200 bg-white px-4 py-2.5 text-center text-[13px] font-medium text-ink-700">
          Показать все записи
        </div>
      </PhoneBody>
    </>
  );
}
