package kz.taxi.mobile.core.idempotency

import java.util.UUID

/**
 * Holds the `Idempotency-Key` for exactly one logical submit.
 *
 * The contract is: every mutating call that moves money or creates an order sends a fresh
 * UUID, and that **same** key is reused only while the user is retrying *that* submit
 * (so a network timeout followed by a retry can never double-charge). Any change to the
 * payload, a completed submit, or a deliberate "repeat" must call [rotate] to get a
 * genuinely new key.
 *
 * Not thread-safe by accident: every access is guarded, because it is touched from the
 * UI thread and from retry logic.
 */
class IdempotencyKeyHolder(
    private val generator: () -> String = { UUID.randomUUID().toString() },
) {
    private val lock = Any()
    private var key: String? = null

    /** The key for the in-flight submit; mints one on first use. */
    fun currentOrNew(): String = synchronized(lock) {
        key ?: generator().also { key = it }
    }

    /** The current key without creating one (for "is this a retry?" decisions). */
    fun peek(): String? = synchronized(lock) { key }

    /** True when [currentOrNew] would reuse an existing key rather than mint a new one. */
    val isRetrying: Boolean
        get() = synchronized(lock) { key != null }

    /** Forgets the key so the next submit gets a brand-new one. */
    fun rotate(): String = synchronized(lock) { generator().also { key = it } }

    fun clear() = synchronized(lock) { key = null }
}
