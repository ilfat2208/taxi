/**
 * Набор блоков админки: плитка с числом, панель, полосы, кольцевая диаграмма, рейл статусов.
 *
 * Зачем отдельный набор, а не «каждый раздел рисует как хочет»: админка — это один продукт, и
 * когда семь разделов рисуют свои бары и заголовки, они выглядят как семь разных продуктов.
 * Здесь собраны те блоки, которые нужны каждому разделу, и они же несут атрибуты, по которым
 * браузерная проверка считает плотность: `data-admin-kpi` у плиток, `data-admin-panel` у панелей.
 *
 * Никаких библиотек диаграмм: полосы и кольцо — обычные SVG и `div`, потому что данные у нас
 * дискретные (статусы, маршруты, коды ответов), а не временные ряды, и тянуть ради этого
 * полмегабайта чартов было бы нечестно по отношению к скорости панели.
 */
import type { ReactNode } from 'react';
import { cx } from '../lib/cx';

export type KitTone = 'neutral' | 'brand' | 'success' | 'warning' | 'danger' | 'info';

const TONE_BG: Record<KitTone, string> = {
  neutral: 'bg-ink-100 text-ink-600',
  brand: 'bg-brand-50 text-brand-700',
  success: 'bg-success-50 text-success-700',
  warning: 'bg-warning-50 text-warning-700',
  danger: 'bg-brand-50 text-brand-700',
  info: 'bg-info-50 text-info-700',
};

const TONE_FILL: Record<KitTone, string> = {
  neutral: 'bg-ink-400',
  brand: 'bg-brand-500',
  success: 'bg-success-500',
  warning: 'bg-warning-500',
  danger: 'bg-brand-600',
  info: 'bg-info-500',
};

/**
 * Плитка с числом: иконка в цветном квадрате, крупное значение, пояснение под ним.
 *
 * Пояснение обязательно: «23» без подписи — это не данные, а загадка. В подписи пишем, что
 * именно посчитано и откуда взято (серверный итог или загруженная страница).
 */
export function KpiTile({
  label,
  value,
  caption,
  icon,
  tone = 'brand',
  loading = false,
  className,
}: {
  label: string;
  value: ReactNode;
  caption: ReactNode;
  icon?: ReactNode;
  tone?: KitTone;
  loading?: boolean;
  className?: string;
}) {
  return (
    <div
      data-admin-kpi
      className={cx(
        'rounded-card border border-ink-200 bg-white p-4 shadow-sm transition-shadow hover:shadow',
        className,
      )}
    >
      <div className="flex items-start gap-3">
        {icon !== undefined && (
          <span className={cx('grid h-10 w-10 shrink-0 place-items-center rounded-xl text-lg', TONE_BG[tone])}>
            {icon}
          </span>
        )}
        <div className="min-w-0 flex-1">
          <div className="truncate text-xs font-medium tracking-wide text-ink-500 uppercase">{label}</div>
          <div className="mt-1 truncate text-2xl font-semibold text-ink-900 tabular-nums">
            {loading ? <span className="text-ink-300">—</span> : value}
          </div>
        </div>
      </div>
      <p className="mt-2 line-clamp-2 text-xs leading-relaxed text-ink-500">{caption}</p>
    </div>
  );
}

/** Панель: заголовок, при необходимости действие справа, тело. Несёт `data-admin-panel`. */
export function Panel({
  title,
  subtitle,
  action,
  children,
  id,
  className,
  bodyClassName,
}: {
  title?: ReactNode;
  subtitle?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  id?: string;
  className?: string;
  bodyClassName?: string;
}) {
  return (
    <section
      id={id}
      data-admin-panel
      // `min-w-0` обязателен: панель часто стоит в grid-колонке, а у grid-элемента
      // `min-width: auto` — широкая таблица внутри растянула бы документ на телефоне
      // (эту ошибку уже ловили в «Пульте» и «Справочниках»).
      className={cx('min-w-0 rounded-card border border-ink-200 bg-white shadow-sm', className)}
    >
      {(title || action) && (
        <header className="flex flex-wrap items-start gap-3 border-b border-ink-100 px-4 py-3">
          <div className="min-w-0 flex-1">
            {title && <h2 className="text-sm font-semibold text-ink-900">{title}</h2>}
            {subtitle && <p className="mt-0.5 text-xs text-ink-500">{subtitle}</p>}
          </div>
          {action && <div className="flex flex-wrap items-center gap-2">{action}</div>}
        </header>
      )}
      <div className={cx('p-4', bodyClassName)}>{children}</div>
    </section>
  );
}

