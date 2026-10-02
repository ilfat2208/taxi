import { Link } from 'react-router-dom';
import { formatMoney } from '../../api/money';
import type { Product } from '../../api/types';
import { Card } from '../ui/Card';
import { Button } from '../ui/Button';
import { useAddToCart } from '../../hooks/useCart';
import { ProductThumb } from './ProductThumb';
import { Badge } from '../ui/Badge';

/** Catalog tile: price, stock hint and a one-tap add to cart. */
export function ProductCard({ product }: { product: Product }) {
  const addToCart = useAddToCart();
  const inStock = product.availableQuantity > 0;

  return (
    <Card as="article" className="flex flex-col overflow-hidden">
      <Link to={`/market/${product.id}`} className="block p-3" aria-label={`Открыть товар ${product.title}`}>
        <div className="mb-3 h-28 overflow-hidden rounded-xl bg-ink-100 sm:h-32">
          <ProductThumb imageUrl={product.imageUrl} title={product.title} />
        </div>
        <p className="line-clamp-2 min-h-10 text-sm font-medium text-ink-900">{product.title}</p>
        <p className="mt-1 truncate text-xs text-ink-500">{product.merchantName}</p>
        <p className="tnum mt-2 text-base font-semibold text-ink-900">
          {formatMoney(product.priceMinor, product.currency, { trimZeroFraction: true })}
        </p>
      </Link>

      <div className="mt-auto flex items-center justify-between gap-2 border-t border-ink-100 p-3">
        {inStock ? (
          <span className="text-xs text-ink-500">В наличии: {product.availableQuantity}</span>
        ) : (
          <Badge tone="warning">Нет в наличии</Badge>
        )}
        <Button
          size="sm"
          variant={inStock ? 'primary' : 'secondary'}
          disabled={!inStock || addToCart.isPending}
          loading={addToCart.isPending}
          onClick={() => addToCart.mutate({ productId: product.id, quantity: 1, product })}
        >
          {addToCart.isSuccess ? 'Добавлено' : 'В корзину'}
        </Button>
      </div>
    </Card>
  );
}
