package kz.taxi.mobile.data.repo

import kz.taxi.mobile.core.net.apiCall
import kz.taxi.mobile.data.dto.CreateOrderRequest
import kz.taxi.mobile.data.dto.OrderDto
import kz.taxi.mobile.data.dto.PageDto
import kz.taxi.mobile.data.remote.OrdersApi

class OrdersRepository(private val ordersApi: OrdersApi) {

    /**
     * @param idempotencyKey a fresh UUID per checkout submit; reuse it verbatim to retry the
     *   very same submit without risking a duplicate order.
     */
    suspend fun createOrder(
        idempotencyKey: String,
        deliveryAddress: String,
        contactPhone: String,
        sourceAccountId: String,
        comment: String? = null,
    ): Result<OrderDto> = apiCall {
        ordersApi.createOrder(
            idempotencyKey = idempotencyKey,
            body = CreateOrderRequest(
                deliveryAddress = deliveryAddress.trim(),
                contactPhone = contactPhone.trim(),
                comment = comment?.trim()?.takeIf { it.isNotEmpty() },
                sourceAccountId = sourceAccountId,
            ),
        )
    }

    suspend fun orders(
        page: Int = 0,
        size: Int = DEFAULT_PAGE_SIZE,
        status: String? = null,
    ): Result<PageDto<OrderDto>> = apiCall {
        ordersApi.listOrders(page = page, size = size, status = status)
    }

    suspend fun order(orderId: String): Result<OrderDto> = apiCall { ordersApi.order(orderId) }

    suspend fun cancelOrder(orderId: String): Result<OrderDto> = apiCall {
        ordersApi.cancelOrder(orderId)
    }

    companion object {
        const val DEFAULT_PAGE_SIZE = 20
    }
}