/** Одна горизонтальная полоса: значение, доля от максимума, подпись. */
export function BarRow({
  label,
  value,
  max,
  hint,
  tone = 'brand',
}: {
  label: ReactNode;
  value: number;
  max: number;
  hint?: ReactNode;
  tone?: KitTone;
}) {
  const percent = max > 0 ? Math.min(100, Math.round((value / max) * 100)) : 0;
  return (
    <li className="py-1.5">
      <div className="flex items-baseline justify-between gap-3 text-sm">
        <span className="min-w-0 truncate text-ink-700">{label}</span>
        <span className="shrink-0 font-medium tabular-nums text-ink-900">
          {value.toLocaleString('ru-RU')}
          {hint && <span className="ml-2 text-xs font-normal text-ink-500">{hint}</span>}
        </span>
      </div>
      <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-ink-100">
        <div className={cx('h-full rounded-full', TONE_FILL[tone])} style={{ width: `${percent}%` }} />
      </div>
    </li>
  );
}

/** Список полос: одинаковый максимум на все строки, чтобы длины было честно сравнивать. */
export function BarList({
  items,
  empty,
}: {
  items: Array<{ key: string; label: ReactNode; value: number; hint?: ReactNode; tone?: KitTone }>;
  empty?: ReactNode;
}) {
  if (items.length === 0) {
    return <p className="text-sm text-ink-500">{empty ?? 'Нет данных для диаграммы.'}</p>;
  }
  const max = Math.max(...items.map((item) => item.value), 1);
  return (
    <ul className="divide-y divide-ink-100">
      {items.map((item) => (
        <BarRow key={item.key} label={item.label} value={item.value} max={max} hint={item.hint} tone={item.tone} />
      ))}
    </ul>
  );
}

export interface DonutSegment {
  key: string;
  label: string;
  value: number;
  tone: KitTone;
}

const TONE_STROKE: Record<KitTone, string> = {
  neutral: '#94a3b8',
  brand: '#1f5fa9',
  success: '#15803d',
  warning: '#b45309',
  danger: '#123a68',
  info: '#1d4ed8',
};

/**
 * Кольцевая диаграмма из сегментов (SVG, без библиотек).
 *
 * В центре — сумма всех сегментов: по одному кольцу без числа невозможно понять масштаб.
 * Если данных нет, рисуется пустое кольцо и честная подпись, а не диаграмма из воздуха.
 */
