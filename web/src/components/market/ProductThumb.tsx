import { useState } from 'react';
import { cx } from '../../lib/cx';

/**
 * Product image with a graceful fallback.
 *
 * Catalog images come from merchant-supplied URLs that may 404 or point at a host that does
 * not resolve at all (the seeded demo catalogue uses `cdn.taxi.local`, which exists nowhere).
 * A browser cannot be told to ignore that, so instead of leaving the user with a broken-image
 * icon the component swaps the `<img>` for a coloured tile with the product initial — the same
 * tile the products without an image already get.
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
  const [failed, setFailed] = useState(false);

  if (imageUrl && !failed) {
    return (
      <img
        src={imageUrl}
        alt=""
        loading="lazy"
        onError={() => setFailed(true)}
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
