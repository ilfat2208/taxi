/**
 * home-food-05 · ORTA Home — ипотечный калькулятор.
 *
 * Что на экране: стоимость, взнос и срок как выбираемые значения, демо-ставка,
 * аннуитетный платёж, сумма кредита, переплата и всего к возврату.
 *
 * Честно: ставка ничем не подтверждена — банков-партнёров и скоринга нет. Кнопка заявки
 * отключена, потому что отправлять её некуда. Деньги на платформе живут в минорных
 * единицах, а валюту отдаёт ответ, а не локаль.
 */
import { Badge } from '../../components/ui/Badge';
import { Chips, Money, Notice, PhoneAppBar, PhoneBody, PhoneCard, PhoneTabBar, Row } from '../kit';

const TABS = ['Home', 'Food', 'Tickets', 'Build', 'Rent'];

const DOWN_PAYMENT_SHARES = ['10%', '20%', '30%', '50%'];
const TERMS = ['5 лет', '15 лет', '20 лет', '25 лет'];

export default function HomeFood05() {
  return (
    <>
      <PhoneAppBar title="Ипотечный калькулятор" subtitle="2-комн., 68 м² · 24 900 000 ₸" back />
      <PhoneBody>
        <PhoneCard>
          <Row label="Стоимость объекта" value={<Money minor={2_490_000_000} />} strong />
          <Row label="Первый взнос · 20%" value={<Money minor={498_000_000} />} strong />
          <Row label="Ставка · демо, не оффер банка" value="16,9% годовых" strong />
        </PhoneCard>

        <Chips items={DOWN_PAYMENT_SHARES} active="20%" />
        <Chips items={TERMS} active="15 лет" />

        <PhoneCard title="Платёж в месяц" right={<Badge tone="neutral">демо-ставка</Badge>}>
          <div className="text-[22px]">
            <Money minor={30_240_000} />
          </div>
          <div className="mt-1">
            <Row label="Сумма кредита" value={<Money minor={1_992_000_000} />} />
            <Row label="Переплата за 15 лет" value={<Money minor={3_451_200_000} />} />
            <Row label="Всего к возврату" value={<Money minor={5_443_200_000} />} strong />
          </div>
        </PhoneCard>

        <Notice>
          Ставка ничем не подтверждена: банков-партнёров и скоринга нет, 16,9% — демо-число макета. Поэтому
          кнопка заявки отключена: отправлять её некуда.
        </Notice>

        <div className="rounded-xl bg-ink-200 px-4 py-2.5 text-center text-[13px] font-semibold text-ink-500">
          Отправить заявку в банк
        </div>
      </PhoneBody>
      <PhoneTabBar items={TABS} active="Home" />
    </>
  );
}
