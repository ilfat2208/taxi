/**
 * ORTA Health — телемедицина (план).
 *
 * Экрана нет и быть не может «между делом»: телемедицина — лицензируемая
 * деятельность, а в репозитории нет ни видеосвязи, ни чата с врачом, ни подписи
 * заключения.
 *
 * Предлагаемые эндпоинты и события: `POST /api/v1/health/telemed/sessions`,
 * `GET .../sessions/{id}`, `POST .../sessions/{id}/messages` (WebSocket для live),
 * `POST .../sessions/{id}/conclusion` (подпись врача), `telemed.session.started`,
 * `telemed.conclusion.signed`.
 *
 * Требование: переписка и вложения — медицинские данные (согласие, доступ, срок
 * хранения, шифрование), рецепт без подписи врача не существует. В макете
 * заключение помечено «черновик, без подписи» именно поэтому, а фото зева не
 * нарисовано: загрузка изображений тела — отдельное решение по хранению и
 * доступу, которое нельзя унаследовать от портфолио мастера. Поэтому кнопки
 * приёма отключены намеренно.
 */
import { Badge } from '../../components/ui/Badge';
import { Notice, PhoneAppBar, PhoneBody, PhoneCard, Row } from '../kit';

export default function ServicesHealth16() {
  return (
    <>
      <PhoneAppBar
        title="Айнур Бекова · терапевт"
        subtitle="приём 20 мин · 5 000 ₸ · стаж 12 лет"
        back
        right={<Badge tone="neutral">План</Badge>}
      />
      <PhoneBody>
        <PhoneCard title="Переписка приёма" right={<Badge tone="warning">не подключено</Badge>}>
          <div className="space-y-2">
            <div className="max-w-[260px] rounded-2xl bg-ink-100 px-3 py-2 text-[12px] text-ink-800">
              Здравствуйте! Расскажите, что беспокоит: температура, кашель, как давно?
            </div>
            <div className="flex justify-end">
              <span className="max-w-[260px] rounded-2xl bg-brand-500 px-3 py-2 text-[12px] text-white">
                Температура 37,8 третий день, сухой кашель
              </span>
            </div>
            <div className="max-w-[260px] rounded-2xl bg-ink-100 px-3 py-2 text-[12px] text-ink-800">
              Есть ли одышка при нагрузке?
            </div>
          </div>
          <div className="mt-2 flex items-center gap-2 rounded-xl border border-ink-200 px-3 py-2">
            <span className="text-[12px] text-ink-400">Сообщение врачу…</span>
            <span className="ml-auto rounded-lg bg-ink-200 px-2 py-1 text-[10px] text-ink-500">отправка</span>
          </div>
        </PhoneCard>

        <PhoneCard title="Итог приёма" right={<Badge tone="neutral">черновик, без подписи</Badge>}>
          <Row label="Рекомендация" value="обильное питьё, контроль температуры" />
          <Row label="Направление" value="ОАК + СОЭ" />
          <Row label="Подпись врача" value="нет" strong />
        </PhoneCard>

        <Notice tone="warning">
          <b>Ни телемедицины, ни связи с врачом в ORTA нет.</b> Нет видеосвязи, чата с врачом и подписи
          заключения: это лицензируемая деятельность. Рецепты здесь не выдаются, а переписка и вложения —
          медицинские данные.
        </Notice>

        <div className="mt-auto space-y-2">
          <div className="rounded-xl bg-ink-200 py-3 text-center text-[13px] font-semibold text-ink-500">
            Продолжить приём
          </div>
          <div className="rounded-xl bg-ink-200 py-2.5 text-center text-[13px] font-semibold text-ink-500">
            Завершить без заключения
          </div>
          <p className="text-center text-[11px] text-ink-400">
            Кнопки отключены намеренно: до лицензии, согласий и подписи врача приём не запускается
          </p>
        </div>
      </PhoneBody>
    </>
  );
}
