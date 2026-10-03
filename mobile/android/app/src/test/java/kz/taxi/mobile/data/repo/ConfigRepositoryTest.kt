package kz.taxi.mobile.data.repo

import kotlinx.coroutines.runBlocking
import kz.taxi.mobile.data.dto.PaymentMethodDto
import kz.taxi.mobile.data.dto.PaymentMethodsBlockDto
import kz.taxi.mobile.data.dto.PlatformConfigDto
import kz.taxi.mobile.data.dto.TariffBlockDto
import kz.taxi.mobile.data.dto.TariffDto
import kz.taxi.mobile.data.remote.ConfigApi
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * The repository's job is not transport but judgement: the config endpoint answers with
 * blocks that may be unavailable, and a screen must not be handed an empty tariff picker as
 * if that were the price list.
 */
class ConfigRepositoryTest {

    private val tariffs = listOf(
        TariffDto(code = "ECONOMY", baseMinor = 35_000, perKmMinor = 12_000, perMinuteMinor = 2_500, minFareMinor = 50_000),
        TariffDto(code = "COMFORT", baseMinor = 60_000, perKmMinor = 18_000, perMinuteMinor = 3_500, minFareMinor = 80_000),
    )

    private val methods = listOf(
        PaymentMethodDto(code = "BALANCE", title = "Баланс", implemented = true),
        PaymentMethodDto(code = "CARD", title = "Карта", implemented = false, detail = "не подключён"),
    )

    @Test
    fun `tariffs come through when the block is available`() = runBlocking {
        val repository = ConfigRepository(fakeApi(available = true))

        val result = repository.tariffs()

        assertTrue(result.isSuccess)
        assertEquals(listOf("ECONOMY", "COMFORT"), result.getOrThrow().map { it.code })
    }

    @Test
    fun `an unavailable tariff block becomes an empty list, not a fake price list`() = runBlocking {
        val repository = ConfigRepository(fakeApi(available = false))

        val result = repository.tariffs()

        assertTrue(result.isSuccess)
        assertTrue(result.getOrThrow().isEmpty())
    }

    @Test
    fun `the checkout list contains only implemented methods`() = runBlocking {
        val repository = ConfigRepository(fakeApi(available = true))

        val available = repository.availableMethods().getOrThrow()
        val published = repository.methods().getOrThrow()

        assertEquals(listOf("BALANCE"), available.map { it.code })
        assertEquals(listOf("BALANCE", "CARD"), published.map { it.code })
        assertFalse(published.first { it.code == "CARD" }.implemented)
    }

    @Test
    fun `feature flags default to not built when the gateway does not publish them`() = runBlocking {
        val repository = ConfigRepository(object : ConfigApi {
            override suspend fun config(): PlatformConfigDto = PlatformConfigDto()
        })

        val features = repository.features().getOrThrow()

        assertFalse(features.cardPayments)
        assertFalse(features.pushNotifications)
        assertFalse(features.websockets)
    }

    @Test
    fun `the configuration is cached until it is invalidated`() = runBlocking {
        val counting = CountingConfigApi(available = true)
        val repository = ConfigRepository(counting)

        repository.config()
        repository.config()
        assertEquals(1, counting.calls)

        repository.invalidate()
        repository.config()
        assertEquals(2, counting.calls)
    }

    @Test
    fun `a failed call is an error, not an empty configuration`() = runBlocking {
        val repository = ConfigRepository(object : ConfigApi {
            override suspend fun config(): PlatformConfigDto = throw java.io.IOException("нет сети")
        })

        assertTrue(repository.config().isFailure)
    }

    private fun fakeApi(available: Boolean): ConfigApi = object : ConfigApi {
        override suspend fun config(): PlatformConfigDto = PlatformConfigDto(
            tariffs = TariffBlockDto(
                available = available,
                reason = if (available) null else "trip-service не ответил",
                currency = "KZT",
                tariffs = if (available) tariffs else emptyList(),
            ),
            paymentMethods = PaymentMethodsBlockDto(available = true, methods = methods, merchantFeeBp = 150),
        )
    }

    private class CountingConfigApi(private val available: Boolean) : ConfigApi {

        var calls: Int = 0
            private set

        override suspend fun config(): PlatformConfigDto {
            calls++
            return PlatformConfigDto(
                tariffs = TariffBlockDto(available = available, tariffs = emptyList()),
            )
        }
    }
}
