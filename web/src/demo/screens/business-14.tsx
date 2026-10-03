/**
 * ORTA Business · Сотрудники и роли.
 *
 * Статус на борде «План»: ролей компании, приглашений и журнала действий бизнеса в
 * платформе нет — есть только платформенные роли в JWT (CUSTOMER, DRIVER, MERCHANT,
 * DISPATCHER, SUPPORT, ADMIN из platform/common-security-core/.../Roles.java).
 * Единственный существующий audit-след — support_audit_record, и он про поддержку.
 *
 * Поэтому «Пригласить сотрудника» и «Журнал» нарисованы неактивными, а матрица прав
 * показана как проект: роли компании придётся вводить с нуля, вместе с журналом.
 * Матрица вынесена на всю ширину — четыре колонки в узкой панели обрезали бы названия.
 */
import { Badge } from '../../components/ui/Badge';
import { Chips, ConsolePanel, ConsoleRows, Notice, Row } from '../kit';

/**
 * Строки — одной линией на сотрудника: имя, роль и время последнего действия.
 * Двухэтажные строки выталкивали матрицу прав за рабочую область.
 */
const MEMBERS = [
  { name: 'Асель Т. · владелец', right: 'всё, включая выплаты · 04.10, 09:02', pending: false },
  { name: 'Ержан С. · администратор', right: 'заказы и товары · 04.10, 08:40', pending: false },
  { name: 'Айгуль С. · мастер', right: 'свои записи · 03.10, 18:20', pending: false },
  { name: 'Динара К. · мастер', right: 'ждёт ссылку', pending: true },
];

/**
 * Матрица прав — списком, как на борде: право и одной строкой «владелец да · админ
 * да · мастер нет». Таблица из четырёх колонок в рабочей области обрезала названия
 * прав, а строка рядом с ними читается без сокращений.
 */
const RIGHTS = [
  { title: 'Заказы и возвраты', value: 'владелец да · админ да · мастер нет' },
  { title: 'Цены и товары', value: 'владелец да · админ да · мастер нет' },
  { title: 'Свои записи и отметка визита', value: 'все три роли — да' },
  { title: 'Ответы на отзывы', value: 'владелец да · админ да · мастер нет' },
  { title: 'Выплаты и реквизиты', value: 'только владелец' },
  { title: 'Сотрудники и права', value: 'только владелец' },
];

const JOURNAL = [
  { title: 'Ержан С. изменил цену', meta: '09:12 · 184 990 → 189 990 ₸' },
  { title: 'Ержан С. подтвердил заказ', meta: '18:15 · ORD-241003-8F3K' },
  { title: 'Айгуль С. отметила визит', meta: '17:40 · запись → COMPLETED' },
  { title: 'Асель Т. отменила запись', meta: '20:20 · окно освобождено' },
];

export default function Business14() {
  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      <div className="flex flex-none items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[16px] font-bold text-ink-900">Сотрудники и роли</div>
          <div className="truncate text-[12px] text-ink-500">
            4 сотрудника · 3 роли компании · журнал действий за 7 дней
          </div>
        </div>
        <div className="flex flex-none items-center gap-2">
          <span className="rounded-full bg-ink-100 px-3 py-1.5 text-[12px] text-ink-400">Журнал</span>
          <span className="rounded-full bg-ink-100 px-3 py-1.5 text-[12px] text-ink-400">Пригласить сотрудника</span>
        </div>
      </div>

      <div className="flex-none">
        <Notice tone="warning">
          Ролей компании, приглашений и журнала действий бизнеса нет — в JWT живут только платформенные роли (
          <code>Roles.java</code>).
        </Notice>
      </div>

      <div className="flex flex-none gap-3">
        <ConsolePanel title="Сотрудники" className="w-[360px] flex-none">
          <ConsoleRows
            items={MEMBERS.map((member) => ({
              title: member.name,
              right: member.pending ? (
                <Badge tone="warning">{member.right}</Badge>
              ) : (
                <span className="text-[11.5px] text-ink-500">{member.right}</span>
              ),
            }))}
          />
        </ConsolePanel>

        <ConsolePanel title="Приглашение" className="w-[220px] flex-none">
          <Row label="Ссылка" value="на 72 ч" />
          <Row label="E-mail" value={<span className="text-[12px]">dinara@shymkent-trade.kz</span>} />
          <div className="mt-2">
            <Chips items={['Владелец', 'Админ', 'Мастер']} active="Мастер" />
          </div>
          <div className="mt-3">
            <span className="rounded-full bg-ink-100 px-3 py-1.5 text-[12px] text-ink-400">Отправить приглашение</span>
          </div>
        </ConsolePanel>

        <ConsolePanel
          title="Журнал действий"
          right={<span className="text-[11px] text-ink-400">7 дней</span>}
          className="min-h-0 flex-1 overflow-hidden"
        >
          <ConsoleRows items={JOURNAL} />
        </ConsolePanel>
      </div>

      <ConsolePanel
        title="Права ролей"
        right={
          <span className="text-[11px] text-ink-400">
            редактируется только владельцем · предлагается GET /api/v1/business/members
          </span>
        }
        className="min-h-0 flex-1 overflow-hidden"
      >
        <ConsoleRows
          items={RIGHTS.map((row) => ({
            title: row.title,
            right: <span className="text-[12px] text-ink-500">{row.value}</span>,
          }))}
        />
      </ConsolePanel>
    </div>
  );
}
