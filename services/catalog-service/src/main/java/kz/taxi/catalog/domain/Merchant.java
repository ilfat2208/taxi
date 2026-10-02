package kz.taxi.catalog.domain;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import jakarta.persistence.Version;
import kz.taxi.common.core.error.Preconditions;
import kz.taxi.common.core.id.Ulid;
import lombok.AccessLevel;
import lombok.Getter;
import lombok.NoArgsConstructor;

import java.time.Instant;

/**
 * A seller in the marketplace.
 *
 * <p>{@code owner_user_id} is the identity-service user the profile belongs to
 * and carries a UNIQUE constraint: one person, one shop. Ownership is therefore
 * resolved by lookup on that column rather than by trusting a merchant id sent
 * by the client, which is what makes "only the owning merchant may edit a
 * product" enforceable.
 */
@Entity
@Table(name = "merchant")
@Getter
@NoArgsConstructor(access = AccessLevel.PROTECTED)
public class Merchant {

    @Id
    @Column(name = "id", length = 26, nullable = false, updatable = false)
    private String id;

    @Column(name = "owner_user_id", length = 64, nullable = false)
    private String ownerUserId;

    @Column(name = "name", length = 160, nullable = false)
    private String name;

    @Column(name = "display_name", length = 160)
    private String displayName;

    @Column(name = "phone", length = 32)
    private String phone;

    @Column(name = "email", length = 160)
    private String email;

    @Column(name = "city", length = 80)
    private String city;

    @Enumerated(EnumType.STRING)
    @Column(name = "status", length = 16, nullable = false)
    private MerchantStatus status;

    /** Trust score in basis points (0..500 = 0..5.00 stars), kept exact like money. */
    @Column(name = "rating_basis_points", nullable = false)
    private int ratingBasisPoints;

    /**
     * Account the platform pays this merchant into, chosen by the merchant itself.
     *
     * <p>Nullable by design: a merchant can sell before it has told us where to send
     * the money. Settlement then records the debt (status {@code PENDING}) instead of
     * paying it out, so nothing is silently lost.
     */
    @Column(name = "payout_account_id", length = 26)
    private String payoutAccountId;

    @Column(name = "created_at", nullable = false, updatable = false)
    private Instant createdAt;

    @Column(name = "updated_at", nullable = false)
    private Instant updatedAt;

    @Version
    @Column(name = "version", nullable = false)
    private long version;

    private Merchant(String ownerUserId, String name, String displayName,
                     String phone, String email, String city) {
        this.ownerUserId = ownerUserId;
        this.name = name;
        this.displayName = displayName;
        this.phone = phone;
        this.email = email;
        this.city = city;
    }

    /**
     * Registers a seller profile for a user.
     *
     * <p>Created {@link MerchantStatus#ACTIVE}: this service has no approval
     * workflow, and a marketplace where a fresh merchant cannot publish a single
     * offer is useless as a demo. A real deployment inserts a {@code PENDING}
     * step here and flips the status in an admin use case.
     */
    public static Merchant register(String ownerUserId, String name, String displayName,
                                    String phone, String email, String city) {
        Preconditions.requireText(ownerUserId, "ownerUserId");
        Preconditions.requireText(name, "name");
        Merchant merchant = new Merchant(ownerUserId, name.trim(),
                displayName == null || displayName.isBlank() ? name.trim() : displayName.trim(),
                phone, email, city);
        merchant.id = Ulid.nextId();
        merchant.status = MerchantStatus.ACTIVE;
        merchant.ratingBasisPoints = 0;
        Instant now = Instant.now();
        merchant.createdAt = now;
        merchant.updatedAt = now;
        return merchant;
    }

    /** Merchant name to show next to a product when no display name is set. */
    public String publicName() {
        return displayName == null || displayName.isBlank() ? name : displayName;
    }

    /** Where the platform pays this merchant out. */
    public String payoutAccountId() {
        return payoutAccountId;
    }

    public boolean hasPayoutAccount() {
        return payoutAccountId != null && !payoutAccountId.isBlank();
    }

    /**
     * Points settlements at an account.
     *
     * <p>The merchant decides where the money goes; the platform never invents an
     * account on its behalf, because a payout to a guessed account is money sent to
     * a stranger. Until this is set, settlements are computed and left {@code PENDING}
     * — the debt is on the books and visible, which is the honest state.
     */
    public void assignPayoutAccount(String accountId) {
        Preconditions.requireText(accountId, "payoutAccountId");
        this.payoutAccountId = accountId.trim();
        this.updatedAt = Instant.now();
    }
}
