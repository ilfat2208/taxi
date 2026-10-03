/**
 * transport-13 — ORTA Delivery, параметры посылки.
 *
 * Здесь важен контракт, а не картинка: получатель — отдельная сущность с
 * телефоном, и вручение подтверждает он, а не отправитель. Доставка в коде
 * существует только как строка адреса в заказе маркетплейса, поэтому посылка,
 * вес, габариты и получатель — демонстрационные данные.
 */
import { Chips, Money, Notice, PhoneAppBar, PhoneBody, PhoneCard, PhoneTabBar, Row } from '../kit';

const CARGO_TYPES = ['Документы', 'Посылка', 'Покупка из магазина', 'Передача человеку'];
const DECLARED_MINOR = 5_000_000;

export default function Transport13() {
  return (
    <>
      <PhoneAppBar
        title="ORTA Delivery"
        subtitle="Доставка по Шымкенту · демо-данные"
        right={
          <span className="grid h-9 w-9 place-items-center rounded-xl bg-gradient-to-br from-brand-600 to-brand-800 text-[13px] font-bold text-white">
            D
          </span>
        }
      />
      <PhoneBody>
        <PhoneCard>
          <div className="text-[11px] text-ink-500">Откуда</div>
          <div className="mt-0.5 text-[13px] font-semibold text-ink-900">пр. Республики, 12 · офис, 3 этаж</div>
          <div className="mt-3 text-[11px] text-ink-500">Куда</div>
          <div className="mt-0.5 text-[13px] font-semibold text-ink-900">ул. Желтоксан, 45 · получатель Айгуль</div>
        </PhoneCard>

        <div>
          <div className="mb-2 text-[13px] font-semibold text-ink-800">Что везём</div>
          <Chips items={CARGO_TYPES} active="Посылка" />
        </div>

        <PhoneCard
          title="Коробка, скотч"
          right={<span className="text-[12px] font-medium text-brand-600">Изменить</span>}
        >
          <div className="mb-1 text-[11.5px] text-ink-500">получатель — Айгуль · +7 701 555 22 11</div>
          <Row label="Вес" value="3 кг" />
          <Row label="Габариты" value="40 × 30 × 25 см" />
          <Row label="Объявленная ценность" value={<Money minor={DECLARED_MINOR} />} />
          <Row label="Хрупкое" value="нет" />
        </PhoneCard>

        <Notice tone="warning">
          <b>Вручение подтверждает получатель.</b> Посылка считается доставленной по коду получателя, а не по
          слову курьера, — от этого факта зависит списание денег. Направления Delivery и самих посылок в коде
          нет: адреса, вес и ценность демонстрационные.
        </Notice>

        <div className="mt-auto" />
        <div className="rounded-xl bg-brand-500 px-4 py-3 text-center text-[13px] font-semibold text-white">
          Рассчитать доставку
        </div>
        <div className="text-center text-[11px] text-ink-500">Цена — по расстоянию, весу и ценности груза</div>
      </PhoneBody>
      <PhoneTabBar items={['Доставка', 'Отправления', 'Счёт', 'Профиль']} active="Доставка" />
    </>
  );
}
