package kz.taxi.mobile.data.repo

import kz.taxi.mobile.core.net.apiCall
import kz.taxi.mobile.data.dto.PageDto
import kz.taxi.mobile.data.dto.ProductDto
import kz.taxi.mobile.data.remote.CatalogApi

class CatalogRepository(private val catalogApi: CatalogApi) {

    suspend fun products(
        query: String? = null,
        category: String? = null,
        page: Int = 0,
        size: Int = DEFAULT_PAGE_SIZE,
        sort: String? = null,
    ): Result<PageDto<ProductDto>> = apiCall {
        catalogApi.products(
            query = query?.trim()?.takeIf { it.isNotEmpty() },
            category = category?.takeIf { it.isNotBlank() },
            page = page,
            size = size,
            sort = sort,
        )
    }

    suspend fun product(productId: String): Result<ProductDto> = apiCall {
        catalogApi.product(productId)
    }

    suspend fun categories(): Result<List<String>> = apiCall { catalogApi.categories() }

    companion object {
        const val DEFAULT_PAGE_SIZE = 20
    }
}
