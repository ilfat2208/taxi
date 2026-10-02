package kz.taxi.order.infrastructure;

import kz.taxi.order.domain.CartItem;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;
import java.util.Optional;

public interface CartItemRepository extends JpaRepository<CartItem, String> {

    List<CartItem> findByCartIdOrderByCreatedAtAsc(String cartId);

    /**
     * Looks a line up inside one cart.
     *
     * <p>The cart id is part of the query rather than a check performed afterwards:
     * an item id from another customer's cart must be indistinguishable from an id
     * that does not exist.
     */
    Optional<CartItem> findByIdAndCartId(String id, String cartId);

    Optional<CartItem> findByCartIdAndProductId(String cartId, String productId);
}
