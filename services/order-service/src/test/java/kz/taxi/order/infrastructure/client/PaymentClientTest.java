package kz.taxi.order.infrastructure.client;

import com.fasterxml.jackson.databind.json.JsonMapper;
import com.fasterxml.jackson.datatype.jsr310.JavaTimeModule;
import kz.taxi.common.core.error.DomainException;
import kz.taxi.order.domain.OrderErrorCode;
import kz.taxi.order.domain.PaymentOutcome;
import kz.taxi.order.domain.PaymentStatus;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpMethod;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.client.ClientHttpRequestFactory;
import org.springframework.test.web.client.MockRestServiceServer;
import org.springframework.web.client.ResourceAccessException;
import org.springframework.web.client.RestClient;

import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.header;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.headerDoesNotExist;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.jsonPath;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.method;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.requestTo;
import static org.springframework.test.web.client.response.MockRestResponseCreators.withStatus;
import static org.springframework.test.web.client.response.MockRestResponseCreators.withSuccess;

/**
 * The payment contract, as this service depends on it.
 *
 * <p>Three outcomes have to be told apart, because each one leads to a different
 * decision: a refusal (cancel the order), an indeterminate answer (leave it
 * pending) and a completed payment (settle it). The tests also pin the two headers
 * this client must and must not send.
 */
class PaymentClientTest {

    private static final String BASE_URL = "http://payment.test";
    private static final String PAYMENT_BODY = """
            {"paymentId":"payment-1","paymentNumber":"PAY-000001","type":"MERCHANT","status":"COMPLETED",
             "ownerUserId":"user-1","amountMinor":10000,"feeMinor":250,"totalMinor":10250,"currency":"KZT",
             "sourceAccountId":"account-1","targetAccountId":"merchant-account","merchantId":"merchant-1",
             "orderId":"order-1","failureCode":null,"failureReason":null,
             "createdAt":"2030-01-01T00:00:00Z","completedAt":"2030-01-01T00:00:01Z"}
            """;
    private static final String MERCHANT_PAYMENT_KEY = "ORD-order-1-PAY-merchant-1";

    private MockRestServiceServer server;
    private PaymentClient client;

    @BeforeEach
    void setUp() {
        RestClient.Builder builder = RestClient.builder().baseUrl(BASE_URL);
        server = MockRestServiceServer.bindTo(builder).build();
        client = new PaymentClient(builder.build(),
                new DownstreamErrors(JsonMapper.builder().addModule(new JavaTimeModule()).build()));
    }

    @Test
    @DisplayName("a completed charge is recognised, with its amount, its platform fee and the currency")
    void chargesTheCustomer() {
        server.expect(requestTo(BASE_URL + "/api/v1/payments/merchant"))
                .andExpect(method(HttpMethod.POST))
                .andExpect(header("Idempotency-Key", MERCHANT_PAYMENT_KEY))
                // Identity travels through the platform's outbound interceptor, never
                // through headers set by a client class.
                .andExpect(headerDoesNotExist("Authorization"))
                .andExpect(jsonPath("$.sourceAccountId").value("account-1"))
                .andExpect(jsonPath("$.merchantId").value("merchant-1"))
                .andExpect(jsonPath("$.amountMinor").value(10000))
                .andExpect(jsonPath("$.orderId").value("order-1"))
                .andRespond(withStatus(HttpStatus.CREATED).contentType(MediaType.APPLICATION_JSON).body(PAYMENT_BODY));

        PaymentOutcome outcome = client.createMerchantPayment(
                PaymentClient.merchantPayment("account-1", "merchant-1", 10_000L, "KZT", "Order ORD-1", "order-1"),
                MERCHANT_PAYMENT_KEY);

        assertThat(outcome.status()).isEqualTo(PaymentStatus.COMPLETED);
        assertThat(outcome.paymentId()).isEqualTo("payment-1");
        assertThat(outcome.amountMinor()).isEqualTo(10_000L);
        assertThat(outcome.currency()).isEqualTo("KZT");
        // What the payer was debited: the amount plus the fee the payment service
        // computed. This service never derives it.
        assertThat(outcome.feeMinor()).isEqualTo(250L);
        assertThat(outcome.totalMinor()).isEqualTo(10_250L);
        server.verify();
    }

