package kz.taxi.mobile.core.util

/** Phone-number normalisation shared by login and the transfer form. */
object PhoneNumbers {

    /**
     * Keeps digits, tolerating spaces, dashes and parentheses. A leading `+` survives only
     * when the number actually has digits, so a stray `"+"` normalises to `""`.
     */
    fun normalize(input: String): String {
        val trimmed = input.trim()
        val hasLeadingPlus = trimmed.startsWith("+")
        val digits = buildString(trimmed.length) {
            for (ch in trimmed) {
                if (ch.isDigit()) append(ch)
            }
        }
        if (digits.isEmpty()) return ""
        return if (hasLeadingPlus) "+$digits" else digits
    }

    /** Returns a Russian validation message, or `null` when the number looks usable. */
    fun validationError(input: String): String? {
        val normalized = normalize(input)
        if (normalized.isEmpty()) return "Введите номер телефона"
        val digits = normalized.count(Char::isDigit)
        if (digits < MIN_DIGITS) return "Слишком короткий номер"
        if (digits > MAX_DIGITS) return "Слишком длинный номер"
        return null
    }

    /** Digits-only comparison, so `+7 700 123 45 67` and `+77001234567` are the same number. */
    fun sameNumber(left: String, right: String): Boolean {
        val a = normalize(left).filter(Char::isDigit)
        val b = normalize(right).filter(Char::isDigit)
        return a.isNotEmpty() && a == b
    }

    /** `+7 700 123 45 67` — for display only, never for requests. */
    fun pretty(input: String): String {
        val digits = normalize(input).filter(Char::isDigit)
        if (digits.length != 11) return input
        return "+${digits[0]} ${digits.substring(1, 4)} ${digits.substring(4, 7)} " +
            "${digits.substring(7, 9)} ${digits.substring(9, 11)}"
    }

    private const val MIN_DIGITS = 10
    private const val MAX_DIGITS = 15
}
