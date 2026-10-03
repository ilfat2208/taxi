/**
 * ORTA Jobs — вакансии с фильтрами (план).
 *
 * Экрана и сервиса нет: вакансий, откликов и резюме в репозитории не существует.
 * Предлагаемые эндпоинты: `GET /api/v1/jobs/vacancies?query=&city=&employment=&schedule=&salaryFrom=&page=&size=`,
 * `GET /api/v1/jobs/vacancies/{id}`, `GET /api/v1/jobs/dictionaries` — справочники
 * нужны сразу, потому что список фильтров нельзя собирать из уже загруженной
 * страницы, как это пришлось сделать в `ServicesPage.tsx`.
 *
 * Работодатель показан юридическим лицом, а не платформой: у платформы и её
 * партнёров разные роли, и вакансия должна принадлежать юрлицу с проверенными
 * документами — иначе сервис работы легко превращается в доску объявлений с
 * посредниками. Бренд в карточке оставлен рядом с юрлицом только как вывеска.
 *
 * «Найдено 128 вакансий» и отклики — выдуманные данные. Правдоподобно только
 * окружение: Шымкент, компании платформы и связь салона с QTime.
 */
import { Badge } from '../../components/ui/Badge';
import { Chips, Notice, PhoneAppBar, PhoneBody, PhoneCard, Placeholder } from '../kit';

const VACANCIES: Array<{
  title: string;
  thumb: string;
  employer: string;
  conditions: string;
  pay: string;
  tone: 'success' | 'neutral' | 'warning';
  responses: string;
}> = [
  {
    title: 'Водитель такси на авто компании',
    thumb: 'Авто',
    employer: 'ТОО «ORTA Taxi Шымкент» · БИН 123456789012',
    conditions: 'Шымкент · смены 2/2 · опыт от 1 года',
    pay: 'от 350 000 ₸ · 12 мест',
    tone: 'success',
    responses: '24 отклика',
  },
  {
    title: 'Комплектовщик заказов на склад',
    thumb: 'Склад',
    employer: 'ТОО «ORTA Market Логистика» · БИН 987654321098',
    conditions: 'промзона · 2/2 по 12 ч · без опыта',
    pay: 'от 220 000 ₸ · питание, развозка',
    tone: 'neutral',
    responses: '61 отклик',
  },
  {
    title: 'Мастер маникюра в салон',
    thumb: 'Салон',
    employer: 'ИП «Лотос» · БИН 550123456789',
    conditions: 'ул. Тауке хана, 83 · записи через QTime',
    pay: '50/50 от услуги · документы',
    tone: 'warning',
    responses: 'новое',
  },
];

export default function ServicesHealth18() {
  return (
    <>
      <PhoneAppBar
        title="ORTA Jobs"
        subtitle="Вакансии Шымкента · обновлено 10 минут назад"
        right={<Badge tone="neutral">План</Badge>}
      />
      <PhoneBody>
        <div className="flex items-center gap-2 rounded-xl bg-white px-3 py-2.5 ring-1 ring-inset ring-ink-200">
          <span className="text-[11px] text-ink-400">поиск</span>
          <span className="text-[13px] text-ink-800">Водитель</span>
        </div>

        <Chips items={['Шымкент', 'Полная', 'Смены', 'Без опыта', '200 000 ₸+']} active="Шымкент" />

        <div className="flex items-baseline justify-between">
          <span className="text-[12px] font-semibold text-ink-700">Найдено 128 вакансий</span>
          <span className="text-[12px] text-brand-600">Новые</span>
        </div>

        {VACANCIES.map((vacancy) => (
          <PhoneCard key={vacancy.title}>
            <div className="flex items-center gap-3">
              <Placeholder label={vacancy.thumb} className="h-10 w-10 flex-none" />
              <div className="min-w-0 flex-1">
                <div className="truncate text-[13px] font-semibold text-ink-900">{vacancy.title}</div>
                <div className="truncate text-[11.5px] text-ink-500">{vacancy.employer}</div>
                <div className="truncate text-[11.5px] text-ink-500">{vacancy.conditions}</div>
              </div>
            </div>
            <div className="mt-2 flex items-center justify-between">
              <Badge tone={vacancy.tone}>{vacancy.pay}</Badge>
              <span className="text-[11px] text-ink-400">{vacancy.responses}</span>
            </div>
          </PhoneCard>
        ))}

        <Notice tone="info">
          <b>Справочника вакансий в коде нет.</b> Вакансии, отклики и «128 найдено» — выдуманные данные.
          Вакансия принадлежит юрлицу с БИН, а не платформе: пока это правило не закреплено проверкой
          документов работодателя, сервис работы превращается в доску объявлений с посредниками.
        </Notice>
      </PhoneBody>
    </>
  );
}
