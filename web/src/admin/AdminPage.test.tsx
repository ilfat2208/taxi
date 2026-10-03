import { describe, expect, it } from 'vitest';
import { Route, Routes } from 'react-router-dom';
import { screen, waitFor, within } from '@testing-library/react';
import { ADMIN_SECTIONS } from './sections';
import { AdminPage } from './AdminPage';
import { jsonResponse, renderWithProviders, seedSession, stubFetch } from '../test/utils';

/**
 * Оболочка админ-панели.
 *
 * Проверяются правила доступа, а не картинка: кто вообще попадает в панель, что видит
 * SUPPORT и что происходит при неизвестном разделе. Содержимое самих разделов тестируется
 * рядом, в `sections/*.test.tsx`, поэтому ответы API здесь намеренно пустые.
 *
 * Маршруты объявлены локально — так же, как в `routes.tsx`: без `<Routes>` хук `useParams`
 * не получил бы параметр раздела, а `<Navigate>` с `/admin` было бы некуда перенаправлять.
 */
function renderAdminPage(route: string) {
  return renderWithProviders(
    <Routes>
      <Route path="/admin" element={<AdminPage />} />
      <Route path="/admin/:section" element={<AdminPage />} />
    </Routes>,
    { route },
  );
}

describe('админ-панель', () => {
  it('не пускает вошедшего без роли ADMIN или SUPPORT и объясняет, какие роли нужны', async () => {
    seedSession({ roles: ['CUSTOMER'] });
    const fetchMock = stubFetch(() => jsonResponse({}));

    renderAdminPage('/admin/overview');

    expect(await screen.findByText('Доступ ограничен')).toBeInTheDocument();
    expect(screen.getByText(/Админ-панель доступна ролям/)).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('для ADMIN открывает раздел с полным доступом и без пометки «только чтение»', async () => {
    seedSession({ roles: ['ADMIN'] });
    stubFetch(() => jsonResponse({ items: [], page: 0, size: 20, totalElements: 0, totalPages: 0 }));

    renderAdminPage('/admin/overview');

    expect(await screen.findByRole('heading', { level: 1, name: 'Обзор' })).toBeInTheDocument();
    const nav = screen.getByRole('navigation', { name: 'Разделы админки' });
    expect(within(nav).getAllByRole('link')).toHaveLength(ADMIN_SECTIONS.length);
    expect(screen.getByText(/полный доступ/)).toBeInTheDocument();
    expect(screen.queryByText(/только чтение/)).not.toBeInTheDocument();
  });

  it('для SUPPORT показывает ту же панель, но с пометкой «только чтение»', async () => {
    seedSession({ roles: ['SUPPORT'] });
    stubFetch(() => jsonResponse({ items: [], page: 0, size: 20, totalElements: 0, totalPages: 0 }));

    renderAdminPage('/admin/overview');

    expect(await screen.findByRole('heading', { level: 1, name: 'Обзор' })).toBeInTheDocument();
    expect(screen.getByText(/только чтение/)).toBeInTheDocument();
    expect(screen.queryByText(/полный доступ/)).not.toBeInTheDocument();
  });

  it('на неизвестный раздел отвечает списком существующих, а не пустым экраном', async () => {
    seedSession({ roles: ['ADMIN'] });
    stubFetch(() => jsonResponse({}));

    renderAdminPage('/admin/does-not-exist');

    expect(await screen.findByText('Раздел не найден')).toBeInTheDocument();
    for (const section of ADMIN_SECTIONS) {
      expect(screen.getByRole('button', { name: section.title })).toBeInTheDocument();
    }
  });

  it('на /admin уводит на первый раздел реестра, чтобы ссылку можно было переслать', async () => {
    seedSession({ roles: ['ADMIN'] });
    stubFetch(() => jsonResponse({}));

    renderAdminPage('/admin');

    await waitFor(() => {
      expect(screen.getByRole('heading', { level: 1, name: ADMIN_SECTIONS[0].title })).toBeInTheDocument();
    });
  });
});
