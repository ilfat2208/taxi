package kz.taxi.mobile.core.util

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** The phone normalisation that both the login screen and the transfer form rely on. */
class PhoneNumbersTest {

    @Test
    fun `normalises the shapes a user types`() {
        assertEquals("+77009998877", PhoneNumbers.normalize("+7 (700) 999-88-77"))
        assertEquals("+77009998877", PhoneNumbers.normalize("+7 700 999 88 77"))
        assertEquals("+77009998877", PhoneNumbers.normalize("  +77009998877  "))
        assertEquals("87009998877", PhoneNumbers.normalize("8 700 999 88 77"))
        assertEquals("", PhoneNumbers.normalize("   "))
        assertEquals("", PhoneNumbers.normalize("+"))
    }

    @Test
    fun `keeps a leading plus only`() {
        assertEquals("+77009998877", PhoneNumbers.normalize("+77009998877"))
        assertEquals("77009998877", PhoneNumbers.normalize("77009998877+"))
        assertEquals("77001234567", PhoneNumbers.normalize("7+700+123+4567"))
    }

    @Test
    fun `accepts plausible numbers and rejects implausible ones`() {
        assertNull(PhoneNumbers.validationError("+77001234567"))
        assertNull(PhoneNumbers.validationError("+7 (700) 123-45-67"))
        assertNull(PhoneNumbers.validationError("+123456789012345"))

        assertEquals("Введите номер телефона", PhoneNumbers.validationError(""))
        assertEquals("Введите номер телефона", PhoneNumbers.validationError("   "))
        assertEquals("Слишком короткий номер", PhoneNumbers.validationError("+770012345"))
        assertEquals("Слишком длинный номер", PhoneNumbers.validationError("+1234567890123456"))
    }

    @Test
    fun `compares numbers by digits only`() {
        assertTrue(PhoneNumbers.sameNumber("+77009998877", "+7 700 999 88 77"))
        assertTrue(PhoneNumbers.sameNumber("+77009998877", "+77009998877"))
        assertFalse(PhoneNumbers.sameNumber("+77009998877", "+77001234567"))
        assertFalse("an empty comparison is never a match", PhoneNumbers.sameNumber("", ""))
    }

    @Test
    fun `pretty prints an 11 digit number and leaves anything else alone`() {
        assertEquals("+7 700 999 88 77", PhoneNumbers.pretty("+77009998877"))
        assertEquals("+7 700 123 45 67", PhoneNumbers.pretty("+7 (700) 123-45-67"))
        assertEquals("+123456789012345", PhoneNumbers.pretty("+123456789012345"))
    }
}
