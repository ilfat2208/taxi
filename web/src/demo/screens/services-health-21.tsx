/**
 * ORTA Jobs — статусы отклика и чат (план).
 *
 * Экрана нет. Образец, который стоит скопировать, есть: append-only таймлайн
 * статусов у `order-service` (`GET /api/v1/orders/{id}` отдаёт историю статусов) —
 * отклик должен ходить по той же дисциплине, иначе статус «висит» и человек не
 * знает, ждут его или нет. Список других откликов с их статусами в рамку не
 * поместился: в приложении это отдельная вкладка «Мои отклики».
 *
 * Предлагаемые эндпоинты и события: `GET /api/v1/jobs/applications?status=`,
 * `GET /api/v1/jobs/applications/{id}` (таймлайн),
 * `GET/POST /api/v1/jobs/applications/{id}/messages` (WebSocket для live),
 * `job.application.invited`, `job.application.rejected`, `job.application.hired`.
 *
 * Спорное место: чат с работодателем — канал обмена персональными данными вне
 * платформы (номера, паспорт, «приходите без оформления»). Нужно решить, что в нём
 * запрещено и кто отвечает за договорённости, иначе сервис работы становится местом
 * для схем. Работодатель показан юрлицом, а не платформой.
 */
import { Badge } from '../../components/ui/Badge';
import { Notice, PhoneAppBar, PhoneBody, PhoneCard } from '../kit';

const TIMELINE: Array<{ title: string; note: string; done: boolean }> = [
  { title: 'Отклик отправлен, резюме просмотрено', note: '1 октября, 09:12 → 11:40 · работодатель', done: true },
  {
    title: 'Приглашение на собеседование',
    note: '2 октября, 09:05 · 3 октября, 10:00, ул. Тауке хана, 83, офис 4',
    done: true,
  },
  { title: 'Решение работодателя', note: 'после собеседования · статус придёт в чат', done: false },
];

export default function ServicesHealth21() {
  return (
    <>
      <PhoneAppBar
        title="Мой отклик"
        subtitle="Водитель такси · ТОО «ORTA Taxi Шымкент» · Шымкент"
        back
        right={<Badge tone="success">приглашение</Badge>}
      />
      <PhoneBody>
        <PhoneCard title="Статусы отклика" right={<Badge tone="neutral">таймлайн</Badge>}>
          <div className="space-y-2">
            {TIMELINE.map((step) => (
              <div key={step.title} className="flex gap-2">
                <span
                  className={
                    step.done
                      ? 'mt-1 h-2.5 w-2.5 flex-none rounded-full bg-success-500'
                      : 'mt-1 h-2.5 w-2.5 flex-none rounded-full bg-ink-300'
                  }
                />
                <div className="min-w-0">
                  <div className="text-[12.5px] text-ink-800">{step.title}</div>
                  <div className="text-[11px] text-ink-500">{step.note}</div>
                </div>
              </div>
            ))}
          </div>
        </PhoneCard>

        <PhoneCard
          title="ORTA Taxi · отдел водителей"
          right={<Badge tone="warning">чат не работает</Badge>}
        >
          <div className="space-y-2">
            <div className="max-w-[260px] rounded-2xl bg-ink-100 px-3 py-2 text-[12px] text-ink-800">
              Приглашаем на собеседование 3 октября в 10:00, ул. Тауке хана, 83. Возьмите права и удостоверение.
            </div>
            <div className="flex justify-end">
              <span className="max-w-[260px] rounded-2xl bg-brand-500 px-3 py-2 text-[12px] text-white">
                Здравствуйте! Подойду. Можно оформить в этот же день?
              </span>
            </div>
            <div className="max-w-[260px] rounded-2xl bg-ink-100 px-3 py-2 text-[12px] text-ink-800">
              Да, если медсправка на руках. Техпаспорт оформляем мы.
            </div>
          </div>
          <div className="mt-2 flex items-center gap-2 rounded-xl border border-ink-200 px-3 py-2">
            <span className="text-[12px] text-ink-400">Написать сообщение…</span>
            <span className="ml-auto rounded-lg bg-ink-200 px-2 py-1 text-[10px] text-ink-500">отправка</span>
          </div>
        </PhoneCard>

        <Notice tone="warning">
          <b>Чат с работодателем — канал передачи персональных данных.</b> Здесь обмениваются номерами,
          документами и договорённостями «приходите без оформления» — вне платформы. Что в чате запрещено и кто
          отвечает за договорённости, решается до запуска.
        </Notice>

        <Notice tone="info">
          <b>Всё на этом экране — макет.</b> Ни откликов, ни статусов, ни чата в ORTA нет. Показана форма:
          переходы статусов пишутся таймлайном, как у заказов маркета.
        </Notice>
      </PhoneBody>
    </>
  );
}
