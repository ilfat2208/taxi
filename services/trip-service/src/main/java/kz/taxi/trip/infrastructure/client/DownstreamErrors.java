package kz.taxi.trip.infrastructure.client;

import com.fasterxml.jackson.databind.ObjectMapper;
import kz.taxi.common.core.error.DomainException;
import kz.taxi.trip.domain.TripErrorCode;
import lombok.extern.slf4j.Slf4j;
import org.springframework.web.client.RestClientException;
import org.springframework.web.client.RestClientResponseException;

/**
 * Turns a downstream failure into one of this service's own error codes.
 *
 * <p>Three questions are answered here, and each answer changes what the trip saga
 * does next:
 *
 * <ol>
 *   <li><b>Did the service answer?</b> No answer (a timeout, a refused connection) is
 *       {@link TripErrorCode#DOWNSTREAM_UNAVAILABLE} and 503, never a business outcome:
 *       inferring "the driver was busy" from a timeout would send a rider away from a
 *       car that may already be on its way to him.</li>
 *   <li><b>Was it a refusal we understand?</b> {@code INSUFFICIENT_FUNDS} keeps its
 *       own code and status across the hop, {@code DRIVER_ALREADY_ON_TRIP} and
 *       {@code DRIVER_NOT_ON_DUTY} become {@link TripErrorCode#DRIVER_NOT_AVAILABLE} —
 *       a car that is not free is a normal answer to "give me a car", and the search
 *       simply tries the next one.</li>
 *   <li><b>Was it a refusal we do not understand?</b> Then it is an incident of that
 *       service ({@code *_SERVICE_ERROR}, 502) and not a business decision of this one.
 *       Guessing here is how a platform starts cancelling rides for reasons nobody
 *       can explain.</li>
 * </ol>
 */
@Slf4j
public class DownstreamErrors {

    /** Identifies the counterpart in logs and in the problem's {@code details}. */
    public static final String ACCOUNT_SERVICE = "account-service";
    public static final String DISPATCH_SERVICE = "dispatch-service";
    public static final String DRIVER_SERVICE = "driver-service";

    private static final int MESSAGE_LIMIT = 300;

    private final ObjectMapper objectMapper;

    public DownstreamErrors(ObjectMapper objectMapper) {
        this.objectMapper = objectMapper;
    }

    /** A downstream problem+json reduced to the fields worth keeping. */
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
    }

    /** Reads the problem document of an answered error, tolerating a body that is not one. */
    public Problem describe(RestClientResponseException failure) {
        String body = failure.getResponseBodyAsString();
        try {
            if (body != null && !body.isBlank()) {
                ClientDtos.ProblemDocument parsed = objectMapper.readValue(body, ClientDtos.ProblemDocument.class);
                return new Problem(failure.getStatusCode().value(), parsed.code(),
                        flatten(parsed.bestMessage()));
            }
        } catch (Exception unreadable) {
            log.debug("downstream error body is not problem+json: {}", body);
        }
        return new Problem(failure.getStatusCode().value(), null, failure.getStatusText());
    }

    /** A refusal the caller understands, translated into this service's vocabulary. */
    public DomainException refused(TripErrorCode code, String service, String operation, Problem problem) {
        return DomainException.of(code, "{} refused to {}: {}", service, operation, problem.summary())
                .withDetail("service", service)
                .withDetail("operation", operation)
                .withDetail("downstreamStatus", problem.httpStatus())
                .withDetail("downstreamCode", problem.code());
    }

    /** An answered error this service cannot interpret. */
    public DomainException unanswered(TripErrorCode code, String service, String operation, Problem problem) {
        log.warn("{} answered {} while trying to {}", service, problem.httpStatus(), operation);
        return DomainException.of(code, "{} could not {}: {}", service, operation, problem.summary())
                .withDetail("service", service)
                .withDetail("operation", operation)
                .withDetail("downstreamStatus", problem.httpStatus())
                .withDetail("downstreamCode", problem.code());
    }

    /** No answer at all: the outcome is unknown, and unknown is never "nothing happened". */
    public DomainException noAnswer(String service, String operation, RestClientException cause) {
        log.warn("{} did not answer while trying to {}: {}", service, operation, cause.toString());
        return DomainException.of(TripErrorCode.DOWNSTREAM_UNAVAILABLE,
                        "{} did not answer while trying to {}", service, operation)
                .withDetail("service", service)
                .withDetail("operation", operation)
                .withDetail("cause", cause.getClass().getSimpleName());
    }

    /** A 2xx without a body: the contract was not honoured, and saying so beats a NullPointer. */
    public DomainException emptyBody(TripErrorCode code, String service, String operation) {
        return DomainException.of(code, "{} answered {} without a body", service, operation)
                .withDetail("service", service)
                .withDetail("operation", operation);
    }

    private static String flatten(String message) {
        if (message == null) {
            return null;
        }
        String flattened = message.replace('\n', ' ').replace('\r', ' ').trim();
        return flattened.length() <= MESSAGE_LIMIT ? flattened : flattened.substring(0, MESSAGE_LIMIT);
    }
}
