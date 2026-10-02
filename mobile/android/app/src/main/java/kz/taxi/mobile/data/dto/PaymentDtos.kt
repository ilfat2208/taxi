package kz.taxi.mobile.data.dto

import kotlinx.serialization.Serializable

/** `POST /api/v1/payments/transfers` — requires an `Idempotency-Key` header. */
@Serializable
data class TransferRequest(
    val sourceAccountId: String,
    val targetPhone: String,
    val amountMinor: Long,
    val currency: String = "KZT",
    val description: String? = null,
)

@Serializable
data class PaymentDto(
    val paymentId: String,
    val paymentNumber: String = "",
    val type: String = "",
    val status: String = "",
    val ownerUserId: String = "",
    val sourceAccountId: String? = null,
    val targetAccountId: String? = null,
    val merchantId: String? = null,
    val orderId: String? = null,
    val amountMinor: Long = 0,
    val feeMinor: Long = 0,
    val totalMinor: Long = 0,
    val currency: String = "KZT",
    val description: String? = null,
    val failureCode: String? = null,
    val failureReason: String? = null,
    val createdAt: String? = null,
    val updatedAt: String? = null,
    val completedAt: String? = null,
) {
    val isCompleted: Boolean get() = status.equals("COMPLETED", ignoreCase = true)
    val isFailed: Boolean get() = status.equals("FAILED", ignoreCase = true)
}

@Serializable
data class PaymentTransitionDto(
    val id: String? = null,
    val fromStatus: String? = null,
    val toStatus: String = "",
    val reason: String? = null,
    val actor: String? = null,
    val createdAt: String? = null,
)

/** `GET /api/v1/payments/{id}` */
@Serializable
data class PaymentDetailDto(
    val payment: PaymentDto,
    val transitions: List<PaymentTransitionDto> = emptyList(),
)

/** Payment statuses used by the history filter. */
object PaymentStatuses {
    const val INITIATED = "INITIATED"
    const val PENDING = "PENDING"
    const val COMPLETED = "COMPLETED"
    const val FAILED = "FAILED"
    const val CANCELLED = "CANCELLED"

    val filterable: List<String> = listOf(COMPLETED, PENDING, FAILED, CANCELLED)
}
