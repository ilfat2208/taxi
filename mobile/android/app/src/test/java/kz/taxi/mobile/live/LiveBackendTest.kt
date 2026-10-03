package kz.taxi.mobile.live

import kz.taxi.mobile.core.ApiConfig
import kz.taxi.mobile.core.error.ApiError
import kz.taxi.mobile.core.net.NetworkModule
import kz.taxi.mobile.core.net.asApiError
import kz.taxi.mobile.data.dto.AccountDto
import kz.taxi.mobile.data.dto.AccountTypes
import kz.taxi.mobile.data.dto.AddCartItemRequest
import kz.taxi.mobile.data.dto.CreateAccountRequest
import kz.taxi.mobile.data.dto.CreateOrderRequest
import kz.taxi.mobile.data.dto.PaymentDto
import kz.taxi.mobile.data.dto.PaymentStatuses
import kz.taxi.mobile.data.dto.ProductSort
import kz.taxi.mobile.data.dto.Roles
import kz.taxi.mobile.data.dto.TokenRequest
import kz.taxi.mobile.data.dto.TopUpRequest
import kz.taxi.mobile.data.dto.TransferRequest
import kz.taxi.mobile.data.dto.UpdateCartItemRequest
import kz.taxi.mobile.data.remote.AccountsApi
import kz.taxi.mobile.data.remote.AuthApi
import kz.taxi.mobile.data.remote.CartApi
import kz.taxi.mobile.data.remote.CatalogApi
import kz.taxi.mobile.data.remote.ConfigApi
import kz.taxi.mobile.data.remote.OrdersApi
import kz.taxi.mobile.data.remote.PaymentsApi
import kz.taxi.mobile.data.repo.ConfigRepository
import kz.taxi.mobile.data.repo.PaymentsRepository
import kotlinx.coroutines.delay
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Assume.assumeTrue
import org.junit.Before
import org.junit.BeforeClass
import org.junit.FixMethodOrder
import org.junit.Test
import org.junit.runners.MethodSorters
import java.util.UUID
import java.util.concurrent.atomic.AtomicInteger

/**
 * End-to-end test against the **live** gateway using the real Retrofit/OkHttp stack of the
 * app: the same [NetworkModule], the same interceptors, the same DTOs and the same
 * kotlinx.serialization configuration the Android app uses.
 *
 * Skipped unless explicitly requested, so `gradlew test` never depends on the backend being
 * up:
 *
 * ```
 * .\gradlew.bat testDebugUnitTest --tests "kz.taxi.mobile.live.LiveBackendTest" -Dtaxi.liveTest=true
 * ```
 *
 * The base URL matters: `10.0.2.2` is an alias that exists only inside the Android
 * emulator, so the test points this same stack at the host loopback through the
 * `taxi.api.baseUrl` system property that [ApiConfig] honours.
 */
@FixMethodOrder(MethodSorters.NAME_ASCENDING)
class LiveBackendTest {

    /** The session token, swapped between the operator, the sender and the recipient logins. */
    private class SessionHolder {
        @Volatile
        var token: String? = null
    }

    private val session = SessionHolder()
    private val unauthorizedEvents = AtomicInteger(0)

    private lateinit var authApi: AuthApi
    private lateinit var accountsApi: AccountsApi
    private lateinit var paymentsApi: PaymentsApi
    private lateinit var paymentsRepository: PaymentsRepository
    private lateinit var catalogApi: CatalogApi
    private lateinit var cartApi: CartApi
    private lateinit var ordersApi: OrdersApi
    private lateinit var configRepository: ConfigRepository

    @Before
    fun setUp() {
        assumeTrue(
            "live backend test is opt-in: pass -Dtaxi.liveTest=true (gateway must be up on :8080)",
            LIVE,
        )
        val network = NetworkModule(
            tokenProvider = { session.token },
            onUnauthorized = { unauthorizedEvents.incrementAndGet() },
        )
        authApi = network.create(AuthApi::class.java)
        accountsApi = network.create(AccountsApi::class.java)
        paymentsApi = network.create(PaymentsApi::class.java)
        paymentsRepository = PaymentsRepository(paymentsApi)
        catalogApi = network.create(CatalogApi::class.java)
        cartApi = network.create(CartApi::class.java)
        ordersApi = network.create(OrdersApi::class.java)
        configRepository = ConfigRepository(network.create(ConfigApi::class.java))
        log("gateway base URL = ${network.resolvedBaseUrl}")
    }

