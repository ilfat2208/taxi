package kz.taxi.mobile.core.net

import android.util.Log
import kz.taxi.mobile.core.error.ApiErrorMapper
import okhttp3.Interceptor
import okhttp3.Response

/**
 * Logs failing responses together with the RFC 7807 machine-readable `code` and the
 * `correlationId`, so a bug report can be matched to a gateway log line.
 *
 * The body is read with [Response.peekBody], which buffers a copy and leaves the original
 * stream untouched for Retrofit.
 */
class ProblemLoggingInterceptor(
    private val logger: (String) -> Unit = { line -> Log.w(TAG, line) },
) : Interceptor {

    override fun intercept(chain: Interceptor.Chain): Response {
        val response = chain.proceed(chain.request())
        if (!response.isSuccessful) {
            val body = try {
                response.peekBody(MAX_LOGGED_BODY_BYTES).string()
            } catch (_: Exception) {
                ""
            }
            val problem = ApiErrorMapper.parseProblem(body)
            val requestCorrelationId =
                response.request.tag(CorrelationId::class.java)?.value
            val correlationId = problem?.correlationId
                ?: response.header(CORRELATION_ID_HEADER)
                ?: requestCorrelationId

            logger(
                buildString {
                    append("HTTP ").append(response.code)
                    append(" ").append(response.request.method).append(' ')
                    append(response.request.url.encodedPath)
                    append(" code=").append(problem?.code ?: "-")
                    append(" correlationId=").append(correlationId ?: "-")
                    val detail = problem?.detail
                    if (!detail.isNullOrBlank()) {
                        append(" detail=").append(detail.take(MAX_LOGGED_DETAIL_CHARS))
                    } else if (body.isNotBlank()) {
                        append(" body=").append(body.take(MAX_LOGGED_DETAIL_CHARS))
                    }
                },
            )
        }
        return response
    }

    private companion object {
        const val TAG = "TaxiApi"
        const val MAX_LOGGED_BODY_BYTES = 64L * 1024L
        const val MAX_LOGGED_DETAIL_CHARS = 300
    }
}
