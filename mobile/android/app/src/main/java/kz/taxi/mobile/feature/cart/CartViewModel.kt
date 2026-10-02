package kz.taxi.mobile.feature.cart

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import kz.taxi.mobile.core.error.ApiError
import kz.taxi.mobile.core.net.asApiError
import kz.taxi.mobile.data.dto.CartDto
import kz.taxi.mobile.data.dto.CartItemDto
import kz.taxi.mobile.data.repo.CartRepository
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

data class CartUiState(
    val isLoading: Boolean = true,
    val cart: CartDto? = null,
    /** The item currently being mutated, so its row can be disabled while in flight. */
    val busyItemId: String? = null,
    val isClearing: Boolean = false,
    val error: ApiError? = null,
) {
    val items: List<CartItemDto> get() = cart?.items.orEmpty()
    val isEmpty: Boolean get() = !isLoading && items.isEmpty()
    val subtotalMinor: Long get() = cart?.subtotalMinor ?: 0L
    val currency: String get() = cart?.currency ?: "KZT"
}

class CartViewModel(private val cartRepository: CartRepository) : ViewModel() {

    private val _state = MutableStateFlow(CartUiState())
    val state: StateFlow<CartUiState> = _state.asStateFlow()

    init {
        load()
    }

    fun load() {
        _state.update { it.copy(isLoading = it.cart == null, error = null) }
        viewModelScope.launch {
            cartRepository.cart()
                .onSuccess { cart -> _state.update { it.copy(isLoading = false, cart = cart, error = null) } }
                .onFailure { throwable ->
                    _state.update { it.copy(isLoading = false, error = throwable.asApiError()) }
                }
        }
    }

    fun setQuantity(item: CartItemDto, quantity: Int) {
        val target = quantity.coerceAtLeast(1)
        if (target == item.quantity || _state.value.busyItemId != null) return
        mutate(item.itemId) { cartRepository.updateItem(item.itemId, target) }
    }

    fun increment(item: CartItemDto) = setQuantity(item, item.quantity + 1)

    fun decrement(item: CartItemDto) {
        if (item.quantity <= 1) {
            remove(item.itemId)
        } else {
            setQuantity(item, item.quantity - 1)
        }
    }

    fun remove(itemId: String) {
        if (_state.value.busyItemId != null) return
        mutate(itemId) { cartRepository.removeItem(itemId) }
    }

    fun clear() {
        if (_state.value.isClearing) return
        _state.update { it.copy(isClearing = true, error = null) }
        viewModelScope.launch {
            cartRepository.clear()
                .onSuccess { cart -> _state.update { it.copy(isClearing = false, cart = cart) } }
                .onFailure { throwable ->
                    _state.update { it.copy(isClearing = false, error = throwable.asApiError()) }
                }
        }
    }

    fun dismissError() = _state.update { it.copy(error = null) }

    private fun mutate(itemId: String, block: suspend () -> Result<CartDto>) {
        _state.update { it.copy(busyItemId = itemId, error = null) }
        viewModelScope.launch {
            block()
                .onSuccess { cart -> _state.update { it.copy(busyItemId = null, cart = cart) } }
                .onFailure { throwable ->
                    _state.update { it.copy(busyItemId = null, error = throwable.asApiError()) }
                }
        }
    }
}
