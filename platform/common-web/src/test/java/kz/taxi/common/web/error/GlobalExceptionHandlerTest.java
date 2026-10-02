package kz.taxi.common.web.error;

import kz.taxi.common.core.context.CorrelationContext;
import kz.taxi.common.core.error.CommonErrorCode;
import kz.taxi.common.core.error.DomainException;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.validation.BeanPropertyBindingResult;
import org.springframework.validation.BindException;

import static org.assertj.core.api.Assertions.assertThat;

class GlobalExceptionHandlerTest {

    /** Minimal bean so the binding result can attach a field error to a real property. */
    public static class TransferRequest {
        private long amount;

        public long getAmount() {
            return amount;
        }

        public void setAmount(long amount) {
            this.amount = amount;
        }
    }

    private final GlobalExceptionHandler handler =
            new GlobalExceptionHandler("https://docs.taxi.local/errors");

    @AfterEach
    void tearDown() {
        CorrelationContext.clear();
    }

    private MockHttpServletRequest request() {
        MockHttpServletRequest request = new MockHttpServletRequest("POST", "/api/v1/payments/transfers");
        CorrelationContext.set("corr-1");
        return request;
    }

    @Test
    @DisplayName("maps a domain failure to its own status, code and problem+json body")
    void maps_domain_exception() {
        DomainException ex = DomainException.conflict("insufficient funds")
                .withDetail("accountId", "A1");

        ResponseEntity<ApiProblem> response = handler.handleDomain(ex, request());

        assertThat(response.getStatusCode().value()).isEqualTo(409);
        assertThat(response.getHeaders().getContentType()).isEqualTo(MediaType.APPLICATION_PROBLEM_JSON);
        ApiProblem body = response.getBody();
        assertThat(body).isNotNull();
        assertThat(body.code()).isEqualTo("CONFLICT");
        assertThat(body.detail()).isEqualTo("insufficient funds");
        assertThat(body.correlationId()).isEqualTo("corr-1");
        assertThat(body.details()).containsEntry("accountId", "A1");
        assertThat(body.instance()).isEqualTo("/api/v1/payments/transfers");
        assertThat(body.type().toString()).endsWith("/CONFLICT");
    }

    @Test
    @DisplayName("reports field-level violations for an invalid body")
    void maps_validation_failure() {
        BeanPropertyBindingResult binding =
                new BeanPropertyBindingResult(new TransferRequest(), "transferRequest");
        binding.rejectValue("amount", "Positive", "must be positive");
        MockHttpServletRequest request = request();

        ResponseEntity<ApiProblem> response = handler.handleBinding(new BindException(binding), request);

        assertThat(response.getStatusCode().value()).isEqualTo(400);
        assertThat(response.getBody().errors())
                .singleElement()
                .satisfies(violation -> {
                    assertThat(violation.field()).isEqualTo("amount");
                    assertThat(violation.message()).isEqualTo("must be positive");
                });
    }

    @Test
    @DisplayName("never leaks an unexpected exception message to the client")
    void hides_internal_failures() {
        MockHttpServletRequest request = request();

        ResponseEntity<ApiProblem> response = handler.handleUnexpected(
                new IllegalStateException("jdbc connection string user=taxi password=secret"),
                request);

        assertThat(response.getStatusCode().value()).isEqualTo(500);
        ApiProblem body = response.getBody();
        assertThat(body.code()).isEqualTo(CommonErrorCode.INTERNAL_ERROR.code());
        assertThat(body.detail()).doesNotContain("password").contains("corr-1");
    }

    @Test
    @DisplayName("uses the error code default message when the exception has none")
    void falls_back_to_default_message() {
        ResponseEntity<ApiProblem> response =
                handler.handleDomain(DomainException.of(CommonErrorCode.FORBIDDEN), request());

        assertThat(response.getStatusCode().value()).isEqualTo(403);
        assertThat(response.getBody().detail()).isEqualTo("Access denied");
    }
}
