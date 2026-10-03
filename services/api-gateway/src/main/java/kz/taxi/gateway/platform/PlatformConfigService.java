package kz.taxi.gateway.platform;

import kz.taxi.common.core.money.Currency;
import kz.taxi.common.security.Roles;
import kz.taxi.common.security.SecurityProperties;
import org.springframework.stereotype.Service;
import reactor.core.publisher.Mono;

import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * Assembles the configuration a client fetches once at startup.
 *
 * <p>Why this exists at all: all three reference apps (customer, courier, vendor) open with
 * one call to {@code /api/v1/config} and take from it everything that is a business
 * decision rather than a screen — price lists, payment methods, feature switches, what may
 * be called anonymously. Without it a client hardcodes today's truth and lies to the user
 * the moment the platform changes. ORTA had no such call: the web client knew the endpoints
 * it needed and the Android client hardcoded the demo phone and code.
 *
 * <p>Three rules the implementation follows, and they are the whole point of the endpoint:
 *
 * <ol>
 *   <li><b>Nothing invented.</b> Tariffs and payment methods are fetched from the services
 *       that own them; the platform's own facts (roles, currencies, token lifetime) are read
 *       from the same objects the gateway uses to enforce them.</li>
 *   <li><b>Partial answers beat failures.</b> If the tariff service is down, the response
 *       still carries payment methods, the version and the anonymous paths, and the tariff
 *       block says why it is missing. A client is never left with nothing because one of
 *       six services is slow.</li>
 *   <li><b>Unimplemented is declared, not hidden.</b> Card payments, push, websockets and
 *       localisation are listed as {@code false} with a reason: a client can render "скоро"
 *       instead of a button that goes nowhere.</li>
 * </ol>
 */
@Service
public class PlatformConfigService {

    private static final String API_VERSION = "v1";

    private final DownstreamJsonClient client;
    private final PlatformConfigProperties properties;
    private final SecurityProperties security;

    /** Assembled configuration reused for {@code cache-ttl}: a startup call must not be a stampede. */
    private volatile CachedConfig cache = CachedConfig.empty();

    public PlatformConfigService(DownstreamJsonClient client,
                                 PlatformConfigProperties properties,
                                 SecurityProperties security) {
        this.client = client;
        this.properties = properties;
        this.security = security;
    }

    public Mono<Map<String, Object>> config() {
        CachedConfig current = cache;
        if (current.isFresh(properties.cacheTtl())) {
            return Mono.just(current.body());
        }
        return assemble().doOnNext(body -> cache = new CachedConfig(body, Instant.now()));
    }

    private Mono<Map<String, Object>> assemble() {
        Mono<Map<String, Object>> tariffs = client
                .get(properties.tripServiceUrl(), "/api/v1/trips/tariffs")
                .map(body -> (Map<String, Object>) body)
                .defaultIfEmpty(Map.of())
                .map(body -> body.isEmpty() ? unavailable("trip-service не ответил: тарифы не опубликованы")
                        : available(body));

        Mono<Map<String, Object>> methods = client
                .get(properties.paymentServiceUrl(), "/api/v1/payments/methods")
                .map(body -> (Map<String, Object>) body)
                .defaultIfEmpty(Map.of())
                .map(body -> body.isEmpty() ? unavailable("payment-service не ответил: способы оплаты не опубликованы")
                        : available(body));

        return Mono.zip(tariffs, methods).map(blocks -> {
            Map<String, Object> tariffsBlock = blocks.getT1();
            Map<String, Object> methodsBlock = blocks.getT2();

            Map<String, Object> body = new LinkedHashMap<>();
            body.put("platform", platformBlock());
            body.put("verticals", verticals());
            body.put("tariffs", tariffsBlock);
            body.put("paymentMethods", methodsBlock);
            body.put("features", features(methodsBlock));
            body.put("anonymousPaths", GatewayPublicPaths.ANONYMOUS_GET);
            body.put("notes", notes());
            body.put("generatedAt", Instant.now().toString());
            return body;
        });
    }

