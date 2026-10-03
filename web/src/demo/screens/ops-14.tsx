/**
 * ops-14 · Админка · роли, доступы и флаги функций.
 *
 * Честность экрана: роли и правила живут в коде и JWT (Roles.java, @PreAuthorize, PaymentAccess,
 * InternalApiTokenFilter для /internal/), управления ролями из интерфейса нет. Роли выдаёт учебный
 * провайдер идентичности (POST /api/v1/auth/token с полем roles, код 0000), а часть «флагов» —
 * переменные окружения. Матрица доступа — предложение. Отдельно зафиксировано расхождение: возврат
 * и чтение платежа проходят одну проверку PaymentAccess.canAccess(), пропускающую SUPPORT.
 */
import { Badge } from '../../components/ui/Badge';
import { ConsolePanel, Notice, Row } from '../kit';

const ACCESS: Array<{ label: string; value: string; warn?: boolean }> = [
  { label: 'Платёж: чтение и история', value: 'владелец · SUPPORT · ADMIN' },
  { label: 'Платёж: список всех', value: 'ADMIN' },
  { label: 'Счёт, выписка, резервы', value: 'владелец · ADMIN · SUPPORT — нужно решить', warn: true },
  { label: 'Каталог, товары, заказы', value: 'SUPPORT · ADMIN' },
  { label: 'Поездки и чек', value: 'владелец · SUPPORT · ADMIN' },
  { label: 'Записи QTime', value: 'владелец · SUPPORT · ADMIN' },
  { label: 'Живой парк водителей', value: 'DISPATCHER · SUPPORT · ADMIN' },
  { label: 'Возврат денег · цель', value: 'ADMIN · MERCHANT · поддержка read-only' },
];

const FLAGS = [
  { name: 'taxi.demo.seed', value: 'вкл' },
  { name: 'SETTLEMENT_ENABLED', value: 'вкл' },
  { name: 'SETTLEMENT_AUTO_PAYOUT', value: 'вкл' },
  { name: 'SETTLEMENT_HOLD_PERIOD', value: '1h · в демо 0s' },
  { name: 'PAYMENT_MERCHANT_FEE_BP', value: '150' },
  { name: 'PAYMENT_TRANSFER_FEE_BP', value: '0' },
  { name: 'MANAGEMENT_ENDPOINTS…', value: 'health, metrics, prometheus' },
];

export default function Ops14RolesFlags() {
  return (
    <>
      <div className="flex flex-none items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[15px] font-bold tracking-tight text-ink-900">Роли, доступы и флаги функций</div>
          <div className="truncate text-[12px] text-ink-500">
            Шесть ролей платформы и то, что каждой реально разрешено
          </div>
        </div>
        <div className="flex flex-none items-center gap-2">
          <Badge tone="warning">модель доступа выписана из кода, не выдумана</Badge>
        </div>
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-2 gap-3">
        <ConsolePanel title="Доступ к чужим данным" right={<Badge tone="neutral">предложение</Badge>}>
          {ACCESS.map((item) => (
            <Row
              key={item.label}
              label={item.label}
              value={<span className={item.warn ? 'text-warning-700' : undefined}>{item.value}</span>}
            />
          ))}
          <div className="mt-2">
            <Notice tone="danger">
              <b>Расхождение, которое нужно закрыть.</b> Сейчас возврат и чтение платежа проходят одну и ту же проверку{' '}
              <span className="font-mono">PaymentAccess.canAccess()</span>, а она пропускает SUPPORT. Принцип «поддержка
              не двигает деньги» пока обеспечивает интерфейс; правило должно быть и на сервере.
            </Notice>
          </div>
        </ConsolePanel>

        <ConsolePanel title="Флаги функций" right={<Badge tone="neutral">окружение</Badge>}>
          {FLAGS.map((flag) => (
            <Row key={flag.name} label={<span className="font-mono text-[11px]">{flag.name}</span>} value={flag.value} />
          ))}
          <div className="my-2 border-t border-ink-100" />
          <div className="text-[11.5px] text-ink-600">
            Внутренние ручки закрыты: <span className="font-mono">/internal/</span> требует{' '}
            <span className="font-mono">X-Internal-Token</span> и в контракт консоли не входит.
          </div>
          <div className="mt-2">
            <Notice tone="warning">
              <b>Экран — предложение.</b> Переключателя в рантайме нет: это переменные окружения и конфиг. Роли выдаёт
              учебный провайдер идентичности (<span className="font-mono">POST /api/v1/auth/token</span> с{' '}
              <span className="font-mono">roles</span>, код 0000). Предлагаемые ручки:{' '}
              <span className="font-mono">GET/PUT /api/v1/admin/roles</span>,{' '}
              <span className="font-mono">GET/PUT /api/v1/admin/features</span>.
            </Notice>
          </div>
        </ConsolePanel>
      </div>

      <Notice tone="info">
        <b>Шесть ролей:</b> <span className="font-mono">CUSTOMER</span>, <span className="font-mono">MERCHANT</span>,{' '}
        <span className="font-mono">SUPPORT</span>, <span className="font-mono">ADMIN</span>,{' '}
        <span className="font-mono">DRIVER</span>, <span className="font-mono">DISPATCHER</span> — они едут в JWT, а
        проверяются <span className="font-mono">@PreAuthorize</span> на ручках. Матрица на экране — предложение;
        настоящие правила остаются в коде.
      </Notice>
    </>
  );
}
