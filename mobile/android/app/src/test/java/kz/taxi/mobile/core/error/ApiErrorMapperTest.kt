package kz.taxi.mobile.core.error

import kotlinx.serialization.SerializationException
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.Protocol
import okhttp3.Request
import okhttp3.ResponseBody.Companion.toResponseBody
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import retrofit2.HttpException
import retrofit2.Response
import java.io.IOException
import java.net.ConnectException
import java.net.SocketTimeoutException
import java.net.UnknownHostException

/**
 * The error mapping is what a user actually sees, so it is pinned against **real** problem
 * documents captured from the running gateway.
 */
class ApiErrorMapperTest {

    /** Captured verbatim from the live gateway (`POST /api/v1/payments/transfers`). */
    private val targetAccountNotFoundBody = """
        {"type":"https://docs.taxi.local/errors/TARGET_ACCOUNT_NOT_FOUND",
         "title":"Not Found","status":404,
         "detail":"account-service refused to resolve the recipient account: no active KZT account is registered for phone +77000000000",
         "code":"TARGET_ACCOUNT_NOT_FOUND","instance":"/api/v1/payments/transfers",
         "timestamp":"2026-10-01T15:56:12.390206872Z",
         "correlationId":"01M3W2WCPB31YKN0FHS3VV3XXG",
         "details":{"downstreamStatus":404,"downstream":"account-service","downstreamCode":"ACCOUNT_NOT_FOUND"}}
    """.trimIndent()

    private val unauthorizedBody = """
        {"type":"https://docs.taxi.local/errors/UNAUTHORIZED","title":"Unauthorized",
         "status":401,"detail":"invalid confirmation code","code":"UNAUTHORIZED",
         "instance":"/api/v1/auth/token","timestamp":"2026-10-01T15:56:26.636815717Z",
         "correlationId":"01M3W2WTM947XCBHM1SDN5XJM0"}
    """.trimIndent()

    private val insufficientFundsBody = """
        {"type":"https://docs.taxi.local/errors/INSUFFICIENT_FUNDS","title":"Unprocessable Entity",
         "status":422,"detail":"account-service refused to reserve funds","code":"INSUFFICIENT_FUNDS",
         "instance":"/api/v1/payments/transfers","timestamp":"2026-10-01T15:56:12.535255977Z",
         "correlationId":"01M3W2WCS6BSX6W2QS0TMSDZHF"}
    """.trimIndent()

    private fun httpException(
        status: Int,
        body: String?,
        correlationHeader: String? = null,
    ): HttpException {
        val request = Request.Builder()
            .url("http://localhost:8080/api/v1/payments/transfers")
            .build()
        val rawBuilder = okhttp3.Response.Builder()
            .code(status)
            .message("error")
            .protocol(Protocol.HTTP_1_1)
            .request(request)
        if (correlationHeader != null) rawBuilder.header("X-Correlation-Id", correlationHeader)
        val rawBody = (body ?: "").toResponseBody("application/problem+json".toMediaType())
        rawBuilder.body(rawBody)
        val raw = rawBuilder.build()
        return HttpException(Response.error<Any>(rawBody, raw))
    }

    // ---------------------------------------------------------------- parsing

    @Test
    fun `decodes a real problem document`() {
        val problem = ApiErrorMapper.parseProblem(targetAccountNotFoundBody)
        assertNotNull(problem)
        assertEquals("TARGET_ACCOUNT_NOT_FOUND", problem!!.code)
        assertEquals(404, problem.status)
        assertEquals("01M3W2WCPB31YKN0FHS3VV3XXG", problem.correlationId)
        assertTrue(problem.detail!!.contains("no active KZT account"))
    }

    @Test
    fun `ignores bodies that are not problem documents`() {
        assertNull(ApiErrorMapper.parseProblem(null))
        assertNull(ApiErrorMapper.parseProblem(""))
        assertNull(ApiErrorMapper.parseProblem("   "))
        assertNull(ApiErrorMapper.parseProblem("<html>502 Bad Gateway</html>"))
        assertNull(ApiErrorMapper.parseProblem("not json at all"))
    }

