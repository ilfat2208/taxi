import { Link } from 'react-router-dom';
import { formatMoney } from '../../api/money';
import type { QtimeCompany } from '../../api/types';
import { Badge } from '../ui/Badge';
import { Card } from '../ui/Card';
import { formatRatingBp } from '../../lib/cityTime';

/**
 * Company card of the QTime catalogue.
 *
 * Absent fields stay absent: a company without a price list shows no "от … ₸", one
 * without a rating shows no stars. "0 ₸" and "4,0" would both be made up.
 */
export function CompanyCard({ company }: { company: QtimeCompany }) {
  const rating = formatRatingBp(company.ratingBp);
  const place = [company.city, company.address].filter((part): part is string => Boolean(part));

  return (
    <Card as="li" className="h-full">
      <Link
        to={`/services/${encodeURIComponent(company.companyId)}`}
        className="flex h-full flex-col gap-2 p-4"
      >
        <span className="flex items-start justify-between gap-2">
          <span className="text-sm font-semibold text-ink-900">{company.name}</span>
          {company.category ? <Badge tone="neutral">{company.category}</Badge> : null}
        </span>

        {place.length > 0 ? <span className="text-xs text-ink-500">{place.join(' · ')}</span> : null}

        {rating ? (
          <span className="text-xs text-ink-600">
            ★ {rating}
            {company.reviewsCount !== null ? ` · отзывов: ${company.reviewsCount}` : ''}
          </span>
        ) : null}

        <span className="mt-auto flex items-end justify-between gap-2 pt-2">
          <span className="space-x-3 text-xs text-ink-500">
            {company.specialistsCount !== null ? (
              <span>специалистов: {company.specialistsCount}</span>
            ) : null}
            {company.servicesCount !== null ? <span>услуг: {company.servicesCount}</span> : null}
          </span>
          {company.minPriceMinor !== null ? (
            <span className="tnum shrink-0 text-sm font-semibold text-ink-900">
              {/* The company contract carries no currency field; the platform is
                  Kazakhstan-only, so the default KZT of `formatMoney` applies. */}
              от {formatMoney(company.minPriceMinor, 'KZT', { trimZeroFraction: true })}
            </span>
          ) : null}
        </span>
      </Link>
    </Card>
  );
}
