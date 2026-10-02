package kz.taxi.mobile.feature.catalog

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import kz.taxi.mobile.core.error.ApiError
import kz.taxi.mobile.core.net.asApiError
import kz.taxi.mobile.data.dto.CartDto
import kz.taxi.mobile.data.dto.ProductDto
import kz.taxi.mobile.data.dto.ProductSort
import kz.taxi.mobile.data.repo.CartRepository
import kz.taxi.mobile.data.repo.CatalogRepository
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

data class CatalogUiState(
    val items: List<ProductDto> = emptyList(),
    val categories: List<String> = emptyList(),
    val query: String = "",
    val category: String? = null,
    val sort: String = ProductSort.RELEVANCE,
    val isInitialLoading: Boolean = true,
    val isLoadingMore: Boolean = false,
    val page: Int = 0,
    val hasNext: Boolean = false,
    val totalElements: Long = 0,
    val error: ApiError? = null,
) {
    val isEmpty: Boolean get() = !isInitialLoading && items.isEmpty()
}

/** Marketplace listing: search, category filter and paging. Anonymous — no token needed. */
class CatalogViewModel(
    private val catalogRepository: CatalogRepository,
) : ViewModel() {

    private val _state = MutableStateFlow(CatalogUiState())
    val state: StateFlow<CatalogUiState> = _state.asStateFlow()

    private var searchJob: Job? = null

    init {
        loadCategories()
        refresh()
    }

    private fun loadCategories() {
        viewModelScope.launch {
            catalogRepository.categories().onSuccess { categories ->
                _state.update { it.copy(categories = categories) }
            }
            // A failed category list only degrades the filter row; the grid still works.
        }
    }

    fun onQueryChange(query: String) {
        _state.update { it.copy(query = query) }
        searchJob?.cancel()
        searchJob = viewModelScope.launch {
            delay(SEARCH_DEBOUNCE_MS)
            refresh()
        }
    }

    fun onCategoryChange(category: String?) {
        if (_state.value.category == category) return
        _state.update { it.copy(category = category) }
        refresh()
    }

    fun onSortChange(sort: String) {
        if (_state.value.sort == sort) return
        _state.update { it.copy(sort = sort) }
        refresh()
    }

    fun refresh() {
        _state.update { it.copy(isInitialLoading = true, error = null) }
        viewModelScope.launch {
            val current = _state.value
            catalogRepository.products(
                query = current.query,
                category = current.category,
                page = 0,
                size = PAGE_SIZE,
                sort = current.sort,
            )
                .onSuccess { page ->
                    _state.update {
                        it.copy(
                            items = page.items,
                            page = page.page,
                            hasNext = page.hasNext,
                            totalElements = page.totalElements,
                            isInitialLoading = false,
                            isLoadingMore = false,
                            error = null,
                        )
                    }
                }
                .onFailure { throwable ->
                    _state.update {
                        it.copy(
                            isInitialLoading = false,
                            isLoadingMore = false,
                            error = throwable.asApiError(),
                        )
                    }
                }
        }
    }

    fun loadMore() {
        val current = _state.value
        if (current.isLoadingMore || !current.hasNext || current.isInitialLoading) return
        _state.update { it.copy(isLoadingMore = true) }
        viewModelScope.launch {
            catalogRepository.products(
                query = current.query,
                category = current.category,
                page = current.page + 1,
                size = PAGE_SIZE,
                sort = current.sort,
            )
                .onSuccess { page ->
                    _state.update {
                        it.copy(
                            items = it.items + page.items,
                            page = page.page,
                            hasNext = page.hasNext,
                            totalElements = page.totalElements,
                            isLoadingMore = false,
                        )
                    }
                }
                .onFailure { throwable ->
                    _state.update { it.copy(isLoadingMore = false, error = throwable.asApiError()) }
                }
        }
    }

    fun dismissError() = _state.update { it.copy(error = null) }

    companion object {
        const val PAGE_SIZE = 20
        const val SEARCH_DEBOUNCE_MS = 350L
    }
}

data class ProductDetailUiState(
    val isLoading: Boolean = true,
    val product: ProductDto? = null,
    val quantity: Int = 1,
    val isAddingToCart: Boolean = false,
    val error: ApiError? = null,
    val addedMessage: String? = null,
)

class ProductDetailViewModel(
    private val catalogRepository: CatalogRepository,
    private val cartRepository: CartRepository,
    private val productId: String,
) : ViewModel() {

    private val _state = MutableStateFlow(ProductDetailUiState())
    val state: StateFlow<ProductDetailUiState> = _state.asStateFlow()

    init {
        load()
    }

    fun load() {
        _state.update { it.copy(isLoading = true, error = null) }
        viewModelScope.launch {
            catalogRepository.product(productId)
                .onSuccess { product ->
                    _state.update { it.copy(isLoading = false, product = product, error = null) }
                }
                .onFailure { throwable ->
                    _state.update { it.copy(isLoading = false, error = throwable.asApiError()) }
                }
        }
    }

    fun onQuantityChange(quantity: Int) {
        val max = _state.value.product?.stock?.takeIf { it > 0 } ?: MAX_QUANTITY
        _state.update { it.copy(quantity = quantity.coerceIn(1, minOf(max, MAX_QUANTITY))) }
    }

    fun addToCart() {
        val current = _state.value
        if (current.isAddingToCart) return
        _state.update { it.copy(isAddingToCart = true, error = null, addedMessage = null) }
        viewModelScope.launch {
            cartRepository.addItem(productId = productId, quantity = current.quantity)
                .onSuccess { cart: CartDto ->
                    _state.update {
                        it.copy(
                            isAddingToCart = false,
                            addedMessage = "В корзине товаров: ${cart.itemCount}",
                        )
                    }
                }
                .onFailure { throwable ->
                    _state.update { it.copy(isAddingToCart = false, error = throwable.asApiError()) }
                }
        }
    }

    fun dismissError() = _state.update { it.copy(error = null) }

    fun consumeMessage() = _state.update { it.copy(addedMessage = null) }

    private companion object {
        const val MAX_QUANTITY = 99
    }
}
