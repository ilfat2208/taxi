/**
 * Группы разделов админки.
 *
 * Оболочка рисует разделы не одним списком, а группами с заголовками — как в обычной
 * админке: «Мониторинг», «Деньги», «Поездки и услуги», «Каталог», «Данные». Группировка
 * живёт здесь, а не в реестре разделов: реестр отвечает за то, что раздел делает и какие
 * у него эндпоинты, а порядок и подписи в меню — это навигация.
 *
 * Счётчики у пунктов меню берутся из реальных сервисов (см. `attention.ts`), и только там,
 * где такой счётчик есть смысл: «сколько ждёт внимания», а не «сколько всего».
 */
import type { AdminSection } from './sections';

export interface AdminNavGroup {
  title: string;
  /** Идентификаторы разделов из реестра, в порядке показа. */
  sections: string[];
}

export const ADMIN_NAV_GROUPS: AdminNavGroup[] = [
  { title: 'Мониторинг', sections: ['overview', 'pulse'] },
  { title: 'Деньги', sections: ['payments', 'settlements', 'accounts'] },
  { title: 'Поездки и услуги', sections: ['trips', 'bookings', 'fleet'] },
  { title: 'Каталог и заказы', sections: ['catalog', 'orders'] },
  { title: 'Данные', sections: ['reference'] },
];

/**
 * Группы для роли: пустые группы не показываем, разделы без прав не показываем.
 * Если раздел из реестра не попал ни в одну группу, он всё равно будет показан — в конце,
 * чтобы новый раздел не пропадал из меню из-за забытой строки в этом файле.
 */
export function navGroupsFor(
  sections: AdminSection[],
  role: 'ADMIN' | 'SUPPORT',
): Array<{ title: string; items: AdminSection[] }> {
  const visible = sections.filter((section) => section.roles.includes(role));
  const byId = new Map(visible.map((section) => [section.id, section]));
  const placed = new Set<string>();

  const groups = ADMIN_NAV_GROUPS.map((group) => {
    const items = group.sections
      .map((id) => byId.get(id))
      .filter((section): section is AdminSection => Boolean(section));
    items.forEach((section) => placed.add(section.id));
    return { title: group.title, items };
  }).filter((group) => group.items.length > 0);

  const rest = visible.filter((section) => !placed.has(section.id));
  if (rest.length > 0) {
    groups.push({ title: 'Прочее', items: rest });
  }
  return groups;
}
