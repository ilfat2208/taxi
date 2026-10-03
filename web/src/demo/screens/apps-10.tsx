/**
 * apps-10 · Список заданий (ORTA Delivery).
 *
 * Статус борда — «План»: заданий курьера в API нет. Заказ маркета
 * (GET /api/v1/orders/{id}) знает адрес доставки, но не курьера, не точку
 * забора и не вес. Предлагаемые ручки: GET /api/v1/couriers/me/tasks?status= и
 * POST /api/v1/couriers/me/tasks/{id}/accept.
 *
 * Честность экрана: номера D-482x и суммы — демонстрационные, ни одного
 * задания курьера в системе не существует. Данные демонстрационные.
 */
import { Badge } from '../../components/ui/Badge';
import { Chips, Money, Notice, PhoneAppBar, PhoneBody, PhoneCard, PhoneTabBar } from '../kit';

const COURIER_TABS = ['Задания', 'Карта', 'Деньги', 'Профиль'];

type TaskTone = 'info' | 'brand' | 'success';

const TASKS: Array<{
  id: string;
  state: string;
  tone: TaskTone;
  payout: number;
  address: string;
  hint: string;
  cargo?: string;
  fragile?: boolean;
}> = [
  {
    id: 'D-4822',
    state: 'в работе',
    tone: 'info',
    payout: 61020,
    address: 'ул. Байтурсынова, 42, кв. 15',
    hint: 'доставить · получатель Айгуль',
    cargo: '12,4 кг · 2 места',
    fragile: true,
  },
  {
    id: 'D-4823',
    state: 'новое',
    tone: 'brand',
    payout: 54000,
    address: 'пр. Республики, 12, кв. 8',
    hint: 'забрать: TechnoMart, Тауке хана, 60',
  },
  {
    id: 'D-4821',
    state: 'доставлено',
    tone: 'success',
    payout: 62000,
    address: '12:38 · ул. Байтурсынова, 42',
    hint: 'задание закрыто',
  },
];

export default function Apps10() {
  return (
    <>
      <PhoneAppBar
        title="Задания смены"
        subtitle="Ерлан Касымов · смена с 14:40 · демо"
        right={<Badge tone="neutral">План</Badge>}
      />
      <PhoneBody>
        <div className="shrink-0">
          <Chips items={['В работе', 'Готовые', 'Все']} active="В работе" />
        </div>

        {TASKS.map((task) => (
          <PhoneCard key={task.id} className="shrink-0">
            <div className="flex items-center gap-2.5">
              <Badge tone={task.tone}>{task.state}</Badge>
              <span className="min-w-0 flex-1 truncate font-mono text-[11.5px] text-ink-500">{task.id}</span>
              <Money minor={task.payout} />
            </div>
            <div className="my-2.5 h-px bg-ink-100" />
            <div className="flex items-start gap-2.5">
              <span className="mt-1 h-2 w-2 flex-none rounded-full bg-[#0F6E8C]" />
              <div className="min-w-0 flex-1">
                <div className="text-[12.5px] font-medium text-ink-800">{task.address}</div>
                <div className="text-[11.5px] text-ink-500">{task.hint}</div>
              </div>
            </div>
            {task.cargo ? (
              <div className="mt-2 flex items-center gap-2">
                <span className="flex-1 text-[12px] text-ink-700">{task.cargo}</span>
                {task.fragile ? <Badge tone="warning">хрупкое</Badge> : null}
              </div>
            ) : null}
          </PhoneCard>
        ))}

        <Notice tone="neutral">
          <b>Заданий курьера в API нет.</b> Заказ маркета живёт в{' '}
          <span className="font-mono">order-service</span>, но ни курьера, ни точки забора, ни веса в нём не
          смоделировано: <span className="font-mono">GET /api/v1/orders/{'{id}'}</span> отдаёт статусы
          DRAFT → PAID → CONFIRMED. Предлагается{' '}
          <span className="font-mono">GET /api/v1/couriers/me/tasks?status=</span>.
        </Notice>
      </PhoneBody>
      <PhoneTabBar items={COURIER_TABS} active="Задания" />
    </>
  );
}
