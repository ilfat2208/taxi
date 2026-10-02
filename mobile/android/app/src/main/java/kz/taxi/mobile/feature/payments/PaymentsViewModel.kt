package kz.taxi.mobile.feature.payments

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import kz.taxi.mobile.core.error.ApiError
import kz.taxi.mobile.core.net.asApiError
import kz.taxi.mobile.data.dto.PaymentDetailDto
import kz.taxi.mobile.data.dto.PaymentDto
import kz.taxi.mobile.data.repo.PaymentsRepository
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

data class PaymentsUiState(
    val items: List<PaymentDto> = emptyList(),
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

/** Payment history, paged with a status filter. */
class PaymentsViewModel(
    private val paymentsRepository: PaymentsRepository,
) : ViewModel() {

    private val _state = MutableStateFlow(PaymentsUiState())
    val state: StateFlow<PaymentsUiState> = _state.asStateFlow()

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
            paymentsRepository.payments(page = 0, size = PAGE_SIZE, status = _state.value.statusFilter)
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
            paymentsRepository.payments(
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
    }
}

data class PaymentDetailUiState(
    val isLoading: Boolean = true,
    val detail: PaymentDetailDto? = null,
    val error: ApiError? = null,
)

class PaymentDetailViewModel(
    private val paymentsRepository: PaymentsRepository,
    private val paymentId: String,
) : ViewModel() {

    private val _state = MutableStateFlow(PaymentDetailUiState())
    val state: StateFlow<PaymentDetailUiState> = _state.asStateFlow()

    init {
        load()
    }

    fun load() {
        _state.update { it.copy(isLoading = true, error = null) }
        viewModelScope.launch {
            paymentsRepository.payment(paymentId)
                .onSuccess { detail ->
                    _state.update { it.copy(isLoading = false, detail = detail, error = null) }
                }
                .onFailure { throwable ->
                    _state.update { it.copy(isLoading = false, error = throwable.asApiError()) }
                }
        }
    }

    fun dismissError() = _state.update { it.copy(error = null) }
}
