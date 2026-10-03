package kz.taxi.mobile.data.remote

import kz.taxi.mobile.data.dto.PlatformConfigDto
import retrofit2.http.GET

/**
 * The client configuration.
 *
 * Anonymous: it is the call the app makes before it has a token, and it is what the
 * marketplace and the taxi price list are shown from on the first screen.
 */
interface ConfigApi {

    @GET("api/v1/config")
    suspend fun config(): PlatformConfigDto
}
