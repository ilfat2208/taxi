package kz.taxi.mobile.data.dto

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

/**
 * The client configuration the platform publishes at `GET /api/v1/config`.
 *
 * Why the app reads this instead of hardcoding it: the tariff list, the payment methods and
 * what is still missing are decisions of the platform, not of the binary. A build that ships
 * "карта" as a payment option while the backend cannot take a card is a build that lies to
 * the person holding the phone — and the reference apps (customer, courier, vendor) all solve
 * this with exactly one startup call.
 *
 * Everything is nullable-with-default on purpose: a client must survive an older gateway that
 * does not publish a block yet, and an unavailable downstream block arrives as
 * `available = false` rather than as a missing key.
 */
@Serializable
data class PlatformConfigDto(
    val platform: PlatformInfoDto? = null,
    val verticals: List<VerticalDto> = emptyList(),
    val tariffs: TariffBlockDto? = null,
    @SerialName("paymentMethods") val paymentMethods: PaymentMethodsBlockDto? = null,
    val features: FeaturesDto? = null,
    val anonymousPaths: List<String> = emptyList(),
    val notes: List<String> = emptyList(),
)

@Serializable
data class PlatformInfoDto(
    val name: String? = null,
    val apiVersion: String? = null,
    val currency: String? = null,
    val supportedCurrencies: List<String> = emptyList(),
    val roles: List<String> = emptyList(),
    val tokenTtlSeconds: Long? = null,
    val identityMode: String? = null,
    val issuer: String? = null,
)

/** One vertical of the platform with the entry point a visitor may call without a token. */
@Serializable
data class VerticalDto(
    val code: String,
    val title: String,
    val basePath: String,
    val anonymousCataloguePath: String? = null,
    val authNote: String? = null,
)

/**
 * The price list.
 *
 * @param available false means the block could not be fetched (the gateway says why in [reason]);
 *                  the app must not draw an empty tariff picker in that case.
 */
@Serializable
data class TariffBlockDto(
    val available: Boolean = false,
    val reason: String? = null,
    val currency: String? = null,
    val commissionBp: Int? = null,
    val quoteTtlSeconds: Long? = null,
    val tariffs: List<TariffDto> = emptyList(),
    val note: String? = null,
)

/** Tariff rates, all in minor units: 12 000 is 120,00 ₸ per kilometre. */
@Serializable
data class TariffDto(
    val code: String,
    val baseMinor: Long,
    val perKmMinor: Long,
    val perMinuteMinor: Long,
    val minFareMinor: Long,
)

@Serializable
data class PaymentMethodsBlockDto(
    val available: Boolean = false,
    val reason: String? = null,
    val currency: String? = null,
    val methods: List<PaymentMethodDto> = emptyList(),
    val merchantFeeBp: Int? = null,
    val transferFeeBp: Int? = null,
    val note: String? = null,
)

/**
 * One payment method.
 *
 * @param implemented false is a promise, not a feature: the UI labels it as coming soon and
 *                    never opens a flow for it.
 */
@Serializable
data class PaymentMethodDto(
    val code: String,
    val title: String,
    val implemented: Boolean = false,
    val detail: String? = null,
)

@Serializable
data class FeaturesDto(
    val cardPayments: Boolean = false,
    val pushNotifications: Boolean = false,
    val websockets: Boolean = false,
    val localization: Boolean = false,
    val deliveryZones: Boolean = false,
    val notes: Map<String, String> = emptyMap(),
)
