import { cx } from '../../lib/cx';

/**
 * Product image with a graceful fallback.
 *
 * Catalog images come from merchant-supplied URLs that may 404, so the fallback is
 * a coloured tile with the product initial rather than a broken-image icon.
 */
export function ProductThumb({
  imageUrl,
  title,
  className,
}: {
  imageUrl?: string | null;
  title: string;
  className?: string;
}) {
  if (imageUrl) {
    return (
      <img
        src={imageUrl}
        alt=""
        loading="lazy"
        className={cx('h-full w-full rounded-xl object-cover', className)}
      />
    );
  }

  return (
    <div
      aria-hidden="true"
      className={cx(
        'grid h-full w-full place-items-center rounded-xl bg-gradient-to-br from-brand-50 to-brand-100 text-lg font-semibold text-brand-500',
        className,
      )}
    >
      {title.trim().charAt(0).toUpperCase() || 'Т'}
    </div>
  );
}
