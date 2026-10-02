package kz.taxi.mobile.core.net

/** OkHttp request tag carrying the UUID this client generated for the request. */
class CorrelationId(val value: String) {
    override fun toString(): String = value
}

/** Header the client sends on every request and the gateway echoes on every response. */
const val CORRELATION_ID_HEADER: String = "X-Correlation-Id"

/** Header required by every mutating call that moves money or creates an order. */
const val IDEMPOTENCY_KEY_HEADER: String = "Idempotency-Key"