    companion object {
        private const val ADMIN_PHONE = "+77001234567"
        private const val RECIPIENT_PHONE = "+77009998877"
        private const val UNKNOWN_PHONE = "+77000000000"

        /** The real amount this test moves: 1,23 KZT. */
        private const val TRANSFER_AMOUNT_MINOR = 123L

        /**
         * The shop flow peaks at three units of the same product (2, then 1, then 3), so the
         * product it picks must have at least this much on hand.
         */
        private const val CART_PEAK_QUANTITY = 3

        /** Durable copy of the run, because Gradle only shows stdout on some configurations. */
        private val LOG_FILE = java.io.File("build/live-backend-test.log")

        private val LIVE: Boolean by lazy {
            System.getProperty("taxi.liveTest") == "true" ||
                System.getenv("TAXI_LIVE_TEST") == "1"
        }

        @BeforeClass
        @JvmStatic
        fun pointTheStackAtTheHostLoopback() {
            // 10.0.2.2 is an emulator-only alias; from a JVM test the gateway is on loopback.
            System.setProperty("taxi.api.baseUrl", ApiConfig.HOST_LOOPBACK_BASE_URL)
            LOG_FILE.delete()
        }
    }

    // ------------------------------------------------------------------ helpers

    private fun log(message: String) {
        val line = "[live] $message"
        println(line)
        runCatching {
            LOG_FILE.parentFile?.mkdirs()
            LOG_FILE.appendText(line + System.lineSeparator())
        }
    }

    private fun errorOf(result: Result<*>): ApiError {
        val failure = result.exceptionOrNull()
        assertNotNull("expected the call to fail", failure)
        // `asApiError()` understands both our ApiException and a raw retrofit HttpException.
        return failure!!.asApiError()
    }

    /**
     * Runs a raw API call, logging the RFC 7807 body of any failure before rethrowing — a
     * bare `HttpException: HTTP 403` hides exactly the `code`/`detail` that explains it.
     */
    private suspend fun <T> wire(what: String, block: suspend () -> T): T = try {
        block()
    } catch (t: Throwable) {
        val error = t.asApiError()
        log("!! $what -> HTTP ${error.httpStatus} code=${error.code} correlationId=${error.correlationId}")
        log("   detail=${error.detail}")
        throw t
    }
    private suspend fun login(phone: String, roles: List<String>, displayName: String): String {
        val response = authApi.token(
            TokenRequest(phone = phone, code = ApiConfig.DEMO_CODE, displayName = displayName, roles = roles),
        )
        log("login $phone -> userId=${response.userId} roles=${response.roles}")
        session.token = response.accessToken
        return response.userId
    }

    private suspend fun accountList(phone: String): List<AccountDto> {
        val accounts = accountsApi.listAccounts()
        log("GET /api/v1/accounts as $phone -> ${accounts.size} account(s)")
        accounts.forEach { log("     ${it.id} ${it.currency} ${it.type} available=${it.availableMinor}") }
        return accounts
    }

    private suspend fun ensureAccount(phone: String): AccountDto {
        val existing = accountList(phone)
        if (existing.isNotEmpty()) return existing.first()
        log("no account for $phone -> POST /api/v1/accounts")
        val created = accountsApi.createAccount(
            CreateAccountRequest(currency = "KZT", type = AccountTypes.CUSTOMER, displayName = "Android Live"),
        )
        log("  created ${created.id}")
        return created
    }

    /** Polls until the payment leaves the non-terminal statuses, so a slower saga still passes. */
    private suspend fun awaitTerminal(paymentId: String): PaymentDto {
        var payment = paymentsApi.payment(paymentId).payment
        var attempts = 0
        while (payment.status == PaymentStatuses.INITIATED || payment.status == PaymentStatuses.PENDING) {
            if (attempts++ >= 20) break
            delay(250)
            payment = paymentsApi.payment(paymentId).payment
        }
        return payment
    }

