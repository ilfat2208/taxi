/**
 * apps-15 · Мерчант: новые заказы, подтверждение и сборка (ORTA Business).
 *
 * Статус борда — «В работе»: заказы, товары и сток в API реальны
 * (order-service, catalog-service), но своей ручки списка заказов у мерчанта
 * нет — GET /api/v1/orders отдаёт заказы покупателя. Подтверждение и «собран»
 * не смоделированы: предлагаются GET /api/v1/merchants/me/orders и
 * POST …/{id}/confirm. Кабинет мерчанта есть в web, приложения нет.
 *
 * Честность экрана: «собран» никуда не пишется — сток списывает сага при
 * checkout. Суммы соответствуют каталогу сида (1 290 ₸ × 2 + 12 490 ₸ =
 * 15 070 ₸, комиссия 1,5% = 226,05 ₸). Данные демонстрационные.
 */
import { Badge } from '../../components/ui/Badge';
import { Money, Notice, PhoneAppBar, PhoneBody, PhoneCard, PhoneTabBar, Row } from '../kit';

const MERCHANT_TABS = ['Заказы', 'Товары', 'Выплаты', 'Отзывы'];

const ORDER = {
  id: 'O-01M3Y7QK2N4F',
  waiting: 'ждёт 1:42',
  items: [
    { title: 'Шоколад молочный Ritter Sport 100 г', qty: 2, total: 258000 },
    { title: 'Кофе в зёрнах Lavazza Qualita Oro 1 кг', qty: 1, total: 1249000 },
  ],
  commission: 22605,
  buyerPays: 1529605,
  payout: 1507000,
};

export default function Apps15() {
  return (
    <>
      <PhoneAppBar
        title="ORTA Business · FreshMarket"
        subtitle="Шымкент · продавец с телефона · демо"
        right={<Badge tone="danger">1 новый</Badge>}
      />
      <PhoneBody>
        <div className="flex shrink-0 items-center justify-between gap-3">
          <span className="text-[13px] font-semibold text-ink-800">Новые заказы</span>
          <span className="flex gap-2">
            <Badge tone="danger">1 новый</Badge>
            <Badge tone="success">2 в сборке</Badge>
          </span>
        </div>

        <PhoneCard className="shrink-0">
          <div className="flex items-center gap-2.5">
            <Badge tone="warning">{ORDER.waiting}</Badge>
            <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-ink-500">{ORDER.id}</span>
            <Money minor={ORDER.payout} />
          </div>
          <div className="my-2.5 h-px bg-ink-100" />
          {ORDER.items.map((item) => (
            <div key={item.title} className="flex items-center gap-2 py-1">
              <span className="h-2 w-2 flex-none rounded-full bg-success-500" />
              <span className="min-w-0 flex-1 truncate text-[12px] text-ink-800">{item.title}</span>
              <span className="text-[11.5px] tabular-nums text-ink-500">
                × {item.qty} · <Money minor={item.total} />
              </span>
            </div>
          ))}
          <div className="my-2.5 h-px bg-ink-100" />
          <Row label="Комиссия платформы 1,5%" value={<Money minor={ORDER.commission} />} />
          <Row label="Покупатель платит" value={<Money minor={ORDER.buyerPays} />} />
          <Row label="Вам к выплате" value={<Money minor={ORDER.payout} />} strong />
        </PhoneCard>

        <PhoneCard className="shrink-0">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <div className="text-[13px] text-ink-800">Сканировать штрихкод при сборке</div>
              <div className="text-[11px] text-ink-500">
                поля <span className="font-mono">barcode</span> у товара нет — только SKU
              </div>
            </div>
            <Badge tone="neutral">план</Badge>
          </div>
        </PhoneCard>

        <Notice tone="info">
          <b>Сток списывает сага, а не продавец:</b> резерв идёт при checkout
          (<span className="font-mono">/catalog/internal/stock/reservations</span>), поэтому отметка «собран» в API
          никуда не пишется.
        </Notice>

        <Notice tone="warning">
          <b>Своей ручки заказов у мерчанта нет:</b>{' '}
          <span className="font-mono">GET /api/v1/orders</span> отдаёт заказы покупателя. Предлагаются{' '}
          <span className="font-mono">GET /api/v1/merchants/me/orders</span> и{' '}
          <span className="font-mono">POST …/confirm</span>.
        </Notice>

        <div className="flex shrink-0 flex-col gap-2">
          <div className="rounded-xl bg-success-700 px-3 py-2.5 text-center text-[13px] font-semibold text-white">
            Подтвердить заказ
          </div>
          <div className="rounded-xl px-3 py-2 text-center text-[12.5px] text-ink-500">Отклонить с причиной</div>
        </div>
      </PhoneBody>
      <PhoneTabBar items={MERCHANT_TABS} active="Заказы" />
    </>
  );
}
