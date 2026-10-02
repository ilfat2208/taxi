package kz.taxi.order.infrastructure.client;

import com.fasterxml.jackson.databind.ObjectMapper;
import kz.taxi.common.core.error.DomainException;
import kz.taxi.order.domain.OrderErrorCode;
import lombok.extern.slf4j.Slf4j;
import org.springframework.web.client.RestClientException;
import org.springframework.web.client.RestClientResponseException;

/**
 * Turns a downstream failure into this service's own error code.
 *
 * <p>Two questions are answered here, and both matter for money:
 * <ul>
 *   <li><em>Did the service answer at all?</em> A timeout or a connection failure
 *       means the remote side may still have done the work — that is
 *       {@link OrderErrorCode#DOWNSTREAM_UNAVAILABLE} and the saga must not treat
 *       it as "nothing happened".</li>
 *   <li><em>What did it say?</em> An answered 4xx/5xx is
 *       {@code CATALOG_ERROR} / {@code PAYMENT_SERVICE_ERROR}: the remote logs hold
 *       the reason, and the outcome of the irreversible step is not inferred from
 *       an HTTP status.</li>
 * </ul>
 *
 * <p>The platform's {@code GlobalExceptionHandler} renders errors as RFC 7807, so
 * the downstream {@code code} field is read out of the body: it is the only stable
 * thing to switch on, and it is what lets {@code INSUFFICIENT_STOCK} become a
 * cancellation instead of an infrastructure incident.
 */
@Slf4j
public class DownstreamErrors {

    private static final Problem ABSENT = new Problem(0, null, null);

    private final ObjectMapper objectMapper;

    public DownstreamErrors(ObjectMapper objectMapper) {
        this.objectMapper = objectMapper;
    }

    /** A downstream problem+json reduced to the three fields worth keeping. */
    public record Problem(int httpStatus, String code, String detail) {

        public String summary() {
            StringBuilder out = new StringBuilder();
            if (code != null) {
                out.append(code);
            } else {
                out.append("HTTP ").append(httpStatus);
            }
            if (detail != null && !detail.isBlank()) {
                out.append(": ").append(detail);
            }
            return out.toString();
        }

        /** True when the caller cannot know whether the remote side acted. */
        public boolean isIndeterminate() {
            return httpStatus >= 500
                    || httpStatus == 408
                    || httpStatus == 429
                    || "CONFLICT".equals(code)
                    || "IDEMPOTENCY_CONFLICT".equals(code)
                    || "SERVICE_UNAVAILABLE".equals(code);
        }
    }

    public Problem describe(RestClientResponseException failure) {
        String body = failure.getResponseBodyAsString();
        try {
            if (body != null && !body.isBlank()) {
                ProblemDetails parsed = objectMapper.readValue(body, ProblemDetails.class);
                return new Problem(failure.getStatusCode().value(), parsed.code(),
                        parsed.detail() == null ? parsed.title() : parsed.detail());
            }
        } catch (Exception unreadable) {
            log.debug("downstream error body is not problem+json: {}", body);
        }
        return new Problem(failure.getStatusCode().value(), null, failure.getStatusText());
    }

    /** The service did not answer: the outcome is unknown, never "nothing happened". */
    public DomainException noAnswer(String service, String operation, RestClientException cause) {
        return DomainException.of(OrderErrorCode.DOWNSTREAM_UNAVAILABLE,
                        "{} did not answer while trying to {}", service, operation)
                .withDetail("service", service)
                .withDetail("operation", operation)
                .withDetail("cause", cause.getClass().getSimpleName());
    }

    /** The service answered with an error of its own. */
    public DomainException answeredWithError(OrderErrorCode code,
                                             String service,
                                             String operation,
                                             Problem problem) {
        return DomainException.of(code, "{} refused to {}: {}", service, operation, problem.summary())
                .withDetail("service", service)
                .withDetail("operation", operation)
                .withDetail("downstreamStatus", problem.httpStatus())
                .withDetail("downstreamCode", problem.code());
    }

    /** Read-only view of the fields of a problem+json body this service cares about. */
    @com.fasterxml.jackson.annotation.JsonIgnoreProperties(ignoreUnknown = true)
    private record ProblemDetails(String type, String title, Integer status, String detail, String code) {
    }
}
