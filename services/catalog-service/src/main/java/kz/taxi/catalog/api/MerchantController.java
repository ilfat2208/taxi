package kz.taxi.catalog.api;

import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;
import kz.taxi.catalog.api.dto.CreateMerchantRequest;
import kz.taxi.catalog.api.dto.PayoutAccountRequest;
import kz.taxi.catalog.api.dto.MerchantResponse;
import kz.taxi.catalog.api.dto.MerchantSummaryResponse;
import kz.taxi.catalog.application.CatalogQueryService;
import kz.taxi.catalog.application.MerchantService;
import kz.taxi.common.security.CurrentUser;
import org.springframework.http.HttpStatus;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

/**
 * Merchant profile endpoints.
 *
 * <p>{@code GET /{id}} is the public face of a seller (used by product cards), while
 * {@code /me} and the creation endpoint belong to the caller. {@code /me} is resolved
 * from the token and never takes an id: a merchant must not be able to read another
 * merchant's profile by guessing an id, and must not be able to edit one either.
 */
@RestController
@RequestMapping("/api/v1/merchants")
@Tag(name = "Merchants", description = "Seller profiles: public summary, own profile, onboarding")
public class MerchantController {

    private final MerchantService merchants;
    private final CatalogQueryService catalog;
    private final CurrentUser currentUser;

    public MerchantController(MerchantService merchants, CatalogQueryService catalog, CurrentUser currentUser) {
        this.merchants = merchants;
        this.catalog = catalog;
        this.currentUser = currentUser;
    }

    @PostMapping
    @ResponseStatus(HttpStatus.CREATED)
    @PreAuthorize("hasRole('MERCHANT')")
    @Operation(summary = "Register a merchant profile",
            description = "One profile per user: 409 MERCHANT_ALREADY_EXISTS on a second attempt.")
    public MerchantResponse create(@Valid @RequestBody CreateMerchantRequest request) {
        return merchants.createProfile(currentUser.requireUserId(), request);
    }

    @GetMapping("/me")
    @Operation(summary = "Own merchant profile", description = "404 MERCHANT_NOT_FOUND when the caller has none.")
    public MerchantResponse me() {
        return merchants.getOwnProfile(currentUser.requireUserId());
    }

    @PatchMapping("/me/payout-account")
    @PreAuthorize("hasRole('MERCHANT')")
    @Operation(summary = "Choose where settlements are paid",
            description = """
                    The merchant names the account-service account that payouts go to.
                    Until it is set, settlements are still computed but stay PENDING:
                    the platform owes the money and says so instead of guessing an
                    account and paying a stranger.""")
    public MerchantResponse setPayoutAccount(@Valid @RequestBody PayoutAccountRequest request) {
        return merchants.assignPayoutAccount(currentUser.requireUserId(), request.accountId());
    }

    @GetMapping("/{id}")
    @Operation(summary = "Public merchant summary",
            description = "Id, names, city, status and rating — no contact details, no owner user id.")
    public MerchantSummaryResponse getById(@PathVariable String id) {
        return catalog.getPublicMerchant(id);
    }
}
