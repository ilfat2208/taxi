package kz.taxi.payment.infrastructure;

import com.fasterxml.jackson.databind.ObjectMapper;
import kz.taxi.common.core.error.DomainException;
import kz.taxi.payment.domain.PaymentErrorCode;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Component;
import org.springframework.web.client.RestClientException;
import org.springframework.web.client.RestClientResponseException;

/**
 * Turns a failed account-service call into one of this service's own error codes.
 *
 * <p>The rule this class exists to enforce: <em>a business rejection made by the
 * account service is a business rejection of the payment API</em>. "Not enough
 * funds" was rejected by the bank, not by a bug here, and a caller that sees a 500
 * cannot tell the difference between "you have no money" and "the payment service
 * is broken" — the first is the customer's problem to solve, the second pages an
 * engineer. So:
 *
 * <table>
 *   <tr><th>downstream</th><th>this service</th></tr>
 *   <tr><td>422 {@code INSUFFICIENT_FUNDS}</td><td>422 {@code INSUFFICIENT_FUNDS}</td></tr>
 *   <tr><td>400 {@code INVALID_AMOUNT} / {@code CURRENCY_MISMATCH}</td><td>400 {@code INVALID_AMOUNT}</td></tr>
 *   <tr><td>401/403 or {@code FORBIDDEN_ACCOUNT_ACCESS}</td><td>403 {@code SOURCE_ACCOUNT_NOT_OWNED}</td></tr>
 *   <tr><td>any other 4xx</td><td>the caller's fallback for that call (409 {@code HOLD_FAILED} or 404 {@code TARGET_ACCOUNT_NOT_FOUND})</td></tr>
 *   <tr><td>5xx, timeout, connection refused, unreadable body</td><td>503 {@code DOWNSTREAM_UNAVAILABLE}</td></tr>
 * </table>
 *
 * <p>No path returns 500: the only exceptions that escape this service as 500 are
 * bugs in this service, never a reply from another one.
 */
@Component
@Slf4j
public class AccountServiceProblemTranslator {

    /** Identifies the counterpart in logs and in the problem's {@code details}. */
    public static final String DOWNSTREAM = "account-service";

    private static final int MESSAGE_LIMIT = 300;

    private final ObjectMapper objectMapper;

    public AccountServiceProblemTranslator(ObjectMapper objectMapper) {
        this.objectMapper = objectMapper;
    }

    /**
     * @param failure                whatever the HTTP call threw
     * @param fallbackForClientError code to use for a 4xx that carries no code this
     *                               service knows (per call site: reading the source
     *                               account, resolving a recipient, moving money)
     * @param operation              what was attempted, for the human reading the error
     */
    public DomainException translate(RuntimeException failure,
                                     PaymentErrorCode fallbackForClientError,
                                     String operation) {
        if (failure instanceof DomainException alreadyTyped) {
            return alreadyTyped;
        }

        if (failure instanceof RestClientResponseException responseFailure) {
            if (responseFailure.getStatusCode().is4xxClientError()) {
                AccountServiceDtos.ProblemDocument problem = readProblem(responseFailure.getResponseBodyAsString());
                PaymentErrorCode mapped = mapClientError(responseFailure.getStatusCode().value(), problem,
                        fallbackForClientError);
                log.debug("account-service rejected {} with {} ({}), mapped to {}",
                        operation, responseFailure.getStatusCode().value(),
                        problem == null ? "no problem body" : problem.code(), mapped.code());
                DomainException translated = DomainException.of(mapped,
                        "account-service refused to {}: {}", operation, describe(problem, responseFailure));
                return withDownstreamDetails(translated, responseFailure.getStatusCode().value(),
                        problem == null ? null : problem.code());
            }
            log.warn("account-service failed {} with {}", operation, responseFailure.getStatusCode().value());
            return unavailable(operation, "HTTP " + responseFailure.getStatusCode().value());
        }

        if (failure instanceof RestClientException) {
            log.warn("account-service call failed while trying to {}: {}", operation, failure.toString());
            return unavailable(operation, failure.getClass().getSimpleName());
        }

        // Anything else that came out of the call is still a downstream problem:
        // turning it into a 500 here would blame this service for a failure it
        // cannot fix and hide the retry that would have worked.
        log.warn("unexpected failure while trying to {} on account-service", operation, failure);
        return unavailable(operation, failure.getClass().getSimpleName());
    }

    private DomainException unavailable(String operation, String reason) {
        DomainException translated = DomainException.of(PaymentErrorCode.DOWNSTREAM_UNAVAILABLE,
                "account-service could not be used to {}: {}", operation, reason);
        return withDownstreamDetails(translated, null, null);
    }

    private static PaymentErrorCode mapClientError(int status,
                                                   AccountServiceDtos.ProblemDocument problem,
                                                   PaymentErrorCode fallback) {
        if (status == 401 || status == 403) {
            return PaymentErrorCode.SOURCE_ACCOUNT_NOT_OWNED;
        }
        String downstreamCode = problem == null ? null : problem.code();
        if (downstreamCode != null) {
            switch (downstreamCode) {
                case "INSUFFICIENT_FUNDS" -> {
                    return PaymentErrorCode.INSUFFICIENT_FUNDS;
                }
                case "LIMIT_EXCEEDED", "VELOCITY_EXCEEDED" -> {
                    // A refusal by the payer's own limits is a decision the customer can
                    // act on ("you have reached today's limit"), not an incident. Without
                    // these cases it fell through to the call site's 409 HOLD_FAILED and
                    // the reason survived only in `details.downstreamCode`, which is how a
                    // product tells a user "something went wrong" about something they
                    // could have fixed themselves.
                    return PaymentErrorCode.LIMIT_EXCEEDED;
                }
                case "INVALID_AMOUNT", "CURRENCY_MISMATCH" -> {
                    return PaymentErrorCode.INVALID_AMOUNT;
                }
                case "FORBIDDEN_ACCOUNT_ACCESS" -> {
                    return PaymentErrorCode.SOURCE_ACCOUNT_NOT_OWNED;
                }
                default -> {
                    // Fall through to the call site's fallback: the account service
                    // refused for a reason that is well-defined for that call.
                }
            }
        }
        return fallback;
    }

    private AccountServiceDtos.ProblemDocument readProblem(String body) {
        if (body == null || body.isBlank()) {
            return null;
        }
        try {
            return objectMapper.readValue(body, AccountServiceDtos.ProblemDocument.class);
        } catch (Exception parseFailure) {
            log.debug("account-service error body is not a problem document: {}", body);
            return null;
        }
    }

    private static String describe(AccountServiceDtos.ProblemDocument problem,
                                   RestClientResponseException responseFailure) {
        String message = problem == null ? null : problem.bestMessage();
        if (message == null || message.isBlank()) {
            message = responseFailure.getStatusText();
        }
        if (message == null || message.isBlank()) {
            message = "HTTP " + responseFailure.getStatusCode().value();
        }
        String flattened = message.replace('\n', ' ').replace('\r', ' ').trim();
        return flattened.length() <= MESSAGE_LIMIT ? flattened : flattened.substring(0, MESSAGE_LIMIT);
    }

    private static DomainException withDownstreamDetails(DomainException exception, Integer status, String code) {
        DomainException detailed = exception.withDetail("downstream", DOWNSTREAM);
        if (status != null) {
            detailed = detailed.withDetail("downstreamStatus", status);
        }
        if (code != null) {
            detailed = detailed.withDetail("downstreamCode", code);
        }
        return detailed;
    }
}
