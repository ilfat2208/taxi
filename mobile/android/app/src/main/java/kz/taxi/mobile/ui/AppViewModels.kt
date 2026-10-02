package kz.taxi.mobile.ui

import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import kz.taxi.mobile.AppContainer
import kz.taxi.mobile.core.session.SessionManager
import kz.taxi.mobile.data.repo.AccountsRepository
import kz.taxi.mobile.data.repo.CartRepository
import kz.taxi.mobile.data.repo.CatalogRepository
import kz.taxi.mobile.data.repo.OrdersRepository
import kz.taxi.mobile.data.repo.PaymentsRepository
import kz.taxi.mobile.feature.accounts.AccountsViewModel
import kz.taxi.mobile.feature.cart.CartViewModel
import kz.taxi.mobile.feature.catalog.CatalogViewModel
import kz.taxi.mobile.feature.catalog.ProductDetailViewModel
import kz.taxi.mobile.feature.checkout.CheckoutViewModel
import kz.taxi.mobile.feature.home.HomeViewModel
import kz.taxi.mobile.feature.login.LoginViewModel
import kz.taxi.mobile.feature.orders.OrderDetailViewModel
import kz.taxi.mobile.feature.orders.OrdersViewModel
import kz.taxi.mobile.feature.payments.PaymentDetailViewModel
import kz.taxi.mobile.feature.payments.PaymentsViewModel
import kz.taxi.mobile.feature.transfer.TransferViewModel

/**
 * One factory per ViewModel. Kept explicit instead of using a DI framework so the whole
 * object graph is readable in a single file and the build needs no annotation processing.
 */
object AppViewModels {

    fun login(container: AppContainer): ViewModelProvider.Factory = viewModelFactory {
        initializer { LoginViewModel(container.authRepository) }
    }

    fun home(sessionManager: SessionManager): ViewModelProvider.Factory = viewModelFactory {
        initializer { HomeViewModel(sessionManager) }
    }

    fun accounts(
        accountsRepository: AccountsRepository,
        sessionManager: SessionManager,
    ): ViewModelProvider.Factory = viewModelFactory {
        initializer { AccountsViewModel(accountsRepository, sessionManager) }
    }

    fun transfer(
        accountsRepository: AccountsRepository,
        paymentsRepository: PaymentsRepository,
    ): ViewModelProvider.Factory = viewModelFactory {
        initializer { TransferViewModel(accountsRepository, paymentsRepository) }
    }

    fun payments(paymentsRepository: PaymentsRepository): ViewModelProvider.Factory = viewModelFactory {
        initializer { PaymentsViewModel(paymentsRepository) }
    }

    fun paymentDetail(
        paymentsRepository: PaymentsRepository,
        paymentId: String,
    ): ViewModelProvider.Factory = viewModelFactory {
        initializer { PaymentDetailViewModel(paymentsRepository, paymentId) }
    }

    fun catalog(catalogRepository: CatalogRepository): ViewModelProvider.Factory = viewModelFactory {
        initializer { CatalogViewModel(catalogRepository) }
    }

    fun productDetail(
        catalogRepository: CatalogRepository,
        cartRepository: CartRepository,
        productId: String,
    ): ViewModelProvider.Factory = viewModelFactory {
        initializer { ProductDetailViewModel(catalogRepository, cartRepository, productId) }
    }

    fun cart(cartRepository: CartRepository): ViewModelProvider.Factory = viewModelFactory {
        initializer { CartViewModel(cartRepository) }
    }

    fun checkout(
        accountsRepository: AccountsRepository,
        ordersRepository: OrdersRepository,
    ): ViewModelProvider.Factory = viewModelFactory {
        initializer { CheckoutViewModel(accountsRepository, ordersRepository) }
    }

    fun orders(ordersRepository: OrdersRepository): ViewModelProvider.Factory = viewModelFactory {
        initializer { OrdersViewModel(ordersRepository) }
    }

    fun orderDetail(
        ordersRepository: OrdersRepository,
        orderId: String,
    ): ViewModelProvider.Factory = viewModelFactory {
        initializer { OrderDetailViewModel(ordersRepository, orderId) }
    }
}
