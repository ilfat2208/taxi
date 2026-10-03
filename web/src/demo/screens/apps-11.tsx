/**
 * apps-11 · Карточка задания, проблема и поддержка (ORTA Delivery).
 *
 * Статус борда — «План»: карточка задания — план целиком, у курьера нет ни
 * заданий, ни канала связи. Чата поддержки в API нет: ручки /api/v1/support/**
 * — это доступ оператора к данным с аудитом чтения, а не переписка.
 * Предлагаемая ручка: POST /api/v1/couriers/me/tasks/{id}/issue.
 *
 * Честность экрана: адрес, вес и комментарий покупателя демонстрационные; ни
 * задания, ни обращения в API нет. Данные демонстрационные.
 */
import { Badge } from '../../components/ui/Badge';
import { Chips, Money, Notice, PhoneAppBar, PhoneBody, PhoneCard } from '../kit';

const TASK = {
  id: 'D-4822',
  accepted: 'принято 14:52',
  cargo: '12,4 кг · 2 места',
  payout: 61020,
  deadline: 'до 15:10 · 1,8 км до адреса',
  pickup: 'FreshMarket, пр. Тауке хана, 60',
  pickupHint: 'забрать · 2 места, уже собраны',
  dropoff: 'ул. Байтурсынова, 42, кв. 15',
  dropoffHint: 'доставить · подъезд 2, этаж 4, домофон 15',
  comment: '«Домофон 15, позвоните за 10 минут. Если не открою — оставьте у консьержа.»',
};

const ISSUES = ['Получателя нет дома', 'Адрес не найден', 'Груз повреждён'];

export default function Apps11() {
  return (
    <>
      <PhoneAppBar title={`Задание ${TASK.id}`} subtitle={`${TASK.accepted} · вес 12,4 кг`} back />
      <PhoneBody>
        <PhoneCard className="shrink-0">
          <div className="flex items-center gap-2.5">
            <Badge tone="info">в работе</Badge>
            <span className="min-w-0 flex-1 truncate text-[11.5px] text-ink-500">{TASK.deadline}</span>
            <Money minor={TASK.payout} />
          </div>
          <div className="my-2.5 h-px bg-ink-100" />
          <div className="flex gap-2.5">
            <div className="flex flex-none flex-col items-center pt-1">
              <span className="h-2.5 w-2.5 rounded-full bg-[#0F6E8C]" />
              <span className="my-1 h-5 w-0.5 bg-ink-200" />
              <span className="h-2.5 w-2.5 rounded-[3px] bg-ink-400" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-[12.5px] font-semibold text-ink-900">{TASK.pickup}</div>
              <div className="text-[11.5px] text-ink-500">{TASK.pickupHint}</div>
              <div className="mt-2 text-[12.5px] font-semibold text-ink-900">{TASK.dropoff}</div>
              <div className="text-[11.5px] text-ink-500">{TASK.dropoffHint}</div>
            </div>
          </div>
          <div className="my-2.5 h-px bg-ink-100" />
          <div className="flex items-center gap-2">
            <span className="flex-1 text-[12px] text-ink-700">{TASK.cargo}</span>
            <Badge tone="warning">хрупкое</Badge>
          </div>
        </PhoneCard>

        <Notice tone="info">
          <b>Комментарий покупателя.</b> {TASK.comment}
        </Notice>

        <div className="shrink-0 text-[11px] font-semibold uppercase tracking-wide text-ink-500">
          Проблема с заданием
        </div>
        <div className="shrink-0">
          <Chips items={ISSUES} />
        </div>

        <PhoneCard className="shrink-0">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <div className="text-[13px] text-ink-800">Чат поддержки ORTA</div>
              <div className="text-[11px] text-ink-500">
                ручки <span className="font-mono">/api/v1/support/**</span> — доступ оператора, не переписка
              </div>
            </div>
            <Badge tone="neutral">план</Badge>
          </div>
        </PhoneCard>

        <div className="flex shrink-0 flex-col gap-2">
          <div className="rounded-xl bg-[#0F6E8C] px-3 py-2.5 text-center text-[13px] font-semibold text-white">
            В путь к получателю
          </div>
          <div className="rounded-xl bg-ink-100 px-3 py-2.5 text-center text-[13px] font-semibold text-ink-700">
            Сообщить о проблеме
          </div>
        </div>
      </PhoneBody>
    </>
  );
}
