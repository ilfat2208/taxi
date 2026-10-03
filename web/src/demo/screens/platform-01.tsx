/**
 * platform-01 · ORTA ID — профиль (телефон, работает).
 *
 * Честность экрана: работает ровно то, что видно в шапке — вход по телефону и профиль по токену
 * (`POST /api/v1/auth/token`, `GET /api/v1/auth/me`). Роли — это не «подписки» и не настройки,
 * а то, что dev-стенд кладёт в JWT; у этого аккаунта нет `DISPATCHER`, поэтому раздела
 * «Диспетчерская» он не увидит. Всё, что ниже ролей, помечено «план»: адресов, платёжных методов,
 * устройств и согласий в коде нет.
 */
import { Badge } from '../../components/ui/Badge';
import { Chips, PhoneAppBar, PhoneBody, PhoneCard, PhoneTabBar, Row } from '../kit';

const TABS = ['Главная', 'История', 'Переводы', 'Профиль'];
const ROLES = ['CUSTOMER', 'DRIVER', 'MERCHANT'];

const PLANNED: Array<{ title: string; hint: string }> = [
  { title: 'Телефон и вход', hint: 'смена номера — экран «Вход и безопасность»' },
  { title: 'Устройства и сессии', hint: 'токен не отзывается' },
  { title: 'Согласия и персональные данные', hint: 'журнала согласий нет' },
  { title: 'Адреса и бизнес-аккаунт', hint: 'адреса — часть ORTA ID' },
];

export default function Platform01Screen() {
  return (
    <>
      <PhoneAppBar
        title="ORTA ID"
        subtitle="Профиль и вход · один аккаунт на всю экосистему"
        right={<Badge tone="success">подтверждён</Badge>}
      />
      <PhoneBody>
        <PhoneCard>
          <div className="flex items-center gap-3">
            <span className="grid h-11 w-11 flex-none place-items-center rounded-full bg-gradient-to-br from-brand-500 to-info-500 text-[15px] font-semibold text-white">
              А
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[14px] font-semibold text-ink-900">Асхат Сейтказы</span>
              <span className="block truncate text-[11.5px] text-ink-500">+7 700 123 45 67 · демо-аккаунт</span>
            </span>
          </div>
          <div className="my-2 h-px bg-ink-100" />
          <Row label="Идентификатор" value={<span className="font-mono text-[11.5px]">U-1A2B3C4D5E</span>} />
          <Row label="Город пилота" value="Шымкент" />
          <Row label="Аккаунт создан" value="12 августа 2026" />
        </PhoneCard>

        <PhoneCard title="Роли этого аккаунта" right={<Badge tone="success">из JWT</Badge>}>
          <Chips items={ROLES} active="CUSTOMER" />
          <p className="mt-2 text-[11.5px] leading-snug text-ink-500">
            Роли приходят в том же JWT, что и идентификатор: у аккаунта нет <code className="rounded bg-ink-100 px-1">DISPATCHER</code>,
            поэтому раздел «Диспетчерская» ему не показывается.
          </p>
        </PhoneCard>

        <PhoneCard title="Данные профиля" right={<Badge tone="neutral">план</Badge>}>
          <div className="divide-y divide-ink-50">
            {PLANNED.map((item) => (
              <div key={item.title} className="flex items-center justify-between gap-2 py-1.5">
                <span className="min-w-0">
                  <span className="block truncate text-[12.5px] font-medium text-ink-800">{item.title}</span>
                  <span className="block truncate text-[11px] text-ink-500">{item.hint}</span>
                </span>
                <Badge tone="neutral">план</Badge>
              </div>
            ))}
          </div>
        </PhoneCard>

        <div className="rounded-xl border border-ink-200 bg-white py-2.5 text-center text-[13px] font-medium text-brand-700">
          Выйти на этом устройстве
        </div>
      </PhoneBody>
      <PhoneTabBar items={TABS} active="Профиль" />
    </>
  );
}
