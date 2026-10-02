package kz.taxi.mobile.feature.home

import androidx.annotation.StringRes
import androidx.lifecycle.ViewModel
import kz.taxi.mobile.R
import kz.taxi.mobile.core.session.Session
import kz.taxi.mobile.core.session.SessionManager
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update

/**
 * The cities the header picker offers.
 *
 * The list is local because the backend has no city directory yet; geolocation is not
 * requested either — the app must not claim to know the city it does not know.
 */
enum class HomeCity(@StringRes val labelRes: Int) {
    SHYMKENT(R.string.city_shymkent),
    ALMATY(R.string.city_almaty),
    ASTANA(R.string.city_astana),
    KARAGANDA(R.string.city_karaganda),
}

/** A notice shown in the bell sheet. Only local notices exist so far. */
data class HomeNotice(
    val id: String,
    @StringRes val titleRes: Int,
    @StringRes val bodyRes: Int,
)

private val LocalNotices = listOf(
    HomeNotice(
        id = "welcome",
        titleRes = R.string.home_notice_welcome_title,
        bodyRes = R.string.home_notice_welcome_body,
    ),
)

data class HomeUiState(
    val city: HomeCity = HomeCity.SHYMKENT,
    val notices: List<HomeNotice> = LocalNotices,
    val unreadNotices: Int = LocalNotices.size,
) {
    /** Drives the red dot on the bell: no unread notices, no dot. */
    val hasUnreadNotices: Boolean get() = unreadNotices > 0
}

class HomeViewModel(sessionManager: SessionManager) : ViewModel() {

    private val _state = MutableStateFlow(HomeUiState())
    val state: StateFlow<HomeUiState> = _state.asStateFlow()

    /** The header greeting and the avatar initials come from the shared session. */
    val session: StateFlow<Session?> = sessionManager.session

    fun selectCity(city: HomeCity) = _state.update { it.copy(city = city) }

    fun markNoticesRead() = _state.update { it.copy(unreadNotices = 0) }
}