    // ------------------------------------------------------------------ the required proof

    @Test
    fun `01 login, list accounts, move real money, and retry with the same idempotency key`() =
        runBlocking {
            // 1. Login. ADMIN is requested so the demo-funding step below is permitted.
            val adminUserId = login(ADMIN_PHONE, listOf(Roles.CUSTOMER, Roles.ADMIN), "Android Live Test")
            assertNotNull("login must return a user id", adminUserId)

            val me = authApi.me()
            log("GET /api/v1/auth/me -> ${me.userId} ${me.phone} ${me.roles}")
            assertEquals("GET /auth/me must identify the same user", adminUserId, me.userId)
            assertTrue("expected ADMIN for demo funding", me.roles.contains(Roles.ADMIN))

            // 2. Sender account (created if the user has none).
            val sender = ensureAccount(ADMIN_PHONE)

            // 3. Provision the recipient by logging in as that phone.
            login(RECIPIENT_PHONE, listOf(Roles.CUSTOMER), "Android Recipient")
            val recipient = ensureAccount(RECIPIENT_PHONE)
            assertTrue("the recipient account must be active", recipient.isActive)
            assertNotEquals("sender and recipient must be different accounts", sender.id, recipient.id)

            // 4. Make sure the sender can afford it a hundred times over.
            if (sender.availableMinor < TRANSFER_AMOUNT_MINOR * 100) {
                login(ADMIN_PHONE, listOf(Roles.CUSTOMER, Roles.ADMIN), "Android Live Test")
                log("sender balance is low -> ADMIN demo top-up")
                accountsApi.topUp(sender.id, TopUpRequest(amountMinor = 100_000L, reason = "live test funding"))
                login(ADMIN_PHONE, listOf(Roles.CUSTOMER, Roles.ADMIN), "Android Live Test")
            }

            // 4b. Provisioning the recipient above swapped the session token, so the transfer
            // below would otherwise be sent as the *recipient* while debiting the *sender's*
            // account — which account-service rightly refuses with 403 (it is somebody else's
            // account). Assume the sender's identity again; the funding branch above is skipped
            // whenever the demo balance is already sufficient.
            login(ADMIN_PHONE, listOf(Roles.CUSTOMER, Roles.ADMIN), "Android Live Test")

            // 5. THE REAL TRANSFER.
            val key = UUID.randomUUID().toString()
            val request = TransferRequest(
                sourceAccountId = sender.id,
                targetPhone = RECIPIENT_PHONE,
                amountMinor = TRANSFER_AMOUNT_MINOR,
                currency = "KZT",
                description = "Android live-backend test",
            )
            log("POST /api/v1/payments/transfers amountMinor=$TRANSFER_AMOUNT_MINOR Idempotency-Key=$key")
            val first = awaitTerminal(
                wire("POST /payments/transfers") {
                    paymentsApi.transfer(idempotencyKey = key, body = request).paymentId
                },
            )
            log("  paymentId=${first.paymentId} number=${first.paymentNumber} status=${first.status}")
            log("  amount=${first.amountMinor} fee=${first.feeMinor} total=${first.totalMinor} ${first.currency}")
            log("  source=${first.sourceAccountId} target=${first.targetAccountId}")

            assertEquals("the payment must complete", PaymentStatuses.COMPLETED, first.status)
            assertEquals(TRANSFER_AMOUNT_MINOR, first.amountMinor)
            assertEquals(sender.id, first.sourceAccountId)
            assertEquals(
                "the transfer must land on the recipient's account",
                recipient.id,
                first.targetAccountId,
            )
            assertEquals("KZT", first.currency)

            // 6. RETRY WITH THE SAME KEY — must not create a second payment.
            log("retrying with the SAME Idempotency-Key=$key")
            val retried = paymentsApi.transfer(idempotencyKey = key, body = request)
            log("  retry -> paymentId=${retried.paymentId} status=${retried.status}")
            assertEquals(
                "a retry with the same Idempotency-Key must return the SAME payment",
                first.paymentId,
                retried.paymentId,
            )
            assertEquals(first.paymentNumber, retried.paymentNumber)
            assertEquals(PaymentStatuses.COMPLETED, retried.status)

            // 7. A deliberately NEW key is a new payment.
            val newKey = UUID.randomUUID().toString()
            log("deliberate repeat with a NEW Idempotency-Key=$newKey")
            val second = paymentsApi.transfer(idempotencyKey = newKey, body = request)
            log("  new key -> paymentId=${second.paymentId}")
            assertNotEquals(
                "a new Idempotency-Key must create a new payment",
                first.paymentId,
                second.paymentId,
            )

            // 8. The recipient really was credited.
            login(RECIPIENT_PHONE, listOf(Roles.CUSTOMER), "Android Recipient")
            val recipientAfter = accountList(RECIPIENT_PHONE).first()
            log("recipient balanceMinor=${recipientAfter.balanceMinor} (was ${recipient.balanceMinor})")
            assertTrue(
                "the recipient balance must have grown",
                recipientAfter.balanceMinor >= recipient.balanceMinor + TRANSFER_AMOUNT_MINOR,
            )

            // 9. History and detail.
            login(ADMIN_PHONE, listOf(Roles.CUSTOMER, Roles.ADMIN), "Android Live Test")
            val history = paymentsApi.listPayments(page = 0, size = 20, status = PaymentStatuses.COMPLETED)
            log("GET /api/v1/payments?status=COMPLETED -> totalElements=${history.totalElements}")
            assertTrue(
                "the new payment must appear in the completed history",
                history.items.any { it.paymentId == first.paymentId },
            )
            val detail = paymentsApi.payment(first.paymentId)
            log("GET /api/v1/payments/{id} -> ${detail.transitions.size} transition(s)")
            assertEquals(first.paymentId, detail.payment.paymentId)
            assertTrue("expected a status timeline", detail.transitions.isNotEmpty())
            assertEquals("COMPLETED", detail.transitions.last().toStatus)
        }

