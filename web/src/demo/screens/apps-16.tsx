/**
 * apps-16 · Сканер штрихкода и остатки (ORTA Business).
 *
 * Статус борда — «План»: сканера и поля barcode у товара нет, есть только SKU
 * (FOOD-0003). При этом остаток менять можно: PATCH /api/v1/catalog/products/{id},
 * читать товар — GET /api/v1/catalog/products/{id}; остатки приходят из сида
 * DemoCatalogSeeder. Предлагаемая ручка: GET /api/v1/merchants/me/products?barcode=.
 *
 * Честность экрана: «наведите на штрихкод» — картинка, а не работающая камера;
 * остатки и резерв демонстрационные. Данные демонстрационные.
 */
import { Badge } from '../../components/ui/Badge';
import { Money, Notice, PhoneAppBar, PhoneBody, PhoneCard, PhoneTabBar, Row } from '../kit';

const MERCHANT_TABS = ['Заказы', 'Товары', 'Выплаты', 'Отзывы'];

const PRODUCT = {
  title: 'Шоколад Ritter Sport 100 г',
  sku: 'FOOD-0003',
  price: 129000,
  stock: 200,
  reserved: 2,
  order: 'O-01M3Y7QK2N4F',
};

const STORE_STOCK: Array<{ title: string; qty: string; low?: boolean }> = [
  { title: 'Кофе в зёрнах Lavazza 1 кг', qty: '60 шт' },
  { title: 'Крем La Roche-Posay Effaclar Duo+', qty: '45 шт' },
  { title: 'Набор Kerastase 250 мл', qty: '18 шт', low: true },
];

/** Макет видоискателя: рамка, полосы штрихкода и линия наведения. */
function ScannerFrame() {
  return (
    <div className="relative h-[128px] shrink-0 overflow-hidden rounded-2xl bg-gradient-to-br from-ink-800 to-ink-900">
      <div className="absolute left-[12%] top-[18%] h-[64%] w-[76%]">
        <span className="absolute left-0 top-0 h-4 w-4 rounded-tl border-l-[3px] border-t-[3px] border-success-500" />
        <span className="absolute right-0 top-0 h-4 w-4 rounded-tr border-r-[3px] border-t-[3px] border-success-500" />
        <span className="absolute bottom-0 left-0 h-4 w-4 rounded-bl border-b-[3px] border-l-[3px] border-success-500" />
        <span className="absolute bottom-0 right-0 h-4 w-4 rounded-br border-b-[3px] border-r-[3px] border-success-500" />
        <div className="flex h-full items-center justify-center gap-[3px] px-6">
          {[3, 2, 4, 2, 3, 5, 2, 3, 2, 4, 3, 2, 5, 3, 2, 4].map((width, index) => (
            <span
              key={index}
              className="h-[62%] rounded-sm bg-white/90"
              style={{ width: `${width}px` }}
            />
          ))}
        </div>
        <span className="absolute left-0 top-1/2 h-[3px] w-full rounded-full bg-success-500" />
      </div>
      <span className="absolute bottom-2.5 left-1/2 -translate-x-1/2 rounded-full bg-white/95 px-2.5 py-1 text-[10.5px] text-ink-600">
        наведите на штрихкод · камеры в демо нет
      </span>
    </div>
  );
}

export default function Apps16() {
  return (
    <>
      <PhoneAppBar
        title="Сканер и остатки"
        subtitle="FreshMarket · Шымкент · демо"
        right={<Badge tone="neutral">План</Badge>}
      />
      <PhoneBody>
        <ScannerFrame />

        <Notice tone="warning">
          <b>Штрихкода в модели товара нет:</b> у товара только SKU{' '}
          <span className="font-mono">{PRODUCT.sku}</span>, и сканера в приложении не существует. Предлагается{' '}
          <span className="font-mono">GET /api/v1/merchants/me/products?barcode=</span>.
        </Notice>

        <PhoneCard className="shrink-0">
          <div className="flex items-center gap-3">
            <div className="min-w-0 flex-1">
              <div className="truncate text-[12.5px] font-semibold text-ink-900">{PRODUCT.title}</div>
              <div className="truncate font-mono text-[11px] text-ink-500">
                SKU {PRODUCT.sku} · штрихкод демо
              </div>
            </div>
            <Money minor={PRODUCT.price} />
          </div>
          <div className="my-2.5 h-px bg-ink-100" />
          <Row label="Остаток" value={`${PRODUCT.stock} шт`} />
          <Row label={`В резерве (заказ ${PRODUCT.order})`} value={`${PRODUCT.reserved} шт`} />
          <Row label="Доступно покупателям" value={`${PRODUCT.stock - PRODUCT.reserved} шт`} strong />
          <div className="mt-1.5 flex items-center justify-between gap-3">
            <span className="text-[11.5px] text-ink-500">Изменить остаток</span>
            <span className="flex items-center gap-3 rounded-xl bg-ink-100 px-3 py-1.5 text-[13px] font-semibold text-ink-700">
              <span>−</span>
              <span className="tabular-nums">{PRODUCT.stock}</span>
              <span>+</span>
            </span>
          </div>
        </PhoneCard>

        <PhoneCard title="Остатки магазина" className="shrink-0">
          {STORE_STOCK.map((item) => (
            <div key={item.title} className="flex items-center gap-3 py-1">
              <span className="min-w-0 flex-1 truncate text-[12.5px] text-ink-800">{item.title}</span>
              <span className="flex items-center gap-1.5 text-[11.5px] tabular-nums text-ink-500">
                <span className={item.low ? 'h-2 w-2 rounded-full bg-warning-500' : 'h-2 w-2 rounded-full bg-success-500'} />
                {item.qty}
              </span>
            </div>
          ))}
        </PhoneCard>

        <div className="shrink-0 rounded-xl bg-success-700 px-3 py-2.5 text-center text-[13px] font-semibold text-white">
          Сохранить остаток (PATCH /catalog/products/{'{id}'})
        </div>
      </PhoneBody>
      <PhoneTabBar items={MERCHANT_TABS} active="Товары" />
    </>
  );
}
