package kz.taxi.common.security.web;

import kz.taxi.common.core.context.CorrelationContext;
import kz.taxi.common.core.error.CommonErrorCode;
import kz.taxi.common.web.error.ApiProblem;
import lombok.extern.slf4j.Slf4j;
import org.springframework.core.Ordered;
import org.springframework.core.annotation.Order;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.security.core.AuthenticationException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;

import jakarta.servlet.http.HttpServletRequest;
import org.springframework.web.context.request.RequestContextHolder;
import org.springframework.web.context.request.ServletRequestAttributes;

/**
 * Security exceptions never become 500s.
 *
 * <p>Two very different failures live here, and both are normal traffic:
 * <ul>
 *   <li>a valid token that lacks the required role — 403, the client should show
 *       "you cannot do that", not "something went wrong";</li>
 *   <li>{@code @PreAuthorize} on a service method (not just a controller), where
 *       the exception is thrown deep in the call stack after the security filter
 *       chain has already finished — the generic exception handler would happily
 *       report it as an internal error.</li>
 * </ul>
 *
 * <p>This advice runs before the generic one, which cannot know about Spring
 * Security at all.
 */
@RestControllerAdvice
@Order(Ordered.HIGHEST_PRECEDENCE)
@Slf4j
public class SecurityExceptionHandler {

    @ExceptionHandler(AccessDeniedException.class)
    public ResponseEntity<ApiProblem> handleAccessDenied(AccessDeniedException ex) {
        HttpServletRequest request = currentRequest();
        log.info("access denied on {} {} [correlationId={}]: {}", request.getMethod(),
                request.getRequestURI(), CorrelationContext.get(), ex.getMessage());
        return ApiProblem.of(CommonErrorCode.FORBIDDEN,
                        "you do not have permission to perform this operation",
                        request.getRequestURI(), CorrelationContext.get(),
                        "https://docs.taxi.local/errors")
                .toResponse();
    }

    @ExceptionHandler(AuthenticationException.class)
    public ResponseEntity<ApiProblem> handleAuthentication(AuthenticationException ex) {
        HttpServletRequest request = currentRequest();
        log.debug("authentication failed on {} {}: {}", request.getMethod(), request.getRequestURI(),
                ex.getMessage());
        return ApiProblem.of(CommonErrorCode.UNAUTHORIZED,
                        "a valid bearer token is required for %s %s"
                                .formatted(request.getMethod(), request.getRequestURI()),
                        request.getRequestURI(), CorrelationContext.get(),
                        "https://docs.taxi.local/errors")
                .toResponse();
    }

    private static HttpServletRequest currentRequest() {
        if (RequestContextHolder.getRequestAttributes() instanceof ServletRequestAttributes attributes) {
            return attributes.getRequest();
        }
        throw new IllegalStateException("no servlet request bound to the current thread");
    }
}
