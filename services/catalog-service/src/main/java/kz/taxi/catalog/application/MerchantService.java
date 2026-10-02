package kz.taxi.catalog.application;

import kz.taxi.catalog.api.dto.CreateMerchantRequest;
import kz.taxi.catalog.api.dto.MerchantResponse;
import kz.taxi.catalog.api.mapper.CatalogMapper;
import kz.taxi.catalog.domain.CatalogErrorCode;
import kz.taxi.catalog.domain.Merchant;
import kz.taxi.catalog.infrastructure.MerchantRepository;
import kz.taxi.common.core.error.DomainException;
import lombok.extern.slf4j.Slf4j;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/** Merchant onboarding and self-service reads. */
@Service
@Slf4j
public class MerchantService {

    private final MerchantRepository merchants;

    public MerchantService(MerchantRepository merchants) {
        this.merchants = merchants;
    }

    /**
     * Creates the caller's merchant profile.
     *
     * <p>One profile per user is a database constraint ({@code uq_merchant_owner}),
     * not a convention: the pre-check exists to answer 409 nicely, and the catch
     * handles the race where two parallel calls both pass the pre-check. Whoever
     * loses the race still gets 409 instead of a 500 — the DB is the arbiter, and
     * throwing a DomainException rolls the transaction back.
     */
    @Transactional
    public MerchantResponse createProfile(String ownerUserId, CreateMerchantRequest request) {
        if (merchants.existsByOwnerUserId(ownerUserId)) {
            throw DomainException.of(CatalogErrorCode.MERCHANT_ALREADY_EXISTS,
                    "user {} already has a merchant profile", ownerUserId);
        }
        Merchant merchant = Merchant.register(ownerUserId, request.name(), request.displayName(),
                request.phone(), request.email(), request.city());
        try {
            merchants.saveAndFlush(merchant);
        } catch (DataIntegrityViolationException race) {
            throw DomainException.of(CatalogErrorCode.MERCHANT_ALREADY_EXISTS,
                    "user {} already has a merchant profile", ownerUserId);
        }
        log.info("registered merchant {} (owner {})", merchant.getId(), ownerUserId);
        return CatalogMapper.toMerchant(merchant);
    }

    @Transactional(readOnly = true)
    public MerchantResponse getOwnProfile(String ownerUserId) {
        return merchants.findByOwnerUserId(ownerUserId)
                .map(CatalogMapper::toMerchant)
                .orElseThrow(() -> DomainException.of(CatalogErrorCode.MERCHANT_NOT_FOUND,
                        "user {} has no merchant profile", ownerUserId));
    }

    /**
     * Tells the platform where to pay this merchant.
     *
     * <p>Only the owner can do it, and the ownership check happens before the account
     * is stored: pointing settlements at somebody else's account is the shortest path
     * to paying a stranger, so the caller never supplies the merchant id — it is
     * resolved from the token.
     */
    @Transactional
    public MerchantResponse assignPayoutAccount(String ownerUserId, String accountId) {
        Merchant merchant = requireOwnProfile(ownerUserId);
        merchant.assignPayoutAccount(accountId);
        merchants.save(merchant);
        log.info("merchant {} will be paid into account {}", merchant.getId(), accountId);
        return CatalogMapper.toMerchant(merchant);
    }

    /** Settlement reads this by merchant id: it acts as a workload, not as the owner. */
    @Transactional(readOnly = true)
    public Merchant requireMerchant(String merchantId) {
        return merchants.findById(merchantId)
                .orElseThrow(() -> DomainException.of(CatalogErrorCode.MERCHANT_NOT_FOUND,
                                "merchant {} not found", merchantId)
                        .withDetail("merchantId", merchantId));
    }

    private Merchant requireOwnProfile(String ownerUserId) {
        return merchants.findByOwnerUserId(ownerUserId)
                .orElseThrow(() -> DomainException.of(CatalogErrorCode.MERCHANT_NOT_FOUND,
                        "user {} has no merchant profile", ownerUserId));
    }
}
