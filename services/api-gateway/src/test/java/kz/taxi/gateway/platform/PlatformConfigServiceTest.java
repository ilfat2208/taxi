package kz.taxi.gateway.platform;

import kz.taxi.common.security.SecurityMode;
import kz.taxi.common.security.SecurityProperties;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import reactor.core.publisher.Mono;
import reactor.test.StepVerifier;

import java.time.Duration;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * The client configuration.
 *
 * <p>Three behaviours are worth a test, and they are the reason the endpoint exists at all:
 * the platform's own facts come from the objects the gateway enforces with, the downstream
 * blocks are the services' answers rather than copies, and a service that is down costs the
 * client one block and not the whole configuration.
 */
class PlatformConfigServiceTest {

    private static final SecurityProperties SECURITY = new SecurityProperties(
            "0123456789abcdef0123456789abcdef", Duration.ofMinutes(45), "https://identity.taxi.local",
            "roles", null, null, SecurityMode.HMAC, null, null, null, null);

    private static final PlatformConfigProperties PROPERTIES = new PlatformConfigProperties(
            "http://trip:8086", "http://payment:8082", Duration.ofSeconds(30), Duration.ofSeconds(1));

    @Test
    @DisplayName("платформенные факты берутся из тех же объектов, которыми шлюз проверяет токены")
    void platform_facts_come_from_the_objects_the_gateway_enforces_with() {
        PlatformConfigService service = new PlatformConfigService(
                fakeClient(tariffsBody(), methodsBody(false)), PROPERTIES, SECURITY);

        Map<String, Object> body = service.config().block();

        @SuppressWarnings("unchecked")
        Map<String, Object> platform = (Map<String, Object>) body.get("platform");
        assertThat(platform.get("name")).isEqualTo("ORTA");
        assertThat(platform.get("currency")).isEqualTo("KZT");
        assertThat(platform.get("tokenTtlSeconds")).isEqualTo(2700L);
        assertThat(platform.get("identityMode")).isEqualTo("HMAC");
        @SuppressWarnings("unchecked")
        List<String> roles = (List<String>) platform.get("roles");
        assertThat(roles).contains("CUSTOMER", "DRIVER", "ADMIN");
    }

    @Test
    @DisplayName("тарифы и способы оплаты — ответы сервисов, а не копия в шлюзе")
    void downstream_blocks_are_the_services_answers() {
        PlatformConfigService service = new PlatformConfigService(
                fakeClient(tariffsBody(), methodsBody(false)), PROPERTIES, SECURITY);

        Map<String, Object> body = service.config().block();

        @SuppressWarnings("unchecked")
        Map<String, Object> tariffs = (Map<String, Object>) body.get("tariffs");
        assertThat(tariffs).containsEntry("available", true);
        assertThat(tariffs).containsEntry("currency", "KZT");
        assertThat(tariffs).containsEntry("commissionBp", 1200);

        @SuppressWarnings("unchecked")
        Map<String, Object> methods = (Map<String, Object>) body.get("paymentMethods");
        assertThat(methods).containsEntry("available", true);
        assertThat((List<?>) methods.get("methods")).hasSize(2);
    }

    @Test
    @DisplayName("недоступный сервис стоит клиенту одного блока, а не всей конфигурации")
    void one_downstream_failure_costs_one_block() {
        // trip-service молчит: тарифы недоступны, остальное на месте.
        PlatformConfigService service = new PlatformConfigService(
                fakeClient(null, methodsBody(false)), PROPERTIES, SECURITY);

        Map<String, Object> body = service.config().block();

        @SuppressWarnings("unchecked")
        Map<String, Object> tariffs = (Map<String, Object>) body.get("tariffs");
        assertThat(tariffs).containsEntry("available", false);
        assertThat((String) tariffs.get("reason")).contains("trip-service");

        @SuppressWarnings("unchecked")
        Map<String, Object> methods = (Map<String, Object>) body.get("paymentMethods");
        assertThat(methods).as("оплата не должна пропадать из-за тарифов").containsEntry("available", true);
        @SuppressWarnings("unchecked")
        List<String> anonymous = (List<String>) body.get("anonymousPaths");
        assertThat(anonymous).contains("/api/v1/trips/tariffs");
    }

