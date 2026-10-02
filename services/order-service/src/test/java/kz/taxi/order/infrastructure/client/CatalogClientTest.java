package kz.taxi.order.infrastructure.client;

import com.fasterxml.jackson.databind.json.JsonMapper;
import com.fasterxml.jackson.datatype.jsr310.JavaTimeModule;
import kz.taxi.common.core.error.DomainException;
import kz.taxi.order.domain.OrderErrorCode;
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

import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.jsonPath;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.method;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.requestTo;
import static org.springframework.test.web.client.response.MockRestResponseCreators.withStatus;
import static org.springframework.test.web.client.response.MockRestResponseCreators.withSuccess;

/**
 * How a catalog answer becomes this service's error code.
 *
 * <p>This mapping is the difference between "cancel the order because the goods are
 * gone" and "leave the order alone because we do not know". Getting it wrong in the
 * permissive direction charges customers for nothing; getting it wrong in the strict
 * direction cancels sellable orders. Both are tested.
 */
class CatalogClientTest {

    private static final String BASE_URL = "http://catalog.test";

    private MockRestServiceServer server;
    private CatalogClient client;

    @BeforeEach
    void setUp() {
        RestClient.Builder builder = RestClient.builder().baseUrl(BASE_URL);
        server = MockRestServiceServer.bindTo(builder).build();
        client = new CatalogClient(builder.build(),
                new DownstreamErrors(JsonMapper.builder().addModule(new JavaTimeModule()).build()));
    }

    @Test
    @DisplayName("a reservation is keyed by the order id and returns the quoted total")
    void reservesStock() {
        server.expect(requestTo(BASE_URL + "/api/v1/catalog/internal/stock/reservations"))
                .andExpect(method(HttpMethod.POST))
                .andExpect(jsonPath("$.orderId").value("order-1"))
                .andExpect(jsonPath("$.items[0].productId").value("product-1"))
                .andExpect(jsonPath("$.items[0].quantity").value(2))
                .andRespond(withStatus(HttpStatus.CREATED).contentType(MediaType.APPLICATION_JSON)
                        .body("""
                                {"orderId":"order-1","status":"ACTIVE","currency":"KZT","subtotalMinor":10000,
                                 "expiresAt":"2030-01-01T00:00:00Z",
                                 "items":[{"productId":"product-1","merchantId":"merchant-1","title":"Title",
                                 "quantity":2,"unitPriceMinor":5000,"lineTotalMinor":10000,"currency":"KZT"}]}
                                """));

        CatalogDtos.Reservation reservation = client.reserve("order-1",
                List.of(new CatalogDtos.ReserveStockItem("product-1", 2)));

        assertThat(reservation.subtotalMinor()).isEqualTo(10_000L);
        assertThat(reservation.currency()).isEqualTo("KZT");
        server.verify();
    }

    @Test
    @DisplayName("INSUFFICIENT_STOCK is a business refusal, not an incident")
    void mapsInsufficientStockToAProductRefusal() {
        server.expect(requestTo(BASE_URL + "/api/v1/catalog/internal/stock/reservations"))
                .andRespond(withStatus(HttpStatus.CONFLICT).contentType(MediaType.APPLICATION_PROBLEM_JSON)
                        .body("""
                                {"type":"about:blank","title":"Conflict","status":409,
                                 "detail":"only 1 of the 2 are left","code":"INSUFFICIENT_STOCK"}
                                """));

        assertThatThrownBy(() -> client.reserve("order-1", List.of(new CatalogDtos.ReserveStockItem("p", 2))))
                .isInstanceOf(DomainException.class)
                .extracting(failure -> ((DomainException) failure).errorCode())
                .isEqualTo(OrderErrorCode.PRODUCT_UNAVAILABLE);
    }

    @Test
    @DisplayName("a mixed-currency cart is refused the same way")
    void mapsMixedCurrenciesToAProductRefusal() {
        server.expect(requestTo(BASE_URL + "/api/v1/catalog/internal/stock/reservations"))
                .andRespond(withStatus(HttpStatus.BAD_REQUEST).contentType(MediaType.APPLICATION_PROBLEM_JSON)
                        .body("{\"status\":400,\"detail\":\"two currencies\",\"code\":\"MIXED_CURRENCIES\"}"));

        assertThatThrownBy(() -> client.reserve("order-1", List.of(new CatalogDtos.ReserveStockItem("p", 1))))
                .isInstanceOf(DomainException.class)
                .extracting(failure -> ((DomainException) failure).errorCode())
                .isEqualTo(OrderErrorCode.PRODUCT_UNAVAILABLE);
    }

    @Test
    @DisplayName("an unrecognised code is an incident: the order must not be cancelled on it")
    void unknownCodeIsNotARefusal() {
        server.expect(requestTo(BASE_URL + "/api/v1/catalog/internal/stock/reservations"))
                .andRespond(withStatus(HttpStatus.CONFLICT).contentType(MediaType.APPLICATION_PROBLEM_JSON)
                        .body("{\"status\":409,\"detail\":\"who knows\",\"code\":\"SOMETHING_NEW\"}"));

        assertThatThrownBy(() -> client.reserve("order-1", List.of(new CatalogDtos.ReserveStockItem("p", 1))))
                .isInstanceOf(DomainException.class)
                .extracting(failure -> ((DomainException) failure).errorCode())
                .isEqualTo(OrderErrorCode.CATALOG_ERROR);
    }

