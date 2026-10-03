/**
 * home-food-12 · ORTA Tickets — карточка события.
 *
 * Что на экране: афиша-плейсхолдер, длительность и возрастной рейтинг, зал, короткое
 * описание, сеансы, условия (места, цены, сбор, вход, возврат) и переход к выбору мест.
 *
 * Честно: картинок-ассетов в проекте нет, поэтому афиша — плейсхолдер, а описание —
 * демо-текст макета. Правила возврата задаёт организатор: в контракте такого поля нет,
 * билетные провайдеры не выбраны, и правила придут от них.
 */
import { Badge } from '../../components/ui/Badge';
import { Chips, Money, Notice, PhoneAppBar, PhoneBody, PhoneCard, PhoneTabBar, Placeholder, Row } from '../kit';

const TABS = ['Home', 'Food', 'Tickets', 'Build', 'Rent'];

const SESSIONS = ['19:00', '21:30 · зал малый'];

export default function HomeFood12() {
  return (
    <>
      <PhoneAppBar
        title="«Қыз Жібек», опера-драма"
        subtitle="Драмтеатр им. Ж. Шанина · ул. Тауке хана, 83 · 2,1 км"
        back
      />
      <PhoneBody>
        <Placeholder
          label="афиша события — плейсхолдер"
          className="wrap-anywhere h-[96px] w-full px-6 text-center leading-tight"
        />

        <div className="flex flex-wrap gap-2">
          <Badge tone="neutral">2 ч 20 мин с антрактом</Badge>
          <Badge tone="neutral">12+</Badge>
          <Badge tone="info">Основной зал · 420 мест</Badge>
        </div>

        <p className="text-[12px] text-ink-600">
          Классическая опера-драма по поэме «Қыз Жібек»: два действия, живой оркестр, антракт 20 минут
          (демо-текст макета).
        </p>

        <Chips items={SESSIONS} active="19:00" />

        <PhoneCard title="Сеанс 3 октября, 19:00">
          <Row label="Свободно мест" value="128 из 420" />
          <Row
            label="Цена"
            value={
              <>
                от <Money minor={250_000} /> · партер <Money minor={350_000} />
              </>
            }
          />
          <Row label="Сервисный сбор" value="5% · демо" />
          <Row label="Вход" value="код в приложении, бумажный не нужен" />
          <Row label="Возврат" value="за 24 часа до начала" />
        </PhoneCard>

        <Notice tone="info">
          Правила возврата задаёт организатор: в макете это «за 24 часа», но в контракте такого поля нет —
          билетные провайдеры не выбраны, и правила придут от них.
        </Notice>

        <div className="rounded-xl bg-brand-500 px-4 py-2.5 text-center text-[13px] font-semibold text-white">
          Выбрать места на 19:00
        </div>
      </PhoneBody>
      <PhoneTabBar items={TABS} active="Tickets" />
    </>
  );
}
