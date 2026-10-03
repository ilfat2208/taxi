/**
 * apps-08 · Профиль и рейтинг (приложение водителя).
 *
 * Статус борда — «В работе»: профиль отдаёт GET /api/v1/drivers/me — смену,
 * рейтинг в базисных пунктах (492 = 4,92), число поездок, документы. Рейтинг
 * ставит пассажир: POST /api/v1/trips/{tripId}/rate, повтор — 409
 * TRIP_ALREADY_RATED, значение вне диапазона — 400 INVALID_RATING.
 *
 * Честность экрана: автомобиля в driver-service нет, телефона пассажира в API
 * поездки нет, acceptance_rate живёт только эскизом roadmap §5, а заработок и
 * поддержка в приложении не сделаны. Данные демонстрационные.
 */
import { Badge } from '../../components/ui/Badge';
import { Kpis, Notice, PhoneAppBar, PhoneBody, PhoneCard, PhoneTabBar } from '../kit';

const DRIVER_TABS = ['Смена', 'Поездки', 'Деньги', 'Профиль'];

const MENU: Array<{ title: string; state: string; tone: 'warning' | 'neutral' }> = [
  { title: 'Документы', state: '1 истекает', tone: 'warning' },
  { title: 'Заработок и выплаты', state: 'план', tone: 'neutral' },
  { title: 'Поддержка', state: 'план', tone: 'neutral' },
];

export default function Apps08() {
  return (
    <>
      <PhoneAppBar
        title="Профиль водителя"
        subtitle="GET /api/v1/drivers/me · демо"
        right={<Badge tone="success">ONLINE</Badge>}
      />
      <PhoneBody>
        <PhoneCard className="shrink-0">
          <div className="flex items-center gap-3">
            <span className="grid h-13 w-13 flex-none place-items-center rounded-full bg-gradient-to-br from-brand-400 to-brand-700 text-[17px] font-bold text-white">
              АС
            </span>
            <div className="min-w-0 flex-1">
              <div className="truncate text-[14px] font-semibold text-ink-900">Айдар Сериков</div>
              <div className="truncate text-[11.5px] text-ink-500">+7 701 567 67 65</div>
              <div className="truncate text-[11.5px] text-ink-500">водитель · Шымкент</div>
            </div>
          </div>
        </PhoneCard>

        <Kpis
          items={[
            { label: 'рейтинг (bp 492)', value: '4,92' },
            { label: 'поездок', value: '1 248' },
            { label: 'документа', value: '3 / 3', hint: '1 истекает' },
          ]}
        />

        <PhoneCard className="shrink-0">
          {MENU.map((item, index) => (
            <div key={item.title}>
              {index > 0 ? <div className="h-px bg-ink-50" /> : null}
              <div className="flex items-center justify-between gap-3 py-2">
                <span className="text-[13px] text-ink-800">{item.title}</span>
                <Badge tone={item.tone}>{item.state}</Badge>
              </div>
            </div>
          ))}
        </PhoneCard>

        <Notice tone="danger">
          <b>Чего нет и это важно.</b> Автомобиль в <span className="font-mono">driver-service</span> не
          смоделирован: ни марки, ни номера — пассажир машину не увидит. Телефона пассажира в поездке тоже нет, а
          принятие заказов (<span className="font-mono">acceptance_rate</span>) живёт только эскизом roadmap §5.
        </Notice>

        <div className="shrink-0 rounded-xl bg-ink-100 px-3 py-2.5 text-center text-[13px] font-semibold text-ink-700">
          Уйти с линии
        </div>
      </PhoneBody>
      <PhoneTabBar items={DRIVER_TABS} active="Профиль" />
    </>
  );
}
