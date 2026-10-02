package kz.taxi.mobile.core.money

import java.math.BigDecimal
import java.math.RoundingMode

/**
 * Money handling for the whole app.
 *
 * The backend speaks exclusively in **minor units** (tiyn for KZT): `150000` means
 * `1 500,00 KZT`. Every amount in this app is a [Long] of minor units and every
 * conversion goes through [BigDecimal] — a `Double` is never used for money, so no
 * binary-floating-point rounding error can ever reach an amount that is sent to the
 * backend.
 */
object Money {

    const val KZT = "KZT"

    /** KZT (and every currency this backend supports) has two fraction digits. */
    private const val FRACTION_DIGITS = 2

    private val SCALE_FACTOR: BigDecimal = BigDecimal.TEN.pow(FRACTION_DIGITS)

    /** ru-KZ groups thousands with a (non-breaking) space and uses a comma for decimals. */
    private const val GROUP_SEPARATOR = '\u00A0'
    private const val DECIMAL_SEPARATOR = ','

    private const val KZT_SYMBOL = "\u20B8"

    /** `1 500,00 ₸` */
    fun format(minor: Long, currency: String = KZT): String =
        render(minor, currency, withSign = false)

    /** `+1 500,00 ₸` / `-1 500,00 ₸` */
    fun formatSigned(minor: Long, currency: String = KZT): String =
        render(minor, currency, withSign = true)

    /** `1 500,00` — no currency symbol, for text fields and compact rows. */
    fun formatPlain(minor: Long): String = grouped(BigDecimal.valueOf(minor, FRACTION_DIGITS))

    fun symbolFor(currency: String): String =
        if (currency.equals(KZT, ignoreCase = true)) KZT_SYMBOL else currency

    private fun render(minor: Long, currency: String, withSign: Boolean): String {
        val magnitude = grouped(BigDecimal.valueOf(minor, FRACTION_DIGITS))
        val signed = when {
            // A sign on zero would read as "-0,00" which is nonsense.
            !withSign || minor == 0L -> magnitude
            minor > 0 -> "+$magnitude"
            else -> "-$magnitude"
        }
        return "$signed\u00A0${symbolFor(currency)}"
    }

    private fun grouped(value: BigDecimal): String {
        val plain = value.abs().setScale(FRACTION_DIGITS, RoundingMode.UNNECESSARY).toPlainString()
        val integerPart = plain.substringBefore('.')
        val fractionPart = plain.substringAfter('.', "")
        val groupedInteger = integerPart
            .reversed()
            .chunked(3)
            .joinToString(GROUP_SEPARATOR.toString())
            .reversed()
        return "$groupedInteger$DECIMAL_SEPARATOR$fractionPart"
    }

    /**
     * Parses free-form user input (`"1 500,50"`, `"1500.5"`, `"1500"`) into minor units.
     * Returns `null` instead of throwing so a text field can show a validation error.
     * Sign is deliberately rejected: the app only ever submits positive amounts.
     */
    fun parseToMinor(input: String): Long? {
        val cleaned = buildString(input.length) {
            for (ch in input) {
                when {
                    ch.isDigit() -> append(ch)
                    ch == ',' || ch == '.' -> append('.')
                    ch == ' ' || ch == '\u00A0' || ch == '\'' || ch == '_' -> Unit
                    ch == '-' || ch == '+' -> return null
                    ch == '\u20B8' -> Unit // ₸
                    ch.isLetter() -> Unit // "тг", "KZT"
                    else -> return null
                }
            }
        }
        if (cleaned.isEmpty() || cleaned.count { it == '.' } > 1) return null
        if (cleaned.startsWith('.') || cleaned.endsWith('.')) return null
        return try {
            val decimal = BigDecimal(cleaned).setScale(FRACTION_DIGITS, RoundingMode.UNNECESSARY)
            decimal.multiply(SCALE_FACTOR).longValueExact()
        } catch (_: ArithmeticException) {
            // too many fraction digits, or the amount does not fit into a Long
            null
        } catch (_: NumberFormatException) {
            null
        }
    }

    /** Sums minor-unit amounts, failing loudly rather than silently overflowing. */
    fun sum(amounts: Iterable<Long>): Long = amounts.fold(0L, Math::addExact)
}