export function Donut({
  segments,
  centerLabel,
  centerValue,
  size = 168,
}: {
  segments: DonutSegment[];
  centerLabel?: string;
  centerValue?: ReactNode;
  size?: number;
}) {
  const total = segments.reduce((sum, segment) => sum + segment.value, 0);
  const radius = 60;
  const circumference = 2 * Math.PI * radius;
  let offset = 0;

  return (
    <div className="flex flex-wrap items-center gap-5">
      <div className="relative" style={{ width: size, height: size }}>
        <svg viewBox="0 0 160 160" width={size} height={size} role="img" aria-label={centerLabel ?? 'Диаграмма'}>
          <circle cx="80" cy="80" r={radius} fill="none" stroke="#e2e8f0" strokeWidth="18" />
          {total > 0 &&
            segments
              .filter((segment) => segment.value > 0)
              .map((segment) => {
                const length = (segment.value / total) * circumference;
                const circle = (
                  <circle
                    key={segment.key}
                    cx="80"
                    cy="80"
                    r={radius}
                    fill="none"
                    stroke={TONE_STROKE[segment.tone]}
                    strokeWidth="18"
                    strokeDasharray={`${length} ${circumference - length}`}
                    strokeDashoffset={-offset}
                    transform="rotate(-90 80 80)"
                  />
                );
                offset += length;
                return circle;
              })}
        </svg>
        <div className="absolute inset-0 grid place-items-center text-center">
          <div>
            <div className="text-xl font-semibold tabular-nums text-ink-900">
              {centerValue ?? total.toLocaleString('ru-RU')}
            </div>
            {centerLabel && <div className="text-[11px] text-ink-500">{centerLabel}</div>}
          </div>
        </div>
      </div>

      <ul className="min-w-[180px] flex-1 space-y-1.5">
        {segments.map((segment) => (
          <li key={segment.key} className="flex items-center gap-2 text-sm">
            <span
              className="h-2.5 w-2.5 shrink-0 rounded-full"
              style={{ backgroundColor: TONE_STROKE[segment.tone] }}
            />
            <span className="min-w-0 flex-1 truncate text-ink-700">{segment.label}</span>
            <span className="shrink-0 font-medium tabular-nums text-ink-900">{segment.value.toLocaleString('ru-RU')}</span>
            <span className="w-12 shrink-0 text-right text-xs tabular-nums text-ink-500">
              {total > 0 ? `${Math.round((segment.value / total) * 100)}%` : '—'}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * Рейл статусов: вертикальный список с числами, как в обычных админках.
 *
 * Первым пунктом всегда идёт «Все»: без него непонятно, от чего считаются остальные числа.
 * Числа приходят снаружи — раздел сам решает, серверные они (`totalElements`) или посчитаны
 * по загруженной странице, и обязан подписать это рядом.
 */
export function StatusRail({
  items,
  active,
  onSelect,
  allLabel = 'Все',
  allCount,
  ariaLabel = 'Фильтр по статусу',
}: {
  items: Array<{ value: string; label: string; count?: number }>;
  active: string;
  onSelect: (value: string) => void;
  allLabel?: string;
  allCount?: number;
  ariaLabel?: string;
}) {
  const base =
    'flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-sm transition-colors';
  return (
    <ul aria-label={ariaLabel} className="space-y-0.5">
      <li>
        <button
          type="button"
          onClick={() => onSelect('')}
          aria-current={active === '' ? 'true' : undefined}
          className={cx(base, active === '' ? 'bg-brand-50 font-medium text-brand-700' : 'text-ink-600 hover:bg-ink-100')}
        >
          <span className="min-w-0 flex-1 truncate">{allLabel}</span>
          {typeof allCount === 'number' && (
            <span className="rounded-full bg-ink-100 px-2 py-0.5 text-xs font-medium tabular-nums text-ink-600">
              {allCount}
            </span>
          )}
        </button>
      </li>
      {items.map((item) => (
        <li key={item.value}>
          <button
            type="button"
            onClick={() => onSelect(item.value)}
            aria-current={active === item.value ? 'true' : undefined}
            className={cx(
              base,
              active === item.value ? 'bg-brand-50 font-medium text-brand-700' : 'text-ink-600 hover:bg-ink-100',
            )}
          >
            <span className="min-w-0 flex-1 truncate">{item.label}</span>
            {typeof item.count === 'number' && (
              <span
                className={cx(
                  'rounded-full px-2 py-0.5 text-xs font-medium tabular-nums',
                  item.count > 0 ? 'bg-brand-100 text-brand-700' : 'bg-ink-100 text-ink-500',
                )}
              >
                {item.count}
              </span>
            )}
          </button>
        </li>
      ))}
    </ul>
  );
}

/** Тулбар раздела: одна строка под заголовком, прижатая к правому краю группа действий. */
export function Toolbar({ children, right }: { children?: ReactNode; right?: ReactNode }) {
  return (
    <div className="mb-4 flex flex-wrap items-end gap-3 rounded-card border border-ink-200 bg-white px-4 py-3 shadow-sm">
      {children}
      {right && <div className="ml-auto flex flex-wrap items-center gap-2">{right}</div>}
    </div>
  );
}

/** Метка-чип для мелких подписей внутри панелей. */
export function Chip({ children, tone = 'neutral' }: { children: ReactNode; tone?: KitTone }) {
  return (
    <span className={cx('inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium', TONE_BG[tone])}>
      {children}
    </span>
  );
}
