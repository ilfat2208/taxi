import { Alert, ErrorAlert } from '../ui/Alerts';
import { PageLoader } from '../ui/Spinner';
import { useOrder } from '../../hooks/useOrders';
import { OrderSummaryCard } from './OrderSummaryCard';
import { isApiError } from '../../api/errors';

/**
 * Live order panel.
 *
 * `useOrder` polls while the saga is still in `PENDING_PAYMENT`/`CREATED`/`PAID`
 * and stops on its own when the order settles, so this component is safe to mount
 * right after checkout *and* on the order page.
 */
export function OrderStatusPanel({ orderId }: { orderId: string }) {
  const query = useOrder(orderId);

  if (query.isPending) {
    return <PageLoader label="Проверяем статус заказа…" />;
  }

  if (query.isError) {
    if (isApiError(query.error) && query.error.isNotFound) {
      return <Alert tone="warning" title="Заказ пока не найден">Обновите страницу через пару секунд — заказ регистрируется.</Alert>;
    }
    return (
      <ErrorAlert
        error={query.error}
        title="Не удалось получить статус заказа"
        onRetry={() => void query.refetch()}
      />
    );
  }

  if (!query.data) {
    return null;
  }

  return <OrderSummaryCard order={query.data} compact note="Статус обновляется автоматически, пока заказ оплачивается." />;
}
