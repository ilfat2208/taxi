/**
 * platform-09 · Лимиты счёта и антифрод по частоте (телефон, работает).
 *
 * Дневное и месячное окна, использование и остаток, плюс контроль частоты операций:
 * `GET /api/v1/accounts/{id}/limits`, `PUT /api/v1/accounts/{id}/limits`. Проверка стоит до движения
 * денег, поэтому отказ не оставляет ни резерва, ни проводки; отказ — `422 LIMIT_EXCEEDED` или
 * `422 VELOCITY_EXCEEDED` с разбором. Ненастроенный лимит означает «без ограничения», а не «лимит 0».
 * Спорное место подписано честно: изменение лимита сейчас административное, пользовательского пути нет.
 */
import { Badge } from '../../components/ui/Badge';
import { Notice, PhoneAppBar, PhoneBody, PhoneCard, PhoneTabBar, Row } from '../kit';

const TABS = ['Главная', 'История', 'Переводы', 'Профиль'];

export default function Platform09Screen() {
  return (
    <>
      <PhoneAppBar
        back
        title="Лимиты"
        subtitle="Основной счёт · KZT · демо-значения"
        right={<Badge tone="success">работает</Badge>}
      />
      <PhoneBody>
        <PhoneCard title="Дневной лимит исходящих" right={<Badge tone="success">настроен</Badge>}>
          <div className="text-[22px] font-semibold tabular-nums text-ink-900">1 000,00 ₸</div>
          <div className="text-[11.5px] text-ink-500">израсходовано 600,00 ₸ · остаток 400,00 ₸</div>
          <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-ink-100">
            <span className="block h-full w-[60%] rounded-full bg-brand-500" />
          </div>
        </PhoneCard>

        <PhoneCard title="Месячное окно и частота">
          <Row label="Месячный лимит" value={<Badge tone="neutral">не настроен — без ограничения</Badge>} />
          <Row label="Защита от частых операций" value="10 операций за 5 минут" />
          <Row label="Состояние контроля" value={<Badge tone="success">включена</Badge>} />
        </PhoneCard>

        <PhoneCard title="Отказ лимита выглядит так">
          <Row label="Не хватает лимита" value={<span className="font-mono text-[11.5px]">422 LIMIT_EXCEEDED</span>} />
          <Row label="Слишком часто" value={<span className="font-mono text-[11.5px]">422 VELOCITY_EXCEEDED</span>} />
          <p className="mt-1 text-[11px] text-ink-500">
            В теле ответа — окно, лимит, использовано и остаток: человеку не нужно писать в поддержку, чтобы понять отказ.
          </p>
        </PhoneCard>

        <Notice tone="neutral">
          <b>Лимит проверяется при резервировании.</b> Отказ не оставляет ни резерва, ни проводки — поэтому «доступно»
          после отказа не меняется.
        </Notice>

        <PhoneCard title="Изменить лимит" right={<Badge tone="neutral">план</Badge>}>
          <p className="text-[11.5px] leading-snug text-ink-500">
            В коде лимит меняет только <code className="rounded bg-ink-100 px-1">ADMIN</code>: человек сам себе лимит
            выставить не может. Нужен путь со вторым фактором: снижение сразу, повышение с подтверждением.
          </p>
          <div className="mt-2 rounded-xl bg-ink-100 py-2.5 text-center text-[13px] font-medium text-ink-500">
            Настроить лимит
          </div>
        </PhoneCard>
      </PhoneBody>
      <PhoneTabBar items={TABS} active="Главная" />
    </>
  );
}
