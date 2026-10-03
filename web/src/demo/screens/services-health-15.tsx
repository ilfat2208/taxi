/**
 * ORTA Health — результаты анализов (план).
 *
 * Экрана нет, контракта нет. Это тот случай, когда «просто ещё один список» —
 * неправда: лабораторному результату нужен источник данных, подпись врача, журнал
 * доступа, согласие и срок хранения.
 *
 * Предлагаемые эндпоинты: `GET /api/v1/health/lab-results`,
 * `GET /api/v1/health/lab-results/{id}`, `.../{id}/pdf`, `DELETE .../{id}`;
 * отдельно журнал `GET /api/v1/health/audit?subject=lab-result`.
 *
 * Требование к интерфейсу: приложение не интерпретирует показатели и не пишет «всё
 * в норме» — диапазоны приходят из лаборатории, вывод делает врач, а показатель вне
 * диапазона только помечается. Кнопка удаления обозначает право на удаление,
 * которого в коде пока нет; повторный приём предлагается записью через QTime, а не
 * отдельным календарём.
 */
import { Badge } from '../../components/ui/Badge';
import { Notice, PhoneAppBar, PhoneBody, PhoneCard, Row } from '../kit';

/** Диапазоны лаборатории: приложение их не считает и вывод по ним не делает. */
const MARKERS: Array<{ name: string; value: string; norm: string; out?: boolean }> = [
  { name: 'Гемоглобин', value: '132 г/л', norm: 'норма 120–150' },
  { name: 'Лейкоциты', value: '6,4 ×10⁹', norm: 'норма 4,0–9,0' },
  { name: 'СОЭ', value: '18 мм/ч', norm: 'норма до 15', out: true },
  { name: 'Тромбоциты', value: '240 ×10⁹', norm: 'норма 180–320' },
];

export default function ServicesHealth15() {
  return (
    <>
      <PhoneAppBar
        title="Результаты анализов"
        subtitle="Общий анализ крови · 1 октября 2026"
        back
        right={<Badge tone="success">проверено врачом</Badge>}
      />
      <PhoneBody>
        <PhoneCard>
          <Row label="Лаборатория" value="«Гиппократ», Шымкент" />
          <Row label="Направление" value="Айнур Бекова, 28 сентября" />
          <Row label="Готово" value="1 октября, 09:12" />
        </PhoneCard>

        <PhoneCard title="Показатели и нормы" right={<Badge tone="neutral">диапазоны лаборатории</Badge>}>
          {MARKERS.map((marker) => (
            <div key={marker.name} className="flex items-baseline justify-between gap-3 py-1">
              <span className="text-[12.5px] text-ink-600">
                {marker.name} · <span className="tabular-nums text-ink-800">{marker.value}</span>
              </span>
              <span
                className={
                  marker.out
                    ? 'flex-none rounded-full bg-warning-50 px-2 py-0.5 text-[11px] font-semibold text-warning-700 ring-1 ring-inset ring-amber-200'
                    : 'flex-none text-[11px] tabular-nums text-ink-400'
                }
              >
                {marker.norm}
              </span>
            </div>
          ))}
        </PhoneCard>

        <PhoneCard title="Заключение врача" right={<Badge tone="neutral">подписано</Badge>}>
          <p className="text-[12px] text-ink-700">
            «СОЭ немного выше нормы: повторить через 3 недели, показаться при температуре или боли».
          </p>
          <div className="my-2 border-t border-ink-100" />
          <Row label="Повторный приём" value="22 октября, 14:30 · запись через QTime" strong />
        </PhoneCard>

        <Notice tone="warning">
          <b>Что нужно, чтобы экран стал настоящим.</b> Анализ — медицинский документ: источник
          (лаборатория), подписанное заключение врача, журнал доступа, согласие с отзывом и срок хранения. В
          ORTA этого нет. СОЭ выше нормы только помечено: вывод делает врач, приложение диагноз не ставит.
        </Notice>

        <div className="mt-auto space-y-2">
          <div className="rounded-xl bg-ink-200 py-3 text-center text-[13px] font-semibold text-ink-500">
            Показать врачу на приёме
          </div>
          <div className="rounded-xl bg-white py-2.5 text-center text-[13px] font-medium text-ink-400 ring-1 ring-inset ring-ink-200">
            Удалить результат из приложения
          </div>
        </div>
      </PhoneBody>
    </>
  );
}
