/**
 * home-food-18 · ORTA Build — расчёт сметы.
 *
 * Что на экране: смета из трёх частей — материалы, работы бригады и прочее (техника,
 * доставка, резерв) — с долями и итогом, плюс сохранение черновика и отправка бригаде.
 *
 * Честно: норм расхода материалов на м² и справочника расценок бригад в репозитории нет,
 * поэтому смета собрана из позиций, которые выбрал пользователь, и это демо-расчёт,
 * а не предложение подрядчика.
 */
import { Money, Notice, PhoneAppBar, PhoneBody, PhoneCard, PhoneTabBar, Row } from '../kit';

const TABS = ['Home', 'Food', 'Tickets', 'Build', 'Rent'];

export default function HomeFood18() {
  return (
    <>
      <PhoneAppBar title="Смета" subtitle="Ремонт 2-комн., 68 м² · черновик от 2 октября · демо" back />
      <PhoneBody>
        <PhoneCard title="Материалы · 29% сметы" right={<Money minor={124_000_000} />}>
          <Row label="Цемент ПЦ 400 · 40 мешков" value={<Money minor={7_560_000} />} />
          <Row label="Кирпич, смеси, грунтовка, профиль" value={<Money minor={116_440_000} />} />
        </PhoneCard>

        <PhoneCard title="Работы · бригада «Ақ Орда» · 67%" right={<Money minor={286_000_000} />}>
          <Row label="Демонтаж, вывоз, финишная отделка" value={<Money minor={104_000_000} />} />
          <Row label="Стяжка и штукатурка" value={<Money minor={114_000_000} />} />
          <Row label="Электрика и сантехника" value={<Money minor={68_000_000} />} />
        </PhoneCard>

        <PhoneCard>
          <Row label="Техника: вышка-тура · 3 дня" value={<Money minor={3_600_000} />} />
          <Row label="Доставка материалов" value={<Money minor={14_400_000} />} />
          <Row label="Итого по позициям" value={<Money minor={428_000_000} />} />
          <Row label="Резерв на непредвиденное 5%" value={<Money minor={21_400_000} />} />
          <Row label="Всё вместе" value={<Money minor={449_400_000} />} strong />
        </PhoneCard>

        <Notice>
          Нормы расхода — не наши: смета собрана из позиций, которые выбрал пользователь. Расхода материалов
          на м² и расценок бригад в репозитории нет, поэтому это демо-расчёт, а не предложение подрядчика.
        </Notice>

        <div className="rounded-xl border border-ink-200 bg-white px-4 py-2 text-center text-[13px] font-semibold text-ink-700">
          Сохранить черновик
        </div>
        <div className="rounded-xl bg-brand-500 px-4 py-2 text-center text-[13px] font-semibold text-white">
          Отправить бригаде
        </div>
      </PhoneBody>
      <PhoneTabBar items={TABS} active="Build" />
    </>
  );
}
