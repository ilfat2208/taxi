/**
 * platform-04 · Роли и доступы, веб-консоль платформы (консоль, в работе).
 *
 * Матрица собрана из работающей модели ролей: `platform/common-security-core` (`Roles.java`,
 * `JwtIssuer.java`) выдаёт JWT с ролями и проверяет подпись — HS256 на dev-стенде, RS256 через JWKS
 * в продакшене. Красная строка — честная дыра QTime: роль `MERCHANT` сейчас может отменить чужую
 * запись, это записано в коде. Аудита выдачи ролей нет — для `SUPPORT` и `ADMIN` это блокер
 * продакшена, а не деталь; поэтому консоль в статусе «в работе», а не «работает».
 *
 * Консольный экран возвращает только содержимое рабочей области: рамку (шапку, меню, роль) рисует
 * `DemoScreenPage` по `frames.ts`.
 */
import { Badge } from '../../components/ui/Badge';
import { ConsolePanel, ConsoleTable, Kpis, Notice } from '../kit';

const ROLES = ['CUSTOMER', 'DRIVER', 'MERCHANT', 'DISPATCHER', 'SUPPORT', 'ADMIN'];

const MATRIX: Array<{ action: string; cells: Array<{ text: string; tone: 'neutral' | 'success' | 'info' | 'warning' | 'danger' }> }> = [
  {
    action: 'Свои счета, выписка, переводы',
    cells: [
      { text: 'да', tone: 'success' },
      { text: 'нет', tone: 'neutral' },
      { text: 'нет', tone: 'neutral' },
      { text: 'нет', tone: 'neutral' },
      { text: 'просмотр', tone: 'info' },
      { text: 'да', tone: 'success' },
    ],
  },
  {
    action: 'Пополнение счёта и лимиты',
    cells: [
      { text: 'нет', tone: 'neutral' },
      { text: 'нет', tone: 'neutral' },
      { text: 'нет', tone: 'neutral' },
      { text: 'нет', tone: 'neutral' },
      { text: 'нет', tone: 'neutral' },
      { text: 'да', tone: 'success' },
    ],
  },
  {
    action: 'Живая карта и поиск ближайших',
    cells: [
      { text: 'нет', tone: 'neutral' },
      { text: 'нет', tone: 'neutral' },
      { text: 'нет', tone: 'neutral' },
      { text: 'да', tone: 'success' },
      { text: 'нет', tone: 'neutral' },
      { text: 'да', tone: 'success' },
    ],
  },
  {
    action: 'Отмена записи в QTime',
    cells: [
      { text: 'своя', tone: 'info' },
      { text: 'нет', tone: 'neutral' },
      { text: 'любая', tone: 'danger' },
      { text: 'нет', tone: 'neutral' },
      { text: 'да', tone: 'info' },
      { text: 'да', tone: 'success' },
    ],
  },
];

const GAPS: Array<{ title: string; meta: string; right: string; tone: 'warning' | 'danger' | 'neutral' }> = [
  { title: 'Журнала выдачи ролей нет', meta: 'GET /api/v1/platform/role-audit — предлагаемый', right: 'блокер', tone: 'danger' },
  { title: 'Роль выдаётся по запросу в теле токена', meta: 'dev-стенд: HS256, без второго фактора', right: 'dev', tone: 'warning' },
  { title: 'MERCHANT отменяет чужую запись', meta: 'связь «мерчант ↔ компания» в QTime не смоделирована', right: 'дыра', tone: 'danger' },
  { title: 'Проверка подписи на проде', meta: '/.well-known/jwks.json, RS256', right: 'работает', tone: 'neutral' },
];

export default function Platform04Screen() {
  return (
    <>
      <Kpis
        items={[
          { label: 'Ролей в модели', value: '6', hint: 'JWT с ролями' },
          { label: 'Источник ролей', value: 'запрос на токен', hint: 'POST /api/v1/auth/token' },
          { label: 'Хранение выдачи', value: 'журнала нет', hint: 'аудита выдачи ролей нет' },
        ]}
      />

      <ConsolePanel
        title="Матрица ролей"
        right={
          <span className="flex items-center gap-2">
            <Badge tone="success">HS256 — dev</Badge>
            <Badge tone="info">RS256 / JWKS — прод</Badge>
          </span>
        }
      >
        <ConsoleTable
          columns={['Действие', ...ROLES]}
          rows={MATRIX.map((row) => [
            row.action,
            ...row.cells.map((cell) => <Badge tone={cell.tone}>{cell.text}</Badge>),
          ])}
        />
        <p className="mt-2 text-[11.5px] text-ink-500">
          Показаны четыре спорных права из семи. Роли <code className="rounded bg-ink-100 px-1">DRIVER</code> и{' '}
          <code className="rounded bg-ink-100 px-1">MERCHANT</code> устроены так же: у водителя свои ручки «про себя»,
          у мерчанта — свои товары и цены. Серым показано «нет», синим — «ограниченное право».
        </p>
      </ConsolePanel>

      <div className="flex min-h-0 flex-1 gap-3">
        <ConsolePanel
          className="flex min-h-0 flex-1 flex-col"
          title="Что уже работает и чего не хватает"
        >
          <div className="divide-y divide-ink-50">
            {GAPS.map((item) => (
              <div key={item.title} className="flex items-center justify-between gap-3 py-2">
                <span className="min-w-0">
                  <span className="block truncate text-[12.5px] text-ink-800">{item.title}</span>
                  <span className="block truncate text-[11.5px] text-ink-500">{item.meta}</span>
                </span>
                <Badge tone={item.tone}>{item.right}</Badge>
              </div>
            ))}
          </div>
        </ConsolePanel>

        <ConsolePanel className="flex min-h-0 w-[300px] flex-none flex-col" title="Известная дыра, записанная в коде">
          <Notice tone="danger">
            <b>MERCHANT может отменить любую запись:</b> связь «мерчант ↔ компания» в QTime не смоделирована.
            Строка матрицы выше показывает это красным (<code className="rounded bg-white/60 px-1">QtimeAccess</code>,{' '}
            <code className="rounded bg-white/60 px-1">docs/api.md</code> §8).
          </Notice>
          <p className="mt-2 text-[11.5px] leading-snug text-ink-500">
            Аудита выдачи ролей нет: кто и когда поднял аккаунт до <code className="rounded bg-ink-100 px-1">SUPPORT</code> или{' '}
            <code className="rounded bg-ink-100 px-1">ADMIN</code> — не восстановить. Предлагаемые ручки:{' '}
            <code className="rounded bg-ink-100 px-1">GET /api/v1/platform/roles</code>,{' '}
            <code className="rounded bg-ink-100 px-1">GET /api/v1/platform/role-audit</code>.
          </p>
        </ConsolePanel>
      </div>
    </>
  );
}
