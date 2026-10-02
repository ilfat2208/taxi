package kz.taxi.qtime.api;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.SerializationFeature;
import jakarta.servlet.Filter;
import kz.taxi.common.web.error.GlobalExceptionHandler;
import org.springframework.http.converter.json.MappingJackson2HttpMessageConverter;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;

/**
 * A standalone {@link MockMvc} wired the way Spring Boot wires the real application.
 *
 * <p>Two details matter and both are easy to get wrong. First, {@code findAndRegisterModules}
 * plus {@code WRITE_DATES_AS_TIMESTAMPS = false}: without it a bare {@code ObjectMapper} in a
 * standalone setup serialises an {@link java.time.Instant} as a decimal epoch number, and a
 * test that then asserts ISO-8601 would be asserting something the production application
 * does not do either way. Second, the platform's {@link GlobalExceptionHandler} is installed
 * explicitly, because that is what turns a {@code DomainException} into problem+json — the
 * whole point of these tests is the status code a client actually receives.
 */
final class ApiTestSupport {

    private ApiTestSupport() {
    }

    static MockMvc standalone(Object controller, Filter... filters) {
        ObjectMapper objectMapper = new ObjectMapper();
        objectMapper.findAndRegisterModules();
        objectMapper.disable(SerializationFeature.WRITE_DATES_AS_TIMESTAMPS);
        return MockMvcBuilders
                .standaloneSetup(controller)
                .setControllerAdvice(new GlobalExceptionHandler("https://docs.taxi.local/errors"))
                .setMessageConverters(new MappingJackson2HttpMessageConverter(objectMapper))
                .addFilters(filters)
                .build();
    }
}
