package kz.taxi.common.web.idempotency;

import com.fasterxml.jackson.databind.ObjectMapper;
import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import kz.taxi.common.core.context.CorrelationContext;
import kz.taxi.common.core.error.CommonErrorCode;
import kz.taxi.common.web.error.ApiProblem;
import org.springframework.core.Ordered;
import org.springframework.core.annotation.Order;
import org.springframework.http.MediaType;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;

import java.io.IOException;

/**
 * Publishes the idempotency key of the current request.
 *
 * <p>Only unsafe methods carry a key (a GET is already idempotent), and the key
 * is validated before it can reach Redis: unbounded keys are both a memory risk
 * and an easy way to poison a shared namespace.
 */
@Component
@Order(Ordered.HIGHEST_PRECEDENCE + 10)
public class IdempotencyKeyFilter extends OncePerRequestFilter {

    private final IdempotencyProperties properties;
    private final ObjectMapper objectMapper;

    public IdempotencyKeyFilter(IdempotencyProperties properties, ObjectMapper objectMapper) {
        this.properties = properties;
        this.objectMapper = objectMapper;
    }

    @Override
    protected void doFilterInternal(HttpServletRequest request,
                                    HttpServletResponse response,
                                    FilterChain filterChain) throws ServletException, IOException {
        String rawKey = request.getHeader(properties.headerName());
        String key = rawKey == null ? null : rawKey.trim();

        if (key != null && !key.isEmpty() && !isValid(key)) {
            reject(response, request);
            return;
        }

        if (key != null && !key.isEmpty()) {
            IdempotencyContext.set(key);
            request.setAttribute(IdempotencyContext.ATTRIBUTE, key);
        }
        try {
            filterChain.doFilter(request, response);
        } finally {
            IdempotencyContext.clear();
        }
    }

    @Override
    protected boolean shouldNotFilter(HttpServletRequest request) {
        String method = request.getMethod();
        return "GET".equals(method) || "HEAD".equals(method) || "OPTIONS".equals(method)
                || "TRACE".equals(method);
    }

    private boolean isValid(String key) {
        if (key.length() > properties.maxKeyLength()) {
            return false;
        }
        for (int i = 0; i < key.length(); i++) {
            char c = key.charAt(i);
            boolean allowed = (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z')
                    || (c >= '0' && c <= '9') || c == '-' || c == '_' || c == '.' || c == ':';
            if (!allowed) {
                return false;
            }
        }
        return true;
    }

    private void reject(HttpServletResponse response, HttpServletRequest request) throws IOException {
        ApiProblem problem = ApiProblem.of(CommonErrorCode.VALIDATION_FAILED,
                "header '%s' must be 1..%d characters of [A-Za-z0-9._:-]"
                        .formatted(properties.headerName(), properties.maxKeyLength()),
                request.getRequestURI(), CorrelationContext.get(),
                "https://docs.taxi.local/errors");
        response.setStatus(problem.status());
        response.setContentType(MediaType.APPLICATION_PROBLEM_JSON_VALUE);
        objectMapper.writeValue(response.getOutputStream(), problem);
    }
}
