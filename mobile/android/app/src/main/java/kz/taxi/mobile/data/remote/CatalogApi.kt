package kz.taxi.mobile.data.remote

import kz.taxi.mobile.data.dto.PageDto
import kz.taxi.mobile.data.dto.ProductDto
import retrofit2.http.GET
import retrofit2.http.Path
import retrofit2.http.Query

/** Anonymous — the marketplace needs no token. */
interface CatalogApi {

    @GET("api/v1/catalog/products")
    suspend fun products(
        @Query("query") query: String? = null,
        @Query("category") category: String? = null,
        @Query("page") page: Int,
        @Query("size") size: Int,
        @Query("sort") sort: String? = null,
    ): PageDto<ProductDto>

    @GET("api/v1/catalog/products/{id}")
    suspend fun product(@Path("id") productId: String): ProductDto

    @GET("api/v1/catalog/categories")
    suspend fun categories(): List<String>
}
