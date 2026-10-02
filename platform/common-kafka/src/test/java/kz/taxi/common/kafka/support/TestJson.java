package kz.taxi.common.kafka.support;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.json.JsonMapper;
import com.fasterxml.jackson.datatype.jsr310.JavaTimeModule;

/**
 * ObjectMapper for tests.
 *
 * <p>Production code receives Spring Boot's mapper, which already registers the
 * JSR-310 module (otherwise {@code Instant} — part of every event envelope — is
 * not serializable). Tests build their own, so they must be explicit about it.
 */
public final class TestJson {

    private TestJson() {
    }

    public static ObjectMapper mapper() {
        return JsonMapper.builder()
                .addModule(new JavaTimeModule())
                .build();
    }
}
