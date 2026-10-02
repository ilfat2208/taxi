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
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.navigation.NavType
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.rememberNavController
import androidx.navigation.navArgument
import kotlinx.coroutines.launch
import kz.taxi.mobile.core.ui.LocalAppContainer
import kz.taxi.mobile.feature.accounts.AccountsScreen
import kz.taxi.mobile.feature.cart.CartScreen
import kz.taxi.mobile.feature.catalog.CatalogScreen
import kz.taxi.mobile.feature.catalog.ProductDetailScreen
import kz.taxi.mobile.feature.checkout.CheckoutScreen
import kz.taxi.mobile.feature.login.LoginScreen
import kz.taxi.mobile.feature.orders.OrderDetailScreen
import kz.taxi.mobile.feature.orders.OrdersScreen
import kz.taxi.mobile.feature.payments.PaymentDetailScreen
import kz.taxi.mobile.feature.payments.PaymentsScreen
import kz.taxi.mobile.feature.transfer.TransferScreen

object Routes {
    const val LOGIN = "login"
    const val ACCOUNTS = "accounts"
    const val TRANSFER = "transfer"
    const val PAYMENTS = "payments"
    const val CATALOG = "catalog"
    const val CART = "cart"
    const val CHECKOUT = "checkout"
    const val ORDERS = "orders"

    const val PAYMENT_ID = "paymentId"
    const val PRODUCT_ID = "productId"
    const val ORDER_ID = "orderId"

    const val PAYMENT_DETAIL = "payment/{$PAYMENT_ID}"
    const val PRODUCT_DETAIL = "product/{$PRODUCT_ID}"
    const val ORDER_DETAIL = "order/{$ORDER_ID}"

    fun paymentDetail(paymentId: String) = "payment/$paymentId"
    fun productDetail(productId: String) = "product/$productId"
    fun orderDetail(orderId: String) = "order/$orderId"
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

    NavHost(
        navController = navController,
        startDestination = if (session != null) Routes.ACCOUNTS else Routes.LOGIN,
    ) {
        composable(Routes.LOGIN) {
            LoginScreen(
                baseUrl = container.baseUrl,
                onLoggedIn = {
                    navController.navigate(Routes.ACCOUNTS) {
                        popUpTo(Routes.LOGIN) { inclusive = true }
                        launchSingleTop = true
                    }
                },
            )
        }

        composable(Routes.ACCOUNTS) {
            AccountsScreen(
                onOpenTransfer = { navController.navigate(Routes.TRANSFER) },
                onOpenPayments = { navController.navigate(Routes.PAYMENTS) },
                onOpenCatalog = { navController.navigate(Routes.CATALOG) },
                onOpenOrders = { navController.navigate(Routes.ORDERS) },
                onOpenCart = { navController.navigate(Routes.CART) },
                onLogout = { scope.launch { container.sessionManager.logout() } },
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

        composable(Routes.CATALOG) {
            CatalogScreen(
                onBack = { navController.popBackStack() },
                onOpenProduct = { productId -> navController.navigate(Routes.productDetail(productId)) },
                onOpenCart = { navController.navigate(Routes.CART) },
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
                onOpenCatalog = { navController.navigate(Routes.CATALOG) },
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

        composable(Routes.ORDERS) {
            OrdersScreen(
                onBack = { navController.popBackStack() },
                onOpenOrder = { orderId -> navController.navigate(Routes.orderDetail(orderId)) },
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
