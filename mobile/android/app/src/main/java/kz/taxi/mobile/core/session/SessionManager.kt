package kz.taxi.mobile.core.session

import kotlinx.coroutines.channels.BufferOverflow
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asSharedFlow
import kotlinx.coroutines.flow.asStateFlow

/**
 * The app-wide session. It keeps the token in memory as well as in [TokenStore] because the
 * OkHttp interceptor must read it synchronously on every request.
 *
 * A `401` on an authenticated call flows through [expiredEvents]; the app collector clears
 * the persisted session and the navigation layer sends the user back to login.
 */
class SessionManager(private val store: TokenStore) {

    private val _session = MutableStateFlow<Session?>(null)
    val session: StateFlow<Session?> = _session.asStateFlow()

    private val _expiredEvents = MutableSharedFlow<Unit>(
        replay = 0,
        extraBufferCapacity = 1,
        onBufferOverflow = BufferOverflow.DROP_OLDEST,
    )
    val expiredEvents: SharedFlow<Unit> = _expiredEvents.asSharedFlow()

    /**
     * False until the persisted session has been read at startup. The navigation layer waits
     * for this so a logged-in user is not briefly bounced through the login screen.
     */
    private val _restored = MutableStateFlow(false)
    val restored: StateFlow<Boolean> = _restored.asStateFlow()

    @Volatile
    private var cachedToken: String? = null

    /** Synchronous token access for the OkHttp interceptor. */
    fun tokenNow(): String? = cachedToken

    fun currentSession(): Session? = _session.value

    /** Rehydrates the in-memory cache from disk; called once when the app starts. */
    suspend fun restore() {
        setSession(store.current())
        _restored.value = true
    }

    suspend fun onAuthenticated(session: Session) {
        store.save(session)
        setSession(session)
    }

    /** Refreshes the cached profile (e.g. after `GET /auth/me`) without touching the token. */
    suspend fun updateProfile(displayName: String, phone: String, roles: List<String>) {
        val current = _session.value ?: return
        val updated = current.copy(displayName = displayName, phone = phone, roles = roles)
        store.save(updated)
        setSession(updated)
    }

    suspend fun logout() {
        store.clear()
        setSession(null)
    }

    /**
     * Called from the network layer. Drops the token immediately (so no further request
     * uses it) and asks the app to clear storage and navigate to login.
     */
    fun onUnauthorized() {
        setSession(null)
        _expiredEvents.tryEmit(Unit)
    }

    private fun setSession(session: Session?) {
        cachedToken = session?.accessToken
        _session.value = session
    }
}
