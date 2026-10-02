package kz.taxi.catalog.api.dto;

import jakarta.validation.constraints.NotBlank;

/**
 * Where the platform should pay a merchant.
 *
 * @param accountId an account-service account owned by the merchant; the platform
 *                  does not verify ownership here — it verifies it at payout time,
 *                  because an account can be closed or reassigned in between
 */
public record PayoutAccountRequest(
        @NotBlank(message = "accountId is required") String accountId
) {
}
