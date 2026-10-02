package kz.taxi.common.web.error;

import com.fasterxml.jackson.annotation.JsonInclude;
import kz.taxi.common.core.error.ErrorCode;
import org.springframework.http.HttpStatus;
import org.springframework.http.ProblemDetail;

import java.net.URI;
import java.time.Instant;
import java.util.List;
import java.util.Map;

/**
 * RFC 7807 problem document, extended with a stable machine-readable
 * {@code code} and the {@code correlationId} of the failing request.
 *
 * <pre>{@code
 * {
 *   "type": "https://docs.taxi.local/errors/INSUFFICIENT_FUNDS",
 *   "title": "Unprocessable payment",
 *   "status": 422,
 *   "detail": "account A1 has 500.00 KZT but 1500.00 KZT is required",
 *   "code": "INSUFFICIENT_FUNDS",
 *   "instance": "/api/v1/payments/transfers",
 *   "correlationId": "01J8ZCQ7Y4R3F0N5G8K2M9QW1T",
 *   "timestamp": "2024-09-01T10:15:30Z",
 *   "errors": [{"field": "amount", "message": "must be positive"}]
 * }
 * }</pre>
 */
@JsonInclude(JsonInclude.Include.NON_EMPTY)
public record ApiProblem(
        URI type,
        String title,
        int status,
        String detail,
        String code,
        String instance,
        Instant timestamp,
        String correlationId,
        Map<String, Object> details,
        List<Violation> errors
) {

    /** One field-level validation failure. */
    @JsonInclude(JsonInclude.Include.NON_NULL)
    public record Violation(String field, String message, Object rejectedValue) {
    }

    public static ApiProblem of(ErrorCode errorCode,
                                String detail,
                                String instance,
                                String correlationId,
                                String problemBaseUri) {
        HttpStatus status = HttpStatus.resolve(errorCode.httpStatus());
        HttpStatus resolved = status == null ? HttpStatus.INTERNAL_SERVER_ERROR : status;
        return new ApiProblem(
                URI.create(problemBaseUri + "/" + errorCode.code()),
                resolved.getReasonPhrase(),
                resolved.value(),
                detail == null || detail.isBlank() ? errorCode.defaultMessage() : detail,
                errorCode.code(),
                instance,
                Instant.now(),
                correlationId,
                Map.of(),
                List.of());
    }

    public ApiProblem withDetails(Map<String, Object> extraDetails) {
        return new ApiProblem(type, title, status, detail, code, instance, timestamp, correlationId,
                extraDetails == null ? Map.of() : Map.copyOf(extraDetails), errors);
    }

    public ApiProblem withErrors(List<Violation> violations) {
        return new ApiProblem(type, title, status, detail, code, instance, timestamp, correlationId,
                details, violations == null ? List.of() : List.copyOf(violations));
    }

    public org.springframework.http.ResponseEntity<ApiProblem> toResponse() {
        return org.springframework.http.ResponseEntity.status(status)
                .contentType(org.springframework.http.MediaType.APPLICATION_PROBLEM_JSON)
                .body(this);
    }

    /** Bridge to Spring's own {@link ProblemDetail} for framework-thrown errors. */
    public static ApiProblem fromProblemDetail(ProblemDetail problemDetail, String correlationId) {
        int statusValue = problemDetail.getStatus();
        return new ApiProblem(
                problemDetail.getType(),
                problemDetail.getTitle(),
                statusValue,
                problemDetail.getDetail(),
                "HTTP_" + statusValue,
                problemDetail.getInstance() == null ? null : problemDetail.getInstance().toString(),
                Instant.now(),
                correlationId,
                problemDetail.getProperties() == null ? Map.of() : Map.copyOf(problemDetail.getProperties()),
                List.of());
    }
}
