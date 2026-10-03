/**
 * Описание рамок консолей по разделам.
 *
 * Боковое меню и роль — часть макета, но они одинаковы для всего раздела, поэтому
 * живут здесь, а не в каждом экране: иначе десять консолей одного раздела получили
 * бы десять разных шапок, и раздел перестал бы выглядеть одним продуктом.
 */
export interface ConsoleConfig {
  title: string;
  role: string;
  nav: string[];
}

export const CONSOLE_CONFIG: Record<number, ConsoleConfig> = {
  4: {
    title: 'ORTA Business',
    role: 'роль MERCHANT · владелец магазина',
    nav: ['Обзор', 'Заказы', 'Товары и услуги', 'Клиенты', 'Финансы и выплаты', 'Записи', 'Отзывы', 'Сотрудники', 'Настройки'],
  },
  5: {
    title: 'QTime CRM',
    role: 'роль MERCHANT · администратор салона',
    nav: ['Календарь', 'Записи', 'Мастера', 'Графики работы', 'Услуги и прайс', 'Клиенты', 'Отзывы', 'Отчёты', 'Настройки'],
  },
  6: {
    title: 'ORTA Оператор',
    role: 'роль SUPPORT · поддержка и пульт',
    nav: ['Поддержка', 'Операционный пульт', 'Админка платформы', 'Аудит', 'Роли и доступы'],
  },
  8: {
    title: 'ORTA Платформа',
    role: 'роль ADMIN · администрирование',
    nav: ['Роли и доступы', 'Справочники', 'Интеграции'],
  },
};

/** Активный пункт меню выбираем по названию экрана — без магии и лишних полей в реестре. */
export function activeNavFor(section: number, title: string): string {
  const config = CONSOLE_CONFIG[section];
  if (!config) return '';
  const found = config.nav.find((item) => {
    const head = item.split(' ')[0].toLowerCase();
    return title.toLowerCase().includes(head);
  });
  return found ?? config.nav[0];
}
