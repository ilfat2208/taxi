/**
 * ORTA Jobs — карточка вакансии (план).
 *
 * Экрана нет, контракт пришлось бы писать с нуля: ни вакансий, ни работодателей,
 * ни требований, ни отзывов сотрудников в ORTA не существует. Обязанности, условия
 * и языки переехали в подпись, чтобы карточка помещалась в рамку: на экране —
 * деньги, график, требования и работодатель.
 *
 * Предлагаемые эндпоинты: `GET /api/v1/jobs/vacancies/{id}`, `.../{id}/similar`,
 * `GET /api/v1/jobs/employers/{id}`, `POST /api/v1/jobs/vacancies/{id}/favourite`.
 *
 * Работодатель — юридическое лицо, а не платформа: у платформы и её партнёров
 * разные роли, и вакансия должна принадлежать юрлицу с проверенными документами,
 * иначе сервис работы становится доской объявлений с посредниками. Отзывы
 * сотрудников — тоже новая сущность: их негде взять, пока нет откликов и истории
 * работы.
 */
import { Badge } from '../../components/ui/Badge';
import { Money, Notice, PhoneAppBar, PhoneBody, PhoneCard, Row } from '../kit';

export default function ServicesHealth19() {
  return (
    <>
      <PhoneAppBar
        title="Водитель такси"
        subtitle="ТОО «ORTA Taxi Шымкент» · Шымкент · полная занятость"
        back
        right={<Badge tone="neutral">План</Badge>}
      />
      <PhoneBody>
        <PhoneCard right={<Badge tone="success">на руки, 2 раза в месяц</Badge>}>
          <div className="text-[17px] font-bold text-ink-900">
            от <Money minor={35_000_000} />
          </div>
          <div className="my-2 border-t border-ink-100" />
          <Row label="График" value="сменный 2/2, 12 часов" />
          <Row label="Авто и оформление" value="машина компании" />
        </PhoneCard>

        <PhoneCard title="Что нужно" right={<Badge tone="neutral">документы</Badge>}>
          <Row label="Права категории B" value="стаж от 3 лет" />
          <Row label="Удостоверение, техпаспорт" value="нужны" />
          <Row label="Медсправка" value="до первого выхода" />
          <Row label="Языки" value="казахский, русский" strong />
        </PhoneCard>

        <PhoneCard title="Работодатель">
          <Row label="Юрлицо" value="ТОО «ORTA Taxi Шымкент»" />
          <Row label="БИН" value={<span className="font-mono">123456789012</span>} />
          <Row label="Вакансия заведена" value="самим юрлицом" strong />
        </PhoneCard>

        <Notice tone="warning">
          <b>Вакансия выдумана целиком.</b> Ни сервиса вакансий, ни работодателей, ни отзывов сотрудников в
          ORTA нет. Требование: вакансия принадлежит юрлицу с документами, а не платформе.
        </Notice>

        <div className="mt-auto space-y-2">
          <div className="rounded-xl bg-brand-500 py-3 text-center text-[13px] font-semibold text-white">
            Откликнуться · резюме и согласие
          </div>
          <div className="rounded-xl bg-white py-2.5 text-center text-[13px] font-medium text-ink-700 ring-1 ring-inset ring-ink-200">
            Написать работодателю
          </div>
        </div>
      </PhoneBody>
    </>
  );
}
