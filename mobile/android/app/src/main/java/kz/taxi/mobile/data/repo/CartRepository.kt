package kz.taxi.mobile.data.repo

import kz.taxi.mobile.core.net.apiCall
import kz.taxi.mobile.data.dto.AddCartItemRequest
import kz.taxi.mobile.data.dto.CartDto
import kz.taxi.mobile.data.dto.UpdateCartItemRequest
import kz.taxi.mobile.data.remote.CartApi

class CartRepository(private val cartApi: CartApi) {

    /** Creates the cart on the first call. */
    suspend fun cart(): Result<CartDto> = apiCall { cartApi.cart() }

    suspend fun addItem(productId: String, quantity: Int): Result<CartDto> = apiCall {
        cartApi.addItem(AddCartItemRequest(productId = productId, quantity = quantity))
    }

    suspend fun updateItem(itemId: String, quantity: Int): Result<CartDto> = apiCall {
        cartApi.updateItem(itemId, UpdateCartItemRequest(quantity = quantity))
    }

    suspend fun removeItem(itemId: String): Result<CartDto> = apiCall {
        cartApi.removeItem(itemId)
    }

    suspend fun clear(): Result<CartDto> = apiCall { cartApi.clear() }
}
