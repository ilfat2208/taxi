package kz.taxi.mobile.data.dto

import kotlinx.serialization.Serializable

/** Every `/api/v1/cart` endpoint returns the whole cart. */
@Serializable
data class CartDto(
    val cartId: String = "",
    val status: String = "ACTIVE",
    val currency: String = "KZT",
    val itemCount: Int = 0,
    val subtotalMinor: Long = 0,
    val items: List<CartItemDto> = emptyList(),
    val updatedAt: String? = null,
) {
    val isEmpty: Boolean get() = items.isEmpty()
}

@Serializable
data class CartItemDto(
    val itemId: String,
    val productId: String = "",
    val merchantId: String = "",
    val title: String = "",
    val imageUrl: String? = null,
    val unitPriceMinor: Long = 0,
    val quantity: Int = 0,
    val lineTotalMinor: Long = 0,
    val currency: String = "KZT",
)

@Serializable
data class AddCartItemRequest(
    val productId: String,
    val quantity: Int,
)

@Serializable
data class UpdateCartItemRequest(
    val quantity: Int,
)
