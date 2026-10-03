/**
 * ORTA Business · Товары — список и массовые действия.
 *
 * Статус на борде «В работе»: каталог работает (GET/POST/PATCH
 * /api/v1/catalog/products, остаток меняется дельтой stockDelta с причиной), а вот
 * пакетного API нет — поэтому панель массовых правок подписана честно.
 *
 * Названия товаров в таблице сокращены до «Galaxy A55 128GB» и подобных: строка
 * из пяти колонок в рабочей области 828 px, и полное имя с SKU в неё не влезает.
 */
import { Badge } from '../../components/ui/Badge';
import { Chips, ConsolePanel, ConsoleTable, Money, Notice, Row } from '../kit';

type ProductStatus = 'ACTIVE' | 'DRAFT';

const STATUS_TONE: Record<ProductStatus, 'success' | 'neutral'> = { ACTIVE: 'success', DRAFT: 'neutral' };

const PRODUCTS: Array<{
  title: string;
  category: string;
  priceMinor: number;
  stock: string;
  status: ProductStatus;
}> = [
  { title: 'Galaxy A55 128GB', category: 'Электроника', priceMinor: 18999000, stock: '12 шт', status: 'ACTIVE' },
  { title: 'Powerbank 20 000 мА·ч', category: 'Аксессуары', priceMinor: 1599000, stock: '2 шт', status: 'ACTIVE' },
  { title: 'Наушники TWS R50i', category: 'Аудио', priceMinor: 1249000, stock: '0 шт', status: 'ACTIVE' },
  { title: 'Зарядка 25 Вт', category: 'Аксессуары', priceMinor: 699000, stock: '—', status: 'DRAFT' },
];

const MASS_ACTIONS = ['Цена +5%', 'Остаток 0', 'Снять с публикации'];

export default function Business05() {
  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      <div className="flex flex-none items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[16px] font-bold text-ink-900">Товары</div>
          <div className="truncate text-[12px] text-ink-500">
            128 активных · 4 черновика · 2 без остатка · 6 категорий
          </div>
        </div>
        <div className="flex flex-none items-center gap-2">
          <span className="rounded-full bg-ink-100 px-3 py-1.5 text-[12px] text-ink-400">Импорт CSV</span>
          <span className="rounded-full bg-brand-500 px-3.5 py-1.5 text-[12px] font-medium text-white">Создать товар</span>
        </div>
      </div>

      <ConsolePanel title="Каталог" right={<span className="text-[11px] text-ink-400">Сортировка: по остатку</span>}>
        <div className="flex items-center gap-2 rounded-xl border border-ink-200 bg-white px-3 py-2 text-[12px] text-ink-400">
          Название, SKU или бренд
        </div>
        <div className="mt-2">
          <Chips
            items={['Все · 134', 'Активные · 128', 'Черновики · 4', 'Нет в наличии · 2', 'Электроника · 41']}
            active="Все · 134"
          />
        </div>

        <div className="mt-2 flex items-center justify-between gap-3 rounded-xl bg-brand-50 px-3 py-2">
          <span className="text-[12px] font-medium text-brand-700">Выбрано 3 из 128</span>
          <span className="flex items-center gap-2">
            {MASS_ACTIONS.map((action) => (
              <span key={action} className="rounded-full border border-brand-200 bg-white px-2.5 py-1 text-[11.5px] text-ink-700">
                {action}
              </span>
            ))}
          </span>
        </div>
        <p className="mt-1 text-[11px] text-ink-400">массовые действия идут по одному товару</p>

        <div className="mt-3">
          <ConsoleTable
            columns={['Товар', 'Категория', 'Цена', 'Остаток', 'Статус']}
            rows={PRODUCTS.map((product) => [
              <span key="t" className="font-medium text-ink-900">{product.title}</span>,
              product.category,
              <Money key="p" minor={product.priceMinor} />,
              product.stock === '—' ? <span key="s" className="text-ink-400">—</span> : <span key="s">{product.stock}</span>,
              <Badge key="st" tone={STATUS_TONE[product.status]}>
                {product.status === 'ACTIVE' && product.stock === '0 шт' ? 'нет в наличии' : product.status}
              </Badge>,
            ])}
          />
        </div>

        <div className="mt-2 flex items-center justify-between gap-3">
          <span className="text-[11.5px] text-ink-500">Показано 4 из 134 · страница 1</span>
          <span className="flex items-center gap-2">
            <span className="rounded-full border border-ink-200 bg-white px-3 py-1 text-[12px] text-ink-400">Назад</span>
            <span className="rounded-full border border-ink-200 bg-white px-3 py-1 text-[12px] text-ink-700">Вперёд</span>
          </span>
        </div>
      </ConsolePanel>

      <div className="flex flex-none gap-3">
        <ConsolePanel title="Массовые действия" className="w-[320px] flex-none">
          <Row label="Выбрано товаров" value="3 из 128" />
          <Row label="Правок к отправке" value="3" />
          <Row label="Цена после правки" value="от 199 489,50 ₸" strong />
        </ConsolePanel>
        <div className="flex-1">
          <Notice tone="warning">
            Половина правок может не примениться: клиент вызывает{' '}
            <code>{'PATCH /api/v1/catalog/products/{id}'}</code> по очереди, и сеть рвётся на 60-м товаре — часть цен уже
            изменена, часть нет, откатить это нечем. Предлагается <code>POST /api/v1/catalog/products/bulk</code>. Склада,
            приёмки, инвентаризации и импорта CSV тоже нет — это план.
          </Notice>
        </div>
      </div>
    </div>
  );
}
