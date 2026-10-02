package kz.taxi.mobile.core.error

import kotlinx.serialization.SerializationException
import kotlinx.serialization.json.Json
import retrofit2.HttpException
import java.io.IOException
import java.net.ConnectException
import java.net.SocketTimeoutException
import java.net.UnknownHostException

/**
 * Turns anything that can go wrong on the wire into an [ApiError]:
 * a Russian message a human can act on, plus the RFC 7807 [ProblemDetails.code] and the
 * `correlationId` that support asks for.
 *
 * Deliberately free of any Android dependency so it can be unit tested on the JVM.
 */
object ApiErrorMapper {

    const val NETWORK_MESSAGE: String = "Нет соединения с сервером. Проверьте интернет и попробуйте снова."
    const val TIMEOUT_MESSAGE: String = "Сервер не ответил вовремя. Попробуйте ещё раз."
    const val UNAUTHORIZED_MESSAGE: String = "Сессия истекла. Войдите снова."
    const val MALFORMED_MESSAGE: String = "Сервер вернул неожиданный ответ. Попробуйте позже."
    const val UNEXPECTED_MESSAGE: String = "Произошла непредвиденная ошибка. Попробуйте позже."

    private val json = Json {
        ignoreUnknownKeys = true
        isLenient = true
        explicitNulls = false
    }

    /** Decodes an `application/problem+json` body; returns `null` when it is not one. */
    fun parseProblem(raw: String?): ProblemDetails? {
        val trimmed = raw?.trim().orEmpty()
        if (trimmed.isEmpty() || !trimmed.startsWith("{")) return null
        return try {
            json.decodeFromString(ProblemDetails.serializer(), trimmed)
        } catch (_: SerializationException) {
            null
        } catch (_: IllegalArgumentException) {
            null
        }
    }

    /** The Russian human message for a machine-readable business code. */
    fun messageForCode(code: String?, httpStatus: Int? = null): String = when (code) {
        Codes.UNAUTHORIZED -> UNAUTHORIZED_MESSAGE
        Codes.FORBIDDEN -> "Недостаточно прав для этой операции."
        Codes.ACCOUNT_ALREADY_EXISTS -> "Такой счёт уже существует."
        Codes.ACCOUNT_NOT_FOUND -> "Счёт не найден. Обновите список счетов."
        Codes.TARGET_ACCOUNT_NOT_FOUND -> "Получатель не найден: у этого номера нет активного счёта в тенге."
        Codes.INSUFFICIENT_FUNDS -> "Недостаточно средств на счёте."
        Codes.SELF_TRANSFER_NOT_ALLOWED -> "Нельзя перевести деньги на тот же самый счёт."
        Codes.LIMIT_EXCEEDED -> "Превышен лимит операции. Уменьшите сумму или попробуйте позже."
        Codes.VELOCITY_EXCEEDED -> "Слишком много операций за короткое время. Подождите немного."
        Codes.PAYMENT_NOT_FOUND -> "Платёж не найден."
        Codes.PRODUCT_NOT_FOUND -> "Товар не найден — возможно, он снят с продажи."
        Codes.PRODUCT_UNAVAILABLE -> "Товара не хватает на складе."
        Codes.CART_EMPTY -> "Корзина пуста — добавьте товары перед оформлением."
        Codes.CART_NOT_FOUND -> "Корзина не найдена. Добавьте товар заново."
        Codes.ORDER_NOT_FOUND -> "Заказ не найден."
        Codes.ORDER_NOT_CANCELLABLE -> "Этот заказ уже нельзя отменить."
        Codes.IDEMPOTENCY_CONFLICT -> "Запрос уже был отправлен с другими данными. Повторите операцию."
        Codes.VALIDATION_FAILED -> "Проверьте заполненные поля."
        Codes.RATE_LIMITED -> "Слишком много запросов. Подождите немного."
        Codes.SERVICE_UNAVAILABLE -> "Сервис временно недоступен. Попробуйте позже."
        else -> when (httpStatus) {
            400 -> "Некорректный запрос."
            401 -> UNAUTHORIZED_MESSAGE
            403 -> "Недостаточно прав для этой операции."
            404 -> "Запрошенные данные не найдены."
            409 -> "Операция конфликтует с текущим состоянием."
            422 -> "Операцию нельзя выполнить с этими данными."
            429 -> "Слишком много запросов. Подождите немного."
            in 500..599 -> "Сервис временно недоступен. Попробуйте позже."
            else -> UNEXPECTED_MESSAGE
        }
    }

    /**
     * Builds an [ApiError] from an error response.
     *
     * @param headerCorrelationId the gateway's `X-Correlation-Id` response header
     * @param requestCorrelationId the UUID this client generated for the request, used only
     *   as a last resort so the user always has *something* to quote to support.
     */
    fun fromProblem(
        httpStatus: Int,
        problem: ProblemDetails?,
        headerCorrelationId: String? = null,
        requestCorrelationId: String? = null,
    ): ApiError {
        val code = problem?.code
        val correlationId = problem?.correlationId
            ?: headerCorrelationId
            ?: requestCorrelationId
        return ApiError(
            code = code,
            httpStatus = problem?.status ?: httpStatus,
            detail = problem?.detail,
            correlationId = correlationId,
            message = messageForCode(code, httpStatus),
        )
    }

    fun fromProblemBody(
        httpStatus: Int,
        rawBody: String?,
        headerCorrelationId: String? = null,
        requestCorrelationId: String? = null,
    ): ApiError = fromProblem(httpStatus, parseProblem(rawBody), headerCorrelationId, requestCorrelationId)

    /** Transport-level failure that never reached the application. */
    fun networkFailure(
        message: String = NETWORK_MESSAGE,
        correlationId: String? = null,
        cause: Throwable? = null,
    ): ApiError = ApiError(
        code = null,
        httpStatus = null,
        detail = cause?.message,
        correlationId = correlationId,
        message = message,
        isNetworkFailure = true,
    )

    /**
     * Retrofits an arbitrary failure. [HttpException] carries the raw response, so the
     * RFC 7807 body (including `code` and `correlationId`) is recovered from it.
     */
    fun fromThrowable(t: Throwable, requestCorrelationId: String? = null): ApiError = when (t) {
        is HttpException -> {
            val response = t.response()
            val rawBody = try {
                response?.errorBody()?.string()
            } catch (_: IOException) {
                null
            } catch (_: IllegalStateException) {
                null
            }
            fromProblemBody(
                httpStatus = response?.code() ?: t.code(),
                rawBody = rawBody,
                headerCorrelationId = response?.headers()?.get("X-Correlation-Id"),
                requestCorrelationId = requestCorrelationId,
            )
        }
        is SocketTimeoutException -> networkFailure(TIMEOUT_MESSAGE, cause = t)
        is UnknownHostException -> networkFailure(NETWORK_MESSAGE, cause = t)
        is ConnectException -> networkFailure(NETWORK_MESSAGE, cause = t)
        is IOException -> networkFailure(NETWORK_MESSAGE, cause = t)
        is SerializationException -> ApiError(
            code = null,
            httpStatus = null,
            detail = t.message,
            correlationId = requestCorrelationId,
            message = MALFORMED_MESSAGE,
        )
        else -> ApiError(
            code = null,
            httpStatus = null,
            detail = t.message,
            correlationId = requestCorrelationId,
            message = UNEXPECTED_MESSAGE,
        )
    }
}
