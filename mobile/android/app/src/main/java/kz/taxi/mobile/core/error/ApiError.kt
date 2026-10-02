package kz.taxi.mobile.core.error

import kotlinx.serialization.Serializable

/**
 * RFC 7807 problem document as produced by the gateway
 * (`Content-Type: application/problem+json`).
 */
@Serializable
data class ProblemDetails(
    val type: String? = null,
    val title: String? = null,
    val status: Int? = null,
    val detail: String? = null,
    /** Machine-readable business code, e.g. `INSUFFICIENT_FUNDS`. */
    val code: String? = null,
    val instance: String? = null,
    val timestamp: String? = null,
    /** Echoed by the gateway; support asks for exactly this value. */
    val correlationId: String? = null,
)

/**
 * A failure that is ready to be shown to a human: a Russian [message] plus the
 * machine-readable [code] and the [correlationId] that support needs.
 */
data class ApiError(
    val code: String?,
    val httpStatus: Int?,
    val detail: String?,
    val correlationId: String?,
    val message: String,
    /** True when the request failed because the bearer token is missing/expired/invalid. */
    val isUnauthorized: Boolean = httpStatus == 401 || code == Codes.UNAUTHORIZED,
    /** True when the device could not reach the gateway at all. */
    val isNetworkFailure: Boolean = false,
) {
    /** The line shown in the error UI: `Код: INSUFFICIENT_FUNDS · Запрос: 01M3...`. */
    val diagnostics: String?
        get() {
            val parts = buildList {
                code?.let { add("Код: $it") }
                correlationId?.let { add("Correlation-Id: $it") }
                httpStatus?.let { add("HTTP $it") }
            }
            return parts.takeIf { it.isNotEmpty() }?.joinToString(" · ")
        }
}

/** Machine-readable error codes of the fixed backend contract. */
object Codes {
    const val UNAUTHORIZED = "UNAUTHORIZED"
    const val FORBIDDEN = "FORBIDDEN"
    const val ACCOUNT_ALREADY_EXISTS = "ACCOUNT_ALREADY_EXISTS"
    const val ACCOUNT_NOT_FOUND = "ACCOUNT_NOT_FOUND"
    const val TARGET_ACCOUNT_NOT_FOUND = "TARGET_ACCOUNT_NOT_FOUND"
    const val INSUFFICIENT_FUNDS = "INSUFFICIENT_FUNDS"
    const val SELF_TRANSFER_NOT_ALLOWED = "SELF_TRANSFER_NOT_ALLOWED"
    const val LIMIT_EXCEEDED = "LIMIT_EXCEEDED"
    const val VELOCITY_EXCEEDED = "VELOCITY_EXCEEDED"
    const val PAYMENT_NOT_FOUND = "PAYMENT_NOT_FOUND"
    const val PRODUCT_NOT_FOUND = "PRODUCT_NOT_FOUND"
    const val PRODUCT_UNAVAILABLE = "PRODUCT_UNAVAILABLE"
    const val CART_EMPTY = "CART_EMPTY"
    const val CART_NOT_FOUND = "CART_NOT_FOUND"
    const val ORDER_NOT_FOUND = "ORDER_NOT_FOUND"
    const val ORDER_NOT_CANCELLABLE = "ORDER_NOT_CANCELLABLE"
    const val IDEMPOTENCY_CONFLICT = "IDEMPOTENCY_CONFLICT"
    const val VALIDATION_FAILED = "VALIDATION_FAILED"
    const val RATE_LIMITED = "RATE_LIMITED"
    const val SERVICE_UNAVAILABLE = "SERVICE_UNAVAILABLE"
}
