/**
 * Галерея демо-макетов.
 *
 * Это вход в раздел: список всех экранов борда с их честными статусами. Смысл
 * страницы — не «показать красиво», а не дать потеряться: у каждого макета видно,
 * работает ли он на самом деле (`Работает`), сделан ли в текущей фазе (`Ф2`), есть
 * ли API без интерфейса (`В работе`) или это только проект (`План`).
 *
 * Экраны, которые в приложении настоящие, ведут по ссылке на живой раздел — их не
 * нужно рисовать заново, и подменять их макетом было бы враньём.
 */
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Badge } from '../components/ui/Badge';
import { Card, CardBody, CardHeader } from '../components/ui/Card';
import { PageHeader } from '../components/layout/PageHeader';
import { DemoLayout } from './DemoLayout';
import { demoMeta, demoSections } from './registry';
import { STATUS_LABEL, STATUS_TONE, type DemoStatus } from './types';

const STATUSES: DemoStatus[] = ['Работает', 'Ф2', 'В работе', 'План'];

export function DemoGalleryPage() {
  const [section, setSection] = useState<number | 'all'>('all');
  const [status, setStatus] = useState<DemoStatus | 'all'>('all');
  const [query, setQuery] = useState('');

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return demoMeta.filter((screen) => {
      if (section !== 'all' && screen.section !== section) return false;
      if (status !== 'all' && screen.status !== status) return false;
      if (needle && !`${screen.title} ${screen.note}`.toLowerCase().includes(needle)) return false;
      return true;
    });
  }, [section, status, query]);

  const counts = useMemo(() => {
    const byStatus = new Map<DemoStatus, number>();
    for (const screen of demoMeta) byStatus.set(screen.status, (byStatus.get(screen.status) ?? 0) + 1);
    return byStatus;
  }, []);

  const phones = filtered.filter((s) => s.kind === 'phone').length;
  const consoles = filtered.length - phones;

  return (
    <DemoLayout>
    <div className="space-y-4">
      <PageHeader
        title="Демо-макеты"
        subtitle="Все экраны дизайн-борда, перенесённые в код: 145 макетов и 17 разделов, которые уже работают на живом API."
      />

      <Card>
        <CardBody className="space-y-3 text-sm text-ink-600">
          <p>
            <b className="text-ink-900">Что это.</b> Макеты из <code className="rounded bg-ink-100 px-1">docs/design/orta-screens.html</code>,
            собранные как настоящие React-экраны. Данные в них демонстрационные — на каждой рамке стоит пометка
            «демо-данные», а рядом с экраном написано, что в нём работает по-настоящему, а что только проектируется.
          </p>
          <p>
            <b className="text-ink-900">Что значит статус.</b> Он перенесён с борда и означает ровно то же:
            {' '}<Badge tone="success">Работает</Badge> — проверено сквозными сценариями на живом стеке,
            {' '}<Badge tone="info">Ф2</Badge> — сделано в текущей фазе,
            {' '}<Badge tone="warning">В работе</Badge> — API и правила есть, интерфейса нет,
            {' '}<Badge tone="neutral">План</Badge> — кода нет, есть проект.
          </p>
          <div className="flex flex-wrap gap-2 pt-1">
            {STATUSES.map((s) => (
              <Badge key={s} tone={STATUS_TONE[s]}>
                {STATUS_LABEL[s]}: {counts.get(s) ?? 0}
              </Badge>
            ))}
          </div>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Фильтры" subtitle={`Показано ${filtered.length} из ${demoMeta.length}`} />
        <CardBody className="space-y-3">
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => setSection('all')}
              className={`rounded-full px-3 py-1.5 text-xs ${section === 'all' ? 'bg-brand-500 text-white' : 'bg-ink-100 text-ink-600'}`}
            >
              Все разделы
            </button>
            {demoSections.map((s) => (
              <button
                key={s.section}
                type="button"
                onClick={() => setSection(s.section)}
                className={`rounded-full px-3 py-1.5 text-xs ${section === s.section ? 'bg-brand-500 text-white' : 'bg-ink-100 text-ink-600'}`}
              >
                {s.section}. {s.title} · {s.screens.length}
              </button>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => setStatus('all')}
              className={`rounded-full px-3 py-1.5 text-xs ${status === 'all' ? 'bg-brand-500 text-white' : 'bg-ink-100 text-ink-600'}`}
            >
              Любой статус
            </button>
            {STATUSES.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => setStatus(s)}
                className={`rounded-full px-3 py-1.5 text-xs ${status === s ? 'bg-brand-500 text-white' : 'bg-ink-100 text-ink-600'}`}
              >
                {STATUS_LABEL[s]}
              </button>
            ))}
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Поиск по названию и описанию"
              className="ml-auto w-full max-w-xs rounded-xl border border-ink-200 px-3 py-2 text-sm outline-none focus:border-brand-400 sm:w-64"
            />
          </div>
          <p className="text-xs text-ink-500">
            В выборке: мобильных экранов {phones}, консолей {consoles}.
          </p>
        </CardBody>
      </Card>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {filtered.map((screen) => (
          <div key={screen.id} className="flex flex-col justify-between rounded-card border border-ink-200 bg-white p-4 shadow-sm">
            <div className="space-y-2">
              <div className="flex items-start justify-between gap-2">
                <div className="text-sm font-semibold text-ink-900">{screen.title}</div>
                <Badge tone={STATUS_TONE[screen.status]}>{STATUS_LABEL[screen.status]}</Badge>
              </div>
              <div className="text-xs text-ink-500">
                {screen.section}. {screen.sectionTitle} · {screen.kind === 'phone' ? 'телефон 390×844' : 'консоль 1024×768'}
              </div>
              <p className="line-clamp-3 text-xs text-ink-600">{screen.note}</p>
            </div>
            <div className="mt-3 flex items-center gap-2">
              {screen.realRoute ? (
                <Link
                  to={screen.realRoute.replace(/\{(\w+)\}/g, 'demo')}
                  className="rounded-xl bg-brand-500 px-3 py-2 text-xs font-medium text-white"
                >
                  Открыть работающий экран
                </Link>
              ) : (
                <Link to={`/demo/${screen.id}`} className="rounded-xl bg-brand-500 px-3 py-2 text-xs font-medium text-white">
                  Смотреть макет
                </Link>
              )}
              <span className="truncate font-mono text-[11px] text-ink-400">{screen.id}</span>
            </div>
          </div>
        ))}
      </div>

      {filtered.length === 0 ? (
        <Card>
          <CardBody className="text-sm text-ink-500">По этим фильтрам экранов нет.</CardBody>
        </Card>
      ) : null}
    </div>
    </DemoLayout>
  );
}