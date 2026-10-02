package kz.taxi.mobile.core

import kz.taxi.mobile.BuildConfig

/**
 * The single place where the backend origin lives.
 *
 * The value is injected at build time from `-Ptaxi.api.baseUrl=...` (see app/build.gradle.kts)
 * and defaults to the Android emulator alias for the host loopback interface. A system
 * property override is honoured so JVM (unit / live-backend) tests can point the very same
 * Retrofit stack at `http://localhost:8080` without a code change.
 */
object ApiConfig {

    /** The Android emulator's alias for the developer machine's loopback interface. */
    const val EMULATOR_BASE_URL: String = "http://10.0.2.2:8080"

    /** Only reachable from a JVM test / a process on the host itself. */
    const val HOST_LOOPBACK_BASE_URL: String = "http://localhost:8080"

    /** Development identity provider: any phone, this code. */
    const val DEMO_CODE: String = "0000"
    const val DEMO_PHONE: String = "+77001234567"

    private const val BASE_URL_SYSTEM_PROPERTY = "taxi.api.baseUrl"

    val baseUrl: String
        get() = System.getProperty(BASE_URL_SYSTEM_PROPERTY)?.takeIf { it.isNotBlank() }
            ?: BuildConfig.API_BASE_URL

    /** Retrofit requires the base URL to end with `/`. */
    val normalizedBaseUrl: String
        get() = baseUrl.let { if (it.endsWith("/")) it else "$it/" }
}
