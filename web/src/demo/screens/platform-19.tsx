/**
 * platform-19 · Отзыв: публичность и оспаривание (телефон, план).
 *
 * Модели отзывов в коде нет — это макет. Экран фиксирует три решения, которые обычно забывают.
 * Публичность профиля выключена по умолчанию — оценка исполнителя видна всегда, история человека
 * только с согласия. Оспаривание не удаляет отзыв молча: нужна причина исполнителя и разбор
 * поддержкой. Третье — судьба отзывов удалённого аккаунта: обезличить автора или скрыть отзыв,
 * иначе удаление станет способом обнулить себе рейтинг.
 */
import { Badge } from '../../components/ui/Badge';
import { Chips, Notice, PhoneAppBar, PhoneBody, PhoneCard, PhoneTabBar, Row } from '../kit';

const TABS = ['Главная', 'История', 'Переводы', 'Профиль'];
const TAGS = ['Товар как в описании', 'Быстрая доставка', 'Упаковка', 'Цена'];

export default function Platform19Screen() {
  return (
    <>
      <PhoneAppBar
        back
        title="Отзыв и оспаривание"
        subtitle="Заказ 01J8ZP…2M · завершён 7 октября"
        right={<Badge tone="neutral">план</Badge>}
      />
      <PhoneBody>
        <PhoneCard title="Как всё прошло?" right={<Badge tone="neutral">оценка не поставлена</Badge>}>
          <Chips items={TAGS} active="Товар как в описании" />
          <div className="mt-2 rounded-xl border border-ink-200 px-3 py-2 text-[12.5px] text-ink-800">
            Царапина на корпусе, но заменили.
          </div>
          <p className="mt-1 text-[11px] text-ink-500">
            POST /api/v1/orders/{'{id}'}/review · только по завершённому заказу
          </p>
          <div className="mt-2 rounded-xl bg-brand-500 py-2.5 text-center text-[13px] font-semibold text-white">
            Опубликовать отзыв
          </div>
        </PhoneCard>

        <PhoneCard title="Кто увидит отзыв" right={<Badge tone="warning">публичность выключена</Badge>}>
          <Row label="Публичный профиль" value="по умолчанию выключен" />
          <Row label="Только с согласия" value="ваш профиль и история" />
          <Row label="Не видно никому" value="телефон, адрес, суммы" />
          <p className="mt-1 text-[11px] leading-snug text-ink-500">
            Публичность — продуктовое решение, а не значение по умолчанию: публичный профиль открывает историю человека.
          </p>
        </PhoneCard>

        <PhoneCard title="Оспаривание оценки">
          <div className="space-y-2">
            <div className="flex gap-2">
              <span className="mt-1.5 h-2 w-2 flex-none rounded-full bg-ink-400" />
              <span className="min-w-0">
                <span className="block text-[12.5px] font-medium text-ink-800">Исполнитель оспаривает отзыв</span>
                <span className="block text-[11px] text-ink-500">Не «удалите», а «вот что было»: причина и чек или фото</span>
              </span>
            </div>
            <div className="flex gap-2">
              <span className="mt-1.5 h-2 w-2 flex-none rounded-full bg-ink-300" />
              <span className="min-w-0">
                <span className="block text-[12.5px] font-medium text-ink-800">Разбирает поддержка, а не алгоритм</span>
                <span className="block text-[11px] text-ink-500">Роль SUPPORT: отзывы разбирают люди со знанием города</span>
              </span>
            </div>
          </div>
        </PhoneCard>

        <Notice tone="warning">
          <b>Судьба отзывов удалённого аккаунта не решена.</b> Обезличить автора или скрыть отзыв — продуктовый выбор;
          без него удаление аккаунта станет способом обнулить себе рейтинг.
        </Notice>
      </PhoneBody>
      <PhoneTabBar items={TABS} active="Профиль" />
    </>
  );
}
