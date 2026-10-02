package kz.taxi.mobile.feature.transfer

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import kz.taxi.mobile.core.error.ApiError
import kz.taxi.mobile.core.idempotency.IdempotencyKeyHolder
import kz.taxi.mobile.core.money.Money
import kz.taxi.mobile.core.net.asApiError
import kz.taxi.mobile.core.util.PhoneNumbers
import kz.taxi.mobile.data.dto.AccountDto
import kz.taxi.mobile.data.dto.PaymentDto
import kz.taxi.mobile.data.repo.AccountsRepository
import kz.taxi.mobile.data.repo.PaymentsRepository
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

enum class TransferStep { FORM, REVIEW, SUCCESS }

data class TransferUiState(
    val accounts: List<AccountDto> = emptyList(),
    val isLoadingAccounts: Boolean = true,
    val selectedAccountId: String? = null,

    val recipientPhone: String = "",
    val amountText: String = "",
    val description: String = "",

    val step: TransferStep = TransferStep.FORM,
    val isSubmitting: Boolean = false,
    val error: ApiError? = null,
    val phoneError: String? = null,
    val amountError: String? = null,

    /** The payment returned by a successful submit. */
    val payment: PaymentDto? = null,

    /** Exactly the key that will be / was sent with the current submit. */
    val idempotencyKey: String? = null,

    /** True when the last failure was a transport failure, so retrying reuses the same key. */
    val retryReusesKey: Boolean = false,
) {
    val sourceAccount: AccountDto?
        get() = accounts.firstOrNull { it.id == selectedAccountId } ?: accounts.firstOrNull()

    val amountMinor: Long?
        get() = Money.parseToMinor(amountText)?.takeIf { it > 0 }

    val canReview: Boolean
        get() = sourceAccount != null && amountMinor != null && recipientPhone.isNotBlank()
}

/**
 * Card-to-card transfer with an explicit review step.
 *
 * Idempotency contract implemented here:
 *  * the key is minted when the user moves from the form to the review step and is shown on
 *    screen, so it is obvious that a *logical submit* owns one key;
 *  * editing the form (going back) rotates it, because the payload changed;
 *  * a **transport** failure keeps the key so "Повторить" retries the very same operation
 *    instead of risking a second money movement;
 *  * a business failure and a success both drop the key, so the next submit is fresh;
 *  * "Повторить операцию" on the success screen deliberately starts a new submit with a
 *    brand-new key.
 */
class TransferViewModel(
    private val accountsRepository: AccountsRepository,
    private val paymentsRepository: PaymentsRepository,
    private val idempotency: IdempotencyKeyHolder = IdempotencyKeyHolder(),
) : ViewModel() {

    private val _state = MutableStateFlow(TransferUiState())
    val state: StateFlow<TransferUiState> = _state.asStateFlow()

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
        invalidateSubmit(keepRecipient = true)
        _state.update { it.copy(selectedAccountId = accountId, error = null) }
    }

    fun onPhoneChange(value: String) {
        invalidateSubmit(keepRecipient = true)
        _state.update { it.copy(recipientPhone = value, phoneError = null, error = null) }
    }

    fun onAmountChange(value: String) {
        invalidateSubmit(keepRecipient = true)
        _state.update { it.copy(amountText = value, amountError = null, error = null) }
    }

    fun onDescriptionChange(value: String) {
        _state.update { it.copy(description = value, error = null) }
    }

    fun dismissError() = _state.update { it.copy(error = null) }

    /** Form -> review. Validates locally and mints the key that the submit will carry. */
    fun toReview() {
        val current = _state.value
        val phoneError = PhoneNumbers.validationError(current.recipientPhone)
        val amountError = when {
            current.amountText.isBlank() -> "Введите сумму"
            current.amountMinor == null -> "Сумма должна быть положительным числом, максимум 2 знака после запятой"
            else -> null
        }
        if (phoneError != null || amountError != null) {
            _state.update { it.copy(phoneError = phoneError, amountError = amountError) }
            return
        }

        val source = current.sourceAccount
        val amountMinor = current.amountMinor!!
        if (source != null && PhoneNumbers.sameNumber(current.recipientPhone, source.ownerPhone)) {
            _state.update {
                it.copy(
                    phoneError = "Это счёт отправителя — нельзя перевести самому себе",
                )
            }
            return
        }
        if (source != null && amountMinor > source.availableMinor) {
            _state.update {
                it.copy(
                    amountError = "Недостаточно средств: доступно ${Money.format(source.availableMinor, source.currency)}",
                )
            }
            return
        }

        val key = idempotency.currentOrNew()
        _state.update {
            it.copy(
                step = TransferStep.REVIEW,
                error = null,
                phoneError = null,
                amountError = null,
                idempotencyKey = key,
                retryReusesKey = false,
            )
        }
    }

    /** Review -> form. The payload may change, so the old key must not be reused. */
    fun backToForm() {
        idempotency.clear()
        _state.update {
            it.copy(step = TransferStep.FORM, error = null, idempotencyKey = null, retryReusesKey = false)
        }
    }

    /**
     * Sends the transfer. Safe to call again after a failure: the key is reused exactly when
     * the previous attempt failed for transport reasons.
     */
    fun submit() {
        val current = _state.value
        if (current.isSubmitting) return
        val source = current.sourceAccount ?: return
        val amountMinor = current.amountMinor ?: return

        val key = idempotency.currentOrNew()
        _state.update { it.copy(isSubmitting = true, error = null, idempotencyKey = key) }

        viewModelScope.launch {
            paymentsRepository.transfer(
                idempotencyKey = key,
                sourceAccountId = source.id,
                targetPhone = PhoneNumbers.normalize(current.recipientPhone),
                amountMinor = amountMinor,
                currency = source.currency,
                description = current.description,
            )
                .onSuccess { payment ->
                    idempotency.clear()
                    _state.update {
                        it.copy(
                            isSubmitting = false,
                            step = TransferStep.SUCCESS,
                            payment = payment,
                            idempotencyKey = key,
                            retryReusesKey = false,
                            error = null,
                        )
                    }
                    loadAccounts()
                }
                .onFailure { throwable ->
                    val error = throwable.asApiError()
                    if (error.isNetworkFailure) {
                        // Unknown outcome: the retry MUST carry the same key.
                    } else {
                        idempotency.clear()
                    }
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

    /** "Повторить операцию": a deliberate new transfer, so it starts from a fresh key. */
    fun repeat() {
        idempotency.clear()
        _state.update {
            it.copy(
                step = TransferStep.FORM,
                payment = null,
                idempotencyKey = null,
                retryReusesKey = false,
                error = null,
                amountText = "",
                description = "",
            )
        }
    }

    /** "Новый перевод": clears the form entirely. */
    fun startNew() {
        idempotency.clear()
        _state.update {
            TransferUiState(
                accounts = it.accounts,
                isLoadingAccounts = false,
                selectedAccountId = it.selectedAccountId,
            )
        }
    }

    /**
     * Any change to the form invalidates the prepared submit, because the payload the key
     * belongs to no longer exists.
     */
    private fun invalidateSubmit(keepRecipient: Boolean) {
        if (_state.value.step != TransferStep.FORM) return
        idempotency.clear()
        _state.update { it.copy(idempotencyKey = null, retryReusesKey = false) }
        if (!keepRecipient) _state.update { it.copy(recipientPhone = "") }
    }
}
