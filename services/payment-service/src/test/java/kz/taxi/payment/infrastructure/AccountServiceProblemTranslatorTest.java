package kz.taxi.payment.infrastructure;

import com.fasterxml.jackson.databind.ObjectMapper;
import kz.taxi.common.core.error.DomainException;
import kz.taxi.payment.domain.PaymentErrorCode;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.web.client.HttpClientErrorException;
import org.springframework.web.client.HttpServerErrorException;
import org.springframework.web.client.ResourceAccessException;

import java.net.SocketTimeoutException;
import java.nio.charset.StandardCharsets;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * Translation of the account service's failures into this service's own errors.
 *
 * <p>The property under test is not the wording but the classification: a customer
 * who has no money and a payment service whose dependency is down must not look the
 * same to the caller, and neither of them may look like a bug in this service.
 */
class AccountServiceProblemTranslatorTest {

    private final AccountServiceProblemTranslator translator =
            new AccountServiceProblemTranslator(new ObjectMapper());

    @Test
    @DisplayName("INSUFFICIENT_FUNDS stays INSUFFICIENT_FUNDS at 422")
    void business_rejection_keeps_its_code_and_status() {
        DomainException translated = translator.translate(clientError(HttpStatus.UNPROCESSABLE_ENTITY, """
                {"type":"https://docs.taxi.local/errors/INSUFFICIENT_FUNDS",
                 "title":"Unprocessable Entity","status":422,"code":"INSUFFICIENT_FUNDS",
                 "detail":"account A-1 has 5.00 KZT but 10.00 KZT is required"}
                """), PaymentErrorCode.HOLD_FAILED, "reserve funds for a payment");

        assertThat(translated.errorCode()).isEqualTo(PaymentErrorCode.INSUFFICIENT_FUNDS);
        assertThat(translated.errorCode().httpStatus()).isEqualTo(422);
        assertThat(translated.getMessage()).contains("5.00 KZT");
        assertThat(translated.details()).containsEntry("downstream", "account-service");
        assertThat(translated.details()).containsEntry("downstreamCode", "INSUFFICIENT_FUNDS");
    }

    @Test
    @DisplayName("a 503 from the account service becomes DOWNSTREAM_UNAVAILABLE, never a 500")
    void server_error_becomes_a_service_unavailable() {
        DomainException translated = translator.translate(serverError(HttpStatus.SERVICE_UNAVAILABLE),
                PaymentErrorCode.HOLD_FAILED, "reserve funds for a payment");

        assertThat(translated.errorCode()).isEqualTo(PaymentErrorCode.DOWNSTREAM_UNAVAILABLE);
        assertThat(translated.errorCode().httpStatus()).isEqualTo(503);
        assertThat(translated.errorCode().httpStatus()).isNotEqualTo(500);
    }

    @Test
    @DisplayName("a timeout or a refused connection is not a payment bug either")
    void connectivity_failure_becomes_a_service_unavailable() {
        DomainException timeout = translator.translate(
                new ResourceAccessException("I/O error", new SocketTimeoutException("read timed out")),
                PaymentErrorCode.HOLD_FAILED, "move reserved funds");
        DomainException refused = translator.translate(
                new ResourceAccessException("Connection refused"),
                PaymentErrorCode.HOLD_FAILED, "reserve funds for a payment");

        assertThat(timeout.errorCode()).isEqualTo(PaymentErrorCode.DOWNSTREAM_UNAVAILABLE);
        assertThat(refused.errorCode()).isEqualTo(PaymentErrorCode.DOWNSTREAM_UNAVAILABLE);
    }

    @Test
    @DisplayName("an unexpected failure type is still treated as a downstream problem")
    void unknown_failures_do_not_escape_as_500() {
        DomainException translated = translator.translate(new IllegalStateException("something odd"),
                PaymentErrorCode.HOLD_FAILED, "read the source account");

        assertThat(translated.errorCode()).isEqualTo(PaymentErrorCode.DOWNSTREAM_UNAVAILABLE);
        assertThat(translated.errorCode().httpStatus()).isNotEqualTo(500);
    }

