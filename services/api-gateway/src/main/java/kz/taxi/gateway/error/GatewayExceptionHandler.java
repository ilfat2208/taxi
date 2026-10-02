package kz.taxi.gateway.error;

import kz.taxi.common.core.context.CorrelationContext;
import kz.taxi.common.core.error.CommonErrorCode;
import kz.taxi.common.core.error.DomainException;
import kz.taxi.common.core.error.ErrorCode;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.http.server.reactive.ServerHttpRequest;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;
import org.springframework.web.bind.support.WebExchangeBindException;
import org.springframework.web.server.ResponseStatusException;
import org.springframework.web.server.ServerWebExchange;
import org.springframework.web.server.ServerWebInputException;

import java.util.List;
import java.util.Map;

/**
 * Turns exceptions raised by gateway controllers into problem+json.
 *
 * <p>Errors produced by <em>routed</em> services are already problem documents:
 * they pass through untouched, so a client sees one error format regardless of
 * where the failure happened.
 */
@RestControllerAdvice
@Slf4j
public class GatewayExceptionHandler {

    @ExceptionHandler(DomainException.class)
    public ResponseEntity<ProblemResponse> handleDomain(DomainException ex, ServerWebExchange exchange) {
        ErrorCode code = ex.errorCode();
        if (code.httpStatus() >= 500) {
            log.error("domain failure [{}] on {} {}", code.code(), method(exchange), path(exchange), ex);
        } else {
            log.debug("rejection [{}] on {} {}: {}", code.code(), method(exchange), path(exchange), ex.getMessage());
        }
        ProblemResponse problem = ProblemResponse.of(code, ex.getMessage(), path(exchange), correlationIdOf(exchange));
        if (!ex.details().isEmpty()) {
            problem = problem.withDetails(ex.details());
        }
        return problem(problem);
    }

    @ExceptionHandler(WebExchangeBindException.class)
    public ResponseEntity<ProblemResponse> handleValidation(WebExchangeBindException ex,
                                                            ServerWebExchange exchange) {
        Map<String, Object> details = Map.of("errors", ex.getFieldErrors().stream()
                .map(error -> Map.of(
                        "field", error.getField(),
                        "message", error.getDefaultMessage() == null ? "invalid" : error.getDefaultMessage()))
                .toList());
        return problem(ProblemResponse
                .of(CommonErrorCode.VALIDATION_FAILED, "request body is invalid", path(exchange), correlationIdOf(exchange))
                .withDetails(details));
    }

    @ExceptionHandler(ServerWebInputException.class)
    public ResponseEntity<ProblemResponse> handleInput(ServerWebInputException ex, ServerWebExchange exchange) {
        return problem(ProblemResponse.of(CommonErrorCode.BAD_REQUEST,
                "request is malformed", path(exchange), correlationIdOf(exchange)));
    }

    @ExceptionHandler(ResponseStatusException.class)
    public ResponseEntity<ProblemResponse> handleStatus(ResponseStatusException ex, ServerWebExchange exchange) {
        return problem(ProblemResponse.of(ex.getStatusCode().value(),
                "HTTP_" + ex.getStatusCode().value(),
                ex.getReason(),
                path(exchange),
                correlationIdOf(exchange)));
    }

    @ExceptionHandler(Exception.class)
    public ResponseEntity<ProblemResponse> handleUnexpected(Exception ex, ServerWebExchange exchange) {
        String correlationId = correlationIdOf(exchange);
        log.error("unhandled exception [correlationId={}] on {} {}", correlationId, method(exchange),
                path(exchange), ex);
        return problem(ProblemResponse.of(CommonErrorCode.INTERNAL_ERROR,
                "Something went wrong. Quote correlation id %s when contacting support.".formatted(correlationId),
                path(exchange), correlationId));
    }

    private static ResponseEntity<ProblemResponse> problem(ProblemResponse problem) {
        return ResponseEntity.status(problem.status())
                .contentType(org.springframework.http.MediaType.APPLICATION_PROBLEM_JSON)
                .body(problem);
    }

    /**
     * Correlation id of the failing request.
     *
     * <p>Reads the exchange attribute published by {@code CorrelationIdGlobalFilter}
     * first (a reactive stack has no request thread to carry a ThreadLocal), then the
     * request header, and only then the thread-local — which still covers errors
     * raised inside a controller rather than in the routing layer.
     */
    private static String correlationIdOf(ServerWebExchange exchange) {
        if (exchange != null) {
            Object attribute = exchange.getAttributes().get(CorrelationContext.MDC_KEY);
            if (attribute instanceof String value && !value.isBlank()) {
                return value;
            }
            String header = exchange.getRequest().getHeaders().getFirst(CorrelationContext.HEADER);
            if (header != null && !header.isBlank()) {
                return header;
            }
        }
        String correlationId = CorrelationContext.get();
        return correlationId == null ? "" : correlationId;
    }

    private static String path(ServerWebExchange exchange) {
        ServerHttpRequest request = exchange.getRequest();
        return request.getPath().value();
    }

    private static String method(ServerWebExchange exchange) {
        return String.valueOf(exchange.getRequest().getMethod());
    }
}
