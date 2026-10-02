package kz.taxi.gateway.filter;

import kz.taxi.common.core.context.CorrelationContext;
import kz.taxi.common.core.id.Ulid;
import lombok.extern.slf4j.Slf4j;
import org.slf4j.MDC;
import org.springframework.core.Ordered;
import org.springframework.core.annotation.Order;
import org.springframework.http.HttpHeaders;
import org.springframework.http.server.reactive.ServerHttpRequest;
import org.springframework.http.server.reactive.ServerHttpRequestDecorator;
import org.springframework.http.server.reactive.ServerHttpResponse;
import org.springframework.stereotype.Component;
import org.springframework.web.server.ServerWebExchange;
import org.springframework.web.server.WebFilter;
import org.springframework.web.server.WebFilterChain;
import reactor.core.publisher.Mono;

/**
 * Mints the correlation id at the edge of the platform.
 *
 * <p>One id per client request, forwarded downstream as a header, echoed back to the
 * client, and carried into every Kafka event the request causes. This is the thread
 * that lets support answer "where did my transfer go" with one query instead of a
 * service-by-service search.
 *
 * <p>It is a {@link WebFilter}, not a Spring Cloud Gateway {@code GlobalFilter}, and
 * that distinction is a bug fix rather than a style choice: gateway global filters
 * only run for <em>routed</em> requests. Requests the gateway answers itself —
 * {@code POST /api/v1/auth/token} and the error it returns for a wrong SMS code —
 * bypassed them entirely, so exactly the failure a user is most likely to report
 * arrived with no correlation id at all. A {@code WebFilter} runs for every exchange,
 * routed or local.
 *
 * <p>The request is wrapped in a {@link ServerHttpRequestDecorator} rather than mutated
 * through {@code request.mutate().header(...)}: on an unmodified request the builder
 * operates on a read-only header view and throws {@code UnsupportedOperationException}.
 * Copying the headers into a writable map is the pattern that always works, whatever
 * Spring's internals do.
 */
@Component
@Order(Ordered.HIGHEST_PRECEDENCE)
@Slf4j
public class CorrelationIdWebFilter implements WebFilter {

    @Override
    public Mono<Void> filter(ServerWebExchange exchange, WebFilterChain chain) {
        String incoming = sanitize(exchange.getRequest().getHeaders().getFirst(CorrelationContext.HEADER));
        final String correlationId = incoming == null ? Ulid.nextId() : incoming;

        // Published before anything else can fail, so even an error thrown by a later
        // filter — or by a controller the gateway hosts itself — can tell the client
        // which id to quote.
        exchange.getAttributes().put(CorrelationContext.MDC_KEY, correlationId);
        ServerHttpResponse response = exchange.getResponse();
        response.getHeaders().set(CorrelationContext.HEADER, correlationId);

        ServerHttpRequest decoratedRequest = new ServerHttpRequestDecorator(exchange.getRequest()) {
            @Override
            public HttpHeaders getHeaders() {
                HttpHeaders headers = new HttpHeaders();
                headers.putAll(super.getHeaders());
                headers.set(CorrelationContext.HEADER, correlationId);
                return headers;
            }
        };

        long startedAt = System.nanoTime();
        String path = exchange.getRequest().getURI().getRawPath();

        return chain.filter(exchange.mutate().request(decoratedRequest).build())
                .doFirst(() -> MDC.put(CorrelationContext.MDC_KEY, correlationId))
                .doFinally(signal -> {
                    MDC.remove(CorrelationContext.MDC_KEY);
                    long durationMs = (System.nanoTime() - startedAt) / 1_000_000;
                    log.debug("{} {} -> {} in {}ms [correlationId={}]",
                            exchange.getRequest().getMethod(), path,
                            response.getStatusCode() == null ? "-" : response.getStatusCode().value(),
                            durationMs, correlationId);
                });
    }

    /** Same defensive rule as the services: never trust a header into a log line. */
    private static String sanitize(String candidate) {
        if (candidate == null) {
            return null;
        }
        String trimmed = candidate.trim();
        if (trimmed.isEmpty() || trimmed.length() > 128) {
            return null;
        }
        for (int i = 0; i < trimmed.length(); i++) {
            char c = trimmed.charAt(i);
            boolean allowed = (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z')
                    || (c >= '0' && c <= '9') || c == '-' || c == '_' || c == '.';
            if (!allowed) {
                return null;
            }
        }
        return trimmed;
    }
}