    @Test
    @DisplayName("флаг карточных платежей выводится из ответа сервиса, а не вписан в код")
    void card_flag_follows_the_payment_service() {
        Map<String, Object> withCard = new PlatformConfigService(
                fakeClient(tariffsBody(), methodsBody(true)), PROPERTIES, SECURITY)
                .config().block();
        Map<String, Object> withoutCard = new PlatformConfigService(
                fakeClient(tariffsBody(), methodsBody(false)), PROPERTIES, SECURITY)
                .config().block();

        assertThat(feature(withCard, "cardPayments")).isEqualTo(true);
        assertThat(feature(withoutCard, "cardPayments")).isEqualTo(false);
        // Остальные флаги — факты о платформе, и они объявлены, а не спрятаны.
        assertThat(feature(withoutCard, "pushNotifications")).isEqualTo(false);
        assertThat(feature(withoutCard, "websockets")).isEqualTo(false);
    }

    @Test
    @DisplayName("конфигурация переиспользуется в пределах cache-ttl")
    void the_configuration_is_cached() {
        CountingClient client = new CountingClient(tariffsBody(), methodsBody(false));
        PlatformConfigService service = new PlatformConfigService(client, PROPERTIES, SECURITY);

        service.config().block();
        service.config().block();
        service.config().block();

        assertThat(client.calls)
                .as("стартовый вызов клиента не должен превращаться в лавину запросов")
                .isEqualTo(2);
    }

    @Test
    @DisplayName("анонимные пути публикуются из того же списка, что разрешает шлюз")
    void anonymous_paths_are_published() {
        PlatformConfigService service = new PlatformConfigService(
                fakeClient(tariffsBody(), methodsBody(false)), PROPERTIES, SECURITY);

        StepVerifier.create(service.config())
                .assertNext(body -> assertThat(body.get("anonymousPaths"))
                        .isEqualTo(GatewayPublicPaths.ANONYMOUS_GET))
                .verifyComplete();
    }

    private static Object feature(Map<String, Object> body, String name) {
        @SuppressWarnings("unchecked")
        Map<String, Object> features = (Map<String, Object>) body.get("features");
        return features.get(name);
    }

    private static Map<String, Object> tariffsBody() {
        Map<String, Object> body = new HashMap<>();
        body.put("currency", "KZT");
        body.put("commissionBp", 1200);
        body.put("quoteTtlSeconds", 300);
        body.put("tariffs", List.of(Map.of("code", "ECONOMY", "baseMinor", 35000L)));
        return body;
    }

    private static Map<String, Object> methodsBody(boolean cardImplemented) {
        Map<String, Object> body = new HashMap<>();
        body.put("methods", List.of(
                Map.of("code", "BALANCE", "implemented", true),
                Map.of("code", "CARD", "implemented", cardImplemented)));
        return body;
    }

    private static DownstreamJsonClient fakeClient(Map<String, Object> tariffs, Map<String, Object> methods) {
        return (baseUrl, path) -> {
            if (path.contains("trips") && tariffs != null) {
                return Mono.just(tariffs);
            }
            if (path.contains("payments") && methods != null) {
                return Mono.just(methods);
            }
            return Mono.empty();
        };
    }

    /** Считает обращения, чтобы проверить кэш. */
    private static final class CountingClient implements DownstreamJsonClient {

        private final Map<String, Object> tariffs;
        private final Map<String, Object> methods;
        private int calls;

        private CountingClient(Map<String, Object> tariffs, Map<String, Object> methods) {
            this.tariffs = tariffs;
            this.methods = methods;
        }

        @Override
        public Mono<Map<String, Object>> get(String baseUrl, String path) {
            calls++;
            return Mono.just(path.contains("trips") ? tariffs : methods);
        }
    }
}
