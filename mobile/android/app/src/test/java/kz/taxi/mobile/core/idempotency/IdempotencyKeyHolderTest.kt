package kz.taxi.mobile.core.idempotency

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.util.concurrent.CountDownLatch
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit

/**
 * The idempotency contract: one key per logical submit, reused when retrying *that* submit,
 * replaced whenever a new submit begins.
 */
class IdempotencyKeyHolderTest {

    /** Deterministic generator so the assertions can name the exact keys. */
    private class SequenceGenerator(private val keys: List<String>) {
        private var index = 0
        fun next(): String = keys[index++.coerceAtMost(keys.lastIndex)]
        val calls: Int get() = index
    }

    @Test
    fun `mints a key on first use and reuses it afterwards`() {
        val generator = SequenceGenerator(listOf("key-1", "key-2"))
        val holder = IdempotencyKeyHolder(generator::next)

        assertNull("nothing is minted before the first submit", holder.peek())
        assertFalse(holder.isRetrying)

        val first = holder.currentOrNew()
        assertEquals("key-1", first)
        assertTrue(holder.isRetrying)

        // A retry of the same submit must carry the very same key.
        assertEquals(first, holder.currentOrNew())
        assertEquals(first, holder.currentOrNew())
        assertEquals("the generator must only have been consulted once", 1, generator.calls)
    }

    @Test
    fun `rotate produces a brand new key`() {
        val generator = SequenceGenerator(listOf("key-1", "key-2"))
        val holder = IdempotencyKeyHolder(generator::next)

        val first = holder.currentOrNew()
        val second = holder.rotate()

        assertEquals("key-2", second)
        assertNotEquals(first, second)
        assertEquals("the rotated key is what the next submit uses", second, holder.currentOrNew())
    }

    @Test
    fun `clear makes the next submit fresh`() {
        val generator = SequenceGenerator(listOf("key-1", "key-2"))
        val holder = IdempotencyKeyHolder(generator::next)

        holder.currentOrNew()
        holder.clear()

        assertNull(holder.peek())
        assertFalse(holder.isRetrying)
        assertEquals("key-2", holder.currentOrNew())
    }

    @Test
    fun `models a network retry then a deliberate repeat`() {
        val generator = SequenceGenerator(listOf("attempt-key", "repeat-key"))
        val holder = IdempotencyKeyHolder(generator::next)

        // 1. first submit
        val submitKey = holder.currentOrNew()
        // 2. transport failure: the key is deliberately NOT cleared, so the retry reuses it
        val retryKey = holder.currentOrNew()
        assertEquals(submitKey, retryKey)
        // 3. success: clear, then a deliberate repeat must get a new key
        holder.clear()
        val repeatKey = holder.currentOrNew()
        assertNotEquals(submitKey, repeatKey)
    }

    @Test
    fun `mints distinct UUIDs when no generator is injected`() {
        val holder = IdempotencyKeyHolder()
        val first = holder.currentOrNew()
        holder.clear()
        val second = holder.currentOrNew()

        assertNotEquals(first, second)
        assertTrue(
            "expected a UUID, got $first",
            Regex("^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$").matches(first),
        )
    }

    @Test
    fun `concurrent callers observe exactly one key`() {
        val holder = IdempotencyKeyHolder()
        val threads = 16
        val pool = Executors.newFixedThreadPool(threads)
        val start = CountDownLatch(1)
        val keys = java.util.Collections.synchronizedList(mutableListOf<String>())

        repeat(threads) {
            pool.submit {
                start.await()
                keys.add(holder.currentOrNew())
            }
        }
        start.countDown()
        pool.shutdown()
        assertTrue(pool.awaitTermination(10, TimeUnit.SECONDS))

        assertEquals(threads, keys.size)
        assertEquals("all callers must see the same in-flight key", 1, keys.toSet().size)
    }
}