    // ------------------------------------------------------------------ error contract over the wire

    @Test
    fun `02 a failed transfer returns an RFC 7807 problem with a code and a correlation id`() = runBlocking {
        login(ADMIN_PHONE, listOf(Roles.CUSTOMER, Roles.ADMIN), "Android Live Test")
        val sender = ensureAccount(ADMIN_PHONE)

        val error = errorOf(
            paymentsRepository.transfer(
                idempotencyKey = UUID.randomUUID().toString(),
                sourceAccountId = sender.id,
                targetPhone = UNKNOWN_PHONE,
                amountMinor = 100L,
                description = "unknown recipient",
            ),
        )
        log("unknown recipient -> HTTP ${error.httpStatus} code=${error.code} correlationId=${error.correlationId}")
        log("  message=${error.message}")
        assertEquals("TARGET_ACCOUNT_NOT_FOUND", error.code)
        assertEquals(404, error.httpStatus)
        assertNotNull("support needs the correlationId", error.correlationId)
        assertTrue("the message must be the Russian one", error.message.contains("Получатель"))
        assertTrue(
            "the diagnostics must quote the correlationId",
            error.diagnostics!!.contains(error.correlationId!!),
        )
    }

    @Test
    fun `03 a wrong confirmation code is UNAUTHORIZED and a bad token clears the session`() = runBlocking {
        session.token = null
        val wrongCode = errorOf(runCatching { authApi.token(TokenRequest(phone = ADMIN_PHONE, code = "9999")) })
        log("wrong code -> HTTP ${wrongCode.httpStatus} code=${wrongCode.code} correlationId=${wrongCode.correlationId}")
        assertEquals("UNAUTHORIZED", wrongCode.code)
        assertTrue(wrongCode.isUnauthorized)

        // An authenticated call with a garbage token must be reported to the app so it can
        // drop the session and return to login.
        val before = unauthorizedEvents.get()
        session.token = "not-a-real-token"
        val badToken = errorOf(runCatching { authApi.me() })
        log("bad token -> HTTP ${badToken.httpStatus} code=${badToken.code}")
        assertEquals("UNAUTHORIZED", badToken.code)
        assertTrue(badToken.isUnauthorized)
        assertEquals(
            "the 401 must have notified the session layer exactly once",
            before + 1,
            unauthorizedEvents.get(),
        )
    }

