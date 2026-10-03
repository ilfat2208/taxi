/**
 * Оболочка демо-режима.
 *
 * Макеты открыты без входа намеренно: в них нет ни чужих данных, ни запросов к
 * API — это витрина экранов, и требовать ради неё сессию значило бы мешать ровно
 * тому, ради чего она сделана. Настоящие разделы приложения остаются под входом.
 *
 * Сверху — честная рамка: что это демо, откуда взялись статусы и куда вернуться.
 */
import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';

export function DemoLayout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen bg-[#F5F6F8]">
      <header className="border-b border-ink-200 bg-white">
        <div className="mx-auto flex max-w-[1400px] flex-wrap items-center gap-3 px-4 py-3">
          <Link to="/demo" className="flex items-center gap-2">
            <span className="grid h-8 w-8 place-items-center rounded-lg bg-brand-500 text-sm font-bold text-white">O</span>
            <span className="text-[15px] font-bold tracking-tight text-ink-900">ORTA · демо-макеты</span>
          </Link>
          <span className="rounded-full bg-ink-100 px-2.5 py-1 text-xs text-ink-600">
            данные демонстрационные · вход не нужен
          </span>
          <span className="flex-1" />
          <Link to="/" className="rounded-xl bg-ink-100 px-3 py-2 text-xs font-medium text-ink-700">
            В приложение
          </Link>
        </div>
      </header>
      <main className="mx-auto max-w-[1400px] px-4 py-5">{children}</main>
      <footer className="mx-auto max-w-[1400px] px-4 pb-8 text-xs text-ink-500">
        Макеты перенесены из дизайн-борда <code className="rounded bg-ink-100 px-1">docs/design/orta-screens.html</code>.
        Статус у каждого экрана означает то же, что на борде: работает, сделано в текущей фазе, есть только API
        или только проект. Проверить все экраны разом: <code className="rounded bg-ink-100 px-1">cd web; node e2e/check-demo.mjs</code>.
      </footer>
    </div>
  );
}
