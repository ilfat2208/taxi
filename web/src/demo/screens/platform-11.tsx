/**
 * platform-11 · Перевод по телефону (телефон, работает).
 *
 * Получатель ищется по номеру, реквизиты не вводятся: `POST /api/v1/payments/transfers` из
 * `services/payment-service`, поиск счёта — `GET /api/v1/accounts/internal/resolve`. Обязательный
 * `Idempotency-Key` — не формальность: без него повтор при обрыве сети спишет деньги дважды,
 * а тот же ключ с другим телом даёт `409 IDEMPOTENCY_CONFLICT`. Нехватка доступных денег —
 * `422 INSUFFICIENT_FUNDS` (зарезервированные не считаются), лимит — `422 LIMIT_EXCEEDED`.
 */
import { Badge } from '../../components/ui/Badge';
import { Chips, Notice, PhoneAppBar, PhoneBody, PhoneCard, PhoneTabBar, Row } from '../kit';

const TABS = ['Главная', 'История', 'Переводы', 'Профиль'];
const AMOUNTS = ['5 000 ₸', '15 000 ₸', 'Вся доступная'];

export default function Platform11Screen() {
  return (
    <>
      <PhoneAppBar
        back
        title="Перевод по телефону"
        subtitle="ORTA Pay · со счёта Основной · KZT"
        right={<Badge tone="success">работает</Badge>}
      />
      <PhoneBody>
        <div className="rounded-xl border border-ink-200 bg-white px-3 py-2">
          <div className="text-[11px] text-ink-500">Номер получателя</div>
          <div className="text-[15px] font-medium tabular-nums text-ink-900">+7 701 555 22 11</div>
        </div>
        <p className="-mt-1 text-[11px] text-ink-500">Получатель ищется по номеру: реквизиты вводить не нужно.</p>

        <PhoneCard>
          <div className="flex items-center gap-3">
            <span className="grid h-10 w-10 flex-none place-items-center rounded-full bg-gradient-to-br from-brand-400 to-brand-700 text-[14px] font-semibold text-white">
              А
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[14px] font-semibold text-ink-900">Айгуль Т.</span>
              <span className="block truncate text-[11.5px] text-ink-500">найден по номеру · GET /accounts/internal/resolve</span>
            </span>
            <Badge tone="success">проверен</Badge>
          </div>
        </PhoneCard>

        <div className="rounded-xl border border-brand-200 bg-brand-50/50 px-3 py-2">
          <div className="text-[11px] text-ink-500">Сумма · комментарий «Обед»</div>
          <div className="text-[22px] font-semibold tabular-nums text-ink-900">15 000 ₸</div>
        </div>
        <Chips items={AMOUNTS} active="15 000 ₸" />

        <PhoneCard title="Итог операции">
          <Row label="Со счёта" value="Основной · доступно 20 000,00 ₸" />
          <Row label="Комиссия внутри ORTA" value="0,00 ₸" />
          <Row label="Останется на счёте" value="5 000,00 ₸" strong />
        </PhoneCard>

        <Notice tone="info">
          <b>Повтор нажатия не спишет дважды.</b> Запрос уходит с ключом <code className="rounded bg-white/60 px-1">Idempotency-Key</code>:
          тот же ключ с тем же телом вернёт исходный ответ, а с другим телом — <code className="rounded bg-white/60 px-1">409 IDEMPOTENCY_CONFLICT</code>.
          Резерв при отказе не создаётся.
        </Notice>

        <div className="mt-auto rounded-xl bg-brand-500 py-3 text-center text-[14px] font-semibold text-white">
          Перевести 15 000 ₸
        </div>
      </PhoneBody>
      <PhoneTabBar items={TABS} active="Переводы" />
    </>
  );
}
