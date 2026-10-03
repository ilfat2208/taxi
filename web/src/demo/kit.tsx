/**
 * Кит демо-макетов: рамки устройств и примитивы экранов.
 *
 * Зачем отдельный кит, а не «каждый экран сам себе»: на борде 160 макетов, и если
 * бы каждый рисовал свою шапку, отступы и карточки, раздел превратился бы в музей
 * разных стилей. Здесь собрано то, что повторяется: корпус телефона и консоли,
 * пометка «демо», шапка и нижняя навигация телефона, карточки, строки списков,
 * показатели, плашки-предупреждения и деньги.
 *
 * Правила раздела (держит весь демо-режим):
 *  - числа правдоподобные, но это демо: пометка стоит на рамке, а не в мелком шрифте;
 *  - ничего не «работает по-настоящему»: экраны без API не притворяются живыми;
 *  - если экран опирается на готовое ядро (QTime, леджер, каталог), это пишется
 *    в подписи экрана, а не выдумывается в разметке.
 */
import type { ReactNode } from 'react';
import { cx } from '../lib/cx';

// ---------------------------------------------------------------- корпуса

/** Пометка, что данные демонстрационные. Стоит на каждой рамке. */
export function DemoBadge({ className }: { className?: string }) {
  return (
    <span
      className={cx(
        'inline-flex items-center gap-1 rounded-full bg-ink-900/85 px-2.5 py-1 text-[11px] font-medium text-white backdrop-blur',
        className,
      )}
    >
      демо-данные
    </span>
  );
}

/** Мобильный экран 390×844 без корпуса телефона (для встраивания в галерею). */
export function PhoneContent({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cx('flex h-[816px] w-[390px] flex-col overflow-hidden bg-[#F5F6F8]', className)}>{children}</div>;
}

/** Корпус телефона со статус-баром и индикатором «домой». */
export function PhoneFrame({ children, caption }: { children: ReactNode; caption?: ReactNode }) {
  return (
    <div className="inline-flex flex-col items-start gap-3">
      <div data-demo-frame="phone" className="relative rounded-[44px] border border-ink-200 bg-white p-0 shadow-xl">
        <div className="pointer-events-none absolute right-4 top-3 z-10">
          <DemoBadge />
        </div>
        <div data-demo-viewport="phone" className="flex h-[844px] w-[390px] flex-col overflow-hidden rounded-[44px] bg-white">
          <div className="flex h-7 flex-none items-center justify-between px-5 pt-1 text-[12px] font-semibold text-ink-900">
            <span>9:41</span>
            <span className="flex items-center gap-1 text-ink-500">
              <span className="inline-block h-2 w-4 rounded-sm bg-ink-400" />
              <span className="inline-block h-2 w-3 rounded-sm bg-ink-400" />
              <span className="inline-block h-2.5 w-5 rounded-sm bg-ink-500" />
            </span>
          </div>
          <div className="flex min-h-0 flex-1 flex-col">{children}</div>
          <div className="grid h-[22px] flex-none place-items-center">
            <span className="h-[5px] w-[134px] rounded-full bg-ink-900/80" />
          </div>
        </div>
      </div>
      {caption}
    </div>
  );
}

/** Консоль 1024×768: верхняя панель, боковое меню, рабочая область. */
export function ConsoleFrame({
  title,
  role,
  nav,
  activeNav,
  children,
  caption,
}: {
  title: string;
  role: string;
  nav: string[];
  activeNav: string;
  children: ReactNode;
  caption?: ReactNode;
}) {
  return (
    <div className="inline-flex flex-col items-start gap-3">
      <div data-demo-frame="console" className="relative">
        <div className="pointer-events-none absolute right-3 top-3 z-10">
          <DemoBadge />
        </div>
        <div data-demo-viewport="console" className="flex h-[768px] w-[1024px] flex-col overflow-hidden rounded-card border border-ink-200 bg-white shadow-xl">
          <div className="flex h-[54px] flex-none items-center gap-3 border-b border-ink-100 bg-white px-4">
            <span className="grid h-7 w-7 place-items-center rounded-lg bg-brand-500 text-sm font-bold text-white">O</span>
            <span className="text-[15px] font-bold tracking-tight text-ink-900">{title}</span>
            <span className="flex-1" />
            <span className="rounded-full bg-ink-100 px-2.5 py-1 text-xs text-ink-600">{role}</span>
          </div>
          <div className="flex min-h-0 flex-1">
            <div className="flex w-[196px] flex-none flex-col gap-1 border-r border-ink-100 bg-ink-50/60 p-3">
              {nav.map((item) => (
                <span
                  key={item}
                  className={cx(
                    'rounded-lg px-3 py-2 text-[13px]',
                    item === activeNav ? 'bg-white font-semibold text-brand-700 shadow-sm' : 'text-ink-600',
                  )}
                >
                  {item}
                </span>
              ))}
            </div>
            <div data-demo-main="console" className="flex min-w-0 flex-1 flex-col gap-3 overflow-hidden bg-[#F5F6F8] p-4">{children}</div>
          </div>
        </div>
      </div>
      {caption}
    </div>
  );
}

// ------------------------------------------------------------ примитивы телефона

export function PhoneAppBar({
  title,
  subtitle,
  right,
  back,
}: {
  title: string;
  subtitle?: string;
  right?: ReactNode;
  back?: boolean;
}) {
  return (
    <div className="flex flex-none items-center gap-3 border-b border-ink-100 bg-white px-4 py-3">
      {back ? <span className="text-lg text-ink-500">←</span> : null}
      <div className="min-w-0 flex-1">
        <div className="truncate text-[15px] font-bold text-ink-900">{title}</div>
        {subtitle ? <div className="truncate text-xs text-ink-500">{subtitle}</div> : null}
      </div>
      {right}
    </div>
  );
}

