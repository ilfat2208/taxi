package kz.taxi.order.application;

import kz.taxi.common.core.error.CommonErrorCode;
import kz.taxi.common.core.error.DomainException;
import kz.taxi.common.core.money.Currency;
import kz.taxi.order.domain.Cart;
import kz.taxi.order.domain.CartStatus;
import kz.taxi.order.infrastructure.CartRepository;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;

import java.util.Optional;

/**
 * Finds — or creates — the caller's one active cart.
 *
 * <p>The rule "one ACTIVE cart per user" lives in a partial unique index, not in a
 * check-then-insert: two concurrent requests both pass an application-level check,
 * and only the database can arbitrate. What application code must do is lose the
 * race gracefully, which is why this class exists:
 *
 * <ul>
 *   <li>{@link #requireActiveCart} is deliberately <em>not</em> transactional. It
 *       reads, and on a miss it delegates the insert to a nested transaction.</li>
 *   <li>{@link #insertNewActiveCart} runs in {@code REQUIRES_NEW}. On PostgreSQL a
 *       failed statement aborts the whole surrounding transaction, so a losing
 *       insert must roll back a transaction of its own — otherwise the re-read that
 *       follows would fail with "current transaction is aborted" instead of
 *       returning the cart the other request created.</li>
 * </ul>
 *
 * <p>The cart returned from the nested transaction is detached; callers save it
 * back (a merge) when they change it, which is how a freshly opened cart gets a
 * line in the same request.
 */
@Component
public class ActiveCartProvider {

    private final CartRepository cartRepository;

    public ActiveCartProvider(CartRepository cartRepository) {
        this.cartRepository = cartRepository;
    }

    /** The caller's active cart, opened on first access. */
    public Cart requireActiveCart(String userId) {
        Optional<Cart> existing = findActiveCart(userId);
        if (existing.isPresent()) {
            return existing.get();
        }
        try {
            return insertNewActiveCart(userId);
        } catch (DataIntegrityViolationException race) {
            // Another request won the unique index. Its row is the cart; ours never
            // existed as far as anyone can tell.
            return findActiveCart(userId).orElseThrow(() -> DomainException.of(CommonErrorCode.SERVICE_UNAVAILABLE,
                    "another request is opening your cart right now, please retry"));
        }
    }

    /** The caller's active cart, without creating one. */
    public Optional<Cart> findActiveCart(String userId) {
        return cartRepository.findFirstByUserIdAndStatus(userId, CartStatus.ACTIVE);
    }

    @Transactional(propagation = Propagation.REQUIRES_NEW)
    public Cart insertNewActiveCart(String userId) {
        return cartRepository.saveAndFlush(Cart.open(userId, Currency.KZT));
    }
}
