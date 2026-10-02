import { Link, useParams } from 'react-router-dom';
import { isApiError } from '../api/errors';
import { PageHeader } from '../components/layout/PageHeader';
import { OrderSummaryCard } from '../components/orders/OrderSummaryCard';
import { Alert, ErrorAlert } from '../components/ui/Alerts';
import { Button, buttonClass } from '../components/ui/Button';
import { EmptyState } from '../components/ui/EmptyState';
import { PageLoader } from '../components/ui/Spinner';
import { useCancelOrder, useOrder } from '../hooks/useOrders';

/** Statuses in which the order service still accepts a cancellation. */
const CANCELLABLE = ['CREATED', 'DRAFT', 'PENDING_PAYMENT'];

/**
 * Order detail.
 *
 * The order is polled while it is `PENDING_PAYMENT` (see `useOrder`), so the state
 * timeline updates on its own right after checkout; the cancel action only appears
 * while the order is still cancellable.
 */
export function OrderDetailPage() {
  const { orderId } = useParams<{ orderId: string }>();
  const query = useOrder(orderId);
  const cancel = useCancelOrder();

  if (query.isPending) {
    return (
      <>
        <PageHeader title="Заказ" backTo="/orders" backLabel="К заказам" />
        <PageLoader label="Загружаем заказ…" />
      </>
    );
  }

  if (query.isError) {
    const notFound = isApiError(query.error) && query.error.isNotFound;
    return (
      <>
        <PageHeader title="Заказ" backTo="/orders" backLabel="К заказам" />
        {notFound ? (
          <EmptyState
            title="Заказ не найден"
            description="Проверьте номер заказа или откройте список своих заказов."
            action={
              <Link to="/orders" className={buttonClass()}>
                К списку заказов
              </Link>
            }
          />
        ) : (
          <ErrorAlert error={query.error} title="Не удалось загрузить заказ" onRetry={() => void query.refetch()} />
        )}
      </>
    );
  }

  const order = query.data;
  if (!order) {
    return (
      <>
        <PageHeader title="Заказ" backTo="/orders" backLabel="К заказам" />
        <EmptyState title="Заказ не найден" />
      </>
    );
  }

  const canCancel = CANCELLABLE.includes(order.status);

  return (
    <>
      <PageHeader
        title={`Заказ № ${order.orderNumber}`}
        subtitle="Позиции, оплата и история статусов"
        backTo="/orders"
        backLabel="К заказам"
      />

      <div className="space-y-4">
        {order.status === 'PENDING_PAYMENT' ? (
          <Alert tone="warning" title="Ожидаем подтверждение оплаты">
            Статус обновляется автоматически каждые несколько секунд — страницу перезагружать не нужно.
          </Alert>
        ) : null}

        {cancel.error ? <ErrorAlert error={cancel.error} title="Не удалось отменить заказ" /> : null}
        {cancel.isSuccess ? <Alert tone="success" title="Заказ отменён" /> : null}

        <OrderSummaryCard order={order}>
          {order.paymentId ? (
            <Link
              to={`/payments/${order.paymentId}`}
              className={buttonClass({ variant: 'ghost', size: 'sm' })}
            >
              Открыть платёж
            </Link>
          ) : null}

          {canCancel ? (
            <Button
              variant="danger"
              size="sm"
              loading={cancel.isPending}
              disabled={cancel.isPending}
              onClick={() => {
                if (order.orderId) {
                  cancel.mutate(order.orderId);
                }
              }}
            >
              Отменить заказ
            </Button>
          ) : null}
        </OrderSummaryCard>

        {!canCancel ? (
          <p className="text-sm text-ink-500">
            Этот заказ нельзя отменить: он уже оплачен или завершён. Оформите возврат в карточке платежа.
          </p>
        ) : null}
      </div>
    </>
  );
}
