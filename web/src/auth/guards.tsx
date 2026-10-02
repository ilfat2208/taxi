import { Link, Navigate, Outlet, useLocation } from 'react-router-dom';
import type { Role } from '../api/types';
import { roleLabel } from '../lib/format';
import { useAuth } from './AuthContext';
import { EmptyState } from '../components/ui/EmptyState';
import { buttonClass } from '../components/ui/Button';

/**
 * Route guard for everything except `/login`.
 *
 * Unauthenticated visitors are redirected to the login screen *remembering where
 * they were going*, so signing in lands them back on the page they asked for.
 * Role-restricted areas render an explanation instead of redirecting: silently
 * bouncing a user to the dashboard hides the reason.
 */
export function RequireAuth({ roles }: { roles?: Role[] }) {
  const { isAuthenticated, roles: currentRoles } = useAuth();
  const location = useLocation();

  if (!isAuthenticated) {
    return <Navigate to="/login" replace state={{ from: `${location.pathname}${location.search}` }} />;
  }

  if (roles && roles.length > 0 && !roles.some((role) => currentRoles.includes(role))) {
    return (
      <EmptyState
        title="Доступ ограничен"
        description={
          <>
            Этот раздел доступен ролям: {roles.map(roleLabel).join(', ')}. Ваши роли:{' '}
            {currentRoles.length > 0 ? currentRoles.map(roleLabel).join(', ') : 'нет'}.
            <br />
            В демо-режиме роль можно запросить на экране входа.
          </>
        }
        action={
          <Link to="/" className={buttonClass({ variant: 'secondary' })}>
            На главную
          </Link>
        }
      />
    );
  }

  return <Outlet />;
}