    @Test
    @DisplayName("a refusal is a FAILED outcome, not an exception: the saga cancels on it")
    void answersARejectionWithADeclinedOutcome() {
        server.expect(requestTo(BASE_URL + "/api/v1/payments/merchant"))
                .andRespond(withStatus(HttpStatus.UNPROCESSABLE_ENTITY)
                        .contentType(MediaType.APPLICATION_PROBLEM_JSON)
                        .body("""
                                {"status":422,"title":"Unprocessable","detail":"not enough money",
                                 "code":"INSUFFICIENT_FUNDS"}
                                """));

        PaymentOutcome outcome = client.createMerchantPayment(
                PaymentClient.merchantPayment("account-1", "merchant-1", 10_000L, "KZT", "Order ORD-1", "order-1"),
                MERCHANT_PAYMENT_KEY);

        assertThat(outcome.status()).isEqualTo(PaymentStatus.FAILED);
        assertThat(outcome.failureCode()).isEqualTo("INSUFFICIENT_FUNDS");
        assertThat(outcome.failureReason()).contains("not enough money");
    }

    @Test
    @DisplayName("a 5xx does not become a decline: money may have moved")
    void mapsServerErrorToAnError() {
        server.expect(requestTo(BASE_URL + "/api/v1/payments/merchant"))
                .andRespond(withStatus(HttpStatus.INTERNAL_SERVER_ERROR)
                        .contentType(MediaType.APPLICATION_JSON).body("{\"code\":\"INTERNAL_ERROR\"}"));

        assertThatThrownBy(() -> client.createMerchantPayment(
                PaymentClient.merchantPayment("account-1", "merchant-1", 10_000L, "KZT", "Order ORD-1", "order-1"),
                MERCHANT_PAYMENT_KEY))
                .isInstanceOf(DomainException.class)
                .extracting(failure -> ((DomainException) failure).errorCode())
                .isEqualTo(OrderErrorCode.PAYMENT_SERVICE_ERROR);
    }

    @Test
    @DisplayName("a conflict on our idempotency key means an earlier attempt exists: unknown, never declined")
    void mapsIdempotencyConflictToAnUnknownOutcome() {
        server.expect(requestTo(BASE_URL + "/api/v1/payments/merchant"))
                .andRespond(withStatus(HttpStatus.CONFLICT).contentType(MediaType.APPLICATION_PROBLEM_JSON)
                        .body("{\"status\":409,\"code\":\"IDEMPOTENCY_CONFLICT\"}"));

        assertThatThrownBy(() -> client.createMerchantPayment(
                PaymentClient.merchantPayment("account-1", "merchant-1", 10_000L, "KZT", "Order ORD-1", "order-1"),
                MERCHANT_PAYMENT_KEY))
                .isInstanceOf(DomainException.class)
                .extracting(failure -> ((DomainException) failure).errorCode())
                .isEqualTo(OrderErrorCode.PAYMENT_SERVICE_ERROR);
    }

    @Test
    @DisplayName("a timeout throws, so the order is left pending for the reconciliation path")
    void mapsTimeoutToAnUnknownOutcome() {
        PaymentClient timedOut = new PaymentClient(
                RestClient.builder().baseUrl(BASE_URL).requestFactory(alwaysTimesOut()).build(),
                new DownstreamErrors(new com.fasterxml.jackson.databind.ObjectMapper()));

        assertThatThrownBy(() -> timedOut.createMerchantPayment(
                PaymentClient.merchantPayment("account-1", "merchant-1", 10_000L, "KZT", "Order ORD-1", "order-1"),
                MERCHANT_PAYMENT_KEY))
                .isInstanceOf(DomainException.class)
                .extracting(failure -> ((DomainException) failure).errorCode())
                .isEqualTo(OrderErrorCode.DOWNSTREAM_UNAVAILABLE);
    }

