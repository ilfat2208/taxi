package kz.taxi.gateway.error;

import com.fasterxml.jackson.annotation.JsonInclude;
import kz.taxi.common.core.error.ErrorCode;

import java.time.Instant;
import java.util.LinkedHashMap;
import java.util.Map;

/**
 * RFC 7807 problem document for the reactive edge.
 *
 * <p>Mirrors the servlet-side {@code ApiProblem} on purpose: a client must not
 * be able to tell whether a 409 came from the gateway or from a domain service.
 * It is duplicated rather than shared because the servlet implementation pulls
 * in the MVC stack, which a reactive gateway must not carry.
 */
@JsonInclude(JsonInclude.Include.NON_EMPTY)
public record ProblemResponse(
        String type,
        String title,
        int status,
        String detail,
        String code,
        String instance,
        Instant timestamp,
        String correlationId,
        Map<String, Object> details
) {

    private static final String TYPE_BASE = "https://docs.taxi.local/errors/";

    public static ProblemResponse of(ErrorCode errorCode,
                                     String detail,
                                     String instance,
                                     String correlationId) {
        return new ProblemResponse(
                TYPE_BASE + errorCode.code(),
                titleFor(errorCode.httpStatus()),
                errorCode.httpStatus(),
                detail == null || detail.isBlank() ? errorCode.defaultMessage() : detail,
                errorCode.code(),
                instance,
                Instant.now(),
                correlationId,
                Map.of());
    }

    public static ProblemResponse of(int status,
                                     String code,
                                     String detail,
                                     String instance,
                                     String correlationId) {
        return new ProblemResponse(TYPE_BASE + code, titleFor(status), status, detail, code, instance,
                Instant.now(), correlationId, Map.of());
    }

    public ProblemResponse withDetails(Map<String, Object> extra) {
        Map<String, Object> merged = new LinkedHashMap<>(details);
        merged.putAll(extra);
        return new ProblemResponse(type, title, status, detail, code, instance, timestamp, correlationId, merged);
    }

    private static String titleFor(int status) {
        return switch (status) {
            case 400 -> "Bad Request";
            case 401 -> "Unauthorized";
            case 403 -> "Forbidden";
            case 404 -> "Not Found";
            case 409 -> "Conflict";
            case 412 -> "Precondition Failed";
            case 422 -> "Unprocessable Entity";
            case 429 -> "Too Many Requests";
            case 503 -> "Service Unavailable";
            default -> status >= 500 ? "Internal Server Error" : "Error";
        };
    }
}
