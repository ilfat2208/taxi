package kz.taxi.mobile.data.remote

import kz.taxi.mobile.data.dto.AddCartItemRequest
import kz.taxi.mobile.data.dto.CartDto
import kz.taxi.mobile.data.dto.UpdateCartItemRequest
import retrofit2.http.Body
import retrofit2.http.DELETE
import retrofit2.http.GET
import retrofit2.http.PATCH
import retrofit2.http.POST
import retrofit2.http.Path

/** The cart is created on the first `GET /api/v1/cart`; every call returns the whole cart. */
interface CartApi {

    @GET("api/v1/cart")
    suspend fun cart(): CartDto

    @POST("api/v1/cart/items")
    suspend fun addItem(@Body body: AddCartItemRequest): CartDto

    @PATCH("api/v1/cart/items/{itemId}")
    suspend fun updateItem(
        @Path("itemId") itemId: String,
        @Body body: UpdateCartItemRequest,
    ): CartDto

    @DELETE("api/v1/cart/items/{itemId}")
    suspend fun removeItem(@Path("itemId") itemId: String): CartDto

    @DELETE("api/v1/cart")
    suspend fun clear(): CartDto
}
