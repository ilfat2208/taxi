package kz.taxi.mobile.feature.accounts

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import kz.taxi.mobile.core.error.ApiError
import kz.taxi.mobile.core.money.Money
import kz.taxi.mobile.core.net.asApiError
import kz.taxi.mobile.core.session.Session
import kz.taxi.mobile.core.session.SessionManager
import kz.taxi.mobile.data.dto.AccountDto
import kz.taxi.mobile.data.dto.AccountTypes
import kz.taxi.mobile.data.dto.TransactionDto
import kz.taxi.mobile.data.repo.AccountsRepository
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

data class AccountsUiState(
    val isLoading: Boolean = true,
    val isRefreshing: Boolean = false,
    val accounts: List<AccountDto> = emptyList(),
    val selectedAccountId: String? = null,
    val transactions: List<TransactionDto> = emptyList(),
    val isLoadingTransactions: Boolean = false,
    val isOpeningAccount: Boolean = false,
    val isToppingUp: Boolean = false,
    val error: ApiError? = null,
    val notification: String? = null,
) {
    val selectedAccount: AccountDto?
        get() = accounts.firstOrNull { it.id == selectedAccountId } ?: accounts.firstOrNull()

    val totalAvailableMinor: Long
        get() = accounts.filter { it.isActive }.fold(0L) { acc, account -> acc + account.availableMinor }

    val isEmpty: Boolean get() = !isLoading && accounts.isEmpty()
}

class AccountsViewModel(
    private val accountsRepository: AccountsRepository,
    private val sessionManager: SessionManager,
) : ViewModel() {

    private val _state = MutableStateFlow(AccountsUiState())
    val state: StateFlow<AccountsUiState> = _state.asStateFlow()

    val session: StateFlow<Session?> = sessionManager.session

    init {
        refresh()
    }

    fun refresh() {
        _state.update { it.copy(isLoading = it.accounts.isEmpty(), isRefreshing = it.accounts.isNotEmpty(), error = null) }
        viewModelScope.launch {
            accountsRepository.accounts()
                .onSuccess { accounts ->
                    val selected = _state.value.selectedAccountId
                        ?.takeIf { id -> accounts.any { it.id == id } }
                        ?: accounts.firstOrNull()?.id
                    _state.update {
                        it.copy(
                            isLoading = false,
                            isRefreshing = false,
                            accounts = accounts,
                            selectedAccountId = selected,
                            error = null,
                        )
                    }
                    selected?.let(::loadTransactions)
                }
                .onFailure { throwable ->
                    _state.update {
                        it.copy(isLoading = false, isRefreshing = false, error = throwable.asApiError())
                    }
                }
        }
    }

    fun selectAccount(accountId: String) {
        if (_state.value.selectedAccountId == accountId) return
        _state.update { it.copy(selectedAccountId = accountId, transactions = emptyList()) }
        loadTransactions(accountId)
    }

    private fun loadTransactions(accountId: String) {
        _state.update { it.copy(isLoadingTransactions = true) }
        viewModelScope.launch {
            accountsRepository.transactions(accountId = accountId, page = 0, size = RECENT_TRANSACTION_COUNT)
                .onSuccess { page ->
                    _state.update { it.copy(isLoadingTransactions = false, transactions = page.items) }
                }
                .onFailure {
                    // A failed "recent activity" panel must not blank out the balances.
                    _state.update { it.copy(isLoadingTransactions = false, transactions = emptyList()) }
                }
        }
    }

    fun openAccount() {
        if (_state.value.isOpeningAccount) return
        _state.update { it.copy(isOpeningAccount = true, error = null) }
        viewModelScope.launch {
            accountsRepository.openAccount(type = AccountTypes.CUSTOMER, currency = Money.KZT)
                .onSuccess { created ->
                    _state.update {
                        it.copy(
                            isOpeningAccount = false,
                            selectedAccountId = created.id,
                            notification = "Счёт ${created.currency} открыт",
                        )
                    }
                    refresh()
                }
                .onFailure { throwable ->
                    _state.update { it.copy(isOpeningAccount = false, error = throwable.asApiError()) }
                }
        }
    }

    /** Demo funds. Requires an `ADMIN`-capable session, otherwise the gateway answers 403. */
    fun topUpSelected(amountMinor: Long) {
        val account = _state.value.selectedAccount ?: return
        if (_state.value.isToppingUp) return
        _state.update { it.copy(isToppingUp = true, error = null) }
        viewModelScope.launch {
            accountsRepository.topUp(account.id, amountMinor, reason = "demo top-up from Android client")
                .onSuccess { updated ->
                    _state.update {
                        it.copy(
                            isToppingUp = false,
                            notification = "Счёт пополнен на ${Money.format(amountMinor)}",
                            accounts = it.accounts.map { current ->
                                if (current.id == updated.id) updated else current
                            },
                        )
                    }
                    refresh()
                }
                .onFailure { throwable ->
                    _state.update { it.copy(isToppingUp = false, error = throwable.asApiError()) }
                }
        }
    }

    fun dismissError() = _state.update { it.copy(error = null) }

    fun consumeNotification() = _state.update { it.copy(notification = null) }

    private companion object {
        const val RECENT_TRANSACTION_COUNT = 5
    }
}
