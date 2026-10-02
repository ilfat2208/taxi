package kz.taxi.mobile.data.dto

import kotlinx.serialization.Serializable

/** `GET /api/v1/catalog/products` and `.../products/{id}` (the detail adds `merchant`, `onHand`, `reserved`, `available`). */
@Serializable
data class ProductDto(
    val id: String,
    val merchantId: String = "",
    val merchantName: String? = null,
    val title: String = "",
    val description: String? = null,
    val category: String? = null,
    val brand: String? = null,
    val priceMinor: Long = 0,
    val currency: String = "KZT",
    val imageUrl: String? = null,
    val status: String = "ACTIVE",
    val availableQuantity: Int? = null,
    val merchant: MerchantDto? = null,
    val onHand: Int? = null,
    val reserved: Int? = null,
    val available: Int? = null,
) {
    /** Best available stock number across the two shapes the backend returns. */
    val stock: Int
        get() = available ?: availableQuantity ?: 0

    val isAvailable: Boolean
        get() = status.equals("ACTIVE", ignoreCase = true) && stock > 0
}

@Serializable
data class MerchantDto(
    val id: String = "",
    val name: String? = null,
    val displayName: String? = null,
    val city: String? = null,
    val status: String? = null,
    val ratingBasisPoints: Int? = null,
)

/** Sort keys accepted by `GET /api/v1/catalog/products?sort=`. */
object ProductSort {
    const val PRICE_ASC = "price_asc"
    const val PRICE_DESC = "price_desc"
    const val NEWEST = "newest"
    const val RELEVANCE = "relevance"
}
