/**
 * platform-05 · Бизнес-аккаунт — сотрудники и доступы, веб-консоль (консоль, план).
 *
 * Макет: мультипользовательского доступа в коде нет — есть один аккаунт с ролью `MERCHANT`.
 * Показано, что именно требуется платформе: роль на организацию, приглашение и отзыв доступа,
 * разделение права на заказы и на выплаты, журнал действий сотрудника. Отдельно выделено право
 * на возврат денег: оно не должно доставаться вместе с ролью «оператор» — решает компания,
 * а отвечает перед покупателем ORTA.
 */
import { Badge } from '../../components/ui/Badge';
import { ConsolePanel, Kpis, Notice, Row } from '../kit';

const MEMBERS: Array<{ name: string; hint: string; role: string; tone: 'brand' | 'warning' | 'neutral'; letter: string }> = [
  { name: 'Асхат С.', hint: 'Владелец · все права', role: 'владелец', tone: 'brand', letter: 'А' },
  { name: 'Дана К.', hint: 'Оператор · заказы и чаты, выплаты не видит', role: 'оператор', tone: 'warning', letter: 'Д' },
  { name: 'Курьер-подрядчик', hint: 'Только доставка: статусы и адреса', role: 'курьер', tone: 'neutral', letter: 'К' },
];

const NEEDED: Array<{ k: string; v: string }> = [
  { k: 'Роль на организацию', v: 'нужна' },
  { k: 'Приглашение и отзыв доступа', v: 'нужны' },
  { k: 'Разделение выплаты / заказы', v: 'нужно' },
  { k: 'Журнал действий сотрудника', v: 'нужен' },
];

export default function Platform05Screen() {
  return (
    <>
      <Kpis
        items={[
          { label: 'Организаций у аккаунта', value: '1', hint: 'ИП «Сейтказы»' },
          { label: 'Сотрудников', value: '3', hint: 'роль одна на аккаунт' },
          { label: 'Роль на организацию', value: 'нет', hint: 'только MERCHANT' },
        ]}
      />

      <div className="flex min-h-0 flex-1 gap-3">
        <ConsolePanel
          className="flex min-h-0 flex-1 flex-col"
          title="ИП «Сейтказы» · Магазин электроники"
          right={<Badge tone="success">активна</Badge>}
        >
          <Row label="ИИН / БИН" value="880101 300 123" />
          <Row label="Роль владельца" value={<span className="font-mono text-[12px]">MERCHANT</span>} />
          <Row label="Выплаты" value="счёт KZT · 4 812 300,00 ₸" />
          <div className="my-2 h-px bg-ink-100" />

          <div className="divide-y divide-ink-50">
            {MEMBERS.map((member) => (
              <div key={member.name} className="flex items-center gap-3 py-2">
                <span className="grid h-9 w-9 flex-none place-items-center rounded-full bg-gradient-to-br from-brand-400 to-brand-700 text-[13px] font-semibold text-white">
                  {member.letter}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] font-medium text-ink-800">{member.name}</span>
                  <span className="block truncate text-[11.5px] text-ink-500">{member.hint}</span>
                </span>
                <Badge tone={member.tone}>{member.role}</Badge>
              </div>
            ))}
          </div>

          <div className="my-2 h-px bg-ink-100" />
          <div className="flex items-center justify-between gap-3">
            <span className="text-[11.5px] text-ink-500">Приглашение по телефону · приходит SMS со ссылкой</span>
            <span className="rounded-lg bg-brand-500 px-3 py-1.5 text-[12px] font-medium text-white">
              Пригласить сотрудника
            </span>
          </div>
          <p className="mt-2 text-[11.5px] text-ink-500">
            Предлагаемые ручки: <code className="rounded bg-ink-100 px-1">GET /api/v1/organizations/{'{id}'}/members</code>,{' '}
            <code className="rounded bg-ink-100 px-1">POST /api/v1/organizations/{'{id}'}/invitations</code>,{' '}
            <code className="rounded bg-ink-100 px-1">DELETE …/members/{'{userId}'}</code>.
          </p>
        </ConsolePanel>

        <ConsolePanel className="flex min-h-0 w-[360px] flex-none flex-col" title="Что решает этот раздел">
          <p className="text-[12px] leading-snug text-ink-600">
            Сегодня роль одна на аккаунт: человек либо <code className="rounded bg-ink-100 px-1">MERCHANT</code>, либо нет.
            Отсюда следует, что бухгалтер и продавец-консультант получают один и тот же доступ, а сотрудник,
            принятый на неделю, остаётся с доступом навсегда.
          </p>
          <div className="my-2 h-px bg-ink-100" />
          {NEEDED.map((item) => (
            <Row key={item.k} label={item.k} value={item.v} />
          ))}
          <div className="mt-2">
            <Notice tone="warning">
              <b>Границы ответственности.</b> Кто из сотрудников может вернуть деньги покупателю — решает компания,
              но отвечает перед покупателем ORTA. Поэтому право на возврат и на изменение цены должно быть отдельным
              правом, а не частью роли «оператор».
            </Notice>
          </div>
          <p className="mt-2 text-[11.5px] text-ink-500">
            Журнал действий сотрудника (<code className="rounded bg-ink-100 px-1">GET …/organizations/{'{id}'}/audit</code>)
            нужен раньше, чем выплаты: без него спор «кто отменил заказ» неразрешим.
          </p>
        </ConsolePanel>
      </div>
    </>
  );
}
