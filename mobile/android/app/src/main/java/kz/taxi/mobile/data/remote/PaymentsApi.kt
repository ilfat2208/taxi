package kz.taxi.mobile.data.remote

import kz.taxi.mobile.core.net.IDEMPOTENCY_KEY_HEADER
import kz.taxi.mobile.data.dto.PageDto
import kz.taxi.mobile.data.dto.PaymentDetailDto
import kz.taxi.mobile.data.dto.PaymentDto
import kz.taxi.mobile.data.dto.TransferRequest
import retrofit2.http.Body
import retrofit2.http.GET
import retrofit2.http.Header
import retrofit2.http.POST
import retrofit2.http.Path
import retrofit2.http.Query

interface PaymentsApi {

    /**
     * Moves money. [idempotencyKey] must be a fresh UUID per logical submit and must be
     * reused verbatim when retrying that same submit.
     */
    @POST("api/v1/payments/transfers")
    suspend fun transfer(
        @Header(IDEMPOTENCY_KEY_HEADER) idempotencyKey: String,
        @Body body: TransferRequest,
    ): PaymentDto

    @GET("api/v1/payments")
    suspend fun listPayments(
        @Query("page") page: Int,
        @Query("size") size: Int,
        @Query("status") status: String? = null,
    ): PageDto<PaymentDto>

    @GET("api/v1/payments/{id}")
    suspend fun payment(@Path("id") paymentId: String): PaymentDetailDto

    /**
     * The payment of one order.
     *
     * NOTE: the task contract documents `GET /api/v1/payments/by-order/{orderId}/all`, but the
     * running gateway answers `404 NOT_FOUND — no endpoint GET .../all`. The routed path is the
     * one below; it returns a **single** payment document (one payment per merchant), not a list
     * — verified against the live gateway. Everything a client needs for the whole order is in
     * `OrderDto.payments`.
     */
    @GET("api/v1/payments/by-order/{orderId}")
    suspend fun paymentsByOrder(@Path("orderId") orderId: String): PaymentDto
}