    // ---------------------------------------------------------------- messages

    @Test
    fun `every contract code maps to a Russian message that is not the code itself`() {
        val codes = listOf(
            Codes.UNAUTHORIZED, Codes.FORBIDDEN, Codes.ACCOUNT_ALREADY_EXISTS,
            Codes.ACCOUNT_NOT_FOUND, Codes.TARGET_ACCOUNT_NOT_FOUND, Codes.INSUFFICIENT_FUNDS,
            Codes.SELF_TRANSFER_NOT_ALLOWED, Codes.LIMIT_EXCEEDED, Codes.VELOCITY_EXCEEDED,
            Codes.PAYMENT_NOT_FOUND, Codes.PRODUCT_NOT_FOUND, Codes.PRODUCT_UNAVAILABLE,
            Codes.CART_EMPTY, Codes.CART_NOT_FOUND, Codes.ORDER_NOT_FOUND,
            Codes.ORDER_NOT_CANCELLABLE, Codes.IDEMPOTENCY_CONFLICT, Codes.VALIDATION_FAILED,
            Codes.RATE_LIMITED, Codes.SERVICE_UNAVAILABLE,
        )
        val seen = mutableSetOf<String>()
        for (code in codes) {
            val message = ApiErrorMapper.messageForCode(code, httpStatus = 400)
            assertTrue("empty message for $code", message.isNotBlank())
            assertFalse("message for $code leaked the raw code", message.contains(code))
            assertTrue(
                "message for $code is not Russian: $message",
                Regex("[А-Яа-я]").containsMatchIn(message),
            )
            seen.add(message)
        }
        assertTrue("messages should not be one generic string", seen.size >= codes.size - 1)
    }

    @Test
    fun `falls back to the HTTP status when the code is unknown or missing`() {
        assertEquals("Недостаточно прав для этой операции.", ApiErrorMapper.messageForCode(null, 403))
        assertTrue(ApiErrorMapper.messageForCode(null, 401).contains("Сессия"))
        assertTrue(ApiErrorMapper.messageForCode(null, 404).contains("не найдены"))
        assertTrue(ApiErrorMapper.messageForCode(null, 500).contains("недоступен"))
        assertTrue(ApiErrorMapper.messageForCode(null, 503).contains("недоступен"))
        assertTrue(ApiErrorMapper.messageForCode("SOMETHING_NEW", 200).isNotBlank())
        assertTrue(ApiErrorMapper.messageForCode(null, null).isNotBlank())
    }

    // ---------------------------------------------------------------- mapped errors

    @Test
    fun `maps the real TARGET_ACCOUNT_NOT_FOUND response`() {
        val error = ApiErrorMapper.fromProblemBody(
            httpStatus = 404,
            rawBody = targetAccountNotFoundBody,
            headerCorrelationId = null,
            requestCorrelationId = "req-uuid",
        )
        assertEquals("TARGET_ACCOUNT_NOT_FOUND", error.code)
        assertEquals(404, error.httpStatus)
        assertEquals("01M3W2WCPB31YKN0FHS3VV3XXG", error.correlationId)
        assertTrue(error.message.contains("Получатель"))
        assertFalse(error.isUnauthorized)
        assertFalse(error.isNetworkFailure)
        assertTrue(error.diagnostics!!.contains("TARGET_ACCOUNT_NOT_FOUND"))
        assertTrue(error.diagnostics!!.contains("01M3W2WCPB31YKN0FHS3VV3XXG"))
    }

    @Test
    fun `maps INSUFFICIENT_FUNDS to a Russian message`() {
        val error = ApiErrorMapper.fromProblemBody(422, insufficientFundsBody)
        assertEquals("INSUFFICIENT_FUNDS", error.code)
        assertTrue(error.message.contains("Недостаточно средств"))
    }

