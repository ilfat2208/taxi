package kz.taxi.mobile.data.repo

import kz.taxi.mobile.core.net.apiCall
import kz.taxi.mobile.data.dto.AccountDto
import kz.taxi.mobile.data.dto.AccountTypes
import kz.taxi.mobile.data.dto.CreateAccountRequest
import kz.taxi.mobile.data.dto.PageDto
import kz.taxi.mobile.data.dto.TopUpRequest
import kz.taxi.mobile.data.dto.TransactionDto
import kz.taxi.mobile.data.remote.AccountsApi

class AccountsRepository(private val accountsApi: AccountsApi) {

    suspend fun accounts(): Result<List<AccountDto>> = apiCall { accountsApi.listAccounts() }

    suspend fun openAccount(
        currency: String = "KZT",
        type: String = AccountTypes.CUSTOMER,
        displayName: String? = null,
    ): Result<AccountDto> = apiCall {
        accountsApi.createAccount(
            CreateAccountRequest(
                currency = currency,
                type = type,
                displayName = displayName?.trim()?.takeIf { it.isNotEmpty() },
            ),
        )
    }

    suspend fun transactions(
        accountId: String,
        page: Int = 0,
        size: Int = DEFAULT_PAGE_SIZE,
    ): Result<PageDto<TransactionDto>> = apiCall {
        accountsApi.transactions(accountId = accountId, page = page, size = size)
    }

    /** Demo funds. Only an `ADMIN` session may call this. */
    suspend fun topUp(accountId: String, amountMinor: Long, reason: String): Result<AccountDto> =
        apiCall { accountsApi.topUp(accountId, TopUpRequest(amountMinor = amountMinor, reason = reason)) }

    companion object {
        const val DEFAULT_PAGE_SIZE = 20
    }
}
