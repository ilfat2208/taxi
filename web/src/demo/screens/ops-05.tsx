/**
 * ops-05 · Поддержка · чат с клиентом.
 *
 * Честность экрана: сервиса обращений и чата нет, пушей и центра уведомлений тоже — клиенту некуда
 * доставить ответ, сегодня есть только события в Kafka. Поэтому ручки на экране — предложение.
 * Переписка, SLA и номер обращения — демо; связка с платежом и поездкой — существующие чтения (ops-03).
 */
import { Badge } from '../../components/ui/Badge';
import { Chips, ConsolePanel, Notice, Row } from '../kit';

export default function Ops05Chat() {
  return (
    <>
      <div className="flex flex-none items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[15px] font-bold tracking-tight text-ink-900">Обращение #4821 · Айша Н.</div>
          <div className="truncate text-[12px] text-ink-500">Открыто 09:52 · канал: приложение (демо)</div>
        </div>
        <div className="flex flex-none items-center gap-2">
          <Badge tone="warning">ждёт ответа 4 мин</Badge>
          <span className="rounded-xl bg-white px-3 py-1.5 text-[12px] text-ink-600 ring-1 ring-ink-200">Закрыть</span>
        </div>
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-2 gap-3">
        <ConsolePanel
          title="Переписка"
          right={<Badge tone="neutral">тема: списание за поездку</Badge>}
        >
          <div className="flex flex-col gap-2.5">
            <div>
              <div className="max-w-[78%] rounded-2xl rounded-bl-md bg-ink-100 px-3 py-2 text-[12.5px] leading-[19px] text-ink-800">
                Здравствуйте! Списали 1 848 ₸, а поездка была 905 ₸. Почему?
              </div>
              <div className="mt-1 text-[10.5px] text-ink-400">клиент · 09:52</div>
            </div>

            <div className="self-end text-right">
              <div className="max-w-[78%] rounded-2xl rounded-br-md bg-brand-50 px-3 py-2 text-[12.5px] leading-[19px] text-brand-800 ring-1 ring-brand-100">
                Здравствуйте! Проверила: это две разные поездки — 28 сентября на 905,72 ₸ и сегодня на 1 848,00 ₸.
                Покажу обе в чеке.
              </div>
              <div className="mt-1 text-[10.5px] text-ink-400">support-agent-1 · 09:54</div>
            </div>

            <div>
              <div className="max-w-[78%] rounded-2xl rounded-bl-md bg-ink-100 px-3 py-2 text-[12.5px] leading-[19px] text-ink-800">
                А можно вернуть деньги за сегодняшнюю?
              </div>
              <div className="mt-1 text-[10.5px] text-ink-400">клиент · 09:58</div>
            </div>
          </div>

          <div className="mt-3">
            <Chips
              items={[
                'Прикрепить платёж',
                'Прикрепить поездку',
                'Шаблон: «чек в приложении»',
                'Передать оператору',
              ]}
            />
          </div>

          <div className="mt-3 flex items-center gap-2 rounded-xl border border-ink-200 bg-white px-3 py-2.5">
            <span className="text-[12.5px] text-ink-400">Ответ клиенту или шаблон…</span>
            <span className="ml-auto rounded-lg bg-ink-100 px-2.5 py-1 text-[12px] text-ink-400">Отправить</span>
          </div>
          <div className="mt-2 text-[11px] text-ink-400">
            Отправка недоступна: доставить сообщение клиенту сегодня нечем.
          </div>
        </ConsolePanel>

        <div className="flex min-h-0 flex-col gap-3">
          <ConsolePanel title="Контекст обращения">
            <Row label="Платёж" value={<span className="font-mono text-[11.5px]">PM-01J8ZCQ7Y4R3</span>} />
            <Row label="Поездка" value={<span className="font-mono text-[11.5px]">T01M3Y1A…690MJF</span>} />
            <Row label="Запись QTime" value={<span className="font-mono text-[11.5px]">B-01M3YB7QK2</span>} />
            <Row label="Чтений по клиенту" value="2 за сутки" />
            <Row label="SLA ответа" value="15 мин" />
          </ConsolePanel>

          <ConsolePanel title="Экран — предложение" right={<Badge tone="neutral">план</Badge>}>
            <Notice tone="warning">
              <b>Сервиса обращений нет.</b> Ни обращений, ни сообщений, ни центра уведомлений, ни пушей: клиенту
              некуда доставить ответ. Предлагаемые ручки — только предложение:{' '}
              <span className="font-mono">POST /api/v1/support/conversations</span>,{' '}
              <span className="font-mono">GET …/{'{id}'}/messages</span>,{' '}
              <span className="font-mono">POST …/{'{id}'}/assign</span>.
            </Notice>
            <div className="mt-2 text-[11px] text-ink-500">
              Связка платёж/поездка/запись — уже работающие чтения из карточек поддержки. Переписка, время и номер
              обращения — демо.
            </div>
          </ConsolePanel>
        </div>
      </div>
    </>
  );
}
