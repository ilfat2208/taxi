/** UI labels and date formatting shared by every page. */

const DATE_TIME_FORMAT = new Intl.DateTimeFormat('ru-KZ', {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
});

const DATE_FORMAT = new Intl.DateTimeFormat('ru-KZ', {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
});

function parse(value: string | null | undefined): Date | null {
  if (!value) {
    return null;
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function formatDateTime(value: string | null | undefined, fallback = '—'): string {
  const date = parse(value);
  return date ? DATE_TIME_FORMAT.format(date) : fallback;
}

export function formatDate(value: string | null | undefined, fallback = '—'): string {
  const date = parse(value);
  return date ? DATE_FORMAT.format(date) : fallback;
}

export function formatRelative(value: string | null | undefined, now: number = Date.now()): string {
  const date = parse(value);
  if (!date) {
    return '—';
  }
  const diffSeconds = Math.round((now - date.getTime()) / 1000);
  if (diffSeconds < 60) {
    return 'только что';
  }
  const minutes = Math.round(diffSeconds / 60);
  if (minutes < 60) {
    return `${minutes} мин назад`;
  }
  const hours = Math.round(minutes / 60);
  if (hours < 24) {
    return `${hours} ч назад`;
  }
  return formatDateTime(value);
}

export type Tone = 'neutral' | 'success' | 'warning' | 'danger' | 'info' | 'brand';

const PAYMENT_STATUS_LABELS: Record<string, string> = {
  CREATED: 'Создан',
  PENDING: 'В обработке',
  PENDING_PAYMENT: 'Ожидает оплаты',
  PROCESSING: 'Обрабатывается',
  AUTHORIZED: 'Авторизован',
  COMPLETED: 'Выполнен',
  PAID: 'Оплачен',
  CONFIRMED: 'Подтверждён',
  SHIPPED: 'Отправлен',
  DELIVERED: 'Доставлен',
  FAILED: 'Ошибка',
  CANCELLED: 'Отменён',
  REFUNDED: 'Возврат',
  PARTIALLY_REFUNDED: 'Частичный возврат',
  // catalog / merchant states, rendered by the same badge component
  ACTIVE: 'Активен',
  DRAFT: 'Черновик',
  OUT_OF_STOCK: 'Нет в наличии',
  ARCHIVED: 'В архиве',
  SUSPENDED: 'Заблокирован',
  // driver states (dispatch console)
  ONLINE: 'На линии',
  OFFLINE: 'Не на линии',
  BUSY: 'На заказе',
  ON_TRIP: 'В поездке',
  BLOCKED: 'Заблокирован',
};

export function statusLabel(status: string | null | undefined): string {
  if (!status) {
    return '—';
  }
  return PAYMENT_STATUS_LABELS[status] ?? status;
}

export function statusTone(status: string | null | undefined): Tone {
  switch (status) {
    case 'COMPLETED':
    case 'PAID':
    case 'DELIVERED':
    case 'CONFIRMED':
    case 'ACTIVE':
    case 'ONLINE':
      return 'success';
    case 'FAILED':
    case 'SUSPENDED':
    case 'BLOCKED':
      return 'danger';
    case 'CANCELLED':
    case 'ARCHIVED':
    case 'OFFLINE':
      return 'neutral';
    case 'REFUNDED':
    case 'PARTIALLY_REFUNDED':
      return 'info';
    case 'PENDING':
    case 'PENDING_PAYMENT':
    case 'PROCESSING':
    case 'CREATED':
    case 'SHIPPED':
    case 'DRAFT':
    case 'OUT_OF_STOCK':
    case 'BUSY':
    case 'ON_TRIP':
      return 'warning';
    default:
      return 'neutral';
  }
}

export function paymentTypeLabel(type: string | null | undefined): string {
  switch (type) {
    case 'TRANSFER':
      return 'Перевод';
    case 'P2P':
      return 'Перевод P2P';
    case 'MERCHANT_PAYMENT':
      return 'Оплата магазину';
    case 'REFUND':
      return 'Возврат';
    case 'TOP_UP':
      return 'Пополнение';
    default:
      return type ?? '—';
  }
}

export function accountTypeLabel(type: string | null | undefined): string {
  switch (type) {
    case 'CUSTOMER':
      return 'Текущий счёт';
    case 'SAVINGS':
      return 'Сберегательный';
    case 'MERCHANT':
      return 'Счёт мерчанта';
    case 'SYSTEM':
      return 'Системный';
    default:
      return type ?? '—';
  }
}

export function operationLabel(operation: string | null | undefined): string {
  switch (operation) {
    case 'TRANSFER_IN':
      return 'Входящий перевод';
    case 'TRANSFER_OUT':
      return 'Исходящий перевод';
    case 'TOP_UP':
      return 'Пополнение';
    case 'PAYMENT':
      return 'Оплата';
    case 'REFUND':
      return 'Возврат';
    case 'HOLD':
      return 'Блокировка средств';
    case 'RELEASE':
      return 'Разблокировка средств';
    case 'CARD_PURCHASE':
      return 'Покупка картой';
    default:
      return operation ?? '—';
  }
}

export function directionLabel(direction: string | null | undefined): string {
  return direction === 'DEBIT' ? 'Списание' : direction === 'CREDIT' ? 'Зачисление' : (direction ?? '—');
}

export function isCredit(direction: string | null | undefined): boolean {
  return direction === 'CREDIT';
}

export function roleLabel(role: string): string {
  switch (role) {
    case 'CUSTOMER':
      return 'Клиент';
    case 'MERCHANT':
      return 'Мерчант';
    case 'SUPPORT':
      return 'Поддержка';
    case 'ADMIN':
      return 'Администратор';
    case 'DRIVER':
      return 'Водитель';
    case 'DISPATCHER':
      return 'Диспетчер';
    default:
      return role;
  }
}

/** "42 с" / "3 мин" / "2 ч 5 мин" — age of a position, not a date. */
export function formatAgeSeconds(seconds: number | null | undefined): string {
  if (typeof seconds !== 'number' || !Number.isFinite(seconds) || seconds < 0) {
    return '—';
  }
  const total = Math.round(seconds);
  if (total < 60) {
    return `${total} с`;
  }
  const minutes = Math.floor(total / 60);
  if (minutes < 60) {
    return `${minutes} мин`;
  }
  const hours = Math.floor(minutes / 60);
  const restMinutes = minutes % 60;
  return restMinutes === 0 ? `${hours} ч` : `${hours} ч ${restMinutes} мин`;
}

/** Metres below a kilometre, one decimal above it: "640 м" / "1,4 км". */
export function formatDistanceMeters(meters: number | null | undefined): string {
  if (typeof meters !== 'number' || !Number.isFinite(meters) || meters < 0) {
    return '—';
  }
  if (meters < 1000) {
    return `${Math.round(meters)} м`;
  }
  return `${(meters / 1000).toFixed(1).replace('.', ',')} км`;
}

/** Truncates a long ULID/order number for dense lists while keeping it copyable. */
export function shortId(id: string, length = 8): string {
  return id.length <= length ? id : `${id.slice(0, length)}…`;
}
