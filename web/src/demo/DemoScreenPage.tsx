/**
 * Просмотр одного демо-экрана: рамка устройства, сам экран и честная подпись.
 *
 * Подпись — не украшение, а часть макета: рядом с каждым экраном написано, что на
 * нём, где это живёт или будет жить в коде, какие эндпоинты его кормят и что
 * сознательно не сделано. Без этого 145 картинок выглядят как обещания.
 */
import { Suspense, lazy, useMemo } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Badge } from '../components/ui/Badge';
import { Card, CardBody, CardHeader } from '../components/ui/Card';
import { EmptyState } from '../components/ui/EmptyState';
import { PageLoader } from '../components/ui/Spinner';
import { ConsoleFrame, PhoneFrame } from './kit';
import { CONSOLE_CONFIG, activeNavFor } from './frames';
import { DemoLayout } from './DemoLayout';
import { demoMeta, hasScreen, loadScreen, screenById } from './registry';
import { STATUS_LABEL, STATUS_TONE } from './types';

export function DemoScreenPage() {
  const { screenId = '' } = useParams();
  const meta = screenById(screenId);
  const position = useMemo(() => demoMeta.findIndex((s) => s.id === screenId), [screenId]);

  if (!meta) {
    return (
      <EmptyState
        title="Макет не найден"
        description={`Экрана с идентификатором «${screenId}» в реестре нет. Откройте галерею демо-макетов.`}
        action={
          <Link to="/demo" className="rounded-xl bg-brand-500 px-4 py-2 text-sm font-medium text-white">
            В галерею
          </Link>
        }
      />
    );
  }

  // Пока компонент макета не написан, честно говорим об этом — вместо падения
  // ленивой загрузки. Реестр знает все 145 экранов, код появляется постепенно.
  if (!hasScreen(meta.id)) {
    return (
      <div className="space-y-4">
        <Link to="/demo" className="rounded-xl bg-ink-100 px-3 py-2 text-xs font-medium text-ink-700">
          ← Все макеты
        </Link>
        <Card>
          <CardHeader title={meta.title} subtitle={`${meta.section}. ${meta.sectionTitle}`} />
          <CardBody className="space-y-2 text-sm text-ink-600">
            <p>Этот макет ещё не перенесён в код. Его описание уже есть в реестре:</p>
            <p className="text-xs text-ink-500"><b>Где в коде:</b> <code className="rounded bg-ink-100 px-1">{meta.code}</code></p>
            <p className="text-xs text-ink-500"><b>Эндпоинты:</b> <code className="rounded bg-ink-100 px-1">{meta.endpoints}</code></p>
            <p className="text-xs text-ink-500">{meta.note}</p>
          </CardBody>
        </Card>
      </div>
    );
  }
  const Screen = lazy(loadScreen(meta.id));
  const prev = position > 0 ? demoMeta[position - 1] : undefined;
  const next = position >= 0 && position < demoMeta.length - 1 ? demoMeta[position + 1] : undefined;

  const caption = (
    <div className="max-w-[1024px] space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-semibold text-ink-900">{meta.title}</span>
        <Badge tone={STATUS_TONE[meta.status]}>{STATUS_LABEL[meta.status]}</Badge>
        <Badge tone="neutral">{meta.kind === 'phone' ? 'телефон 390×844' : 'консоль 1024×768'}</Badge>
        <span className="font-mono text-[11px] text-ink-400">{meta.id}</span>
      </div>
      <p className="text-sm text-ink-600">{meta.note}</p>
      <p className="text-xs text-ink-500">
        <b>Где в коде:</b> <code className="rounded bg-ink-100 px-1">{meta.code}</code>
      </p>
      <p className="text-xs text-ink-500">
        <b>Эндпоинты и события:</b> <code className="rounded bg-ink-100 px-1">{meta.endpoints}</code>
      </p>
    </div>
  );

  return (
    <DemoLayout>
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Link to="/demo" className="rounded-xl bg-ink-100 px-3 py-2 text-xs font-medium text-ink-700">
          ← Все макеты
        </Link>
        {prev ? (
          <Link to={`/demo/${prev.id}`} className="rounded-xl bg-white px-3 py-2 text-xs text-ink-600 ring-1 ring-ink-200">
            ← {prev.title}
          </Link>
        ) : null}
        {next ? (
          <Link to={`/demo/${next.id}`} className="rounded-xl bg-white px-3 py-2 text-xs text-ink-600 ring-1 ring-ink-200">
            {next.title} →
          </Link>
        ) : null}
        <span className="ml-auto text-xs text-ink-500">
          {meta.section}. {meta.sectionTitle}
        </span>
      </div>

      <div className="overflow-x-auto">
        <Suspense fallback={<PageLoader label="Загружаем макет…" />}>
          {meta.kind === 'phone' ? (
            <PhoneFrame caption={caption}>
              <Screen />
            </PhoneFrame>
          ) : (
            <ConsoleFrame
              title={CONSOLE_CONFIG[meta.section]?.title ?? meta.sectionTitle}
              role={CONSOLE_CONFIG[meta.section]?.role ?? 'роль из макета'}
              nav={CONSOLE_CONFIG[meta.section]?.nav ?? ['Обзор']}
              activeNav={activeNavFor(meta.section, meta.title)}
              caption={caption}
            >
              <Screen />
            </ConsoleFrame>
          )}
        </Suspense>
      </div>

      <Card>
        <CardHeader title="Как читать этот раздел" />
        <CardBody className="space-y-2 text-sm text-ink-600">
          <p>
            Макет показывает <b>предлагаемый вид</b>. Числа в нём демонстрационные — так и подписано на рамке.
            Если экран опирается на уже готовое ядро (запись через QTime, леджер и холды, каталог и заказы),
            это сказано в описании, потому что такая часть действительно работает.
          </p>
          <p>
            Экраны со статусом <b>План</b> не имеют ни сервиса, ни эндпоинтов: это проект, который ждёт решения
            продукта. Экраны <b>В работе</b> означают обратное: API и правила есть, не хватает интерфейса.
          </p>
        </CardBody>
      </Card>
    </div>
    </DemoLayout>
  );
}