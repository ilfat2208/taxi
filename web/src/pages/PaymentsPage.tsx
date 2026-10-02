import { useState } from 'react';
import { Link } from 'react-router-dom';
import { PageHeader } from '../components/layout/PageHeader';
import { PaymentRow } from '../components/payments/PaymentRow';
import { ErrorAlert } from '../components/ui/Alerts';
import { buttonClass } from '../components/ui/Button';
import { Card, CardBody, CardHeader } from '../components/ui/Card';
import { EmptyState } from '../components/ui/EmptyState';
import { SelectField } from '../components/ui/Field';
import { Pagination } from '../components/ui/Pagination';
import { SkeletonRows } from '../components/ui/Skeleton';
import { usePayments } from '../hooks/usePayments';
import { statusLabel } from '../lib/format';

const PAGE_SIZE = 10;

/** Statuses the payment state machine can reach, plus "all". */
const STATUS_OPTIONS = [
  'CREATED',
  'PENDING',
  'PROCESSING',
  'COMPLETED',
  'FAILED',
  'CANCELLED',
  'REFUNDED',
  'PARTIALLY_REFUNDED',
];

/** Payment history with a status filter and pagination. */
export function PaymentsPage() {
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(0);

  const query = usePayments({ page, size: PAGE_SIZE, status: status === '' ? undefined : status });
  const data = query.data;

  return (
    <>
      <PageHeader
        title="Платежи"
        subtitle="Переводы, оплаты и возвраты — с фильтром по состоянию"
        actions={
          <Link to="/transfer" className={buttonClass({ size: 'sm' })}>
            Новый перевод
          </Link>
        }
      />

      <Card>
        <CardHeader
          title="История операций"
          subtitle={data ? `Найдено: ${data.totalElements}` : undefined}
          action={
            <div className="w-44">
              <SelectField
                id="payments-status"
                label="Статус"
                value={status}
                options={STATUS_OPTIONS.map((value) => ({ value, label: statusLabel(value) }))}
                placeholder="Все статусы"
                onChange={(event) => {
                  setStatus(event.target.value);
                  setPage(0);
                }}
              />
            </div>
          }
        />

        <CardBody>
          {query.isPending ? <SkeletonRows count={5} /> : null}

          {query.isError ? (
            <ErrorAlert
              error={query.error}
              title="Не удалось загрузить платежи"
              onRetry={() => void query.refetch()}
            />
          ) : null}

          {data && data.items.length === 0 ? (
            <EmptyState
              title="Платежей не найдено"
              description={
                status === ''
                  ? 'Как только вы сделаете перевод или оплатите заказ, операция появится здесь.'
                  : `Нет платежей в состоянии «${statusLabel(status)}». Попробуйте снять фильтр.`
              }
              action={
                <Link to="/transfer" className={buttonClass()}>
                  Сделать перевод
                </Link>
              }
            />
          ) : null}

          {data && data.items.length > 0 ? (
            <ul className="space-y-2">
              {data.items.map((payment) => (
                <PaymentRow key={payment.paymentId} payment={payment} />
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
