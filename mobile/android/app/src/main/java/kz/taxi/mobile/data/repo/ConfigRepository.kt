package kz.taxi.mobile.data.repo

import kz.taxi.mobile.core.net.apiCall
import kz.taxi.mobile.data.dto.FeaturesDto
import kz.taxi.mobile.data.dto.PaymentMethodDto
import kz.taxi.mobile.data.dto.PlatformConfigDto
import kz.taxi.mobile.data.dto.TariffDto
import kz.taxi.mobile.data.remote.ConfigApi

/**
 * Reads the platform configuration and turns the awkward parts into answers a screen can use.
 *
 * The gateway publishes blocks, not promises: a block carries `available = false` when the
 * service behind it did not answer. Two decisions follow from that, and both live here rather
 * than in a ViewModel:
 *
 * * [tariffs] returns an empty list when the block is unavailable — a tariff picker with no
 *   prices is a lie, and the screen shows "цены временно недоступны" instead;
 * * [methods] keeps unimplemented methods in the list (they travel with `implemented = false`)
 *   so the UI can label them, while [availableMethods] is what a checkout screen may offer.
 */
class ConfigRepository(private val configApi: ConfigApi) {

    private var cached: PlatformConfigDto? = null

    suspend fun config(forceRefresh: Boolean = false): Result<PlatformConfigDto> {
        cached?.takeIf { !forceRefresh }?.let { return Result.success(it) }
        return apiCall { configApi.config() }.onSuccess { cached = it }
    }

    /** Tariff catalogue, or an empty list when the platform could not publish it. */
    suspend fun tariffs(forceRefresh: Boolean = false): Result<List<TariffDto>> =
        config(forceRefresh).map { it.tariffs?.takeIf { block -> block.available }?.tariffs ?: emptyList() }

    /** Payment methods as published, implemented or not. */
    suspend fun methods(forceRefresh: Boolean = false): Result<List<PaymentMethodDto>> =
        config(forceRefresh).map { it.paymentMethods?.methods ?: emptyList() }

    /** What a checkout screen may actually offer today. */
    suspend fun availableMethods(forceRefresh: Boolean = false): Result<List<PaymentMethodDto>> =
        methods(forceRefresh).map { list -> list.filter { it.implemented } }

    /** Feature flags, with the honest defaults of "not built yet". */
    suspend fun features(forceRefresh: Boolean = false): Result<FeaturesDto> =
        config(forceRefresh).map { it.features ?: FeaturesDto() }

    /** Drops the cached answer — used by the home screen's pull-to-refresh. */
    fun invalidate() {
        cached = null
    }
}
