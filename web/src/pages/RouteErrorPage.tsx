import { useRouteError } from 'react-router-dom';
import { ErrorAlert } from '../components/ui/Alerts';
import { Link } from 'react-router-dom';
import { buttonClass } from '../components/ui/Button';

/**
 * Router-level error boundary.
 *
 * A render crash inside a page must not leave a white screen: React Router hands
 * the thrown value to this element, which shows the same error card as the rest of
 * the app (message, code, correlation id) plus a way out.
 */
export function RouteErrorPage() {
  const error = useRouteError();

  return (
    <div className="grid min-h-dvh place-items-center bg-ink-50 p-4">
      <div className="w-full max-w-lg space-y-4">
        <h1 className="text-xl font-semibold text-ink-900">Что-то сломалось на этой странице</h1>
        <ErrorAlert error={error} title="Непредвиденная ошибка интерфейса" />
        <p className="text-sm text-ink-500">
          Обновите страницу. Если ошибка повторяется — сообщите поддержке код и correlation id выше.
        </p>
        <Link to="/" className={buttonClass({ variant: 'secondary' })}>
          На главную
        </Link>
      </div>
    </div>
  );
}
