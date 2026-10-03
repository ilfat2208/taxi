/**
 * home-food-20 · ORTA Rent — вещь, срок аренды и залог.
 *
 * Что на экране: фото вещи (плейсхолдер), залог и рейтинг пункта выдачи, состояние вещи,
 * срок аренды, расчёт со скидкой за длительность, залог-холд и сумма к списанию.
 *
 * Честно: залог — это холд, а не платёж, и это готовая часть: ядро ORTA Pay умеет резерв
 * и освобождение (POST /api/v1/accounts/internal/holds, затем capture за аренду и release
 * остатка залога). А правила удержания за повреждение — предметная модель аренды, которой
 * пока нет. Рейтинг есть у пункта выдачи, а не у вещи.
 */
import { Badge } from '../../components/ui/Badge';
import { Chips, Money, Notice, PhoneAppBar, PhoneBody, PhoneCard, PhoneTabBar, Placeholder, Row } from '../kit';

const TABS = ['Home', 'Food', 'Tickets', 'Build', 'Rent'];

const TERMS = ['1 сутки', '3 суток', '7 суток', '30 суток'];

export default function HomeFood20() {
  return (
    <>
      <PhoneAppBar
        title="Перфоратор Bosch GBH 2-26"
        subtitle="Комплект: кейс, 3 бура SDS-plus · в наличии 3"
        back
      />
      <PhoneBody>
        <Placeholder
          label="фото вещи — плейсхолдер"
          className="wrap-anywhere h-[64px] w-full px-6 text-center leading-tight"
        />

        <div className="flex flex-wrap gap-1.5">
          <Badge tone="warning">залог 30 000 ₸</Badge>
          <Badge tone="brand">пункт выдачи: 4,7 · 412 сдач</Badge>
        </div>

        <p className="text-[11px] text-ink-500">
          Состояние проверено при последней сдаче — 28 сентября, замечаний нет.
        </p>

        <Chips items={TERMS} active="3 суток" />

        <PhoneCard title="Срок и стоимость">
          <Row label="Выдача" value="3 окт, 10:00" />
          <Row label="Возврат" value="6 окт, 10:00" />
          <Row label="Аренда 3 суток × 1 900,00 ₸" value={<Money minor={570_000} />} />
          <Row
            label="Скидка за 3+ суток · 10%"
            value={
              <>
                −<Money minor={57_000} />
              </>
            }
          />
          <Row label="Итого аренда" value={<Money minor={513_000} />} />
          <Row label="Залог · возвращается" value={<Money minor={3_000_000} />} />
          <Row label="Списывается сейчас" value={<Money minor={3_513_000} />} strong />
        </PhoneCard>

        <Notice tone="info">
          Залог — это холд, а не платёж: готовое ядро ORTA Pay умеет резерв и освобождение
          (POST /api/v1/accounts/internal/holds, затем capture за аренду и release остатка залога).
          Правила удержания за повреждение — предметная модель аренды, её пока нет.
        </Notice>

        <div className="rounded-xl bg-brand-500 px-4 py-2.5 text-center text-[13px] font-semibold text-white">
          Забронировать · 5 130,00 ₸ + залог
        </div>
      </PhoneBody>
      <PhoneTabBar items={TABS} active="Rent" />
    </>
  );
}
