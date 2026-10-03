/**
 * home-food-17 · ORTA Build — техника в аренду с почасовой ставкой.
 *
 * Что на экране: машина с почасовой ставкой и условиями, выбор числа часов, режим
 * «с оператором», время и адрес подачи, счёт с итогом и бронирование.
 *
 * Честно: занятость машины по часам — та же задача, что свободные окна в QTime, и
 * отдельного расписания техники пока нет. А вот деньги — готовая платформа: холд
 * (POST /api/v1/accounts/internal/holds) и списание после смены уже работают.
 * Топливо считается по факту и отдельно.
 */
import { Badge } from '../../components/ui/Badge';
import { Chips, Money, Notice, PhoneAppBar, PhoneBody, PhoneCard, PhoneTabBar, Placeholder, Row } from '../kit';

const TABS = ['Home', 'Food', 'Tickets', 'Build', 'Rent'];

const CREW_MODES = ['С оператором', 'Без оператора'];

export default function HomeFood17() {
  return (
    <>
      <PhoneAppBar title="Техника в аренду" subtitle="Почасовая ставка · подача по Шымкенту" back />
      <PhoneBody>
        <PhoneCard>
          <div className="flex gap-2.5">
            <Placeholder
              label="машина — плейсхолдер"
              className="wrap-anywhere h-[56px] w-[64px] flex-none text-center text-[10px]! leading-tight"
            />
            <div className="min-w-0 flex-1">
              <div className="truncate text-[12.5px] font-semibold text-ink-900">Экскаватор-погрузчик JCB 3CX</div>
              <div className="text-[11px] text-ink-500">ковш 1 м³ · оператор включён · 2019 г.</div>
              <div className="text-[12px]">
                <Money minor={1_200_000} />
                <span className="text-ink-500"> / час</span>
              </div>
            </div>
          </div>
          <div className="mt-2 flex flex-wrap gap-1.5">
            <Badge tone="success">Свободен завтра</Badge>
            <Badge tone="neutral">минимум 4 часа</Badge>
            <Badge tone="neutral">подача 25 000 ₸</Badge>
          </div>
        </PhoneCard>

        <PhoneCard title="Сколько часов нужно">
          <div className="flex items-center justify-between gap-2">
            <div className="min-w-0">
              <div className="text-[12.5px] text-ink-800">Минимум 4 часа, дальше шаг 1 час</div>
              <div className="text-[11px] text-ink-500">Ставка 12 000 ₸ за час</div>
            </div>
            <span className="flex flex-none items-center gap-2 rounded-lg bg-ink-100 px-2.5 py-1 text-[13px] text-ink-600">
              <span>−</span>
              <span className="font-semibold text-ink-900">8</span>
              <span>+</span>
            </span>
          </div>
          <div className="mt-2">
            <Chips items={CREW_MODES} active="С оператором" />
          </div>
          <div className="mt-2 rounded-xl border border-ink-200 bg-white px-3 py-2">
            <div className="text-[11px] text-ink-500">Когда · адрес объекта</div>
            <div className="text-[12.5px] text-ink-800">Завтра, 8:00–16:00 · Тауке хана, 83</div>
          </div>
        </PhoneCard>

        <PhoneCard>
          <Row label="Аренда 8 ч × 12 000,00 ₸" value={<Money minor={9_600_000} />} />
          <Row label="Подача в пределах города" value={<Money minor={2_500_000} />} />
          <Row label="Итого к оплате" value={<Money minor={12_100_000} />} strong />
        </PhoneCard>

        <Notice tone="info">
          Занятость машины по часам — та же задача, что свободные окна в QTime, отдельного расписания техники
          нет. Деньги — готовое ядро: холд
          POST /api/v1/accounts/internal/holds, списание после смены. Топливо — по факту и отдельно.
        </Notice>

        <div className="rounded-xl bg-brand-500 px-4 py-2.5 text-center text-[13px] font-semibold text-white">
          Забронировать · 121 000,00 ₸
        </div>
      </PhoneBody>
      <PhoneTabBar items={TABS} active="Build" />
    </>
  );
}
