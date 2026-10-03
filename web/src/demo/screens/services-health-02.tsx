/**
 * ORTA Services — карточка компании (Ф2: раздел работает).
 *
 * Один ответ `GET /api/v1/qtime/companies/{companyId}` даёт всё, что на экране:
 * рейтинг в базисных пунктах, число отзывов и специалистов, адрес, координаты и
 * часовой пояс. Рабочие часы — из `qtime.working_hours`: пн–сб 09:00–20:00,
 * обед 13:00–14:00.
 *
 * Выходной воскресенья — не флаг «работает: нет», а отсутствие строки в
 * расписании: поэтому состояние нельзя рассинхронизировать с часами.
 * Счётчиков «всего окон сегодня» в карточке нет — окна считаются запросом на
 * пару «специалист + услуга + дата», и это подписано как предложение.
 */
import { Badge } from '../../components/ui/Badge';
import { Money, Notice, PhoneAppBar, PhoneBody, PhoneCard, Row } from '../kit';

export default function ServicesHealth02() {
  return (
    <>
      <PhoneAppBar
        title="Салон красоты «Лотос»"
        subtitle="Шымкент · ул. Тауке хана, 83"
        back
        right={<Badge tone="success">Активна</Badge>}
      />
      <PhoneBody>
        <PhoneCard
          title="★ 4,8 · 312 отзывов · Красота"
          right={<Badge tone="brand">QTime</Badge>}
        >
          <Row label="Специалистов" value="3" />
          <Row label="Адрес и координаты" value="42,3170 · 69,5900" />
          <Row label="Расписание" value="пн–сб 09:00–20:00" />
          <Row label="Перерыв" value="13:00–14:00" />
          <Row label="Воскресенье" value="выходной" strong />
        </PhoneCard>

        <Notice tone="info">
          <b>Выходной — это отсутствие строки в расписании.</b> У пн–сб строка есть, у воскресенья её нет,
          поэтому «выходной» нельзя рассинхронизировать с часами работы.
        </Notice>

        <PhoneCard title="Часовой пояс и карта" right={<Badge tone="neutral">Asia/Almaty</Badge>}>
          <p className="text-[12px] text-ink-600">
            Время показываем в зоне компании, а не сервера. Карта не рисуется: координаты в контракте есть,
            но окна и цены важнее.
          </p>
        </PhoneCard>

        <Notice tone="neutral">
          <b>Предлагаемые эндпоинты:</b> <code>GET /companies/{'{id}'}/summary</code> (счётчики окон) и{' '}
          <code>GET /companies/{'{id}'}/working-hours</code>. Сейчас счётчиков «всего окон сегодня» и
          «активная запись держит окно 1 из 1» нет — их считает отдельный запрос по паре мастер + услуга.
        </Notice>

        <div className="mt-auto space-y-2">
          <div className="rounded-xl bg-brand-500 py-3 text-center text-[13px] font-semibold text-white">
            Выбрать специалиста и время
          </div>
          <p className="text-center text-[11px] text-ink-400">
            Цена «от» в карточке — минимальная услуга прайса: <Money minor={450_000} />
          </p>
        </div>
      </PhoneBody>
    </>
  );
}
