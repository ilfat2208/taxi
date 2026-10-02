package kz.taxi.common.security.web;

import com.fasterxml.jackson.databind.ObjectMapper;
import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import kz.taxi.common.core.context.CorrelationContext;
import kz.taxi.common.core.error.CommonErrorCode;
import kz.taxi.common.web.error.ApiProblem;
import lombok.extern.slf4j.Slf4j;
import org.springframework.core.Ordered;
import org.springframework.core.annotation.Order;
import org.springframework.http.MediaType;
import org.springframework.web.filter.OncePerRequestFilter;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;

/**
 * Guards service-to-service endpoints ({@code /internal/} in the path).
 *
 * <p>Why a separate mechanism instead of a user token: a payment service must be
 * able to credit the <em>recipient</em> of a P2P transfer, and the recipient's
 * owner is not the caller. Role-based checks on the user token cannot express
 * that, so the call is authenticated as a workload rather than as a person.
 *
 * <p>The shared secret is the honest local-development stand-in for mTLS or a
 * service mesh identity: it keeps internal endpoints unreachable from the public
 * edge (the gateway never routes {@code /internal/**}), it is compared in
 * constant time, and it is configured per environment.
 */
@Order(Ordered.HIGHEST_PRECEDENCE + 15)
@Slf4j
public class InternalApiTokenFilter extends OncePerRequestFilter {

    public static final String HEADER = "X-Internal-Token";
    private static final String INTERNAL_PATH_SEGMENT = "/internal/";

    private final ObjectMapper objectMapper;
    private final byte[] expectedToken;
    private final String problemBaseUri;

    public InternalApiTokenFilter(ObjectMapper objectMapper, String configuredToken, String problemBaseUri) {
        this.objectMapper = objectMapper;
        this.expectedToken = configuredToken == null ? new byte[0] : configuredToken.getBytes(StandardCharsets.UTF_8);
        this.problemBaseUri = problemBaseUri;
        if (expectedToken.length == 0) {
            log.warn("taxi.internal.token is not configured: internal endpoints are disabled");
        }
    }

    @Override
    protected boolean shouldNotFilter(HttpServletRequest request) {
        return !request.getRequestURI().contains(INTERNAL_PATH_SEGMENT);
    }

    @Override
    protected void doFilterInternal(HttpServletRequest request,
                                    HttpServletResponse response,
                                    FilterChain filterChain) throws ServletException, IOException {
        if (expectedToken.length == 0) {
            reject(response, request, "internal API is disabled in this environment");
            return;
        }

        String provided = request.getHeader(HEADER);
        if (provided == null || !constantTimeEquals(provided.getBytes(StandardCharsets.UTF_8), expectedToken)) {
            log.warn("rejected internal call to {} {} from {} [correlationId={}]",
                    request.getMethod(), request.getRequestURI(), request.getRemoteAddr(),
                    CorrelationContext.get());
            reject(response, request, "a valid %s header is required for internal endpoints".formatted(HEADER));
            return;
        }

        filterChain.doFilter(request, response);
    }

    private void reject(HttpServletResponse response, HttpServletRequest request, String detail)
            throws IOException {
        ApiProblem problem = ApiProblem.of(CommonErrorCode.UNAUTHORIZED, detail,
                request.getRequestURI(), CorrelationContext.get(), problemBaseUri);
        response.setStatus(problem.status());
        response.setContentType(MediaType.APPLICATION_PROBLEM_JSON_VALUE);
        response.setCharacterEncoding("UTF-8");
        objectMapper.writeValue(response.getOutputStream(), problem);
    }

    private static boolean constantTimeEquals(byte[] left, byte[] right) {
        return MessageDigest.isEqual(left, right);
    }
}
