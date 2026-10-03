/**
 * ORTA Jobs — отклик и резюме (план).
 *
 * Экрана нет. Полезная часть — то, что уже готово и переиспользуется: аккаунт
 * ORTA ID (`GET /api/v1/auth/me`, роли из JWT) даёт контакт и личность, правила
 * ролей — `platform/common-security-core`. Всё остальное — резюме, отклик,
 * видимость контактов, согласие на передачу данных работодателю — новая область.
 *
 * Предлагаемые эндпоинты: `GET/PUT /api/v1/jobs/resumes/me`,
 * `POST /api/v1/jobs/vacancies/{id}/applications` (с `Idempotency-Key`, как у
 * заказов и записей), `POST /api/v1/jobs/consents`, `DELETE /api/v1/jobs/resumes/me`;
 * события `job.application.created`, `job.application.viewed`.
 *
 * Требование: резюме видно только тем, кому человек откликнулся. Телефон и
 * документы закрыты до отклика — работодатель не может найти человека поиском по
 * номеру, это правило, а не настройка по умолчанию. Отклик отправляет человек, а не
 * алгоритм: иначе получается база резюме, которую покупают. Согласие на передачу
 * данных, срок хранения и удаление резюме — условие запуска сервиса, а не
 * «настройки приватности».
 */
import { Badge } from '../../components/ui/Badge';
import { Notice, PhoneAppBar, PhoneBody, PhoneCard, Row } from '../kit';

export default function ServicesHealth20() {
  return (
    <>
      <PhoneAppBar
        title="Отклик на вакансию"
        subtitle="Водитель такси · ТОО «ORTA Taxi Шымкент» · Шымкент"
        back
        right={<Badge tone="neutral">План</Badge>}
      />
      <PhoneBody>
        <PhoneCard title="Резюме" right={<span className="text-[12px] text-brand-600">Редактировать</span>}>
          <div className="flex items-center gap-3">
            <span className="grid h-10 w-10 flex-none place-items-center rounded-full bg-success-50 text-[14px] font-semibold text-success-700 ring-1 ring-inset ring-emerald-200">
              Е
            </span>
            <div className="min-w-0 flex-1">
              <div className="text-[13px] font-semibold text-ink-900">Ержан Абдуллаев</div>
              <div className="text-[11.5px] text-ink-500">водитель категории B · стаж 8 лет · Шымкент</div>
            </div>
          </div>
          <div className="mt-2" />
          <Row label="Опыт" value="такси 5 лет, доставка 3 года" />
          <Row label="Права и медсправка" value="B, C · до 14.03.2027" />
          <Row label="Контакт из ORTA ID" value={<span className="font-mono">+7 700 123 45 67</span>} strong />
        </PhoneCard>

        <Notice tone="info">
          <b>Резюме видно только тем, кому вы откликнулись.</b> Телефон и документы закрыты до отклика:
          работодатель не может найти вас поиском по номеру. Это правило, а не настройка по умолчанию, и
          согласие на передачу данных даётся вместе с откликом.
        </Notice>

        <div className="rounded-xl border border-ink-200 bg-white px-3 py-2">
          <div className="text-[11px] text-ink-500">Сопроводительное письмо · необязательно</div>
          <div className="text-[13px] text-ink-800">
            Работал на такси 5 лет, Шымкент знаю хорошо. Готов к сменам 2/2.
          </div>
        </div>

        <Notice tone="warning">
          <b>Сервиса работы нет: это макет.</b> Ни резюме, ни отклика, ни правил видимости контактов в ORTA не
          существует. Показано требование: согласие на передачу данных, срок хранения и удаление резюме
          (<code>DELETE /jobs/resumes/me</code>) — условие запуска, а проверка работодателя и запрет на
          перепродажу базы решаются до первого отклика, а не после.
        </Notice>

        <div className="mt-auto space-y-2">
          <div className="rounded-xl bg-brand-500 py-3 text-center text-[13px] font-semibold text-white">
            Отправить отклик
          </div>
          <div className="rounded-xl bg-white py-2.5 text-center text-[13px] font-medium text-ink-700 ring-1 ring-inset ring-ink-200">
            Как это увидит работодатель
          </div>
        </div>
      </PhoneBody>
    </>
  );
}