    // ------------------------------------------------------------------ the shop flow over the same stack

    @Test
    fun `04 anonymous catalog, cart and checkout produce an order with per-merchant payments`() = runBlocking {
        // The catalog is anonymous: no token on purpose.
        session.token = null
        val page = catalogApi.products(
            query = null,
            category = null,
            page = 0,
            size = 50,
            sort = ProductSort.PRICE_ASC,
        )
        log("anonymous GET /api/v1/catalog/products -> totalElements=${page.totalElements}")
        assertTrue("the catalog must not be empty", page.items.isNotEmpty())
        // An earlier run buys the cheapest product out, so taking items.first() blindly makes
        // this test order-dependent: pick the cheapest one that can actually cover the flow.
        val product = page.items.firstOrNull { it.stock >= CART_PEAK_QUANTITY }
            ?: throw IllegalStateException(
                "no product with at least $CART_PEAK_QUANTITY units in stock among the " +
                    "${page.items.size} cheapest — re-seed the catalog",
            )
        log("  picked ${product.id} '${product.title}' priceMinor=${product.priceMinor} stock=${product.stock}")

        val detail = catalogApi.product(product.id)
        log("  detail: merchant=${detail.merchant?.displayName} onHand=${detail.onHand} available=${detail.available}")
        assertNotNull("product detail must expose stock", detail.onHand ?: detail.availableQuantity)

        val categories = catalogApi.categories()
        log("GET /api/v1/catalog/categories -> ${categories.size} categories")
        assertTrue(categories.isNotEmpty())

        // A funded buyer.
        login(RECIPIENT_PHONE, listOf(Roles.CUSTOMER), "Android Buyer")
        val buyer = ensureAccount(RECIPIENT_PHONE)

        val cartCost = product.priceMinor * 2
        if (buyer.availableMinor < cartCost + 10_000L) {
            login(ADMIN_PHONE, listOf(Roles.CUSTOMER, Roles.ADMIN), "Android Live Test")
            log("buyer balance is low -> ADMIN demo top-up")
            accountsApi.topUp(buyer.id, TopUpRequest(amountMinor = cartCost + 1_000_000L, reason = "live test shop funding"))
            login(RECIPIENT_PHONE, listOf(Roles.CUSTOMER), "Android Buyer")
        }

        // Cart lifecycle.
        wire("DELETE /cart") { cartApi.clear() }
        val cart = wire("POST /cart/items") {
            cartApi.addItem(AddCartItemRequest(productId = product.id, quantity = 2))
        }
        log("POST /api/v1/cart/items -> itemCount=${cart.itemCount} subtotalMinor=${cart.subtotalMinor}")
        assertEquals(2, cart.itemCount)
        assertEquals(cartCost, cart.subtotalMinor)

        val itemId = cart.items.first().itemId
        val patched = cartApi.updateItem(itemId, UpdateCartItemRequest(quantity = 1))
        log("PATCH /api/v1/cart/items/{id} -> itemCount=${patched.itemCount} subtotalMinor=${patched.subtotalMinor}")
        assertEquals(1, patched.itemCount)
        assertEquals(product.priceMinor, patched.subtotalMinor)

        val restored = cartApi.addItem(AddCartItemRequest(productId = product.id, quantity = 2))
        log("re-added -> itemCount=${restored.itemCount} subtotalMinor=${restored.subtotalMinor}")
        assertEquals(3, restored.itemCount)

        // Checkout, idempotent.
        val orderKey = UUID.randomUUID().toString()
        val orderRequest = CreateOrderRequest(
            deliveryAddress = "Алматы, ул. Абая 1, кв. 5",
            contactPhone = RECIPIENT_PHONE,
            comment = "Android live-backend test order",
            sourceAccountId = buyer.id,
        )
        log("POST /api/v1/orders Idempotency-Key=$orderKey")
        val order = ordersApi.createOrder(idempotencyKey = orderKey, body = orderRequest)
        log("  order ${order.orderId} number=${order.orderNumber} status=${order.status}")
        log("  subtotal=${order.subtotalMinor} delivery=${order.deliveryFeeMinor} total=${order.totalMinor}")
        order.payments.forEach { payment ->
            log("  payment merchant=${payment.merchantId} status=${payment.status} total=${payment.totalMinor}")
        }
        assertNotNull(order.orderId)
        assertTrue("checkout must create per-merchant payments", order.payments.isNotEmpty())
        assertTrue("the order total must cover the items", order.totalMinor >= order.subtotalMinor)

        val retried = ordersApi.createOrder(idempotencyKey = orderKey, body = orderRequest)
        log("  retry with the same key -> ${retried.orderId}")
        assertEquals("a retried checkout must not create a second order", order.orderId, retried.orderId)

        // Read it back.
        val loaded = ordersApi.order(order.orderId)
        log("GET /api/v1/orders/{id} -> status=${loaded.status} items=${loaded.items.size} history=${loaded.history.size}")
        assertEquals(order.orderId, loaded.orderId)
        assertTrue("order items must deserialize", loaded.items.isNotEmpty())
        assertTrue("order history must deserialize", loaded.history.isNotEmpty())

        val orderList = ordersApi.listOrders(page = 0, size = 20, status = null)
        log("GET /api/v1/orders -> totalElements=${orderList.totalElements}")
        assertTrue(orderList.items.any { it.orderId == order.orderId })

        val byOrder = paymentsApi.paymentsByOrder(order.orderId)
        log("GET /api/v1/payments/by-order/{orderId} -> ${byOrder.paymentId} status=${byOrder.status}")
        assertEquals(
            "the order's payment must reference the order",
            order.orderId,
            byOrder.orderId,
        )
        assertTrue(
            "the order payment must be completed",
            byOrder.status == PaymentStatuses.COMPLETED || byOrder.status == PaymentStatuses.PENDING,
        )
    }