    @Test
    @DisplayName("an authorization refusal downstream is the caller's problem, not an outage")
    void forbidden_becomes_source_account_not_owned() {
        DomainException translated = translator.translate(clientError(HttpStatus.FORBIDDEN, """
                {"status":403,"code":"FORBIDDEN_ACCOUNT_ACCESS","detail":"account A-9 belongs to another user"}
                """), PaymentErrorCode.SOURCE_ACCOUNT_NOT_OWNED, "read the source account");

        assertThat(translated.errorCode()).isEqualTo(PaymentErrorCode.SOURCE_ACCOUNT_NOT_OWNED);
        assertThat(translated.errorCode().httpStatus()).isEqualTo(403);
    }

    @Test
    @DisplayName("a 404 keeps the meaning of the call site: a missing recipient is not a failed hold")
    void not_found_uses_the_call_site_fallback() {
        DomainException asRecipient = translator.translate(clientError(HttpStatus.NOT_FOUND, """
                {"status":404,"code":"ACCOUNT_NOT_FOUND","detail":"no active KZT account for phone +7700"}
                """), PaymentErrorCode.TARGET_ACCOUNT_NOT_FOUND, "resolve the recipient account");
        DomainException asHold = translator.translate(clientError(HttpStatus.NOT_FOUND, """
                {"status":404,"code":"ACCOUNT_NOT_FOUND","detail":"account A-1 not found"}
                """), PaymentErrorCode.HOLD_FAILED, "reserve funds for a payment");

        assertThat(asRecipient.errorCode()).isEqualTo(PaymentErrorCode.TARGET_ACCOUNT_NOT_FOUND);
        assertThat(asRecipient.errorCode().httpStatus()).isEqualTo(404);
        assertThat(asHold.errorCode()).isEqualTo(PaymentErrorCode.HOLD_FAILED);
        assertThat(asHold.errorCode().httpStatus()).isEqualTo(409);
    }

    @Test
    @DisplayName("an amount the account service refuses stays a 400")
    void invalid_amount_stays_a_client_error() {
        DomainException translated = translator.translate(clientError(HttpStatus.BAD_REQUEST, """
                {"status":400,"code":"CURRENCY_MISMATCH","detail":"account A-1 is in KZT but USD was supplied"}
                """), PaymentErrorCode.HOLD_FAILED, "reserve funds for a payment");

        assertThat(translated.errorCode()).isEqualTo(PaymentErrorCode.INVALID_AMOUNT);
        assertThat(translated.errorCode().httpStatus()).isEqualTo(400);
    }

    @Test
    @DisplayName("an unreadable or empty error body still produces a business error")
    void unreadable_problem_body_falls_back() {
        DomainException noBody = translator.translate(clientError(HttpStatus.CONFLICT, ""),
                PaymentErrorCode.HOLD_FAILED, "capture hold");
        DomainException notJson = translator.translate(clientError(HttpStatus.CONFLICT, "<html>gateway</html>"),
                PaymentErrorCode.HOLD_FAILED, "capture hold");

        assertThat(noBody.errorCode()).isEqualTo(PaymentErrorCode.HOLD_FAILED);
        assertThat(notJson.errorCode()).isEqualTo(PaymentErrorCode.HOLD_FAILED);
        assertThat(noBody.errorCode().httpStatus()).isEqualTo(409);
    }

    @Test
    @DisplayName("an already typed failure is passed through untouched")
    void domain_failures_are_not_rewrapped() {
        DomainException original = DomainException.of(PaymentErrorCode.SELF_TRANSFER_NOT_ALLOWED, "same account");

        assertThat(translator.translate(original, PaymentErrorCode.HOLD_FAILED, "anything")).isSameAs(original);
    }

    private static HttpClientErrorException clientError(HttpStatus status, String body) {
        return HttpClientErrorException.create(status, status.getReasonPhrase(), HttpHeaders.EMPTY,
                body.getBytes(StandardCharsets.UTF_8), StandardCharsets.UTF_8);
    }

    private static HttpServerErrorException serverError(HttpStatus status) {
        return HttpServerErrorException.create(status, status.getReasonPhrase(), HttpHeaders.EMPTY,
                new byte[0], StandardCharsets.UTF_8);
    }
}
