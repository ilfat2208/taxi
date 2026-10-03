package kz.taxi.gateway.platform;

import reactor.core.publisher.Mono;

import java.util.Map;

/**
 * One call to a downstream service that answers JSON, with the failure already turned into
 * a value.
 *
 * <p>An interface rather than a {@code WebClient} field, because the interesting logic of
 * the config endpoint is not "how do I make an HTTP call" but "what do I answer when a
 * service is down" — and that logic is testable only if the transport can be replaced.
 */
public interface DownstreamJsonClient {

    /**
     * Fetches a JSON object.
     *
     * <p>Resolves to {@code null} — not to an error — when the service is unreachable or
     * answered something that is not a JSON object: a client asking for configuration must
     * still get the rest of it.
     */
    Mono<Map<String, Object>> get(String baseUrl, String path);
}
