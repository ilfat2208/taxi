package kz.taxi.mobile.data.remote

import kz.taxi.mobile.data.dto.MeResponse
import kz.taxi.mobile.data.dto.TokenRequest
import kz.taxi.mobile.data.dto.TokenResponse
import retrofit2.http.Body
import retrofit2.http.GET
import retrofit2.http.POST

interface AuthApi {

    @POST("api/v1/auth/token")
    suspend fun token(@Body body: TokenRequest): TokenResponse

    @GET("api/v1/auth/me")
    suspend fun me(): MeResponse
}
