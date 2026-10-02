package kz.taxi.mobile.data.remote

import kz.taxi.mobile.core.net.IDEMPOTENCY_KEY_HEADER
import kz.taxi.mobile.data.dto.CreateOrderRequest
import kz.taxi.mobile.data.dto.OrderDto
import kz.taxi.mobile.data.dto.PageDto
import retrofit2.http.Body
import retrofit2.http.GET
import retrofit2.http.Header
import retrofit2.http.POST
import retrofit2.http.Path
import retrofit2.http.Query

interface OrdersApi {

    /** Checkout. [idempotencyKey] must be fresh per submit and reused when retrying it. */
    @POST("api/v1/orders")
    suspend fun createOrder(
        @Header(IDEMPOTENCY_KEY_HEADER) idempotencyKey: String,
        @Body body: CreateOrderRequest,
    ): OrderDto

    @GET("api/v1/orders")
    suspend fun listOrders(
        @Query("page") page: Int,
        @Query("size") size: Int,
        @Query("status") status: String? = null,
    ): PageDto<OrderDto>

    @GET("api/v1/orders/{id}")
    suspend fun order(@Path("id") orderId: String): OrderDto

    /** No request body: a JSON body would be rejected as an unsupported content type. */
    @POST("api/v1/orders/{id}/cancel")
    suspend fun cancelOrder(@Path("id") orderId: String): OrderDto
}
