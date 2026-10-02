package kz.taxi.common.web.error;

import jakarta.servlet.http.HttpServletRequest;
import kz.taxi.common.core.context.CorrelationContext;
import kz.taxi.common.core.error.CommonErrorCode;
import kz.taxi.common.core.error.DomainException;
import kz.taxi.common.core.error.ErrorCode;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.core.Ordered;
import org.springframework.core.annotation.Order;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.http.converter.HttpMessageNotReadableException;
import org.springframework.validation.BindException;
import org.springframework.validation.FieldError;
import org.springframework.web.HttpMediaTypeNotSupportedException;
import org.springframework.web.HttpRequestMethodNotSupportedException;
import org.springframework.web.bind.MethodArgumentNotValidException;
import org.springframework.web.bind.MissingServletRequestParameterException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;
import org.springframework.web.method.annotation.MethodArgumentTypeMismatchException;
import org.springframework.web.server.ResponseStatusException;
import org.springframework.web.servlet.resource.NoResourceFoundException;

import jakarta.validation.ConstraintViolationException;
import java.util.List;

/**
 * Single translation point from exceptions to HTTP responses.
 *
 * <p>Two rules make the API predictable:
 * <ol>
 *   <li>Every {@link DomainException} maps through its own {@link ErrorCode}, so
 *       a service can introduce a new business error without touching this class.</li>
 *   <li>Unexpected exceptions never leak their message or stack trace to the
 *       client — they become an opaque {@code INTERNAL_ERROR} and are logged with
 *       full context for the on-call engineer.</li>
 * </ol>
 */
@RestControllerAdvice
@Order(Ordered.HIGHEST_PRECEDENCE + 100)
@Slf4j
public class GlobalExceptionHandler {

    private final String problemBaseUri;

    public GlobalExceptionHandler(
            @Value("${taxi.web.problem-base-uri:https://docs.taxi.local/errors}") String problemBaseUri) {
        this.problemBaseUri = problemBaseUri;
    }

    @ExceptionHandler(DomainException.class)
    public ResponseEntity<ApiProblem> handleDomain(DomainException ex, HttpServletRequest request) {
        ErrorCode code = ex.errorCode();
        boolean serverSide = code.httpStatus() >= 500;
        if (serverSide) {
            log.error("domain failure [{}] on {} {}: {}", code.code(), request.getMethod(),
                    request.getRequestURI(), ex.getMessage(), ex);
        } else {
            log.debug("business rejection [{}] on {} {}: {}", code.code(), request.getMethod(),
                    request.getRequestURI(), ex.getMessage());
        }
        ApiProblem problem = ApiProblem.of(code, ex.getMessage(), request.getRequestURI(),
                CorrelationContext.get(), problemBaseUri);
        if (!ex.details().isEmpty()) {
            problem = problem.withDetails(ex.details());
        }
        return problem.toResponse();
    }

    @ExceptionHandler(MethodArgumentNotValidException.class)
    public ResponseEntity<ApiProblem> handleBodyValidation(MethodArgumentNotValidException ex,
                                                           HttpServletRequest request) {
        List<ApiProblem.Violation> violations = ex.getBindingResult().getFieldErrors().stream()
                .map(GlobalExceptionHandler::toViolation)
                .toList();
        return validationProblem("request body is invalid", violations, request);
    }

    @ExceptionHandler(BindException.class)
    public ResponseEntity<ApiProblem> handleBinding(BindException ex, HttpServletRequest request) {
        List<ApiProblem.Violation> violations = ex.getBindingResult().getFieldErrors().stream()
                .map(GlobalExceptionHandler::toViolation)
                .toList();
        return validationProblem("request parameters are invalid", violations, request);
    }

    @ExceptionHandler(ConstraintViolationException.class)
    public ResponseEntity<ApiProblem> handleConstraintViolation(ConstraintViolationException ex,
                                                                HttpServletRequest request) {
        List<ApiProblem.Violation> violations = ex.getConstraintViolations().stream()
                .map(v -> new ApiProblem.Violation(
                        v.getPropertyPath() == null ? null : v.getPropertyPath().toString(),
                        v.getMessage(),
                        v.getInvalidValue()))
                .toList();
        return validationProblem("request constraints are violated", violations, request);
    }

    @ExceptionHandler(MethodArgumentTypeMismatchException.class)
    public ResponseEntity<ApiProblem> handleTypeMismatch(MethodArgumentTypeMismatchException ex,
                                                         HttpServletRequest request) {
        String expected = ex.getRequiredType() == null ? "unknown" : ex.getRequiredType().getSimpleName();
        ApiProblem problem = ApiProblem.of(CommonErrorCode.VALIDATION_FAILED,
                        "parameter '%s' must be a valid %s".formatted(ex.getName(), expected),
                        request.getRequestURI(), CorrelationContext.get(), problemBaseUri)
                .withErrors(List.of(new ApiProblem.Violation(ex.getName(), "invalid value", ex.getValue())));
        return problem.toResponse();
    }

