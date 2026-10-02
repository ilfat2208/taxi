package kz.taxi.catalog.api.dto;

import jakarta.validation.constraints.Email;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

/**
 * Registration of a merchant profile for the calling user.
 *
 * <p>{@code ownerUserId} is deliberately absent: it comes from the JWT, never from
 * the body, otherwise anybody could register a shop in somebody else's name.
 */
public record CreateMerchantRequest(
        @NotBlank @Size(max = 160) String name,
        @Size(max = 160) String displayName,
        @Size(max = 32) String phone,
        @Email @Size(max = 160) String email,
        @Size(max = 80) String city
) {
}
