import { useState } from 'react';
import { Link } from 'react-router-dom';
import { formatMoney, multiplyMinor } from '../api/money';
import { fieldErrorOf } from '../api/errors';
import type { CartItem } from '../api/types';
import { useAuth } from '../auth/AuthContext';
import { AccountPicker } from '../components/accounts/AccountPicker';
import { PageHeader } from '../components/layout/PageHeader';
import { ProductThumb } from '../components/market/ProductThumb';
import { OrderStatusPanel } from '../components/orders/OrderStatusPanel';
import { Alert, ErrorAlert } from '../components/ui/Alerts';
import { Button, buttonClass } from '../components/ui/Button';
import { Card, CardBody, CardHeader, DetailRow } from '../components/ui/Card';
import { EmptyState } from '../components/ui/EmptyState';
import { TextAreaField, TextField } from '../components/ui/Field';
import { PageLoader } from '../components/ui/Spinner';
import { useAccounts } from '../hooks/useAccounts';
import { useCart, useClearCart, useRemoveCartItem, useUpdateCartItem } from '../hooks/useCart';
import { useCreateOrder } from '../hooks/useOrders';
import { useIdempotencyKey, transferSignature } from '../lib/idempotency';
import { formatPhoneInput, normalizePhone } from '../lib/phone';

interface CheckoutErrors {
  address?: string;
  phone?: string;
  source?: string;
}

/** One cart line: quantity stepper (optimistic) and a remove button. */
function CartLine({
  item,
  currency,
  onQuantityChange,
  onRemove,
  busy,
}: {
  item: CartItem;
  currency: string;
  onQuantityChange: (quantity: number) => void;
  onRemove: () => void;
  busy: boolean;
}) {
  const lineTotal = item.totalMinor ?? multiplyMinor(item.priceMinor, item.quantity);
  const max = item.availableQuantity ?? undefined;

  return (
    <li className="flex gap-3 py-3">
      <Link to={`/market/${item.productId}`} className="h-16 w-16 shrink-0 overflow-hidden rounded-xl bg-ink-100">
        <ProductThumb imageUrl={item.imageUrl} title={item.title} />
      </Link>

      <div className="min-w-0 flex-1">
        <Link to={`/market/${item.productId}`} className="line-clamp-2 text-sm font-medium text-ink-900">
          {item.title}
        </Link>
        <p className="tnum mt-0.5 text-xs text-ink-500">
          {formatMoney(item.priceMinor, item.currency ?? currency)} за шт.
        </p>

        <div className="mt-2 flex items-center gap-2">
          <div className="flex items-center gap-1">
            <Button
              variant="secondary"
              size="sm"
              aria-label={`Уменьшить количество: ${item.title}`}
              disabled={busy || item.quantity <= 1}
              onClick={() => onQuantityChange(item.quantity - 1)}
            >
              −
            </Button>
            <span className="tnum w-10 text-center text-sm" aria-label={`Количество: ${item.quantity}`}>
              {item.quantity}
            </span>
            <Button
              variant="secondary"
              size="sm"
              aria-label={`Увеличить количество: ${item.title}`}
              disabled={busy || (max !== undefined && item.quantity >= max)}
              onClick={() => onQuantityChange(item.quantity + 1)}
            >
              +
            </Button>
          </div>

          <Button variant="ghost" size="sm" onClick={onRemove} disabled={busy}>
            Удалить
          </Button>
        </div>

        {max !== undefined && item.quantity >= max ? (
          <p className="mt-1 text-xs text-warning-700">Больше нет в наличии (максимум {max})</p>
        ) : null}
      </div>

      <p className="tnum shrink-0 text-sm font-semibold text-ink-900">
        {formatMoney(lineTotal, item.currency ?? currency)}
      </p>
    </li>
  );
}

/**
 * Cart + checkout.
 *
 * Cart edits are optimistic (the totals move immediately and roll back if the
 * server refuses), and checkout creates the order with one Idempotency-Key per
 * attempt, then hands over to the live order panel which polls while the order is
 * still `PENDING_PAYMENT`.
 */
