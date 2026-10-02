package kz.taxi.mobile.nav

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.navigation.NavType
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.rememberNavController
import androidx.navigation.navArgument
import kotlinx.coroutines.launch
import kz.taxi.mobile.R
import kz.taxi.mobile.core.ui.LocalAppContainer
import kz.taxi.mobile.feature.accounts.AccountsScreen
import kz.taxi.mobile.feature.cart.CartScreen
import kz.taxi.mobile.feature.catalog.CatalogScreen
import kz.taxi.mobile.feature.catalog.ProductDetailScreen
import kz.taxi.mobile.feature.checkout.CheckoutScreen
import kz.taxi.mobile.feature.comingsoon.ComingSoonScreen
import kz.taxi.mobile.feature.home.HomeScreen
import kz.taxi.mobile.feature.home.HomeServices
import kz.taxi.mobile.feature.home.ServiceKey
import kz.taxi.mobile.feature.login.LoginScreen
import kz.taxi.mobile.feature.orders.OrderDetailScreen
import kz.taxi.mobile.feature.orders.OrdersScreen
import kz.taxi.mobile.feature.payments.PaymentDetailScreen
import kz.taxi.mobile.feature.payments.PaymentsScreen
import kz.taxi.mobile.feature.taxi.TaxiScreen
import kz.taxi.mobile.feature.transfer.TransferScreen

object Routes {
    const val LOGIN = "login"

    /** The ORTA home screen: the start destination of every signed-in session. */
    const val HOME = "home"

    const val ACCOUNTS = "accounts"
    const val TRANSFER = "transfer"
    const val PAYMENTS = "payments"
    const val CATALOG = "catalog"

    /** The same catalog, opened from the home search stub with the search field focused. */
    const val CATALOG_SEARCH = "catalog-search"

    const val CART = "cart"
    const val CHECKOUT = "checkout"
    const val ORDERS = "orders"
    const val TAXI = "taxi"

    const val SERVICE_KEY = "serviceKey"
    const val COMING_SOON = "coming-soon/{$SERVICE_KEY}"

    const val PAYMENT_ID = "paymentId"
    const val PRODUCT_ID = "productId"
    const val ORDER_ID = "orderId"

    const val PAYMENT_DETAIL = "payment/{$PAYMENT_ID}"
    const val PRODUCT_DETAIL = "product/{$PRODUCT_ID}"
    const val ORDER_DETAIL = "order/{$ORDER_ID}"

    fun paymentDetail(paymentId: String) = "payment/$paymentId"
    fun productDetail(productId: String) = "product/$productId"
    fun orderDetail(orderId: String) = "order/$orderId"
    fun comingSoon(key: ServiceKey) = "coming-soon/${key.name}"
}

