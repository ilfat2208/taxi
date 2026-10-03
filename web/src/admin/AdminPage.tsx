/**
 * Страница админ-панели: роль, раздел, загрузка компонента раздела.
 *
 * Панель работает только на реальных API сервисов. Если компонента раздела ещё
 * нет, страница так и говорит и показывает, какие эндпоинты этот раздел должен
 * обслуживать — вместо пустого экрана или выдуманных цифр.
 */
import { Suspense, lazy, useMemo } from 'react';
import { Link, Navigate, useNavigate, useParams } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { Badge } from '../components/ui/Badge';
import { Card, CardBody, CardHeader } from '../components/ui/Card';
import { EmptyState } from '../components/ui/EmptyState';
import { PageLoader } from '../components/ui/Spinner';
import { roleLabel } from '../lib/format';
import { AdminLayout } from './AdminLayout';
import { ADMIN_SECTIONS, adminSectionById, hasSection, loadSection } from './sections';

export function AdminPage() {
  const { section: sectionParam } = useParams<{ section?: string }>();
  const navigate = useNavigate();
  const { session, roles, logout } = useAuth();

  const role: 'ADMIN' | 'SUPPORT' | null = roles.includes('ADMIN')
    ? 'ADMIN'
    : roles.includes('SUPPORT')
      ? 'SUPPORT'
      : null;

  const sectionId = sectionParam ?? ADMIN_SECTIONS[0].id;
  const section = adminSectionById(sectionId);

  // Компонент раздела кэшируется по идентификатору: без этого каждое переключение
  // меню создавало бы новый lazy-компонент и перезагружало раздел с нуля.
  const Section = useMemo(() => (hasSection(sectionId) ? lazy(loadSection(sectionId)) : null), [sectionId]);

  if (!role) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-16">
        <EmptyState
          title="Доступ ограничен"
          description={
            <>
              Админ-панель доступна ролям {roleLabel('ADMIN')} и {roleLabel('SUPPORT')}. Ваши роли:{' '}
              {roles.length > 0 ? roles.map(roleLabel).join(', ') : 'нет'}. Роль можно запросить на экране входа —
              выберите её при получении токена и войдите заново.
            </>
          }
          action={
            <Link to="/" className="text-sm font-medium text-brand-700 hover:underline">
              Вернуться в приложение
            </Link>
          }
        />
      </div>
    );
  }

  const canWrite = role === 'ADMIN';

  // Канонический адрес раздела в URL: без этого меню не подсвечивало бы активный
  // пункт на «/admin», а ссылку на конкретный раздел нельзя было бы переслать.
  if (!sectionParam) {
    return <Navigate to={`/admin/${ADMIN_SECTIONS[0].id}`} replace />;
  }

  return (
    <AdminLayout
      sectionId={sectionId}
      role={role}
      canWrite={canWrite}
      onLogout={logout}
      userName={session?.phone ?? ''}
    >
      {!section ? (
        <Card>
          <CardHeader
            title="Раздел не найден"
            subtitle={`«${sectionId}» нет в реестре разделов админки.`}
          />
          <CardBody>
            <ul className="grid gap-2 sm:grid-cols-2">
              {ADMIN_SECTIONS.map((item) => (
                <li key={item.id}>
                  <button
                    type="button"
                    onClick={() => navigate(`/admin/${item.id}`)}
                    className="w-full rounded-xl px-3 py-2 text-left text-sm font-medium text-brand-700 hover:bg-brand-50"
                  >
                    {item.title}
                  </button>
                </li>
              ))}
            </ul>
          </CardBody>
        </Card>
      ) : (
        <>
          <div className="mb-5">
            <div className="flex flex-wrap items-center gap-3">
              <h1 className="text-xl font-semibold text-ink-900">{section.title}</h1>
              {section.write && (
                <Badge tone={canWrite ? 'warning' : 'neutral'}>
                  {canWrite
                    ? `Меняет данные: ${section.write}`
                    : `Только чтение: ${section.write} — доступно роли ${roleLabel('ADMIN')}`}
                </Badge>
              )}
            </div>
            <p className="mt-1 max-w-3xl text-sm text-ink-600">{section.description}</p>
            <p className="mt-2 font-mono text-xs break-words text-ink-400">{section.endpoints}</p>
          </div>

          {Section ? (
            <Suspense fallback={<PageLoader label="Загружаем раздел…" />}>
              <Section key={sectionId} section={section} role={role} canWrite={canWrite} />
            </Suspense>
          ) : (
            <Card>
              <CardHeader
                title={`Раздел «${section.title}» ещё не сделан`}
                subtitle="Готовы те разделы, у которых есть компонент в web/src/admin/sections."
              />
              <CardBody>
                <p className="text-sm text-ink-600">
                  Данные для этого раздела уже отдаются сервисами по эндпоинтам, указанным выше. Пока интерфейса нет,
                  проверять их можно напрямую в API Gateway (Swagger UI на порту 8080).
                </p>
              </CardBody>
            </Card>
          )}
        </>
      )}
    </AdminLayout>
  );
}