export function CartPage() {
  const { session } = useAuth();
  const cartQuery = useCart();
  const accountsQuery = useAccounts();
  const updateItem = useUpdateCartItem();
  const removeItem = useRemoveCartItem();
  const clearCart = useClearCart();
  const createOrder = useCreateOrder();

  const [address, setAddress] = useState('');
  const [phone, setPhone] = useState(() => formatPhoneInput(session?.phone ?? ''));
  const [comment, setComment] = useState('');
  const [selectedSourceId, setSelectedSourceId] = useState<string | null>(null);
  const [errors, setErrors] = useState<CheckoutErrors>({});
  const [createdOrderId, setCreatedOrderId] = useState<string | null>(null);

  const accounts = accountsQuery.data ?? [];
  const source = accounts.find((account) => account.id === selectedSourceId) ?? accounts[0] ?? null;
  const cart = cartQuery.data ?? null;

  const normalizedPhone = normalizePhone(phone);
  const { acquire, reset } = useIdempotencyKey(
    transferSignature({
      deliveryAddress: address.trim(),
      contactPhone: normalizedPhone,
      comment: comment.trim(),
      sourceAccountId: source?.id ?? null,
    }),
  );

  const submitOrder = () => {
    if (createOrder.isPending || !cart || cart.items.length === 0) {
      return;
    }
    const next: CheckoutErrors = {};
    if (address.trim().length < 5) {
      next.address = 'Укажите адрес доставки (город, улица, дом)';
    }
    if (!normalizedPhone) {
      next.phone = 'Введите телефон в формате +7 700 000 00 00';
    }
    if (!source) {
      next.source = 'Выберите счёт для оплаты';
    }
    setErrors(next);
    if (Object.keys(next).length > 0 || !source || !normalizedPhone) {
      return;
    }

    createOrder.mutate(
      {
        body: {
          deliveryAddress: address.trim(),
          contactPhone: normalizedPhone,
          comment: comment.trim() || undefined,
          sourceAccountId: source.id,
        },
        idempotencyKey: acquire(),
      },
      {
        onSuccess: (order) => {
          setCreatedOrderId(order.orderId);
          reset();
        },
      },
    );
  };

  if (createdOrderId) {
    return (
      <>
        <PageHeader title="Заказ оформлен" subtitle="Мы следим за его статусом в реальном времени" />
        <div className="space-y-4">
          <OrderStatusPanel orderId={createdOrderId} />
          <div className="flex flex-wrap gap-2">
            <Link to="/orders" className={buttonClass({ variant: 'secondary' })}>
              Все заказы
            </Link>
            <Link to="/market" className={buttonClass({ variant: 'ghost' })}>
              Продолжить покупки
            </Link>
          </div>
        </div>
      </>
    );
  }

  if (cartQuery.isPending) {
    return (
      <>
        <PageHeader title="Корзина" />
        <PageLoader label="Загружаем корзину…" />
      </>
    );
  }

  if (cartQuery.isError) {
    return (
      <>
        <PageHeader title="Корзина" />
        <ErrorAlert
          error={cartQuery.error}
          title="Не удалось загрузить корзину"
          onRetry={() => void cartQuery.refetch()}
        />
      </>
    );
  }

  if (!cart || cart.items.length === 0) {
    return (
      <>
        <PageHeader title="Корзина" />
        <EmptyState
          title="Корзина пуста"
          description="Добавьте товары из маркета — здесь появятся позиции, суммы и оформление заказа."
          action={
            <Link to="/market" className={buttonClass()}>
              Перейти в маркет
            </Link>
          }
        />
      </>
    );
  }

  const canCheckout = accounts.length > 0;

  return (
    <>
      <PageHeader title="Корзина" subtitle={`Позиций: ${cart.itemCount}`} />

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader
            title="Товары"
            action={
              <Button
                variant="ghost"
                size="sm"
                loading={clearCart.isPending}
                onClick={() => clearCart.mutate()}
              >
                Очистить
              </Button>
            }
          />
          <CardBody>
            <ul className="divide-y divide-ink-100">
              {cart.items.map((item) => (
                <CartLine
                  key={item.itemId}
                  item={item}
                  currency={cart.currency}
                  busy={updateItem.isPending || removeItem.isPending}
                  onQuantityChange={(quantity) => updateItem.mutate({ itemId: item.itemId, quantity })}
                  onRemove={() => removeItem.mutate({ itemId: item.itemId })}
                />
              ))}
            </ul>

            {updateItem.error || removeItem.error ? (
              <div className="mt-3">
                <ErrorAlert
                  error={updateItem.error ?? removeItem.error}
                  title="Не удалось изменить корзину"
                />
              </div>
            ) : null}
          </CardBody>
        </Card>

        <div className="space-y-4">
          <Card>
            <CardHeader title="Итого" />
            <CardBody>
              <dl>
                <DetailRow label="Товары">
                  <span className="tnum">{formatMoney(cart.itemsTotalMinor, cart.currency)}</span>
                </DetailRow>
                <DetailRow label="Доставка">
                  <span className="tnum">{formatMoney(cart.deliveryMinor, cart.currency)}</span>
                </DetailRow>
                <DetailRow label="К оплате">
                  <span className="tnum text-lg">{formatMoney(cart.totalMinor, cart.currency)}</span>
                </DetailRow>
              </dl>
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Оформление" subtitle="Проверьте адрес и счёт оплаты" />
            <CardBody>
              {!canCheckout ? (
                <div className="mb-3">
                  <Alert tone="warning" title="Нет счёта для оплаты">
                    Откройте счёт на главной странице, чтобы оплатить заказ.
                  </Alert>
                </div>
              ) : null}

              <form
                className="space-y-4"
                noValidate
                onSubmit={(event) => {
                  event.preventDefault();
                  submitOrder();
                }}
              >
                <TextField
                  id="checkout-address"
                  label="Адрес доставки"
                  value={address}
                  autoComplete="street-address"
                  placeholder="Алматы, Абая 150, кв. 12"
                  onChange={(event) => setAddress(event.target.value)}
                  error={errors.address ?? fieldErrorOf(createOrder.error, 'deliveryAddress')}
                  required
                />

                <TextField
                  id="checkout-phone"
                  label="Контактный телефон"
                  type="tel"
                  inputMode="tel"
                  value={phone}
                  onChange={(event) => setPhone(formatPhoneInput(event.target.value))}
                  error={errors.phone ?? fieldErrorOf(createOrder.error, 'contactPhone')}
                  hint="Курьер позвонит по этому номеру"
                  required
                />

                <TextAreaField
                  id="checkout-comment"
                  label="Комментарий к заказу"
                  value={comment}
                  onChange={(event) => setComment(event.target.value)}
                  placeholder="Например: позвонить за час"
                />

                {accounts.length > 0 ? (
                  <AccountPicker
                    accounts={accounts}
                    value={source?.id ?? ''}
                    onChange={setSelectedSourceId}
                    name="checkout-source-account"
                    label="Счёт оплаты"
                    error={errors.source}
                  />
                ) : null}

                {createOrder.error ? (
                  <ErrorAlert
                    error={createOrder.error}
                    title="Заказ не оформлен"
                    onRetry={submitOrder}
                    retryLabel="Повторить оформление"
                  />
                ) : null}

                <Button
                  type="submit"
                  block
                  size="lg"
                  loading={createOrder.isPending}
                  disabled={createOrder.isPending || !canCheckout}
                >
                  Оформить заказ на {formatMoney(cart.totalMinor, cart.currency)}
                </Button>

                <p className="text-xs text-ink-500">
                  Заказ создаётся один раз: повторная отправка использует тот же ключ идемпотентности.
                </p>
              </form>
            </CardBody>
          </Card>
        </div>
      </div>
    </>
  );
}