    /** Facts about the platform itself, taken from the objects the gateway enforces with. */
    private Map<String, Object> platformBlock() {
        Map<String, Object> platform = new LinkedHashMap<>();
        platform.put("name", "ORTA");
        platform.put("apiVersion", API_VERSION);
        platform.put("currency", Currency.KZT.name());
        platform.put("supportedCurrencies", List.of(Currency.values()).stream().map(Enum::name).toList());
        platform.put("roles", List.of(Roles.CUSTOMER, Roles.MERCHANT, Roles.DRIVER, Roles.DISPATCHER,
                Roles.SUPPORT, Roles.ADMIN));
        platform.put("tokenTtlSeconds", security.jwtTtl().toSeconds());
        platform.put("identityMode", security.mode().name());
        platform.put("issuer", security.issuer());
        return platform;
    }

    /** The verticals a client may show, with the anonymous entry point of each. */
    private List<Map<String, Object>> verticals() {
        List<Map<String, Object>> verticals = new ArrayList<>();
        verticals.add(vertical("TAXI", "Такси", "/api/v1/trips", GatewayPublicPaths.TAXI_TARIFFS,
                "Заказ поездки требует токена и роли CUSTOMER"));
        verticals.add(vertical("QTIME", "Записи на услуги", "/api/v1/qtime",
                GatewayPublicPaths.QTIME_COMPANIES,
                "Просмотр компаний и окон анонимный, запись требует роли CUSTOMER"));
        verticals.add(vertical("MARKET", "Маркет", "/api/v1/catalog", GatewayPublicPaths.MARKET_CATALOGUE,
                "Витрина открыта всем, покупка требует роли CUSTOMER"));
        return verticals;
    }

    private Map<String, Object> vertical(String code, String title, String basePath,
                                        String cataloguePath, String authNote) {
        Map<String, Object> vertical = new LinkedHashMap<>();
        vertical.put("code", code);
        vertical.put("title", title);
        vertical.put("basePath", basePath);
        vertical.put("anonymousCataloguePath", cataloguePath);
        vertical.put("authNote", authNote);
        return vertical;
    }

    /**
     * What is not built yet, said out loud.
     *
     * <p>{@code cardPayments} is derived from the payment service's own answer rather than
     * typed here: once that method is implemented, this flag flips by itself.
     */
    private Map<String, Object> features(Map<String, Object> methodsBlock) {
        Map<String, Object> features = new LinkedHashMap<>();
        features.put("cardPayments", cardImplemented(methodsBlock));
        features.put("pushNotifications", false);
        features.put("websockets", false);
        features.put("localization", false);
        features.put("deliveryZones", false);
        features.put("notes", Map.of(
                "cardPayments", "флаг выводится из ответа payment-service: карта объявлена планом",
                "pushNotifications", "устройства не регистрируются: нет эндпоинта токена устройства",
                "websockets", "real-time идёт опросом; сервер не публикует адрес сокета",
                "localization", "сервисы отвечают по-русски: заголовок языка не обрабатывается",
                "deliveryZones", "город один: зон, наценок и расписаний в API нет"));
        return features;
    }

    private boolean cardImplemented(Map<String, Object> methodsBlock) {
        Object methods = methodsBlock.get("methods");
        if (!(methods instanceof List<?> list)) {
            return false;
        }
        return list.stream()
                .filter(Map.class::isInstance)
                .map(Map.class::cast)
                .anyMatch(method -> "CARD".equals(method.get("code")) && Boolean.TRUE.equals(method.get("implemented")));
    }

    private Map<String, Object> available(Map<String, Object> body) {
        Map<String, Object> block = new LinkedHashMap<>();
        block.put("available", true);
        block.putAll(body);
        return block;
    }

    private Map<String, Object> unavailable(String reason) {
        Map<String, Object> block = new LinkedHashMap<>();
        block.put("available", false);
        block.put("reason", reason);
        return block;
    }

    private List<String> notes() {
        return List.of(
                "Этот ответ — единственный вызов, который клиенту нужен до входа: тарифы, способы оплаты,"
                        + " вертикали и то, что можно запрашивать без токена",
                "Тарифы и способы оплаты — данные сервисов, а не копия в шлюзе: изменилась конфигурация"
                        + " trip-service или payment-service, изменился ответ",
                "Недоступный блок остаётся в ответе с available=false и причиной: клиент покажет остальное");
    }

    /** Cached body together with the moment it was assembled. */
    private record CachedConfig(Map<String, Object> body, Instant assembledAt) {

        static CachedConfig empty() {
            return new CachedConfig(Map.of(), Instant.EPOCH);
        }

        boolean isFresh(Duration ttl) {
            return !body.isEmpty() && assembledAt.plus(ttl).isAfter(Instant.now());
        }
    }
}
