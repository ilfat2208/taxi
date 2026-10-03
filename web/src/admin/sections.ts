/**
 * Реестр секций админ-панели.
 *
 * Разделы фиксированы здесь, а компоненты подключаются по соглашению об имени файла:
 * `./sections/<id>.tsx`. Благодаря этому секции можно писать по отдельности, не
 * трогая маршруты и меню: добавление раздела — это строка в этом файле и один новый
 * файл. Обратная сторона тоже полезна: если файла нет, страница честно скажет, что
 * раздел ещё не сделан, а не упадёт.
 *
 * `write` описывает, что в разделе меняет данные. Роль SUPPORT видит панель только
 * для чтения — и это правило живёт здесь, а не размазано по кнопкам.
 */
import type { ComponentType } from 'react';

export interface AdminSection {
  id: string;
  title: string;
  /** Что в разделе и на каких данных он работает. */
  description: string;
  /** Какие эндпоинты обслуживают раздел — чтобы это было видно, а не подразумевалось. */
  endpoints: string;
  /** Кто видит раздел. */
  roles: Array<'ADMIN' | 'SUPPORT'>;
  /** Что в разделе меняет данные (для роли SUPPORT кнопки этих действий скрыты). */
  write?: string;
}

export const ADMIN_SECTIONS: AdminSection[] = [
  {
    id: 'overview',
    title: 'Обзор',
    description: 'Состояние платформы: сколько платежей, поездок, записей и расчётов ждут внимания, что отвечает из сервисов.',
    endpoints: 'GET /api/v1/payments, /trips, /qtime/bookings, /settlements, /actuator/health',
    roles: ['ADMIN', 'SUPPORT'],
  },
  {
    id: 'payments',
    title: 'Платежи и возвраты',
    description: 'Все платежи платформы, детали, история возвратов и возврат средств с причиной.',
    endpoints: 'GET /api/v1/payments, GET /api/v1/payments/{id}, GET /api/v1/payments/{id}/refunds, POST /api/v1/payments/{id}/refund',
    roles: ['ADMIN', 'SUPPORT'],
    write: 'Возврат средств',
  },
  {
    id: 'settlements',
    title: 'Расчёты с мерчантами',
    description: 'Долг перед продавцом и его выплата: расчёты по периодам, покрытые платежи, сверка.',
    endpoints: 'GET /api/v1/settlements, GET /api/v1/settlements/{id}, POST /api/v1/settlements/run',
    roles: ['ADMIN', 'SUPPORT'],
    write: 'Запуск расчёта',
  },
  {
    id: 'trips',
    title: 'Поездки',
    description: 'Живые и завершённые поездки: водитель, маршрут, деньги, чек, ручное назначение машины и отмена.',
    endpoints: 'GET /api/v1/trips, GET /api/v1/trips/{id}, GET /api/v1/trips/{id}/receipt, POST /api/v1/trips/{id}/assign, POST /api/v1/trips/{id}/cancel',
    roles: ['ADMIN', 'SUPPORT'],
    write: 'Назначение водителя и отмена',
  },
  {
    id: 'bookings',
    title: 'Записи QTime',
    description: 'Записи на услуги: клиент, компания, мастер, окно, цена-снимок, отмена с причиной.',
    endpoints: 'GET /api/v1/qtime/bookings, GET /api/v1/qtime/bookings/{id}, POST /api/v1/qtime/bookings/{id}/cancel',
    roles: ['ADMIN', 'SUPPORT'],
    write: 'Отмена записи',
  },
  {
    id: 'fleet',
    title: 'Парк и диспетчерская',
    description: 'Кто на линии, свежесть позиций, поиск ближайших машин к точке и переход в живую карту.',
    endpoints: 'GET /api/v1/dispatch/drivers, GET /api/v1/dispatch/nearest',
    roles: ['ADMIN', 'SUPPORT'],
  },
  {
    id: 'catalog',
    title: 'Магазины, товары и сток',
    description: 'Магазины по владельцу и идентификатору, товары, остатки и резервы стока по заказу.',
    endpoints: 'GET /api/v1/support/merchants/{id}, /support/merchants/by-owner/{userId}, /support/products/{id}, /support/products/{id}/stock, /support/reservations/{orderId}',
    roles: ['ADMIN', 'SUPPORT'],
  },
  {
    id: 'orders',
    title: 'Заказы',
    description: 'Заказ по номеру или идентификатору, история переходов, статус платежа и резерва.',
    endpoints: 'GET /api/v1/support/orders/{id}, /support/orders/by-number/{number}, /support/orders/{id}/history, GET /api/v1/payments/by-order/{orderId}',
    roles: ['ADMIN', 'SUPPORT'],
  },
  {
    id: 'accounts',
    title: 'Счета, лимиты и холды',
    description: 'Снимок счёта, выписка леджера, активные резервы и лимиты: дневной, месячный и правила антифрода.',
    endpoints: 'GET /api/v1/accounts/{id}, /accounts/{id}/transactions, /accounts/{id}/holds, GET|PUT /api/v1/accounts/{id}/limits',
    roles: ['ADMIN', 'SUPPORT'],
    write: 'Изменение лимитов',
  },
];

/** Что получает компонент раздела. Заголовок, описание и список эндпоинтов рисует оболочка. */
export interface AdminSectionProps {
  section: AdminSection;
  role: 'ADMIN' | 'SUPPORT';
  /** true только для ADMIN: у SUPPORT все изменяющие действия скрыты. */
  canWrite: boolean;
}

export function adminSectionById(id: string): AdminSection | undefined {
  return ADMIN_SECTIONS.find((s) => s.id === id);
}

/** Компоненты секций: файл `./sections/<id>.tsx` рядом с этим реестром. */
const modules = import.meta.glob<{ default: ComponentType<AdminSectionProps> }>('./sections/*.tsx');

export function hasSection(sectionId: string): boolean {
  return Boolean(modules[`./sections/${sectionId}.tsx`]);
}

export function loadSection(sectionId: string) {
  const loader = modules[`./sections/${sectionId}.tsx`];
  if (!loader) throw new Error(`нет компонента раздела: ${sectionId}`);
  return loader;
}
