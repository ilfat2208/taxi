/**
 * apps-09 · Смена курьера (ORTA Delivery).
 *
 * Статус борда — «План»: курьерского приложения и сервиса нет, роли COURIER и
 * заданий курьера в моделях не существует — ORTA Delivery на борде помечено как
 * «код не начат». Предлагаемые ручки: POST /api/v1/couriers/me/shift и
 * GET /api/v1/couriers/me — по образцу смены водителя POST /api/v1/drivers/me/status.
 *
 * Честность экрана: из всего списка готово только то, что переиспользуется у
 * водителя (приём позиций), и оно про водителя, а не про курьера. Данные
 * демонстрационные: запросов к API экран не делает.
 */
import { Badge } from '../../components/ui/Badge';
import { Notice, PhoneAppBar, PhoneBody, PhoneCard, PhoneTabBar, Row } from '../kit';

const COURIER_TABS = ['Задания', 'Карта', 'Деньги', 'Профиль'];

type ReadyTone = 'danger' | 'success';

const READINESS: Array<{ title: string; hint: string; state: string; tone: ReadyTone }> = [
  { title: 'Профиль курьера', hint: 'нет ни роли, ни профиля', state: 'нет в API', tone: 'danger' },
  { title: 'Смена и её правила', hint: 'по образцу driver.status', state: 'нет в API', tone: 'danger' },
  { title: 'Приём позиций', hint: 'POST /api/v1/locations — только DRIVER', state: 'есть', tone: 'success' },
];

export default function Apps09() {
  return (
    <>
      <PhoneAppBar
        title="ORTA Delivery"
        subtitle="Приложение курьера · демо"
        right={<Badge tone="neutral">вне смены</Badge>}
      />
      <PhoneBody>
        <PhoneCard className="shrink-0">
          <div className="flex items-center gap-3">
            <span className="grid h-13 w-13 flex-none place-items-center rounded-full bg-gradient-to-br from-[#0F6E8C] to-[#0A4C61] text-[17px] font-bold text-white">
              ЕК
            </span>
            <div className="min-w-0 flex-1">
              <div className="truncate text-[14px] font-semibold text-ink-900">Ерлан Касымов</div>
              <div className="truncate text-[11.5px] text-ink-500">курьер · Шымкент · демо</div>
            </div>
          </div>
          <div className="my-2.5 h-px bg-ink-100" />
          <Row label="Смена сегодня" value="не начата" />
          <Row label="Заданий выполнено" value="0" />
          <Row label="Заработано" value="0,00 ₸" strong />
        </PhoneCard>

        <div className="shrink-0 text-[11px] font-semibold uppercase tracking-wide text-ink-500">
          Что нужно, чтобы начать смену
        </div>
        <PhoneCard className="shrink-0">
          {READINESS.map((item, index) => (
            <div key={item.title}>
              {index > 0 ? <div className="my-2.5 h-px bg-ink-100" /> : null}
              <div className="flex items-center gap-2.5">
                <span
                  className={
                    item.tone === 'success'
                      ? 'h-2 w-2 flex-none rounded-full bg-success-500'
                      : 'h-2 w-2 flex-none rounded-full bg-brand-500'
                  }
                />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[12.5px] font-medium text-ink-800">{item.title}</div>
                  <div className="truncate text-[11.5px] text-ink-500">{item.hint}</div>
                </div>
                <Badge tone={item.tone}>{item.state}</Badge>
              </div>
            </div>
          ))}
        </PhoneCard>

        <Notice tone="neutral">
          <b>Курьера нет ни в одной модели.</b> Роли, профиля и смены курьера в репозитории не существует: ORTA
          Delivery — строка в заказе маркета. Приём позиций переиспользуется, но он про водителя
          (<span className="font-mono">POST /api/v1/locations</span> принимает только роль DRIVER).
        </Notice>

        <div className="shrink-0 rounded-xl bg-[#0F6E8C] px-3 py-2.5 text-center text-[13px] font-semibold text-white">
          Начать смену — план
        </div>
      </PhoneBody>
      <PhoneTabBar items={COURIER_TABS} active="Профиль" />
    </>
  );
}
