package kz.taxi.mobile.core.net

import okhttp3.Interceptor
import okhttp3.Response
import java.util.UUID

/**
 * Adds the two headers every backend call needs:
 *
 * * `Authorization: Bearer <token>` — from the in-memory session, never from disk on the
 *   request path, so it is correct immediately after login/logout.
 * * `X-Correlation-Id` — a **fresh UUID per request**; the gateway echoes it and includes
 *   it in RFC 7807 problem documents, which is what support uses to trace a failure.
 *
 * It also reports a `401` on an authenticated request so the app can drop the session and
 * return to the login screen; a `401` from the login call itself is left alone.
 */
class ApiHeadersInterceptor(
    private val tokenProvider: () -> String?,
    private val correlationIdFactory: () -> String = { UUID.randomUUID().toString() },
    private val onUnauthorized: () -> Unit = {},
) : Interceptor {

    override fun intercept(chain: Interceptor.Chain): Response {
        val correlationId = correlationIdFactory()
        val original = chain.request()
        val token = tokenProvider()

        val builder = original.newBuilder()
            .header("Accept", "application/json")
            .header(CORRELATION_ID_HEADER, correlationId)
            .tag(CorrelationId::class.java, CorrelationId(correlationId))

        // Never clobber a caller-supplied Authorization header.
        if (token != null && original.header("Authorization") == null) {
            builder.header("Authorization", "Bearer $token")
        }

        val response = chain.proceed(builder.build())
        if (response.code == 401 && token != null) {
            onUnauthorized()
        }
        return response
    }
}
