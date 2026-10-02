package kz.taxi.mobile.core.net

import com.jakewharton.retrofit2.converter.kotlinx.serialization.asConverterFactory
import kz.taxi.mobile.core.ApiConfig
import kotlinx.serialization.json.Json
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.logging.HttpLoggingInterceptor
import retrofit2.Retrofit
import java.util.concurrent.TimeUnit

/**
 * Builds the single OkHttp + Retrofit stack used by every repository and by the JVM
 * live-backend test, so the test exercises exactly the production wiring.
 *
 * JSON is handled by kotlinx.serialization rather than Moshi: it is compile-time (no
 * reflection, no KSP/codegen step, nothing to keep alive in R8) and it is the natural
 * choice for a Kotlin 2.x codebase — `@Serializable` DTOs also work unchanged on the JVM
 * in unit tests.
 *
 * @param tokenProvider current bearer token, read per request from the in-memory session
 * @param onUnauthorized invoked when an authenticated request comes back `401`
 */
class NetworkModule(
    tokenProvider: () -> String?,
    onUnauthorized: () -> Unit,
    baseUrl: String = ApiConfig.normalizedBaseUrl,
    enableHttpLogging: Boolean = false,
) {
    val json: Json = Json {
        ignoreUnknownKeys = true
        explicitNulls = false
        encodeDefaults = true
        isLenient = true
    }

    private val okHttpClient: OkHttpClient = OkHttpClient.Builder()
        .connectTimeout(15, TimeUnit.SECONDS)
        .readTimeout(30, TimeUnit.SECONDS)
        .writeTimeout(30, TimeUnit.SECONDS)
        .callTimeout(45, TimeUnit.SECONDS)
        .retryOnConnectionFailure(true)
        .addInterceptor(
            ApiHeadersInterceptor(
                tokenProvider = tokenProvider,
                onUnauthorized = onUnauthorized,
            ),
        )
        .addInterceptor(ProblemLoggingInterceptor())
        .apply {
            if (enableHttpLogging) {
                addInterceptor(
                    HttpLoggingInterceptor().apply {
                        level = HttpLoggingInterceptor.Level.BASIC
                    },
                )
            }
        }
        .build()

    private val retrofit: Retrofit = Retrofit.Builder()
        .baseUrl(baseUrl)
        .client(okHttpClient)
        .addConverterFactory(json.asConverterFactory("application/json".toMediaType()))
        .build()

    /** The origin actually in use — surfaced in the login screen footer. */
    val resolvedBaseUrl: String = baseUrl

    fun <T : Any> create(service: Class<T>): T = retrofit.create(service)
}