    @ExceptionHandler(MissingServletRequestParameterException.class)
    public ResponseEntity<ApiProblem> handleMissingParameter(MissingServletRequestParameterException ex,
                                                             HttpServletRequest request) {
        ApiProblem problem = ApiProblem.of(CommonErrorCode.VALIDATION_FAILED,
                "required parameter '%s' is missing".formatted(ex.getParameterName()),
                request.getRequestURI(), CorrelationContext.get(), problemBaseUri);
        return problem.toResponse();
    }

    @ExceptionHandler(HttpMessageNotReadableException.class)
    public ResponseEntity<ApiProblem> handleUnreadableBody(HttpMessageNotReadableException ex,
                                                           HttpServletRequest request) {
        log.debug("unreadable request body on {}: {}", request.getRequestURI(), ex.getMessage());
        ApiProblem problem = ApiProblem.of(CommonErrorCode.BAD_REQUEST,
                "request body is missing or malformed", request.getRequestURI(),
                CorrelationContext.get(), problemBaseUri);
        return problem.toResponse();
    }

    @ExceptionHandler({NoResourceFoundException.class,
            org.springframework.web.servlet.NoHandlerFoundException.class})
    public ResponseEntity<ApiProblem> handleNoHandler(Exception ex, HttpServletRequest request) {
        ApiProblem problem = ApiProblem.of(CommonErrorCode.NOT_FOUND,
                "no endpoint %s %s".formatted(request.getMethod(), request.getRequestURI()),
                request.getRequestURI(), CorrelationContext.get(), problemBaseUri);
        return problem.toResponse();
    }

    @ExceptionHandler(HttpRequestMethodNotSupportedException.class)
    public ResponseEntity<ApiProblem> handleMethodNotSupported(HttpRequestMethodNotSupportedException ex,
                                                               HttpServletRequest request) {
        ApiProblem problem = ApiProblem.of(CommonErrorCode.METHOD_NOT_ALLOWED, ex.getMessage(),
                request.getRequestURI(), CorrelationContext.get(), problemBaseUri);
        return problem.toResponse();
    }

    @ExceptionHandler(HttpMediaTypeNotSupportedException.class)
    public ResponseEntity<ApiProblem> handleMediaType(HttpMediaTypeNotSupportedException ex,
                                                      HttpServletRequest request) {
        ApiProblem problem = ApiProblem.of(CommonErrorCode.BAD_REQUEST, ex.getMessage(),
                request.getRequestURI(), CorrelationContext.get(), problemBaseUri);
        return problem.toResponse();
    }

    /** Honours explicit status codes chosen by application code. */
    @ExceptionHandler(ResponseStatusException.class)
    public ResponseEntity<ApiProblem> handleResponseStatus(ResponseStatusException ex,
                                                           HttpServletRequest request) {
        HttpStatus status = HttpStatus.resolve(ex.getStatusCode().value());
        CommonErrorCode fallback = status != null && status.is4xxClientError()
                ? CommonErrorCode.BAD_REQUEST : CommonErrorCode.INTERNAL_ERROR;
        ApiProblem problem = ApiProblem.of(fallback, ex.getReason(), request.getRequestURI(),
                CorrelationContext.get(), problemBaseUri);
        return problem.toResponse();
    }

    @ExceptionHandler(Exception.class)
    public ResponseEntity<ApiProblem> handleUnexpected(Exception ex, HttpServletRequest request) {
        String correlationId = CorrelationContext.getOrCreate();
        log.error("unhandled exception [correlationId={}] on {} {}", correlationId, request.getMethod(),
                request.getRequestURI(), ex);
        ApiProblem problem = ApiProblem.of(CommonErrorCode.INTERNAL_ERROR,
                "Something went wrong. Quote correlation id %s when contacting support.".formatted(correlationId),
                request.getRequestURI(), correlationId, problemBaseUri);
        return problem.toResponse();
    }

    private ResponseEntity<ApiProblem> validationProblem(String detail,
                                                         List<ApiProblem.Violation> violations,
                                                         HttpServletRequest request) {
        return ApiProblem.of(CommonErrorCode.VALIDATION_FAILED, detail, request.getRequestURI(),
                        CorrelationContext.get(), problemBaseUri)
                .withErrors(violations)
                .toResponse();
    }

    private static ApiProblem.Violation toViolation(FieldError fieldError) {
        return new ApiProblem.Violation(fieldError.getField(), fieldError.getDefaultMessage(),
                fieldError.getRejectedValue());
    }
}
