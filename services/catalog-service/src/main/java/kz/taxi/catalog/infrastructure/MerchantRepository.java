package kz.taxi.catalog.infrastructure;

import kz.taxi.catalog.domain.Merchant;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.Optional;

public interface MerchantRepository extends JpaRepository<Merchant, String> {

    /**
     * Resolves the caller's own shop.
     *
     * <p>Every merchant write starts here instead of trusting a merchant id from
     * the request body: ownership is a property of the caller's user id, which
     * comes from the signed JWT.
     */
    Optional<Merchant> findByOwnerUserId(String ownerUserId);

    boolean existsByOwnerUserId(String ownerUserId);
}
