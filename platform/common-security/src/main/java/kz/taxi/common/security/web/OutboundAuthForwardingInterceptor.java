package kz.taxi.common.security.web;

import kz.taxi.common.core.context.CorrelationContext;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.HttpRequest;
import org.springframework.http.client.ClientHttpRequestExecution;
import org.springframework.http.client.ClientHttpRequestInterceptor;
import org.springframework.http.client.ClientHttpResponse;
import org.springframework.web.context.request.RequestContextHolder;
import org.springframework.web.context.request.ServletRequestAttributes;

import jakarta.servlet.http.HttpServletRequest;
import java.io.IOException;

/**
 * Propagates identity and trace context on every outbound service call.
 *
 * <p>Two headers travel with each hop:
 * <ul>
 *   <li>{@code Authorization} — the user token, so the downstream service applies
 *       the same authorization rules as the caller (no "trusted internal caller"
 *       shortcut that quietly bypasses ownership checks);</li>
 *   <li>{@code X-Correlation-Id} — so one id still explains the whole
 *       chain of calls when a saga misbehaves.</li>
 * </ul>
 *
 * <p>The {@code X-Internal-Token} header is added only when configured, which is
 * what internal endpoints require.
 */
@Slf4j
public class OutboundAuthForwardingInterceptor implements ClientHttpRequestInterceptor {

    public static final String AUTHORIZATION = "Authorization";

    private final String internalToken;
    private final boolean forwardAuthorization;

    public OutboundAuthForwardingInterceptor(String internalToken, boolean forwardAuthorization) {
        this.internalToken = internalToken;
        this.forwardAuthorization = forwardAuthorization;
    }

    @Override
    public ClientHttpResponse intercept(HttpRequest request,
                                        byte[] body,
                                        ClientHttpRequestExecution execution) throws IOException {
        String correlationId = CorrelationContext.get();
        if (correlationId != null && !request.getHeaders().containsKey(CorrelationContext.HEADER)) {
            request.getHeaders().add(CorrelationContext.HEADER, correlationId);
        }

        if (internalToken != null && !internalToken.isBlank()
                && !request.getHeaders().containsKey(InternalApiTokenFilter.HEADER)) {
            request.getHeaders().add(InternalApiTokenFilter.HEADER, internalToken);
        }

        if (forwardAuthorization && !request.getHeaders().containsKey(AUTHORIZATION)) {
            String authorization = currentAuthorizationHeader();
            if (authorization != null) {
                request.getHeaders().add(AUTHORIZATION, authorization);
            }
        }

        log.debug("outbound {} {} [correlationId={}]", request.getMethod(), request.getURI(), correlationId);
        return execution.execute(request, body);
    }

    private static String currentAuthorizationHeader() {
        if (RequestContextHolder.getRequestAttributes() instanceof ServletRequestAttributes attributes) {
            HttpServletRequest request = attributes.getRequest();
            return request.getHeader(AUTHORIZATION);
        }
        // Outside a request (scheduled job, Kafka consumer) there is no user token;
        // the internal token is the only credential such a call should use.
        return null;
    }
}
