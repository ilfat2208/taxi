package kz.taxi.payment.infrastructure;

import kz.taxi.common.core.error.DomainException;
import kz.taxi.payment.domain.PaymentErrorCode;
import lombok.extern.slf4j.Slf4j;
import org.springframework.web.client.RestClient;
import org.springframework.web.client.RestClientResponseException;

/**
 * The only thing settlement needs from the catalog service: where to pay a merchant.
 *
 * <p>Kept as one narrow call rather than "fetch the merchant" — payment-service is
 * not interested in a merchant's phone number or rating, and a wide client is how
 * two services quietly become one.
 *
 * <p>The call is authenticated with the internal token (the platform's RestClient
 * decorator adds it), because a settlement job is a workload with no user behind it.
 */
@Slf4j
public class CatalogMerchantClient {

    /** Everything the payout decision needs, and nothing else. */
    public record MerchantSnapshot(String merchantId, String ownerUserId, String displayName, String payoutAccountId) {

        public boolean hasPayoutAccount() {
            return payoutAccountId != null && !payoutAccountId.isBlank();
        }
    }

    private final RestClient client;

    public CatalogMerchantClient(RestClient client) {
        this.client = client;
    }

    public MerchantSnapshot merchant(String merchantId) {
        try {
            MerchantSnapshot snapshot = client.get()
                    .uri("/api/v1/catalog/internal/merchants/{merchantId}", merchantId)
                    .retrieve()
                    .body(MerchantSnapshot.class);
            if (snapshot == null) {
                throw DomainException.of(PaymentErrorCode.MERCHANT_NOT_FOUND,
                        "catalog returned an empty merchant for {}", merchantId);
            }
            return snapshot;
        } catch (RestClientResponseException answered) {
            if (answered.getStatusCode().value() == 404) {
                throw DomainException.of(PaymentErrorCode.MERCHANT_NOT_FOUND,
                        "merchant {} is unknown to the catalog", merchantId);
            }
            // Anything else is an incident, not a business refusal: settlement must
            // not invent a payout account when it cannot read the real one.
            log.error("catalog lookup failed for merchant {}: {}", merchantId, answered.getMessage());
            throw DomainException.of(PaymentErrorCode.CATALOG_SERVICE_ERROR,
                    "the catalog service could not answer for merchant {}", merchantId);
        } catch (RuntimeException down) {
            log.error("catalog service unreachable while reading merchant {}", merchantId, down);
            throw DomainException.of(PaymentErrorCode.DOWNSTREAM_UNAVAILABLE,
                    "the catalog service is unavailable");
        }
    }
}
