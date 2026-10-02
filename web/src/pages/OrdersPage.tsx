import { useState } from 'react';
import { Link } from 'react-router-dom';
import { PageHeader } from '../components/layout/PageHeader';
import { OrderRow } from '../components/orders/OrderRow';
import { ErrorAlert } from '../components/ui/Alerts';
import { buttonClass } from '../components/ui/Button';
import { Card, CardBody, CardHeader } from '../components/ui/Card';
import { EmptyState } from '../components/ui/EmptyState';
import { SelectField } from '../components/ui/Field';
import { Pagination } from '../components/ui/Pagination';
import { SkeletonRows } from '../components/ui/Skeleton';
import { useOrders } from '../hooks/useOrders';
import { statusLabel } from '../lib/format';

const PAGE_SIZE = 10;
const STATUS_OPTIONS = ['CREATED', 'PENDING_PAYMENT', 'PAID', 'CONFIRMED', 'SHIPPED', 'DELIVERED', 'CANCELLED', 'FAILED'];

/** Order history with a status filter. */
export function OrdersPage() {
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(0);

  const query = useOrders({ page, size: PAGE_SIZE, status: status === '' ? undefined : status });
  const data = query.data;

  return (
    <>
      <PageHeader
        title="Заказы"
        subtitle="Покупки из маркета со статусом оплаты и доставки"
        actions={
          <Link to="/market" className={buttonClass({ size: 'sm' })}>
            В маркет
          </Link>
        }
      />

      <Card>
        <CardHeader
          title="Мои заказы"
          subtitle={data ? `Найдено: ${data.totalElements}` : undefined}
          action={
            <div className="w-48">
              <SelectField
                id="orders-status"
                label="Статус"
                value={status}
                placeholder="Все статусы"
                options={STATUS_OPTIONS.map((value) => ({ value, label: statusLabel(value) }))}
                onChange={(event) => {
                  setStatus(event.target.value);
                  setPage(0);
                }}
              />
            </div>
          }
        />

        <CardBody>
          {query.isPending ? <SkeletonRows count={4} /> : null}

          {query.isError ? (
            <ErrorAlert
              error={query.error}
              title="Не удалось загрузить заказы"
              onRetry={() => void query.refetch()}
            />
          ) : null}

          {data && data.items.length === 0 ? (
            <EmptyState
              title={status === '' ? 'Заказов пока нет' : 'Заказов с таким статусом нет'}
              description="Оформите заказ в корзине — он появится здесь вместе со статусом оплаты."
              action={
                <Link to="/market" className={buttonClass()}>
                  Перейти в маркет
                </Link>
              }
            />
          ) : null}

          {data && data.items.length > 0 ? (
            <ul className="space-y-2">
              {data.items.map((order) => (
                <OrderRow key={order.orderId} order={order} />
              ))}
            </ul>
          ) : null}

          {data ? (
            <Pagination
              page={data.page}
              totalPages={data.totalPages}
              hasNext={data.hasNext}
              totalElements={data.totalElements}
              isFetching={query.isFetching}
              onPageChange={setPage}
            />
          ) : null}
        </CardBody>
      </Card>
    </>
  );
}
