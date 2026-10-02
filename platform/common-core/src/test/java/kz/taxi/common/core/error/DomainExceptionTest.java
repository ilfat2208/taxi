package kz.taxi.common.core.error;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class DomainExceptionTest {

    @Test
    @DisplayName("formats {} placeholders in order")
    void formats_placeholders() {
        DomainException ex = DomainException.notFound("account {} not found for user {}", "A1", "U9");

        assertThat(ex.getMessage()).isEqualTo("account A1 not found for user U9");
        assertThat(ex.errorCode()).isEqualTo(CommonErrorCode.NOT_FOUND);
        assertThat(ex.errorCode().httpStatus()).isEqualTo(404);
    }

    @Test
    @DisplayName("keeps the template when there are fewer arguments than placeholders")
    void keeps_unfilled_placeholders() {
        DomainException ex = DomainException.conflict("payment {} already {}", "P1");

        assertThat(ex.getMessage()).isEqualTo("payment P1 already {}");
    }

    @Test
    @DisplayName("carries structured details for clients and support")
    void carries_details() {
        DomainException ex = DomainException.conflict("insufficient funds")
                .withDetail("accountId", "A1")
                .withDetail("available", 100);

        assertThat(ex.details()).containsEntry("accountId", "A1").containsEntry("available", 100);
        assertThat(ex.errorCode().code()).isEqualTo("CONFLICT");
    }

    @Test
    @DisplayName("does not capture stack traces: business failures are expected")
    void skips_stack_trace() {
        DomainException ex = DomainException.validation("bad request");

        assertThat(ex.getStackTrace()).isEmpty();
        assertThatThrownBy(() -> {
            throw ex;
        }).isSameAs(ex);
    }
}
