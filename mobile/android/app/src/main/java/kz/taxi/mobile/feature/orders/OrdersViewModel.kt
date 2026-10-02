package kz.taxi.mobile.feature.orders

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import kz.taxi.mobile.core.error.ApiError
import kz.taxi.mobile.core.net.asApiError
import kz.taxi.mobile.data.dto.OrderDto
import kz.taxi.mobile.data.dto.OrderStatuses
import kz.taxi.mobile.data.repo.OrdersRepository
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

data class OrdersUiState(
    val items: List<OrderDto> = emptyList(),
    val isInitialLoading: Boolean = true,
    val isLoadingMore: Boolean = false,
    val page: Int = 0,
    val hasNext: Boolean = false,
    val totalElements: Long = 0,
    val statusFilter: String? = null,
    val error: ApiError? = null,
) {
    val isEmpty: Boolean get() = !isInitialLoading && items.isEmpty()
}

class OrdersViewModel(private val ordersRepository: OrdersRepository) : ViewModel() {

    private val _state = MutableStateFlow(OrdersUiState())
    val state: StateFlow<OrdersUiState> = _state.asStateFlow()

    init {
        refresh()
    }

    fun setStatusFilter(status: String?) {
        if (_state.value.statusFilter == status) return
        _state.update { it.copy(statusFilter = status) }
        refresh()
    }

    fun refresh() {
        _state.update { it.copy(isInitialLoading = true, error = null) }
        viewModelScope.launch {
            ordersRepository.orders(page = 0, size = PAGE_SIZE, status = _state.value.statusFilter)
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
            ordersRepository.orders(
                page = current.page + 1,
                size = PAGE_SIZE,
                status = current.statusFilter,
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
        val FILTERABLE: List<String> = OrderStatuses.filterable
    }
}

data class OrderDetailUiState(
    val isLoading: Boolean = true,
    val order: OrderDto? = null,
    val isCancelling: Boolean = false,
    val error: ApiError? = null,
    val message: String? = null,
)

class OrderDetailViewModel(
    private val ordersRepository: OrdersRepository,
    private val orderId: String,
) : ViewModel() {

    private val _state = MutableStateFlow(OrderDetailUiState())
    val state: StateFlow<OrderDetailUiState> = _state.asStateFlow()

    init {
        load()
    }

    fun load() {
        _state.update { it.copy(isLoading = true, error = null) }
        viewModelScope.launch {
            ordersRepository.order(orderId)
                .onSuccess { order ->
                    _state.update { it.copy(isLoading = false, order = order, error = null) }
                }
                .onFailure { throwable ->
                    _state.update { it.copy(isLoading = false, error = throwable.asApiError()) }
                }
        }
    }

    fun cancel() {
        if (_state.value.isCancelling) return
        _state.update { it.copy(isCancelling = true, error = null, message = null) }
        viewModelScope.launch {
            ordersRepository.cancelOrder(orderId)
                .onSuccess { order ->
                    _state.update {
                        it.copy(
                            isCancelling = false,
                            order = order,
                            message = "Заказ отменён",
                        )
                    }
                }
                .onFailure { throwable ->
                    _state.update { it.copy(isCancelling = false, error = throwable.asApiError()) }
                }
        }
    }

    fun dismissError() = _state.update { it.copy(error = null) }

    fun consumeMessage() = _state.update { it.copy(message = null) }
}