    @Test
    @DisplayName("a 5xx from the catalog is an incident")
    void mapsServerErrorToACatalogError() {
        server.expect(requestTo(BASE_URL + "/api/v1/catalog/internal/stock/reservations"))
                .andRespond(withStatus(HttpStatus.INTERNAL_SERVER_ERROR).contentType(MediaType.APPLICATION_JSON)
                        .body("{\"code\":\"INTERNAL_ERROR\"}"));

        assertThatThrownBy(() -> client.reserve("order-1", List.of(new CatalogDtos.ReserveStockItem("p", 1))))
                .isInstanceOf(DomainException.class)
                .extracting(failure -> ((DomainException) failure).errorCode())
                .isEqualTo(OrderErrorCode.CATALOG_ERROR);
    }

    @Test
    @DisplayName("a timeout means the outcome is unknown, never 'nothing happened'")
    void mapsTimeoutToDownstreamUnavailable() {
        CatalogClient timedOut = new CatalogClient(
                RestClient.builder().baseUrl(BASE_URL).requestFactory(alwaysTimesOut()).build(),
                new DownstreamErrors(new com.fasterxml.jackson.databind.ObjectMapper()));

        assertThatThrownBy(() -> timedOut.reserve("order-1", List.of(new CatalogDtos.ReserveStockItem("p", 1))))
                .isInstanceOf(DomainException.class)
                .extracting(failure -> ((DomainException) failure).errorCode())
                .isEqualTo(OrderErrorCode.DOWNSTREAM_UNAVAILABLE);
    }

    @Test
    @DisplayName("releasing a reservation that does not exist is a no-op, so a compensation can be retried")
    void releaseOfAMissingReservationIsFine() {
        server.expect(requestTo(BASE_URL + "/api/v1/catalog/internal/stock/reservations/order-1/release"))
                .andRespond(withStatus(HttpStatus.NOT_FOUND).contentType(MediaType.APPLICATION_PROBLEM_JSON)
                        .body("{\"status\":404,\"code\":\"RESERVATION_NOT_FOUND\"}"));

        client.release("order-1", "cancelled");

        server.verify();
    }

    @Test
    @DisplayName("committing a reservation that does not exist is a no-op too")
    void commitOfAMissingReservationIsFine() {
        server.expect(requestTo(BASE_URL + "/api/v1/catalog/internal/stock/reservations/order-1/commit"))
                .andRespond(withStatus(HttpStatus.NOT_FOUND).contentType(MediaType.APPLICATION_PROBLEM_JSON)
                        .body("{\"status\":404,\"code\":\"RESERVATION_NOT_FOUND\"}"));

        client.commit("order-1");

        server.verify();
    }

    @Test
    @DisplayName("an unknown product is, from the customer's point of view, an unavailable product")
    void mapsUnknownProductToAProductRefusal() {
        server.expect(requestTo(BASE_URL + "/api/v1/catalog/internal/products/product-9"))
                .andRespond(withStatus(HttpStatus.NOT_FOUND).contentType(MediaType.APPLICATION_PROBLEM_JSON)
                        .body("{\"status\":404,\"code\":\"PRODUCT_NOT_FOUND\"}"));

        assertThatThrownBy(() -> client.getProduct("product-9"))
                .isInstanceOf(DomainException.class)
                .extracting(failure -> ((DomainException) failure).errorCode())
                .isEqualTo(OrderErrorCode.PRODUCT_UNAVAILABLE);
    }

    @Test
    @DisplayName("the product card is read for its sellable status and quantity")
    void readsTheInternalProduct() {
        server.expect(requestTo(BASE_URL + "/api/v1/catalog/internal/products/product-1"))
                .andRespond(withSuccess("""
                        {"id":"product-1","merchantId":"merchant-1","title":"Phone","priceMinor":129990,
                         "currency":"KZT","status":"ACTIVE","availableQuantity":7}
                        """, MediaType.APPLICATION_JSON));

        CatalogDtos.InternalProduct product = client.getProduct("product-1");

        assertThat(product.priceMinor()).isEqualTo(129_990L);
        assertThat(product.status()).isEqualTo("ACTIVE");
        assertThat(product.availableQuantity()).isEqualTo(7);
    }

    @Test
    @DisplayName("a missing image never fails a cart operation")
    void imageLookupIsBestEffort() {
        server.expect(requestTo(BASE_URL + "/api/v1/catalog/products/product-1"))
                .andRespond(withStatus(HttpStatus.NOT_FOUND));

        assertThat(client.imageUrlOf("product-1")).isNull();
    }

    /** A request factory that always fails the way a read timeout does. */
    private static ClientHttpRequestFactory alwaysTimesOut() {
        return (uri, httpMethod) -> {
            throw new ResourceAccessException("read timed out");
        };
    }
}
