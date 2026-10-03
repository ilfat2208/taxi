/**
 * ORTA Health — аптека и доставка лекарств (план).
 *
 * Экрана нет. Из существующего к платформе подходит только основа маркета:
 * `catalog-service`, `order-service` (`POST /api/v1/orders` с обязательным
 * `Idempotency-Key`), `payment-service` — и заявленная вертикаль ORTA Delivery,
 * которой в коде тоже нет.
 *
 * Предлагаемые эндпоинты: `GET /api/v1/health/pharmacies`,
 * `GET /api/v1/health/pharmacies/{id}/stock?query=`, `POST /api/v1/health/prescriptions`
 * (загрузка рецепта), `POST /api/v1/health/prescriptions/{id}/verify` (проверка
 * фармацевтом), `POST /api/v1/orders` для доставки; события
 * `prescription.verified`, `pharmacy.order.ready`.
 *
 * Требование: безрецептурное и рецептурное нельзя смешивать в одном потоке оплаты,
 * а состав заказа — медицинские данные, поэтому на него распространяются согласие,
 * разделение доступа и срок хранения. Кнопка оформления отключена намеренно:
 * партнёрских аптек и проверки рецептов нет, курс доставки (холодовая цепь для части
 * лекарств) тоже не решён.
 */
import { Badge } from '../../components/ui/Badge';
import { Money, Notice, PhoneAppBar, PhoneBody, PhoneCard, Placeholder, Row } from '../kit';

export default function ServicesHealth17() {
  return (
    <>
      <PhoneAppBar
        title="Аптека и доставка"
        subtitle="Шымкент · заказ к двери"
        right={<Badge tone="neutral">План</Badge>}
      />
      <PhoneBody>
        <div className="flex items-center gap-2 rounded-xl bg-white px-3 py-2.5 ring-1 ring-inset ring-ink-200">
          <span className="text-[11px] text-ink-400">поиск</span>
          <span className="text-[13px] text-ink-800">Парацетамол</span>
        </div>

        <PhoneCard>
          <div className="flex items-center gap-3">
            <Placeholder label="Аптека" className="h-10 w-10 flex-none" />
            <div className="min-w-0 flex-1">
              <div className="truncate text-[13px] font-semibold text-ink-900">Парацетамол, 500 мг №20</div>
              <div className="truncate text-[11.5px] text-ink-500">
                безрецептурный · есть в 6 аптеках · ближайшая 400 м
              </div>
            </div>
            <Money minor={89_000} />
          </div>
        </PhoneCard>

        <PhoneCard>
          <div className="flex items-center gap-3">
            <Placeholder label="Рецепт" className="h-10 w-10 flex-none" />
            <div className="min-w-0 flex-1">
              <div className="truncate text-[13px] font-semibold text-ink-900">Амоксициллин, 500 мг №16</div>
              <div className="truncate text-[11.5px] text-ink-500">
                по рецепту · электронного рецепта в ORTA нет
              </div>
            </div>
          </div>
          <div className="mt-2 flex flex-wrap gap-2">
            {['Загрузить фото рецепта', 'Позвать фармацевта'].map((action) => (
              <span key={action} className="rounded-full bg-ink-100 px-3 py-1.5 text-[11.5px] text-ink-500">
                {action} · недоступно
              </span>
            ))}
          </div>
        </PhoneCard>

        <PhoneCard title="Корзина · доставка 60–90 мин" right={<Badge tone="brand">ORTA Delivery</Badge>}>
          <Row label="Парацетамол №20 · солевой раствор, 5 ампул" value={<Money minor={204_000} />} />
          <Row label="Доставка курьером" value={<Money minor={70_000} />} />
          <Row label="Итого вместе с доставкой" value={<Money minor={274_000} />} strong />
        </PhoneCard>

        <Notice tone="warning">
          <b>Аптек и доставки лекарств в ORTA нет.</b> Ни партнёрских аптек, ни остатков, ни курьеров. Заказ
          по рецепту требует проверки фармацевтом — это процесс, а не кнопка. Безрецептурное и рецептурное
          нельзя смешивать в одном потоке оплаты, а состав заказа — медицинские данные: согласие, доступ, срок
          хранения.
        </Notice>

        <div className="mt-auto space-y-2">
          <div
            aria-disabled="true"
            className="rounded-xl bg-ink-200 py-3 text-center text-[13px] font-semibold text-ink-500"
          >
            Оформить · 2 740 ₸
          </div>
          <p className="text-center text-[11px] text-ink-400">
            Кнопка отключена намеренно: оформление откроется после проверки рецепта фармацевтом и решения по
            холодовой цепи
          </p>
        </div>
      </PhoneBody>
    </>
  );
}
