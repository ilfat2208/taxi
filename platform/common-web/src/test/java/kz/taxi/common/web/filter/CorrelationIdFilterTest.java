package kz.taxi.common.web.filter;

import kz.taxi.common.core.context.CorrelationContext;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockFilterChain;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;

import static org.assertj.core.api.Assertions.assertThat;

class CorrelationIdFilterTest {

    private final CorrelationIdFilter filter = new CorrelationIdFilter();

    @AfterEach
    void tearDown() {
        CorrelationContext.clear();
    }

    @Test
    @DisplayName("mints and echoes a correlation id when the client sends none")
    void mints_correlation_id() throws Exception {
        MockHttpServletRequest request = new MockHttpServletRequest("GET", "/api/v1/accounts");
        MockHttpServletResponse response = new MockHttpServletResponse();

        filter.doFilter(request, response, new MockFilterChain());

        String header = response.getHeader(CorrelationContext.HEADER);
        assertThat(header).isNotNull().hasSize(26);
        assertThat(CorrelationContext.get()).isNull();
    }

    @Test
    @DisplayName("propagates the incoming correlation id to downstream services")
    void propagates_incoming_correlation_id() throws Exception {
        MockHttpServletRequest request = new MockHttpServletRequest("POST", "/api/v1/payments/transfers");
        request.addHeader(CorrelationContext.HEADER, "client-supplied-42");
        MockHttpServletResponse response = new MockHttpServletResponse();
        String[] seenInsideChain = new String[1];

        filter.doFilter(request, response, (req, res) -> seenInsideChain[0] = CorrelationContext.get());

        assertThat(seenInsideChain[0]).isEqualTo("client-supplied-42");
        assertThat(response.getHeader(CorrelationContext.HEADER)).isEqualTo("client-supplied-42");
    }

    @Test
    @DisplayName("ignores header values that could forge log lines")
    void rejects_unsafe_header() throws Exception {
        MockHttpServletRequest request = new MockHttpServletRequest("GET", "/api/v1/accounts");
        request.addHeader(CorrelationContext.HEADER, "abc\nERROR forged log line");
        MockHttpServletResponse response = new MockHttpServletResponse();

        filter.doFilter(request, response, new MockFilterChain());

        assertThat(response.getHeader(CorrelationContext.HEADER)).hasSize(26).doesNotContain("\n");
    }

    @Test
    @DisplayName("falls back to X-Request-Id for callers that use that convention")
    void accepts_request_id_alias() throws Exception {
        MockHttpServletRequest request = new MockHttpServletRequest("GET", "/api/v1/accounts");
        request.addHeader("X-Request-Id", "req-777");
        MockHttpServletResponse response = new MockHttpServletResponse();

        filter.doFilter(request, response, new MockFilterChain());

        assertThat(response.getHeader(CorrelationContext.HEADER)).isEqualTo("req-777");
    }
}
