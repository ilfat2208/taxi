/**
 * crm-15 · Настройки салона и права.
 *
 * Из настроек в модели живут адрес с координатами, город, часовой пояс, категория и статус
 * компании. Шаг сетки (30 минут), горизонт записи (30 дней) и минимальный запас до визита
 * (30 минут) — глобальные параметры сервиса, одинаковые для всех компаний: это спорное
 * место, три числа просятся в company. Политики отмены нет вовсе.
 *
 * Права — незакрытая дыра платформы, и экран показывает её именно так: связь
 * «мерчант ↔ компания» не смоделирована, поэтому сегодня роль MERCHANT может отменить любую
 * запись любой компании и при этом не читает календарь своей.
 */
import { Badge } from '../../components/ui/Badge';
import { cx } from '../../lib/cx';
import { Chips, ConsolePanel, Notice } from '../kit';

interface Field {
  label: string;
  value: string;
  /** Настройка сервиса, а не салона: на экране помечена как спорная. */
  global?: boolean;
  missing?: boolean;
}

const FIELDS: Field[] = [
  { label: 'Название', value: 'Салон красоты «Лотос»' },
  { label: 'Категория', value: 'BEAUTY · Шымкент' },
  { label: 'Адрес', value: 'ул. Тауке хана, 83' },
  { label: 'Часовой пояс', value: 'Asia/Almaty' },
  { label: 'Шаг сетки', value: '30 минут · весь сервис', global: true },
  { label: 'Горизонт записи', value: '30 дней · весь сервис', global: true },
  { label: 'Запас до визита', value: '30 минут · весь сервис', global: true },
  { label: 'Политика отмены', value: 'не смоделирована', missing: true },
];

const RIGHTS = [
  { role: 'CUSTOMER', text: '— записаться', note: 'только сам' },
  { role: 'MERCHANT', text: '— календарь компании', note: 'API не отдаёт' },
  { role: 'SUPPORT', text: '— все записи, чтение', note: 'работает' },
  { role: 'ADMIN', text: '— все записи и отмены', note: 'работает' },
];

export default function CrmSettings() {
  return (
    <>
      <div className="flex items-center gap-2">
        <div className="min-w-0">
          <div className="truncate text-[13px] font-semibold text-ink-900">Настройки салона и права</div>
          <div className="truncate text-[11.5px] text-ink-500">
            Адрес, часовой пояс, шаг сетки, горизонт записи и минимальный запас до визита
          </div>
        </div>
        <span className="ml-auto flex items-center gap-2">
          <Badge tone="danger">настроек в API нет</Badge>
          <span className="rounded-full bg-white px-3 py-1.5 text-[12px] text-ink-600 ring-1 ring-ink-200">Сохранить</span>
        </span>
      </div>

      <div className="grid grid-cols-[minmax(0,1fr)_320px] gap-3">
        <ConsolePanel
          title="Профиль и правила записи"
          right={<span className="text-[11px] text-ink-500">выделено — то, что задаётся на весь сервис, а не на салон</span>}
        >
          <div className="grid grid-cols-2 gap-2.5">
            {FIELDS.map((field) => (
              <div
                key={field.label}
                className={cx(
                  'rounded-xl px-2.5 py-1.5 ring-1 ring-inset',
                  field.global ? 'bg-brand-50/60 ring-brand-200' : 'bg-ink-50 ring-ink-200',
                  field.missing && 'bg-ink-100 ring-ink-200',
                )}
              >
                <div className="text-[10.5px] text-ink-500">{field.label}</div>
                <div className={cx('truncate text-[12.5px]', field.missing ? 'text-ink-400' : 'text-ink-800')}>
                  {field.value}
                </div>
              </div>
            ))}
          </div>

          <div className="mt-2.5">
            <Notice tone="warning">
              <b>Спорное место: настройки записи глобальные, а не салонные.</b> Шаг сетки, горизонт и запас живут в{' '}
              <code className="rounded bg-black/5 px-1 font-mono text-[11px]">QtimeProperties</code> — это параметры
              сервиса, одинаковые для салона, барбершопа, автосервиса и стоматологии. Салон и СТО хотят разную
              гранулярность, поэтому три числа просятся в company. Предлагаются{' '}
              <code className="rounded bg-black/5 px-1 font-mono text-[11px]">GET и PATCH /companies/&#123;id&#125;/settings</code>.
            </Notice>
          </div>
        </ConsolePanel>

        <ConsolePanel title="Права и доступ">
          <div className="space-y-1.5">
            {RIGHTS.map((right) => (
              <div key={right.role} className="flex items-center justify-between gap-2">
                <span className="min-w-0 truncate text-[12.5px] text-ink-800">
                  <span className="font-mono text-[11.5px]">{right.role}</span> {right.text}
                </span>
                <span className="flex-none text-[11px] text-ink-500">{right.note}</span>
              </div>
            ))}
          </div>

          <div className="mt-2.5">
            <Notice tone="danger">
              <b>Незакрытый вопрос: «мерчант ↔ компания» не смоделирована.</b> В{' '}
              <code className="rounded bg-black/5 px-1 font-mono text-[11px]">QtimeAccess</code> сторона компании
              определяется только ролью: isCompanySide = MERCHANT или ADMIN, привязки аккаунта к компании нет. Пока её
              нет, роль MERCHANT может отменить любую запись любой компании — это документированная дыра в коде, а не
              норма. Зеркально: тот же MERCHANT не читает календарь своей компании.
            </Notice>
          </div>

          <div className="mt-2.5 text-[11px] text-ink-500">Компания в шапке</div>
          <div className="mt-1.5">
            <Chips items={['Лотос · BEAUTY', 'ещё 3 компании в демо-базе']} active="Лотос · BEAUTY" />
          </div>
          <p className="mt-2 text-[11.5px] leading-[16px] text-ink-600">
            Нужны поля <code className="rounded bg-black/5 px-1 font-mono text-[11px]">company.owner_user_id</code> и{' '}
            <code className="rounded bg-black/5 px-1 font-mono text-[11px]">specialist.user_id</code>, проверка владельца
            компании в QtimeAccess и отдельный эндпоинт политики отмены — её в модели нет вовсе.
          </p>
        </ConsolePanel>
      </div>
    </>
  );
}
