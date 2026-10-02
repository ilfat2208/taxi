package kz.taxi.mobile.core.money

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Money is minor units + [java.math.BigDecimal] everywhere. These tests pin the exact
 * ru-KZ rendering (non-breaking space grouping, comma decimals, `₸`) and prove that no
 * binary floating point is involved anywhere in the conversion.
 */
class MoneyTest {

    private val nbsp = '\u00A0'
    private val tenge = '\u20B8'

    // ---------------------------------------------------------------- formatting

    @Test
    fun `formats minor units as ru-KZ tenge`() {
        // 150000 minor units == 1 500,00 KZT
        assertEquals("1${nbsp}500,00${nbsp}$tenge", Money.format(150_000L))
    }

    @Test
    fun `groups thousands with a non-breaking space`() {
        assertEquals("4${nbsp}119${nbsp}992,50${nbsp}$tenge", Money.format(411_999_250L))
        assertEquals("1${nbsp}000${nbsp}000,00${nbsp}$tenge", Money.format(100_000_000L))
    }

    @Test
    fun `renders zero and sub-unit amounts`() {
        assertEquals("0,00${nbsp}$tenge", Money.format(0L))
        assertEquals("0,05${nbsp}$tenge", Money.format(5L))
        assertEquals("0,29${nbsp}$tenge", Money.format(29L))
        assertEquals("0,99${nbsp}$tenge", Money.format(99L))
        assertEquals("1,00${nbsp}$tenge", Money.format(100L))
    }

    @Test
    fun `plain format has no currency symbol`() {
        assertEquals("1${nbsp}500,50", Money.formatPlain(150_050L))
        assertEquals("0,01", Money.formatPlain(1L))
    }

    @Test
    fun `signed format adds an explicit sign`() {
        assertEquals("+1${nbsp}500,00${nbsp}$tenge", Money.formatSigned(150_000L))
        assertEquals("-1${nbsp}500,00${nbsp}$tenge", Money.formatSigned(-150_000L))
        assertEquals("0,00${nbsp}$tenge", Money.formatSigned(0L))
    }

    @Test
    fun `non-KZT currencies fall back to the ISO code`() {
        assertEquals("1${nbsp}500,00${nbsp}USD", Money.format(150_000L, "USD"))
    }

    @Test
    fun `an amount never loses a tiyn to floating point`() {
        // A Double-based implementation drifts on values like these.
        val awkward = listOf(1L, 29L, 57L, 1_150L, 8_130L, 123_457L, 999_999_999L)
        for (minor in awkward) {
            val formatted = Money.formatPlain(minor)
            assertEquals(
                "round trip failed for $minor (got $formatted)",
                minor,
                Money.parseToMinor(formatted),
            )
        }
    }

    @Test
    fun `formats the largest amount the backend can hold`() {
        // Long.MAX_VALUE minor units == 92 233 720 368 547 758,07 KZT
        assertEquals(
            "92${nbsp}233${nbsp}720${nbsp}368${nbsp}547${nbsp}758,07${nbsp}$tenge",
            Money.format(Long.MAX_VALUE),
        )
    }

    // ---------------------------------------------------------------- parsing

    @Test
    fun `parses the input shapes a user actually types`() {
        assertEquals(150_050L, Money.parseToMinor("1 500,50"))
        assertEquals(150_050L, Money.parseToMinor("1500,50"))
        assertEquals(150_050L, Money.parseToMinor("1500.50"))
        assertEquals(150_000L, Money.parseToMinor("1500"))
        assertEquals(150_000L, Money.parseToMinor("1 500"))
        assertEquals(150_000L, Money.parseToMinor("1500,00"))
        assertEquals(100L, Money.parseToMinor("1"))
        assertEquals(110L, Money.parseToMinor("1,1"))
        assertEquals(150_000L, Money.parseToMinor("  1500  "))
        assertEquals(150_000L, Money.parseToMinor("1500${nbsp}$tenge"))
    }

    @Test
    fun `rejects input that is not a positive amount`() {
        assertNull(Money.parseToMinor(""))
        assertNull(Money.parseToMinor("   "))
        assertNull(Money.parseToMinor("abc"))
        assertNull(Money.parseToMinor("-100"))
        assertNull(Money.parseToMinor("+100"))
        assertNull(Money.parseToMinor("1.234"))
        assertNull(Money.parseToMinor("1,234"))
        assertNull(Money.parseToMinor("."))
        assertNull(Money.parseToMinor("1.2.3"))
        assertNull(Money.parseToMinor(",50"))
        assertNull(Money.parseToMinor("50,"))
    }

    @Test
    fun `rejects amounts that overflow a Long`() {
        assertNull(Money.parseToMinor("99999999999999999999"))
    }

    @Test
    fun `sums without floating point and fails loudly on overflow`() {
        assertEquals(300L, Money.sum(listOf(100L, 200L)))
        assertEquals(0L, Money.sum(emptyList()))
        var threw = false
        try {
            Money.sum(listOf(Long.MAX_VALUE, 1L))
        } catch (_: ArithmeticException) {
            threw = true
        }
        assertTrue("overflow must not be silent", threw)
    }
}
