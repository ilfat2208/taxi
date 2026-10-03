/**
 * apps-07 · Документы и продление (приложение водителя).
 *
 * Статус борда — «В работе»: продление — тот же POST /api/v1/drivers/me/documents
 * с видом (DRIVING_LICENCE, VEHICLE_INSPECTION, MEDICAL_CHECK) и датой;
 * повторный документ того же вида продлевает существующий. Приложения
 * mobile/driver ещё нет.
 *
 * Честность экрана: демо-сценарий борда — медосмотр истёк 02.10.2026, поэтому
 * линия закрыта (422 DRIVER_DOCUMENT_EXPIRED). Документ, истекающий сегодня,
 * уже недействителен: проверка строгая. Дата обязательна — без неё правило
 * «не пускать с просроченным» нечем проверить. Данные демонстрационные.
 */
import { Badge } from '../../components/ui/Badge';
import { cx } from '../../lib/cx';
import { Notice, PhoneAppBar, PhoneBody, PhoneCard } from '../kit';

type DocTone = 'success' | 'warning' | 'danger';

const DOCUMENTS: Array<{ title: string; until: string; state: string; tone: DocTone }> = [
  { title: 'Права · DRIVING_LICENCE', until: 'действует до 14.03.2029', state: 'valid', tone: 'success' },
  { title: 'Техосмотр · VEHICLE_INSPECTION', until: 'действует до 01.11.2026', state: '30 дней', tone: 'warning' },
  { title: 'Медосмотр · MEDICAL_CHECK', until: 'истёк 02.10.2026', state: 'просрочен', tone: 'danger' },
];

const DOT: Record<DocTone, string> = {
  success: 'bg-success-500',
  warning: 'bg-warning-500',
  danger: 'bg-brand-500',
};

export default function Apps07() {
  return (
    <>
      <PhoneAppBar
        title="Документы водителя"
        subtitle="Айдар Сериков · драйвер 01M3XZ5DXRHACB…"
        back
        right={<Badge tone="danger">линия закрыта</Badge>}
      />
      <PhoneBody>
        <PhoneCard className="shrink-0">
          {DOCUMENTS.map((doc, index) => (
            <div key={doc.title}>
              {index > 0 ? <div className="my-2.5 h-px bg-ink-100" /> : null}
              <div className="flex items-center gap-2.5">
                <span className={cx('h-2 w-2 flex-none rounded-full', DOT[doc.tone])} />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[12.5px] font-medium text-ink-800">{doc.title}</div>
                  <div className="truncate text-[11.5px] text-ink-500">{doc.until}</div>
                </div>
                <Badge tone={doc.tone}>{doc.state}</Badge>
              </div>
            </div>
          ))}
        </PhoneCard>

        <Notice tone="danger">
          <b>Выход на линию закрыт.</b> Медосмотр просрочен, и сервер ответит{' '}
          <span className="font-mono">422 DRIVER_DOCUMENT_EXPIRED</span>. Документ, истекающий сегодня, уже
          недействителен, а неполный набор даёт{' '}
          <span className="font-mono">422 DRIVER_DOCUMENTS_INCOMPLETE</span>.
        </Notice>

        <div className="shrink-0 text-[11px] font-semibold uppercase tracking-wide text-ink-500">
          Продлить медосмотр
        </div>
        <PhoneCard className="shrink-0">
          <div className="text-[11px] text-ink-500">Вид документа</div>
          <div className="text-[13px] font-medium text-ink-800">MEDICAL_CHECK</div>
          <div className="mt-2.5 rounded-xl border border-brand-300 bg-brand-50 px-3 py-2">
            <div className="text-[11px] text-brand-700">Действует до</div>
            <div className="text-[13px] font-medium text-ink-900">12.10.2026</div>
          </div>
        </PhoneCard>

        <div className="shrink-0 text-[11px] text-ink-400">
          Дата обязательна: без неё правило «не пускать с просроченным» нечем проверить. Отправка — тот же
          <span className="font-mono"> POST /api/v1/drivers/me/documents</span>.
        </div>

        <div className="shrink-0 rounded-xl bg-brand-500 px-3 py-2.5 text-center text-[13px] font-semibold text-white">
          Отправить документ
        </div>
      </PhoneBody>
    </>
  );
}
