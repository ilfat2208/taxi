/**
 * crm-10 · Исключения расписания.
 *
 * Исключения живут в schedule_exception и уже влияют на сетку: исключение перекрывает
 * недельный шаблон целиком, день отпуска отдаёт пустую сетку, а не ошибку. Ограничения
 * честные — одно исключение на дату, у дополнительной смены часы обязательны, у отпуска
 * часов быть не может.
 *
 * Главный незакрытый вопрос вынесен на экран, а не спрятан: записи, уже стоящие в
 * исключённый день, не отменяются и не переносятся, окна продолжают держаться, а
 * клиентам никто не звонит.
 */
import { Badge } from '../../components/ui/Badge';
import { ConsolePanel, Notice, Row } from '../kit';

interface Exception {
  title: string;
  kind: string;
  tone: 'warning' | 'neutral' | 'brand';
  text: string;
}

const EXCEPTIONS: Exception[] = [
  {
    title: 'Отпуск · Айгуль Смагулова · 5–7 октября',
    kind: 'VACATION',
    tone: 'warning',
    text: 'Часов у отпуска нет и быть не может — ограничение schedule_exception_extra_shift_hours. На 5 октября уже стоят 2 записи, и они продолжают держать окна.',
  },
  {
    title: 'Выходной · Жанар Оспанова · 9 октября',
    kind: 'DAY_OFF',
    tone: 'neutral',
    text: 'Сетка этого дня станет пустой, и клиент увидит «не работаем»: пустой список — законный ответ сетки окон, а не ошибка.',
  },
  {
    title: 'Дополнительная смена · Жанар Оспанова · 10 октября, 12:00–16:00',
    kind: 'EXTRA_SHIFT',
    tone: 'brand',
    text: 'В субботу по шаблону выходной, поэтому смена задаётся часами и обязана быть непустой. Продано 2 окна, свободно 3.',
  },
];

export default function CrmScheduleExceptions() {
  return (
    <>
      <div className="flex items-center gap-2">
        <div className="min-w-0">
          <div className="text-[13px] font-semibold text-ink-900">Исключения расписания</div>
          <div className="truncate text-[11.5px] text-ink-500">Исключение перекрывает недельный шаблон целиком</div>
        </div>
        <span className="ml-auto flex items-center gap-2">
          <Badge tone="danger">в API исключений нет</Badge>
          <span className="rounded-full bg-white px-3 py-1.5 text-[12px] text-ink-600 ring-1 ring-ink-200">+ Исключение</span>
        </span>
      </div>

      <div className="grid grid-cols-[minmax(0,1fr)_300px] gap-3">
        <ConsolePanel title="Ближайшие исключения" right={<span className="text-[11px] text-ink-500">читаются только из базы</span>}>
          <div className="space-y-2">
            {EXCEPTIONS.map((item) => (
              <div key={item.title} className="rounded-xl px-3 py-2 ring-1 ring-inset ring-ink-200">
                <div className="flex items-center gap-2">
                  <span className="min-w-0 flex-1 truncate text-[12.5px] font-semibold text-ink-800">{item.title}</span>
                  <Badge tone={item.tone}>{item.kind}</Badge>
                </div>
                <p className="mt-1 text-[11.5px] leading-[16px] text-ink-600">{item.text}</p>
              </div>
            ))}
          </div>

          <div className="mt-2">
            <Notice tone="danger">
              <b>Главный незакрытый вопрос: записи в исключённый день.</b> Исключение закрывает день для новых записей,
              но подтверждённые записи остаются CONFIRMED и держат окна: автоматической отмены и предупреждения в сервисе
              нет — клиентам никто не звонит.
            </Notice>
          </div>
        </ConsolePanel>

        <ConsolePanel title="Новое исключение">
          <Row label="Мастер" value="Айгуль Смагулова" />
          <Row label="Дата" value="8 октября 2026" />
          <Row label="Вид" value="Отпуск · VACATION" strong />
          <Row label="Время" value="недоступно" />
          <Row label="Заметка" value="отпуск (демо)" />

          <div className="mt-2 flex items-center gap-1 rounded-full bg-ink-100 p-1">
            <span className="rounded-full bg-white px-2.5 py-1 text-[11.5px] font-medium text-ink-900 shadow-sm">Отпуск</span>
            <span className="rounded-full px-2.5 py-1 text-[11.5px] text-ink-600">Выходной</span>
            <span className="rounded-full px-2.5 py-1 text-[11.5px] text-ink-600">Доп. смена</span>
          </div>

          <p className="mt-2 text-[11.5px] leading-[16px] text-ink-600">
            Часов у отпуска быть не может, у дополнительной смены они обязательны. Заметка — до 255 символов; одно
            исключение на пару «мастер и дата».
          </p>

          <div className="mt-2 flex items-center gap-2">
            <span className="rounded-xl bg-brand-300 px-3 py-1.5 text-[12px] font-medium text-white">Сохранить</span>
            <span className="rounded-xl bg-white px-3 py-1.5 text-[12px] text-ink-700 ring-1 ring-ink-200">Отмена</span>
            <span className="text-[10.5px] text-ink-400">эндпоинта нет</span>
          </div>

          <div className="mt-2">
            <Notice tone="info">
              <b>Почему статус «план».</b> Таблица schedule_exception читается сеткой окон, но эндпоинтов на чтение и
              запись нет: показать исключения сегодня можно только из базы.
            </Notice>
          </div>
        </ConsolePanel>
      </div>
    </>
  );
}
