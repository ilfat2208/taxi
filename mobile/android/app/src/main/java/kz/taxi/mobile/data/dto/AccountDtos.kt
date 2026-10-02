package kz.taxi.mobile.data.dto

import kotlinx.serialization.Serializable

/** `GET /api/v1/accounts` and `POST /api/v1/accounts`. All amounts are minor units. */
@Serializable
data class AccountDto(
    val id: String,
    val ownerUserId: String = "",
    val ownerPhone: String = "",
    val displayName: String? = null,
    val type: String = "CUSTOMER",
    val currency: String = "KZT",
    val status: String = "ACTIVE",
    val balanceMinor: Long = 0,
    val heldMinor: Long = 0,
    val availableMinor: Long = 0,
    val createdAt: String? = null,
    val updatedAt: String? = null,
) {
    val isActive: Boolean get() = status.equals("ACTIVE", ignoreCase = true)
}

@Serializable
data class CreateAccountRequest(
    val currency: String = "KZT",
    val type: String = "CUSTOMER",
    val displayName: String? = null,
)

/** Demo funding. The gateway restricts this to `ADMIN`. */
@Serializable
data class TopUpRequest(
    val amountMinor: Long,
    val reason: String,
)

@Serializable
data class TransactionDto(
    val id: String,
    val transactionId: String = "",
    val accountId: String = "",
    val direction: String = "",
    val amountMinor: Long = 0,
    val currency: String = "KZT",
    val balanceAfterMinor: Long = 0,
    val operation: String = "",
    val referenceType: String? = null,
    val referenceId: String? = null,
    val description: String? = null,
    val createdAt: String? = null,
) {
    val isCredit: Boolean get() = direction.equals("CREDIT", ignoreCase = true)
}

/** Account kinds accepted by `POST /api/v1/accounts`. */
object AccountTypes {
    const val CUSTOMER = "CUSTOMER"
    const val MERCHANT = "MERCHANT"
}
