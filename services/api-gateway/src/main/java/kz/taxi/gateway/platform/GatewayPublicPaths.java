package kz.taxi.gateway.platform;

import org.springframework.http.HttpMethod;

import java.util.List;

/**
 * Paths a visitor may call without a token, in one place.
 *
 * <p>They were listed directly in {@link kz.taxi.gateway.config.GatewaySecurityConfig},
 * which was fine while only the security chain needed them. Now they are also part of the
 * answer to "what can my client do before login" — and a client that learns the list from
 * a second, hand-written copy would, sooner or later, learn it wrong. One list, used by the
 * edge and published at {@code /api/v1/config}.
 *
 * <p>What is deliberately narrow: browsing is anonymous, acting is not. Catalogue and price
 * lists are public; ordering a ride, taking a slot or paying is a token and a role.
 */
public final class GatewayPublicPaths {

    /** Browsing the marketplace catalogue (`GET` only). */
    public static final String MARKET_CATALOGUE = "/api/v1/catalog/products/**";
    public static final String MARKET_CATEGORIES = "/api/v1/catalog/categories";
    public static final String MERCHANT_CARD = "/api/v1/merchants/*";

    /** Browsing the QTime catalogue (`GET` only): a person sees free windows, then registers. */
    public static final String QTIME_COMPANIES = "/api/v1/qtime/companies/**";
    public static final String QTIME_SPECIALISTS = "/api/v1/qtime/specialists/**";

    /** The taxi price list: a client shows prices before it has a token. */
    public static final String TAXI_TARIFFS = "/api/v1/trips/tariffs";

    /** Payment methods and their availability. */
    public static final String PAYMENT_METHODS = "/api/v1/payments/methods";

    /** The client configuration itself. */
    public static final String PLATFORM_CONFIG = "/api/v1/config";

    /** What the security chain permits with {@link HttpMethod#GET} for everybody. */
    public static final List<String> ANONYMOUS_GET = List.of(
            MARKET_CATALOGUE,
            MARKET_CATEGORIES,
            MERCHANT_CARD,
            QTIME_COMPANIES,
            QTIME_SPECIALISTS,
            TAXI_TARIFFS,
            PAYMENT_METHODS,
            PLATFORM_CONFIG);

    private GatewayPublicPaths() {
    }
}
