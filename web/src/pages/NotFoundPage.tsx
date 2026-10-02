import { Link } from 'react-router-dom';
import { buttonClass } from '../components/ui/Button';

/** 404 page for every unmatched route inside the app shell. */
export function NotFoundPage() {
  return (
    <div className="flex flex-col items-center justify-center gap-3 py-16 text-center">
      <p className="text-5xl font-bold text-brand-500">404</p>
      <h1 className="text-xl font-semibold text-ink-900">Страница не найдена</h1>
      <p className="max-w-prose text-sm text-ink-500">
        Возможно, ссылка устарела или в адресе опечатка. Проверьте путь или вернитесь на главную.
      </p>
      <div className="mt-2 flex flex-wrap justify-center gap-2">
        <Link to="/" className={buttonClass()}>
          На главную
        </Link>
        <Link to="/market" className={buttonClass({ variant: 'secondary' })}>
          В маркет
        </Link>
      </div>
    </div>
  );
}
