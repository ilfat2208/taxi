package kz.taxi.gateway.platform;

import org.springframework.core.ParameterizedTypeReference;
import org.springframework.http.MediaType;
import org.springframework.stereotype.Component;
import org.springframework.web.reactive.function.client.WebClient;
import reactor.core.publisher.Mono;

import java.util.Map;

/**
 * {@link DownstreamJsonClient} on top of a {@link WebClient}.
 *
 * <p>Every failure — connection refused, timeout, a 500 from the service, an HTML body —
 * collapses into an empty {@link Mono}. That is deliberate: the config endpoint answers
 * "this block is unavailable and here is why" rather than a 502, because a client that
 * cannot reach the tariff service should still be able to learn the payment methods and the
 * API version.
 */
@Component
public class WebClientDownstreamJsonClient implements DownstreamJsonClient {

    private static final ParameterizedTypeReference<Map<String, Object>> JSON_OBJECT =
            new ParameterizedTypeReference<>() {
            };

    private final WebClient.Builder builder;
    private final PlatformConfigProperties properties;

    public WebClientDownstreamJsonClient(WebClient.Builder builder, PlatformConfigProperties properties) {
        this.builder = builder;
        this.properties = properties;
    }

    @Override
    public Mono<Map<String, Object>> get(String baseUrl, String path) {
        return builder.build()
                .get()
                .uri(baseUrl + path)
                .accept(MediaType.APPLICATION_JSON)
                .retrieve()
                .bodyToMono(JSON_OBJECT)
                .timeout(properties.timeout())
                .onErrorResume(failure -> Mono.empty());
    }
}
