/**
 * crm-09 · Графики работы — шаблон недели.
 *
 * Шаблон — таблица working_hours: одна строка на рабочий день, отсутствие строки и есть
 * выходной, перерыв либо целиком внутри смены, либо отсутствует. Ограничения держит база:
 * конец позже начала, перерыв внутри смены, уникальность пары (мастер, день недели).
 *
 * Сетка окон эти строки читает, но ни один эндпоинт их не отдаёт и не меняет: поэтому
 * экран показан как проект, хотя данные и правила уже работают.
 */
import type { ReactNode } from 'react';
import { Badge } from '../../components/ui/Badge';
import { ConsolePanel, ConsoleTable, Notice } from '../kit';

const COLUMNS = ['День недели', 'Смена', 'Перерыв', 'Длина смены', 'Состояние'];

const ROWS: ReactNode[][] = [
  ['Понедельник', '09:00–20:00', '13:00–14:00', '10 ч 00 мин', <Badge tone="success">рабочий</Badge>],
  ['Вторник', '09:00–20:00', '13:00–14:00', '10 ч 00 мин', <Badge tone="success">рабочий</Badge>],
  ['Среда', '09:00–20:00', '13:00–14:30', '10 ч 00 мин', <Badge tone="warning">перерыв увеличен</Badge>],
  ['Четверг', '09:00–20:00', '13:00–14:00', '10 ч 00 мин', <Badge tone="success">рабочий</Badge>],
  ['Пятница', '09:00–20:00', '13:00–14:00', '10 ч 00 мин', <Badge tone="success">рабочий</Badge>],
  ['Суббота', '10:00–18:00', '13:00–14:00', '8 ч 00 мин', <Badge tone="success">рабочий</Badge>],
  ['Воскресенье', '—', '—', '—', <Badge tone="neutral">выходной</Badge>],
];

export default function CrmWorkingHours() {
  return (
    <>
      <div className="flex items-center gap-2">
        <div className="min-w-0">
          <div className="truncate text-[13px] font-semibold text-ink-900">График работы · Динара Ахметова</div>
          <div className="truncate text-[11.5px] text-ink-500">
            Шаблон недели: пн–сб, обед 13:00–14:00, воскресенье — отсутствие строки в шаблоне
          </div>
        </div>
        <span className="ml-auto flex items-center gap-2">
          <Badge tone="danger">в API графика нет</Badge>
          <span className="rounded-full bg-white px-3 py-1.5 text-[12px] text-ink-600 ring-1 ring-ink-200">Исключения</span>
        </span>
      </div>

      <ConsolePanel
        title="Шаблон недели"
        right={<span className="text-[11px] text-ink-500">qtime.working_hours · одна строка на рабочий день</span>}
      >
        <ConsoleTable columns={COLUMNS} rows={ROWS} />
      </ConsolePanel>

      <div className="grid grid-cols-2 gap-3">
        <Notice tone="neutral">
          <b>Правила держит база, а не интерфейс.</b> Одна строка на (specialist_id, day_of_week), перерыв целиком внутри
          смены либо отсутствует; отсутствие строки и есть выходной. Сетка читает это в{' '}
          <code className="rounded bg-black/5 px-1 font-mono text-[11px]">SlotService.windowsFor</code>, но эндпоинта на
          расписание нет.
        </Notice>
        <Notice tone="info">
          <b>Три числа — не настройки салона.</b> Шаг сетки (30 минут), горизонт записи (30 дней) и минимальный запас до
          визита (30 минут) живут в глобальных{' '}
          <code className="rounded bg-black/5 px-1 font-mono text-[11px]">QtimeProperties</code> и одинаковы для салона,
          барбершопа и стоматологии.
        </Notice>
      </div>
    </>
  );
}
