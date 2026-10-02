import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { formatMoney, multiplyMinor } from '../api/money';
import { isApiError } from '../api/errors';
import { PageHeader } from '../components/layout/PageHeader';
import { ProductThumb } from '../components/market/ProductThumb';
import { Alert, ErrorAlert } from '../components/ui/Alerts';
import { Badge, StatusBadge } from '../components/ui/Badge';
import { Button, buttonClass } from '../components/ui/Button';
import { Card, CardBody, CardHeader, DetailRow } from '../components/ui/Card';
import { EmptyState } from '../components/ui/EmptyState';
import { PageLoader } from '../components/ui/Spinner';
import { useProduct } from '../hooks/useCatalog';
import { useAddToCart } from '../hooks/useCart';
import { useAuth } from '../auth/AuthContext';

/** Product card with a quantity stepper and add-to-cart. */
export function ProductPage() {
  const { productId } = useParams<{ productId: string }>();
  const { hasRole } = useAuth();
  const query = useProduct(productId);
  const addToCart = useAddToCart();
  const [quantity, setQuantity] = useState(1);

  if (query.isPending) {
    return (
      <>
        <PageHeader title="Товар" backTo="/market" backLabel="К маркету" />
        <PageLoader label="Загружаем товар…" />
      </>
    );
  }

  if (query.isError) {
    const notFound = isApiError(query.error) && query.error.isNotFound;
    return (
      <>
        <PageHeader title="Товар" backTo="/market" backLabel="К маркету" />
        {notFound ? (
          <EmptyState
            title="Товар не найден"
            description="Возможно, продавец снял его с продажи."
            action={
              <Link to="/market" className={buttonClass()}>
                Вернуться в каталог
              </Link>
            }
          />
        ) : (
          <ErrorAlert
            error={query.error}
            title="Не удалось загрузить товар"
            onRetry={() => void query.refetch()}
          />
        )}
      </>
    );
  }

  const product = query.data;
  if (!product) {
    return (
      <>
        <PageHeader title="Товар" backTo="/market" backLabel="К маркету" />
        <EmptyState title="Товар не найден" />
      </>
    );
  }

  const maxQuantity = Math.max(1, product.availableQuantity);
  const clampedQuantity = Math.min(Math.max(1, quantity), maxQuantity);
  const inStock = product.availableQuantity > 0;

  return (
    <>
      <PageHeader
        title={product.title}
        subtitle={`${product.merchantName}${product.category ? ` · ${product.category}` : ''}`}
        backTo="/market"
        backLabel="К маркету"
        actions={<StatusBadge status={product.status} />}
      />

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardBody className="grid gap-4 sm:grid-cols-2">
            <div className="h-48 overflow-hidden rounded-xl bg-ink-100 sm:h-full">
              <ProductThumb imageUrl={product.imageUrl} title={product.title} />
            </div>

            <div className="flex flex-col">
              <dl className="text-sm">
                <DetailRow label="Цена">
                  <span className="tnum text-lg">
                    {formatMoney(product.priceMinor, product.currency)}
                  </span>
                </DetailRow>
                {product.brand ? <DetailRow label="Бренд">{product.brand}</DetailRow> : null}
                {product.category ? <DetailRow label="Категория">{product.category}</DetailRow> : null}
                <DetailRow label="В наличии">
                  {inStock ? `${product.availableQuantity} шт.` : 'нет'}
                </DetailRow>
                <DetailRow label="ID товара">
                  <span className="font-mono text-xs">{product.id}</span>
                </DetailRow>
              </dl>

              <div className="mt-4 flex items-center gap-3">
                <span className="text-sm text-ink-600">Количество</span>
                <div className="flex items-center gap-1">
                  <Button
                    variant="secondary"
                    size="sm"
                    aria-label="Уменьшить количество"
                    disabled={clampedQuantity <= 1}
                    onClick={() => setQuantity((value) => Math.max(1, value - 1))}
                  >
                    −
                  </Button>
                  <input
                    id="product-quantity"
                    aria-label="Количество"
                    inputMode="numeric"
                    value={clampedQuantity}
                    onChange={(event) => {
                      const next = Number(event.target.value.replace(/\D/g, ''));
                      setQuantity(Number.isFinite(next) && next > 0 ? Math.min(next, maxQuantity) : 1);
                    }}
                    className="tnum h-9 w-14 rounded-xl border border-ink-200 text-center text-sm"
                  />
                  <Button
                    variant="secondary"
                    size="sm"
                    aria-label="Увеличить количество"
                    disabled={clampedQuantity >= maxQuantity}
                    onClick={() => setQuantity((value) => Math.min(maxQuantity, value + 1))}
                  >
                    +
                  </Button>
                </div>
              </div>

              <p className="tnum mt-3 text-sm text-ink-600">
                Итого: {formatMoney(multiplyMinor(product.priceMinor, clampedQuantity), product.currency)}
              </p>

              {addToCart.error ? (
                <div className="mt-3">
                  <ErrorAlert error={addToCart.error} title="Не удалось добавить в корзину" />
                </div>
              ) : null}

              {addToCart.isSuccess ? (
                <div className="mt-3">
                  <Alert tone="success" title="Товар в корзине">
                    <Link className="underline" to="/cart">
                      Перейти к корзине и оформить заказ
                    </Link>
                  </Alert>
                </div>
              ) : null}

              <div className="mt-4 flex flex-wrap gap-2">
                <Button
                  size="lg"
                  loading={addToCart.isPending}
                  disabled={!inStock || addToCart.isPending}
                  onClick={() => addToCart.mutate({ productId: product.id, quantity: clampedQuantity, product })}
                >
                  Добавить в корзину
                </Button>
                <Link to="/cart" className={buttonClass({ variant: 'secondary', size: 'lg' })}>
                  Открыть корзину
                </Link>
              </div>

              {!inStock ? (
                <p className="mt-2 text-sm text-ink-500">
                  Товар распродан — добавление в корзину недоступно.
                </p>
              ) : null}
            </div>
          </CardBody>
        </Card>

        <div className="space-y-4">
          <Card>
            <CardHeader title="Продавец" />
            <CardBody className="space-y-2 text-sm">
              <p className="font-medium text-ink-900">{product.merchant?.name ?? product.merchantName}</p>
              {product.merchant?.city ? <p className="text-ink-500">{product.merchant.city}</p> : null}
              {typeof product.merchant?.ratingBasisPoints === 'number' ? (
                <p className="text-ink-500">
                  Рейтинг: {(product.merchant.ratingBasisPoints / 100).toFixed(1)} / 5
                </p>
              ) : null}
              <p className="text-xs text-ink-400">ID продавца: {product.merchantId}</p>
            </CardBody>
          </Card>

          {hasRole('MERCHANT') && typeof product.onHand === 'number' ? (
            <Card>
              <CardHeader title="Остатки" subtitle="Видно владельцу и поддержке" />
              <CardBody>
                <dl className="text-sm">
                  <DetailRow label="На складе">{product.onHand}</DetailRow>
                  <DetailRow label="Зарезервировано">{product.reserved ?? 0}</DetailRow>
                  <DetailRow label="Доступно">{product.available ?? product.availableQuantity}</DetailRow>
                </dl>
                <div className="mt-3">
                  <Badge tone="info">Управление остатками — в разделе «Мой магазин»</Badge>
                </div>
              </CardBody>
            </Card>
          ) : null}

          {product.description ? (
            <Card>
              <CardHeader title="Описание" />
              <CardBody>
                <p className="whitespace-pre-line text-sm text-ink-600">{product.description}</p>
              </CardBody>
            </Card>
          ) : null}
        </div>
      </div>
    </>
  );
}