    @Test
    fun `a 401 with a problem body clears the session flag`() {
        val error = ApiErrorMapper.fromProblemBody(401, unauthorizedBody)
        assertEquals("UNAUTHORIZED", error.code)
        assertTrue(error.isUnauthorized)
        assertEquals(ApiErrorMapper.UNAUTHORIZED_MESSAGE, error.message)
    }

    @Test
    fun `a 401 with an empty body still counts as unauthorized`() {
        val error = ApiErrorMapper.fromProblemBody(401, "")
        assertTrue(error.isUnauthorized)
        assertNull(error.code)
        assertEquals(ApiErrorMapper.UNAUTHORIZED_MESSAGE, error.message)
    }

    @Test
    fun `correlation id falls back to the header and then to the request id`() {
        val fromBody = ApiErrorMapper.fromProblemBody(404, targetAccountNotFoundBody, "header-id", "request-id")
        assertEquals("01M3W2WCPB31YKN0FHS3VV3XXG", fromBody.correlationId)

        val fromHeader = ApiErrorMapper.fromProblemBody(500, "", "header-id", "request-id")
        assertEquals("header-id", fromHeader.correlationId)

        val fromRequest = ApiErrorMapper.fromProblemBody(500, "", null, "request-id")
        assertEquals("request-id", fromRequest.correlationId)

        assertNull(ApiErrorMapper.fromProblemBody(500, "", null, null).correlationId)
        assertEquals(
            "only the HTTP status is known, so that is all the diagnostics show",
            "HTTP 500",
            ApiErrorMapper.fromProblemBody(500, "", null, null).diagnostics,
        )
    }

    // ---------------------------------------------------------------- throwables

    @Test
    fun `retrofit HttpException is decoded from its error body`() {
        val error = ApiErrorMapper.fromThrowable(httpException(404, targetAccountNotFoundBody))
        assertEquals("TARGET_ACCOUNT_NOT_FOUND", error.code)
        assertEquals(404, error.httpStatus)
        assertEquals("01M3W2WCPB31YKN0FHS3VV3XXG", error.correlationId)
        assertTrue(error.message.contains("Получатель"))
    }

    @Test
    fun `HttpException without a body uses the response header`() {
        val error = ApiErrorMapper.fromThrowable(httpException(502, null, correlationHeader = "gw-correlation"))
        assertEquals(502, error.httpStatus)
        assertEquals("gw-correlation", error.correlationId)
        assertTrue(error.message.contains("недоступен"))
    }

    @Test
    fun `HttpException without any correlation id falls back to the request id`() {
        val error = ApiErrorMapper.fromThrowable(httpException(500, null), requestCorrelationId = "local-uuid")
        assertEquals("local-uuid", error.correlationId)
    }

    @Test
    fun `transport failures are reported as network failures`() {
        val timeout = ApiErrorMapper.fromThrowable(SocketTimeoutException("timeout"))
        assertEquals(ApiErrorMapper.TIMEOUT_MESSAGE, timeout.message)
        assertTrue(timeout.isNetworkFailure)

        for (throwable in listOf(UnknownHostException("dns"), ConnectException("refused"), IOException("reset"))) {
            val error = ApiErrorMapper.fromThrowable(throwable)
            assertEquals(ApiErrorMapper.NETWORK_MESSAGE, error.message)
            assertTrue(error.isNetworkFailure)
            assertNull(error.httpStatus)
        }
    }

    @Test
    fun `unparseable responses and unexpected throwables get their own message`() {
        assertEquals(
            ApiErrorMapper.MALFORMED_MESSAGE,
            ApiErrorMapper.fromThrowable(SerializationException("bad json")).message,
        )
        assertEquals(
            ApiErrorMapper.UNEXPECTED_MESSAGE,
            ApiErrorMapper.fromThrowable(IllegalStateException("boom")).message,
        )
    }

    @Test
    fun `diagnostics is null when there is nothing to show`() {
        val error = ApiError(code = null, httpStatus = null, detail = null, correlationId = null, message = "x")
        assertNull(error.diagnostics)
    }
}
