package kz.taxi.order.infrastructure;

import kz.taxi.order.domain.Cart;
import kz.taxi.order.domain.CartStatus;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.Optional;

public interface CartRepository extends JpaRepository<Cart, String> {

    /**
     * The caller's active cart, if any.
     *
     * <p>A partial unique index guarantees at most one row, so "first" and "the"
     * are the same thing here.
     */
    Optional<Cart> findFirstByUserIdAndStatus(String userId, CartStatus status);
}