export function PhoneBody({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cx('flex min-h-0 flex-1 flex-col gap-3 overflow-hidden p-4', className)}>{children}</div>;
}

export function PhoneTabBar({ items, active }: { items: string[]; active: string }) {
  return (
    <div className="flex flex-none items-center justify-around border-t border-ink-100 bg-white px-2 py-2">
      {items.map((item) => (
        <span key={item} className={cx('text-[11px]', item === active ? 'font-semibold text-brand-600' : 'text-ink-400')}>
          {item}
        </span>
      ))}
    </div>
  );
}

export function PhoneCard({
  title,
  right,
  children,
  className,
}: {
  title?: string;
  right?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cx('rounded-2xl border border-ink-200 bg-white p-3', className)}>
      {title || right ? (
        <div className="mb-2 flex items-center justify-between gap-2">
          {title ? <span className="text-[13px] font-semibold text-ink-800">{title}</span> : <span />}
          {right}
        </div>
      ) : null}
      {children}
    </div>
  );
}

export function Row({ label, value, strong }: { label: ReactNode; value: ReactNode; strong?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-1">
      <span className="text-[12.5px] text-ink-500">{label}</span>
      <span className={cx('text-right text-[13px]', strong ? 'font-semibold text-ink-900' : 'text-ink-800')}>{value}</span>
    </div>
  );
}

export function Money({ minor, currency = '₸' }: { minor: number; currency?: string }) {
  const major = (minor / 100).toLocaleString('ru-KZ', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return (
    <span className="font-semibold tabular-nums text-ink-900">
      {major} {currency}
    </span>
  );
}

export function Chips({ items, active }: { items: string[]; active?: string }) {
  return (
    <div className="flex flex-wrap gap-2">
      {items.map((item) => (
        <span
          key={item}
          className={cx(
            'rounded-full px-3 py-1.5 text-[12px]',
            item === active ? 'bg-brand-500 text-white' : 'bg-ink-100 text-ink-600',
          )}
        >
          {item}
        </span>
      ))}
    </div>
  );
}

export function Kpis({ items }: { items: Array<{ label: string; value: string; hint?: string }> }) {
  return (
    <div className="grid grid-cols-3 gap-3">
      {items.map((item) => (
        <div key={item.label} className="rounded-2xl border border-ink-200 bg-white p-3">
          <div className="text-[11px] text-ink-500">{item.label}</div>
          <div className="mt-1 text-[17px] font-bold tabular-nums text-ink-900">{item.value}</div>
          {item.hint ? <div className="text-[11px] text-ink-400">{item.hint}</div> : null}
        </div>
      ))}
    </div>
  );
}

export function Notice({ children, tone = 'info' }: { children: ReactNode; tone?: 'info' | 'warning' | 'danger' | 'neutral' }) {
  const tones = {
    info: 'bg-info-50 text-info-700 ring-blue-200',
    warning: 'bg-warning-50 text-warning-700 ring-amber-200',
    danger: 'bg-brand-50 text-brand-700 ring-brand-200',
    neutral: 'bg-ink-100 text-ink-700 ring-ink-200',
  } as const;
  return <div className={cx('rounded-xl px-3 py-2 text-[12px] ring-1 ring-inset', tones[tone])}>{children}</div>;
}

export function Placeholder({ label, className }: { label: string; className?: string }) {
  return (
    <div
      className={cx(
        'grid place-items-center rounded-xl bg-gradient-to-br from-brand-100 via-ink-100 to-ink-200 text-[11px] text-ink-500',
        className,
      )}
    >
      {label}
    </div>
  );
}

// ------------------------------------------------------------ примитивы консоли

export function ConsolePanel({
  title,
  right,
  children,
  className,
}: {
  title?: string;
  right?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cx('rounded-card border border-ink-200 bg-white', className)}>
      {title || right ? (
        <div className="flex items-center justify-between gap-3 border-b border-ink-100 px-4 py-2.5">
          {title ? <span className="text-[13px] font-semibold text-ink-800">{title}</span> : <span />}
          {right}
        </div>
      ) : null}
      <div className="p-3">{children}</div>
    </div>
  );
}

export function ConsoleTable({ columns, rows }: { columns: string[]; rows: ReactNode[][] }) {
  return (
    <div className="overflow-hidden rounded-xl border border-ink-200">
      <div className="grid gap-2 border-b border-ink-100 bg-ink-50 px-3 py-2 text-[11px] uppercase tracking-wide text-ink-500" style={{ gridTemplateColumns: `repeat(${columns.length}, minmax(0, 1fr))` }}>
        {columns.map((c) => (
          <span key={c}>{c}</span>
        ))}
      </div>
      {rows.map((row, i) => (
        <div
          key={i}
          className="grid gap-2 border-b border-ink-50 px-3 py-2 text-[12.5px] text-ink-800 last:border-0"
          style={{ gridTemplateColumns: `repeat(${columns.length}, minmax(0, 1fr))` }}
        >
          {row.map((cell, j) => (
            <span key={j} className="truncate">
              {cell}
            </span>
          ))}
        </div>
      ))}
    </div>
  );
}

export function ConsoleRows({ items }: { items: Array<{ title: string; meta?: string; right?: ReactNode }> }) {
  return (
    <div className="divide-y divide-ink-50">
      {items.map((item) => (
        <div key={item.title} className="flex items-center justify-between gap-3 py-2">
          <div className="min-w-0">
            <div className="truncate text-[13px] text-ink-800">{item.title}</div>
            {item.meta ? <div className="truncate text-[11.5px] text-ink-500">{item.meta}</div> : null}
          </div>
          {item.right}
        </div>
      ))}
    </div>
  );
}
