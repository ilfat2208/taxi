package kz.taxi.mobile.data.repo

import kz.taxi.mobile.core.net.apiCall
import kz.taxi.mobile.core.session.Session
import kz.taxi.mobile.core.session.SessionManager
import kz.taxi.mobile.data.dto.MeResponse
import kz.taxi.mobile.data.dto.TokenRequest
import kz.taxi.mobile.data.remote.AuthApi

class AuthRepository(
    private val authApi: AuthApi,
    private val sessionManager: SessionManager,
) {

    /**
     * Exchanges a phone + the development confirmation code for a session and persists it.
     *
     * The demo identity provider derives the user id from the phone and accepts any phone
     * with the code `0000`.
     */
    suspend fun login(
        phone: String,
        code: String,
        displayName: String? = null,
        roles: List<String>? = null,
    ): Result<Session> = apiCall {
        val normalizedPhone = phone.trim()
        val normalizedName = displayName?.trim()?.takeIf { it.isNotEmpty() }
        val response = authApi.token(
            TokenRequest(
                phone = normalizedPhone,
                code = code.trim(),
                displayName = normalizedName,
                roles = roles?.takeIf { it.isNotEmpty() },
            ),
        )
        val session = Session(
            accessToken = response.accessToken,
            userId = response.userId,
            phone = normalizedPhone,
            displayName = normalizedName ?: normalizedPhone,
            roles = response.roles,
        )
        sessionManager.onAuthenticated(session)
        session
    }

    /** `GET /api/v1/auth/me` — refreshes display name and roles for the cached session. */
    suspend fun refreshProfile(): Result<MeResponse> = apiCall { authApi.me() }

    suspend fun refreshSessionProfile(): Result<Session?> = apiCall {
        val me = authApi.me()
        sessionManager.updateProfile(
            displayName = me.displayName?.takeIf { it.isNotBlank() } ?: me.phone,
            phone = me.phone,
            roles = me.roles,
        )
        sessionManager.currentSession()
    }

    suspend fun logout() = sessionManager.logout()

    fun currentSession(): Session? = sessionManager.currentSession()
}
