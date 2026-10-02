package kz.taxi.mobile.data.dto

import kotlinx.serialization.Serializable

/** `POST /api/v1/orders` — requires an `Idempotency-Key` header. */
@Serializable
data class CreateOrderRequest(
    val deliveryAddress: String,
    val contactPhone: String,
    val comment: String? = null,
    val sourceAccountId: String,
)

/**
 * An order.
 *
 * `GET /api/v1/orders` returns a *summary* (only id, number, status, total, itemCount and
 * dates) while `GET /api/v1/orders/{id}` and `POST /api/v1/orders` return the full document
 * with `items`, `payments` and `history`. Every field beyond `orderId` therefore has a
 * default, so one DTO safely covers both shapes.
 */
@Serializable
data class OrderDto(
    val orderId: String,
    val orderNumber: String = "",
    val status: String = "",
    val sagaState: String? = null,
    val currency: String = "KZT",
    val subtotalMinor: Long = 0,
    val deliveryFeeMinor: Long = 0,
    val totalMinor: Long = 0,
    val paymentId: String? = null,
    val paymentStatus: String? = null,
    val failureReason: String? = null,
    val deliveryAddress: String? = null,
    val contactPhone: String? = null,
    val comment: String? = null,
    val itemCount: Int = 0,
    val items: List<OrderItemDto> = emptyList(),
    val payments: List<OrderPaymentDto> = emptyList(),
    val history: List<OrderHistoryDto> = emptyList(),
    val createdAt: String? = null,
    val updatedAt: String? = null,
    val paidAt: String? = null,
) {
    /** Only a not-yet-paid order can be cancelled. */
    val isCancellable: Boolean
        get() = status.uppercase() in setOf("PENDING_PAYMENT", "CREATED", "PENDING")
}

@Serializable
data class OrderItemDto(
    val itemId: String? = null,
    val productId: String? = null,
    val merchantId: String? = null,
    val title: String? = null,
    val imageUrl: String? = null,
    val unitPriceMinor: Long = 0,
    val quantity: Int = 0,
    val lineTotalMinor: Long = 0,
    val currency: String = "KZT",
)

/** One payment per merchant of the order. */
@Serializable
data class OrderPaymentDto(
    val merchantId: String? = null,
    val paymentId: String,
    val status: String = "",
    val amountMinor: Long = 0,
    val feeMinor: Long = 0,
    val totalMinor: Long = 0,
    val currency: String = "KZT",
)

@Serializable
data class OrderHistoryDto(
    val fromStatus: String? = null,
    val toStatus: String = "",
    val reason: String? = null,
    val actor: String? = null,
    val createdAt: String? = null,
)

/** Order statuses worth filtering by. */
object OrderStatuses {
    const val PENDING_PAYMENT = "PENDING_PAYMENT"
    const val PAID = "PAID"
    const val COMPLETED = "COMPLETED"
    const val CANCELLED = "CANCELLED"
    const val FAILED = "FAILED"

    val filterable: List<String> = listOf(PAID, PENDING_PAYMENT, CANCELLED, FAILED)
}