    @Test
    @DisplayName("the payment of an order is read by order id")
    void readsThePaymentOfAnOrder() {
        server.expect(requestTo(BASE_URL + "/api/v1/payments/by-order/order-1"))
                .andExpect(method(HttpMethod.GET))
                .andRespond(withSuccess(PAYMENT_BODY, MediaType.APPLICATION_JSON));

        Optional<PaymentOutcome> outcome = client.findByOrderId("order-1");

        assertThat(outcome).isPresent();
        assertThat(outcome.orElseThrow().status()).isEqualTo(PaymentStatus.COMPLETED);
    }

    @Test
    @DisplayName("an order that was never charged answers 404, which is an empty outcome and not an error")
    void mapsMissingPaymentToEmpty() {
        server.expect(requestTo(BASE_URL + "/api/v1/payments/by-order/order-1"))
                .andRespond(withStatus(HttpStatus.NOT_FOUND));

        assertThat(client.findByOrderId("order-1")).isEmpty();
    }

    @Test
    @DisplayName("an authorization problem is an error, never 'there is no payment'")
    void mapsForbiddenLookupToAnError() {
        server.expect(requestTo(BASE_URL + "/api/v1/payments/order-1"))
                .andRespond(withStatus(HttpStatus.FORBIDDEN).contentType(MediaType.APPLICATION_PROBLEM_JSON)
                        .body("{\"status\":403,\"code\":\"FORBIDDEN\"}"));

        assertThatThrownBy(() -> client.findByPaymentId("order-1"))
                .isInstanceOf(DomainException.class)
                .extracting(failure -> ((DomainException) failure).errorCode())
                .isEqualTo(OrderErrorCode.PAYMENT_SERVICE_ERROR);
    }

    @Test
    @DisplayName("an unrecognised status becomes UNKNOWN, which stops the saga from deciding")
    void unknownStatusStopsTheSaga() {
        server.expect(requestTo(BASE_URL + "/api/v1/payments/merchant"))
                .andRespond(withStatus(HttpStatus.CREATED).contentType(MediaType.APPLICATION_JSON)
                        .body(PAYMENT_BODY.replace("\"COMPLETED\"", "\"PROCESSING\"")));

        PaymentOutcome outcome = client.createMerchantPayment(
                PaymentClient.merchantPayment("account-1", "merchant-1", 10_000L, "KZT", "Order ORD-1", "order-1"),
                MERCHANT_PAYMENT_KEY);

        assertThat(outcome.status()).isEqualTo(PaymentStatus.UNKNOWN);
    }

    @Test
    @DisplayName("a refund is keyed by the order, so a retried cancellation refunds once")
    void refundsWithADerivedKey() {
        server.expect(requestTo(BASE_URL + "/api/v1/payments/payment-1/refund"))
                .andExpect(method(HttpMethod.POST))
                .andExpect(header("Idempotency-Key", "ORD-order-1-REFUND"))
                .andExpect(jsonPath("$.reason").value("cancelled by the customer"))
                .andRespond(withSuccess("{}", MediaType.APPLICATION_JSON));

        client.refund("payment-1", "cancelled by the customer", "ORD-order-1-REFUND");

        server.verify();
    }

    @Test
    @DisplayName("a refused refund is an error, and the caller must not cancel the order")
    void refundFailureIsAnError() {
        server.expect(requestTo(BASE_URL + "/api/v1/payments/payment-1/refund"))
                .andRespond(withStatus(HttpStatus.CONFLICT).contentType(MediaType.APPLICATION_PROBLEM_JSON)
                        .body("{\"status\":409,\"code\":\"PAYMENT_NOT_REFUNDABLE\"}"));

        assertThatThrownBy(() -> client.refund("payment-1", "later", "ORD-order-1-REFUND"))
                .isInstanceOf(DomainException.class)
                .extracting(failure -> ((DomainException) failure).errorCode())
                .isEqualTo(OrderErrorCode.PAYMENT_SERVICE_ERROR);
    }

    /** A request factory that always fails the way a read timeout does. */
    private static ClientHttpRequestFactory alwaysTimesOut() {
        return (uri, httpMethod) -> {
            throw new ResourceAccessException("read timed out");
        };
    }
}
