package kz.taxi.mobile.feature.checkout

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import kz.taxi.mobile.core.error.ApiError
import kz.taxi.mobile.core.idempotency.IdempotencyKeyHolder
import kz.taxi.mobile.core.net.asApiError
import kz.taxi.mobile.core.util.PhoneNumbers
import kz.taxi.mobile.data.dto.AccountDto
import kz.taxi.mobile.data.dto.OrderDto
import kz.taxi.mobile.data.repo.AccountsRepository
import kz.taxi.mobile.data.repo.OrdersRepository
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

data class CheckoutUiState(
    val accounts: List<AccountDto> = emptyList(),
    val isLoadingAccounts: Boolean = true,
    val selectedAccountId: String? = null,

    val deliveryAddress: String = "",
    val contactPhone: String = "",
    val comment: String = "",

    val isSubmitting: Boolean = false,
    val error: ApiError? = null,
    val addressError: String? = null,
    val phoneError: String? = null,

    /** The key that the current submit carries; shown so the guarantee is visible. */
    val idempotencyKey: String? = null,
    val retryReusesKey: Boolean = false,

    /** Set once the order exists — the screen then switches to the order summary. */
    val order: OrderDto? = null,
) {
    val sourceAccount: AccountDto?
        get() = accounts.firstOrNull { it.id == selectedAccountId } ?: accounts.firstOrNull()

    val canSubmit: Boolean
        get() = sourceAccount != null &&
            deliveryAddress.isNotBlank() &&
            contactPhone.isNotBlank() &&
            !isSubmitting
}

/**
 * Checkout. Uses the same idempotency discipline as the transfer: one key per logical
 * submit, kept across a transport-level retry, dropped after a definitive outcome.
 */
class CheckoutViewModel(
    private val accountsRepository: AccountsRepository,
    private val ordersRepository: OrdersRepository,
    private val idempotency: IdempotencyKeyHolder = IdempotencyKeyHolder(),
) : ViewModel() {

    private val _state = MutableStateFlow(CheckoutUiState())
    val state: StateFlow<CheckoutUiState> = _state.asStateFlow()

    init {
        loadAccounts()
    }

    fun loadAccounts() {
        _state.update { it.copy(isLoadingAccounts = it.accounts.isEmpty()) }
        viewModelScope.launch {
            accountsRepository.accounts()
                .onSuccess { accounts ->
                    _state.update { current ->
                        current.copy(
                            accounts = accounts,
                            isLoadingAccounts = false,
                            selectedAccountId = current.selectedAccountId
                                ?.takeIf { id -> accounts.any { it.id == id } }
                                ?: accounts.firstOrNull()?.id,
                        )
                    }
                }
                .onFailure { throwable ->
                    _state.update {
                        it.copy(isLoadingAccounts = false, error = throwable.asApiError())
                    }
                }
        }
    }

    fun selectAccount(accountId: String) {
        idempotency.clear()
        _state.update {
            it.copy(selectedAccountId = accountId, idempotencyKey = null, retryReusesKey = false, error = null)
        }
    }

    fun onAddressChange(value: String) {
        idempotency.clear()
        _state.update {
            it.copy(deliveryAddress = value, addressError = null, idempotencyKey = null, error = null)
        }
    }

    fun onPhoneChange(value: String) {
        idempotency.clear()
        _state.update {
            it.copy(contactPhone = value, phoneError = null, idempotencyKey = null, error = null)
        }
    }

    fun onCommentChange(value: String) = _state.update { it.copy(comment = value) }

    fun dismissError() = _state.update { it.copy(error = null) }

    fun submit() {
        val current = _state.value
        if (current.isSubmitting) return

        val addressError = if (current.deliveryAddress.trim().length < MIN_ADDRESS_LENGTH) {
            "Укажите адрес доставки"
        } else {
            null
        }
        val phoneError = PhoneNumbers.validationError(current.contactPhone)
        if (addressError != null || phoneError != null) {
            _state.update { it.copy(addressError = addressError, phoneError = phoneError) }
            return
        }
        val source = current.sourceAccount ?: return

        val key = idempotency.currentOrNew()
        _state.update { it.copy(isSubmitting = true, error = null, idempotencyKey = key) }

        viewModelScope.launch {
            ordersRepository.createOrder(
                idempotencyKey = key,
                deliveryAddress = current.deliveryAddress,
                contactPhone = PhoneNumbers.normalize(current.contactPhone),
                sourceAccountId = source.id,
                comment = current.comment,
            )
                .onSuccess { order ->
                    idempotency.clear()
                    _state.update {
                        it.copy(
                            isSubmitting = false,
                            order = order,
                            error = null,
                            retryReusesKey = false,
                        )
                    }
                }
                .onFailure { throwable ->
                    val error = throwable.asApiError()
                    if (!error.isNetworkFailure) idempotency.clear()
                    _state.update {
                        it.copy(
                            isSubmitting = false,
                            error = error,
                            retryReusesKey = error.isNetworkFailure,
                        )
                    }
                }
        }
    }

    fun dismissOrder() {
        idempotency.clear()
        _state.update { it.copy(order = null, idempotencyKey = null) }
    }

    private companion object {
        const val MIN_ADDRESS_LENGTH = 5
    }
}
