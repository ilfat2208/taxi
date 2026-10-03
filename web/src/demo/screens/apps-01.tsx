/**
 * apps-01 · Выход на линию с документами (приложение водителя).
 *
 * Статус борда — «В работе»: правило существует на сервере
 * (services/driver-service: профиль, документы со сроком, смена), а приложения
 * mobile/driver ещё нет, поэтому это макет.
 *
 * Честность экрана: набор документов проверяет сервер, а не экран. Неполный
 * набор — 422 DRIVER_DOCUMENTS_INCOMPLETE, просроченный документ —
 * 422 DRIVER_DOCUMENT_EXPIRED. Автомобиль водителя в driver-service не
 * смоделирован, поэтому на экране его нет и не может быть.
 *
 * Данные демонстрационные: запросов к API экран не делает.
 */
import type { ReactNode } from 'react';
import { Badge } from '../../components/ui/Badge';
import { cx } from '../../lib/cx';
import { Notice, PhoneAppBar, PhoneBody, PhoneCard, PhoneTabBar, Row } from '../kit';

const DRIVER_TABS = ['Смена', 'Поездки', 'Деньги', 'Профиль'];

const DRIVER = {
  initials: 'АС',
  name: 'Айдар Сериков',
  phone: '+7 701 567 67 65',
  rating: '4,92',
  trips: '1 248',
};

type DocTone = 'success' | 'warning';

const DOCUMENTS: Array<{ title: string; until: string; state: string; tone: DocTone }> = [
  { title: 'Права · DRIVING_LICENCE', until: 'действует до 14.03.2029', state: 'действует', tone: 'success' },
  { title: 'Техосмотр · VEHICLE_INSPECTION', until: 'действует до 01.11.2026', state: '30 дней', tone: 'warning' },
  { title: 'Медосмотр · MEDICAL_CHECK', until: 'действует до 12.04.2027', state: 'действует', tone: 'success' },
];

function Action({ children, tone = 'primary' }: { children: ReactNode; tone?: 'primary' | 'secondary' }) {
  return (
    <div
      className={cx(
        'shrink-0 rounded-xl px-3 py-2.5 text-center text-[13px] font-semibold',
        tone === 'primary' ? 'bg-brand-500 text-white' : 'bg-ink-100 text-ink-700',
      )}
    >
      {children}
    </div>
  );
}

export default function Apps01() {
  return (
    <>
      <PhoneAppBar
        title="ORTA Taxi · водитель"
        subtitle="Приложение водителя · демо"
        right={<Badge tone="neutral">OFFLINE</Badge>}
      />
      <PhoneBody>
        <PhoneCard className="shrink-0">
          <div className="flex items-center gap-3">
            <span className="grid h-11 w-11 flex-none place-items-center rounded-full bg-gradient-to-br from-brand-400 to-brand-700 text-[14px] font-bold text-white">
              {DRIVER.initials}
            </span>
            <div className="min-w-0 flex-1">
              <div className="truncate text-[14px] font-semibold text-ink-900">{DRIVER.name}</div>
              <div className="truncate text-[11.5px] text-ink-500">{DRIVER.phone} · смена не начата</div>
            </div>
          </div>
          <div className="my-2.5 h-px bg-ink-100" />
          <Row label="Рейтинг (rating_bp 492)" value={DRIVER.rating} />
          <Row label="Поездок всего" value={DRIVER.trips} />
        </PhoneCard>

        <div className="shrink-0 text-[11px] font-semibold uppercase tracking-wide text-ink-500">
          Документы для выхода на линию
        </div>
        <PhoneCard className="shrink-0">
          {DOCUMENTS.map((doc, index) => (
            <div key={doc.title}>
              {index > 0 ? <div className="my-2.5 h-px bg-ink-100" /> : null}
              <div className="flex items-center gap-2.5">
                <span
                  className={cx(
                    'h-2 w-2 flex-none rounded-full',
                    doc.tone === 'success' ? 'bg-success-500' : 'bg-warning-500',
                  )}
                />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[12.5px] font-medium text-ink-800">{doc.title}</div>
                  <div className="truncate text-[11.5px] text-ink-500">{doc.until}</div>
                </div>
                <Badge tone={doc.tone}>{doc.state}</Badge>
              </div>
            </div>
          ))}
        </PhoneCard>

        <Notice tone="info">
          <b>Проверку делает сервер, а не экран:</b> без действующих прав, техосмотра и медосмотра смена не
          начнётся — <span className="font-mono">422 DRIVER_DOCUMENTS_INCOMPLETE</span>{' '}
          (<span className="font-mono">POST /api/v1/drivers/me/status</span>).
        </Notice>

        <Notice tone="danger">
          <b>Пробел: автомобиля нет.</b> Ни марки, ни номера в{' '}
          <span className="font-mono">driver-service</span> не смоделировано, поэтому показать машину, на которой
          водитель выходит на линию, нечем.
        </Notice>

        <Action>Выйти на линию</Action>
      </PhoneBody>
      <PhoneTabBar items={DRIVER_TABS} active="Смена" />
    </>
  );
}
