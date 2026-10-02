package kz.taxi.common.web.filter;

import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import kz.taxi.common.core.context.CorrelationContext;
import kz.taxi.common.core.id.Ulid;
import org.slf4j.MDC;
import org.springframework.core.Ordered;
import org.springframework.core.annotation.Order;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;

import java.io.IOException;

/**
 * Establishes the correlation id for every inbound request.
 *
 * <p>Runs before Spring Security so that authentication failures are also
 * traceable, and echoes the id back in the response so a client can report it.
 */
@Component
@Order(Ordered.HIGHEST_PRECEDENCE)
public class CorrelationIdFilter extends OncePerRequestFilter {

    @Override
    protected void doFilterInternal(HttpServletRequest request,
                                    HttpServletResponse response,
                                    FilterChain filterChain) throws ServletException, IOException {
        String correlationId = sanitize(request.getHeader(CorrelationContext.HEADER));
        if (correlationId == null) {
            correlationId = sanitize(request.getHeader("X-Request-Id"));
        }
        if (correlationId == null) {
            correlationId = Ulid.nextId();
        }

        CorrelationContext.set(correlationId);
        MDC.put(CorrelationContext.MDC_KEY, correlationId);
        response.setHeader(CorrelationContext.HEADER, correlationId);
        try {
            filterChain.doFilter(request, response);
        } finally {
            MDC.remove(CorrelationContext.MDC_KEY);
            CorrelationContext.clear();
        }
    }

    /** Guards against log injection and absurd header values from untrusted clients. */
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
