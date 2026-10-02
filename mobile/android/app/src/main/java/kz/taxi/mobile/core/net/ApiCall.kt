package kz.taxi.mobile.core.net

import kz.taxi.mobile.core.error.ApiError
import kz.taxi.mobile.core.error.ApiErrorMapper
import kotlinx.coroutines.CancellationException
import retrofit2.HttpException

/** A failure that is guaranteed to carry a mapped, displayable [ApiError]. */
class ApiException(val error: ApiError, cause: Throwable? = null) : Exception(error.message, cause)

/** Uniform access to the mapped error, whatever layer produced the failure. */
fun Throwable.asApiError(): ApiError = when (this) {
    is ApiException -> error
    else -> ApiErrorMapper.fromThrowable(this, correlationIdOf(this))
}

/**
 * The `X-Correlation-Id` this client generated for the failing request. Used only as a
 * last resort — the gateway's own value from the problem document wins.
 */
internal fun correlationIdOf(t: Throwable): String? = try {
    (t as? HttpException)?.response()?.raw()?.request?.tag(CorrelationId::class.java)?.value
} catch (_: Exception) {
    null
}

/**
 * Runs a repository call and converts any failure into a [Result] whose exception is an
 * [ApiException]. Coroutine cancellation is rethrown so structured concurrency still works.
 */
suspend fun <T> apiCall(block: suspend () -> T): Result<T> = try {
    Result.success(block())
} catch (cancellation: CancellationException) {
    throw cancellation
} catch (t: Throwable) {
    Result.failure(ApiException(ApiErrorMapper.fromThrowable(t, correlationIdOf(t)), t))
}