@Composable
fun AppNav() {
    val container = LocalAppContainer.current
    val restored by container.sessionManager.restored.collectAsStateWithLifecycle()
    val session by container.sessionManager.session.collectAsStateWithLifecycle()
    val navController = rememberNavController()
    val scope = rememberCoroutineScope()

    // Wait for the persisted session before choosing a start destination, otherwise a
    // logged-in user would flash the login screen on every cold start.
    if (!restored) {
        Box(modifier = Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
            CircularProgressIndicator()
        }
        return
    }

    // A 401 (or an explicit logout) drops the session: clear the whole back stack and
    // return to login.
    LaunchedEffect(session) {
        if (session == null) {
            navController.navigate(Routes.LOGIN) {
                popUpTo(navController.graph.id) { inclusive = true }
                launchSingleTop = true
            }
        }
    }

    // Tab switching keeps exactly one copy of HOME under the stack and restores the state of
    // the tab the user returns to. `popUpTo` a route that is not on the stack (a session that
    // started on LOGIN) is simply a no-op.
    val selectTab: (MainTab) -> Unit = { tab ->
        navController.navigate(tab.route) {
            popUpTo(Routes.HOME) { saveState = true }
            launchSingleTop = true
            restoreState = true
        }
    }

    // Honest tiles: the two verticals that exist open their real screens, everything else is
    // an explicit placeholder.
    val openService: (ServiceKey) -> Unit = { key ->
        when (key) {
            ServiceKey.TAXI -> navController.navigate(Routes.TAXI)
            ServiceKey.MARKET -> selectTab(MainTab.CATALOG)
            else -> navController.navigate(Routes.comingSoon(key))
        }
    }

    val runQuickAction: (QuickAction) -> Unit = { action ->
        when (action) {
            QuickAction.TRANSFER -> navController.navigate(Routes.TRANSFER)
            QuickAction.NEW_ORDER -> selectTab(MainTab.CATALOG)
            QuickAction.ACCOUNTS -> selectTab(MainTab.PROFILE)
            QuickAction.QR -> navController.navigate(Routes.comingSoon(ServiceKey.QR))
        }
    }

    NavHost(
        navController = navController,
        startDestination = if (session != null) Routes.HOME else Routes.LOGIN,
    ) {
        composable(Routes.LOGIN) {
            LoginScreen(
                baseUrl = container.baseUrl,
                onLoggedIn = {
                    navController.navigate(Routes.HOME) {
                        popUpTo(Routes.LOGIN) { inclusive = true }
                        launchSingleTop = true
                    }
                },
            )
        }

        composable(Routes.HOME) {
            OrtaTabScaffold(
                selected = MainTab.HOME,
                onSelectTab = selectTab,
                onQuickAction = runQuickAction,
            ) {
                HomeScreen(
                    onOpenSearch = { navController.navigate(Routes.CATALOG_SEARCH) },
                    onOpenService = openService,
                    onOpenProfile = { selectTab(MainTab.PROFILE) },
                )
            }
        }

        composable(Routes.CATALOG) {
            OrtaTabScaffold(
                selected = MainTab.CATALOG,
                onSelectTab = selectTab,
                onQuickAction = runQuickAction,
            ) {
                CatalogScreen(
                    onOpenProduct = { productId -> navController.navigate(Routes.productDetail(productId)) },
                    onOpenCart = { navController.navigate(Routes.CART) },
                )
            }
        }

        // Reached from the home search stub: same screen, but the search field takes focus
        // and the header keeps a back arrow, because this instance is not a tab.
        composable(Routes.CATALOG_SEARCH) {
            CatalogScreen(
                onBack = { navController.popBackStack() },
                onOpenProduct = { productId -> navController.navigate(Routes.productDetail(productId)) },
                onOpenCart = { navController.navigate(Routes.CART) },
                focusSearchOnStart = true,
            )
        }

        composable(Routes.ORDERS) {
            OrtaTabScaffold(
                selected = MainTab.ORDERS,
                onSelectTab = selectTab,
                onQuickAction = runQuickAction,
            ) {
                OrdersScreen(
                    onOpenOrder = { orderId -> navController.navigate(Routes.orderDetail(orderId)) },
                )
            }
        }

        composable(Routes.ACCOUNTS) {
            OrtaTabScaffold(
                selected = MainTab.PROFILE,
                onSelectTab = selectTab,
                onQuickAction = runQuickAction,
            ) {
                AccountsScreen(
                    onOpenTransfer = { navController.navigate(Routes.TRANSFER) },
                    onOpenPayments = { navController.navigate(Routes.PAYMENTS) },
                    onOpenCatalog = { selectTab(MainTab.CATALOG) },
                    onOpenOrders = { selectTab(MainTab.ORDERS) },
                    onOpenCart = { navController.navigate(Routes.CART) },
                    onLogout = { scope.launch { container.sessionManager.logout() } },
                )
            }
        }

        composable(Routes.TAXI) {
            TaxiScreen(
                onBack = { navController.popBackStack() },
                onOpenAccounts = { selectTab(MainTab.PROFILE) },
                onOpenCatalog = { selectTab(MainTab.CATALOG) },
            )
        }

        composable(
            route = Routes.COMING_SOON,
            arguments = listOf(navArgument(Routes.SERVICE_KEY) { type = NavType.StringType }),
        ) { entry ->
            val key = entry.arguments?.getString(Routes.SERVICE_KEY)
                ?.let { raw -> ServiceKey.entries.firstOrNull { it.name == raw } }
                ?: ServiceKey.BUSINESS
            val service = HomeServices.byKey(key)
            ComingSoonScreen(
                title = stringResource(service.titleRes),
                message = stringResource(service.messageRes),
                onBack = { navController.popBackStack() },
            )
        }

        composable(Routes.TRANSFER) {
            TransferScreen(onBack = { navController.popBackStack() })
        }

        composable(Routes.PAYMENTS) {
            PaymentsScreen(
                onBack = { navController.popBackStack() },
                onOpenPayment = { paymentId -> navController.navigate(Routes.paymentDetail(paymentId)) },
            )
        }

        composable(
            route = Routes.PAYMENT_DETAIL,
            arguments = listOf(navArgument(Routes.PAYMENT_ID) { type = NavType.StringType }),
        ) { entry ->
            PaymentDetailScreen(
                paymentId = entry.arguments?.getString(Routes.PAYMENT_ID).orEmpty(),
                onBack = { navController.popBackStack() },
            )
        }

        composable(
            route = Routes.PRODUCT_DETAIL,
            arguments = listOf(navArgument(Routes.PRODUCT_ID) { type = NavType.StringType }),
        ) { entry ->
            ProductDetailScreen(
                productId = entry.arguments?.getString(Routes.PRODUCT_ID).orEmpty(),
                onBack = { navController.popBackStack() },
                onOpenCart = { navController.navigate(Routes.CART) },
            )
        }

        composable(Routes.CART) {
            CartScreen(
                onBack = { navController.popBackStack() },
                onCheckout = { navController.navigate(Routes.CHECKOUT) },
                onOpenCatalog = { selectTab(MainTab.CATALOG) },
            )
        }

        composable(Routes.CHECKOUT) {
            CheckoutScreen(
                onBack = { navController.popBackStack() },
                onOpenOrders = {
                    navController.navigate(Routes.ORDERS) {
                        popUpTo(Routes.CHECKOUT) { inclusive = true }
                    }
                },
            )
        }

        composable(
            route = Routes.ORDER_DETAIL,
            arguments = listOf(navArgument(Routes.ORDER_ID) { type = NavType.StringType }),
        ) { entry ->
            OrderDetailScreen(
                orderId = entry.arguments?.getString(Routes.ORDER_ID).orEmpty(),
                onBack = { navController.popBackStack() },
            )
        }
    }
}
