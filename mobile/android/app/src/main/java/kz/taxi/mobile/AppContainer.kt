package kz.taxi.mobile

import android.content.Context
import kz.taxi.mobile.core.net.NetworkModule
import kz.taxi.mobile.core.session.SessionManager
import kz.taxi.mobile.core.session.TokenStore
import kz.taxi.mobile.data.remote.AccountsApi
import kz.taxi.mobile.data.remote.AuthApi
import kz.taxi.mobile.data.remote.CartApi
import kz.taxi.mobile.data.remote.CatalogApi
import kz.taxi.mobile.data.remote.ConfigApi
import kz.taxi.mobile.data.remote.OrdersApi
import kz.taxi.mobile.data.remote.PaymentsApi
import kz.taxi.mobile.data.repo.AccountsRepository
import kz.taxi.mobile.data.repo.AuthRepository
import kz.taxi.mobile.data.repo.CartRepository
import kz.taxi.mobile.data.repo.CatalogRepository
import kz.taxi.mobile.data.repo.ConfigRepository
import kz.taxi.mobile.data.repo.OrdersRepository
import kz.taxi.mobile.data.repo.PaymentsRepository
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch

/**
 * Hand-rolled dependency container.
 *
 * The app deliberately avoids Hilt/Koin: the graph is small and fully explicit, which keeps
 * the build fast (no annotation processing) and makes the JVM live-backend test able to
 * assemble exactly the same object graph without an Android runtime.
 */
class AppContainer(context: Context) {

    private val appScope = CoroutineScope(SupervisorJob() + Dispatchers.Default)

    val sessionManager: SessionManager = SessionManager(TokenStore(context.applicationContext))

    val network: NetworkModule = NetworkModule(
        tokenProvider = sessionManager::tokenNow,
        onUnauthorized = sessionManager::onUnauthorized,
        enableHttpLogging = BuildConfig.DEBUG,
    )

    /** Shown on the login screen so the tester knows which gateway is in use. */
    val baseUrl: String = network.resolvedBaseUrl

    val authRepository = AuthRepository(network.create(AuthApi::class.java), sessionManager)
    val accountsRepository = AccountsRepository(network.create(AccountsApi::class.java))
    val paymentsRepository = PaymentsRepository(network.create(PaymentsApi::class.java))
    val catalogRepository = CatalogRepository(network.create(CatalogApi::class.java))
    val cartRepository = CartRepository(network.create(CartApi::class.java))
    val ordersRepository = OrdersRepository(network.create(OrdersApi::class.java))

    /** Tariffs, payment methods and feature flags — read once at startup, not hardcoded. */
    val configRepository = ConfigRepository(network.create(ConfigApi::class.java))

    init {
        // A 401 anywhere in the app clears the persisted session; the navigation layer
        // observes `sessionManager.session` and falls back to the login screen.
        appScope.launch {
            sessionManager.expiredEvents.collect { sessionManager.logout() }
        }
        appScope.launch { sessionManager.restore() }
    }
}