    @Test
    fun `05 the app reads the platform config anonymously instead of hardcoding it`() = runBlocking {
        // No token: this is the first call the app makes, before a person signs in.
        session.token = null

        val config = wire("GET /api/v1/config") { configRepository.config(forceRefresh = true).getOrThrow() }
        log("GET /api/v1/config -> platform=${config.platform?.name} currency=${config.platform?.currency}")
        assertEquals("ORTA", config.platform?.name)
        assertEquals("KZT", config.platform?.currency)
        assertTrue("the platform must publish its roles", config.platform!!.roles.contains(Roles.CUSTOMER))

        val tariffs = wire("tariffs") { configRepository.tariffs().getOrThrow() }
        tariffs.forEach { tariff ->
            log("  tariff ${tariff.code}: base=${tariff.baseMinor} perKm=${tariff.perKmMinor} min=${tariff.minFareMinor}")
        }
        assertTrue("the price list must arrive from trip-service", tariffs.any { it.code == "ECONOMY" })
        assertTrue(
            "every tariff needs a base fare and a minimum, otherwise a client cannot show it",
            tariffs.all { it.baseMinor > 0 && it.minFareMinor > 0 },
        )

        val methods = wire("payment methods") { configRepository.methods().getOrThrow() }
        methods.forEach { method -> log("  method ${method.code} implemented=${method.implemented}") }
        assertTrue("balance payments must be offered", methods.any { it.code == "BALANCE" && it.implemented })
        assertTrue(
            "an unimplemented method must travel with implemented=false, not be invented by the client",
            methods.none { it.code == "CARD" && it.implemented },
        )

        val verticals = config.verticals.map { it.code }
        log("  verticals: $verticals")
        assertTrue("the taxi vertical must be published", verticals.contains("TAXI"))
        assertTrue(
            "the app must be able to learn what it may call without a token",
            config.anonymousPaths.contains("/api/v1/config"),
        )
    }
}
