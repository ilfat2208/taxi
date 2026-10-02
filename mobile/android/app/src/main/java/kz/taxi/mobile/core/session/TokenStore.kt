package kz.taxi.mobile.core.session

import android.content.Context
import androidx.datastore.core.DataStore
import androidx.datastore.preferences.core.Preferences
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.emptyPreferences
import androidx.datastore.preferences.core.stringPreferencesKey
import androidx.datastore.preferences.core.stringSetPreferencesKey
import androidx.datastore.preferences.preferencesDataStore
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.catch
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.map
import java.io.IOException

private val Context.sessionDataStore: DataStore<Preferences> by preferencesDataStore(name = "taxi_session")

/**
 * Durable home of the bearer token.
 *
 * DataStore (Preferences) is used rather than `EncryptedSharedPreferences`: the latter is
 * still an alpha artifact and drags in Tink, while the token here is a short-lived
 * development-IdP JWT. This class is the single seam where a Keystore-backed
 * implementation could be dropped in later without touching any other layer.
 */
class TokenStore(private val context: Context) {

    private object Keys {
        val ACCESS_TOKEN = stringPreferencesKey("access_token")
        val USER_ID = stringPreferencesKey("user_id")
        val PHONE = stringPreferencesKey("phone")
        val DISPLAY_NAME = stringPreferencesKey("display_name")
        val ROLES = stringSetPreferencesKey("roles")
    }

    val sessionFlow: Flow<Session?> = context.sessionDataStore.data
        .catch { throwable ->
            if (throwable is IOException) emit(emptyPreferences()) else throw throwable
        }
        .map { preferences ->
            val token = preferences[Keys.ACCESS_TOKEN]
            val userId = preferences[Keys.USER_ID]
            if (token.isNullOrBlank() || userId.isNullOrBlank()) {
                null
            } else {
                Session(
                    accessToken = token,
                    userId = userId,
                    phone = preferences[Keys.PHONE].orEmpty(),
                    displayName = preferences[Keys.DISPLAY_NAME].orEmpty(),
                    roles = preferences[Keys.ROLES]?.toList().orEmpty(),
                )
            }
        }

    suspend fun current(): Session? = sessionFlow.first()

    suspend fun save(session: Session) {
        context.sessionDataStore.edit { preferences ->
            preferences[Keys.ACCESS_TOKEN] = session.accessToken
            preferences[Keys.USER_ID] = session.userId
            preferences[Keys.PHONE] = session.phone
            preferences[Keys.DISPLAY_NAME] = session.displayName
            preferences[Keys.ROLES] = session.roles.toSet()
        }
    }

    suspend fun clear() {
        context.sessionDataStore.edit { it.clear() }
    }
}
