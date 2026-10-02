package kz.taxi.mobile.data.remote

import kz.taxi.mobile.data.dto.AccountDto
import kz.taxi.mobile.data.dto.CreateAccountRequest
import kz.taxi.mobile.data.dto.PageDto
import kz.taxi.mobile.data.dto.TopUpRequest
import kz.taxi.mobile.data.dto.TransactionDto
import retrofit2.http.Body
import retrofit2.http.GET
import retrofit2.http.POST
import retrofit2.http.Path
import retrofit2.http.Query

interface AccountsApi {

    @GET("api/v1/accounts")
    suspend fun listAccounts(): List<AccountDto>

    @POST("api/v1/accounts")
    suspend fun createAccount(@Body body: CreateAccountRequest): AccountDto

    @GET("api/v1/accounts/{id}/transactions")
    suspend fun transactions(
        @Path("id") accountId: String,
        @Query("page") page: Int,
        @Query("size") size: Int,
    ): PageDto<TransactionDto>

    /** Demo funding; the gateway answers `403 FORBIDDEN` for a non-admin caller. */
    @POST("api/v1/accounts/{id}/top-up")
    suspend fun topUp(
        @Path("id") accountId: String,
        @Body body: TopUpRequest,
    ): AccountDto
}
