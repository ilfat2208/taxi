package kz.taxi.common.kafka.codec;

import com.fasterxml.jackson.databind.DeserializationFeature;
import com.fasterxml.jackson.databind.JavaType;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import kz.taxi.common.core.event.EventEnvelope;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Component;

import java.util.LinkedHashMap;
import java.util.Map;

/**
 * Serializes {@link EventEnvelope} for Kafka and back.
 *
 * <p>Records are produced as UTF-8 JSON strings rather than binary Avro/Protobuf
 * because the schema story here is "the envelope is stable, the payload evolves":
 * unknown fields are ignored, missing fields surface as null instead of a
 * deserialization crash, and any teammate can read a topic with {@code kafka-console-consumer}.
 * A schema registry becomes worth its cost when several teams share the topic —
 * at that point only this class changes.
 */
@Component
@Slf4j
public class EventEnvelopeCodec {

    public static final String HEADER_EVENT_TYPE = "eventType";
    public static final String HEADER_EVENT_ID = "eventId";
    public static final String HEADER_AGGREGATE_TYPE = "aggregateType";
    public static final String HEADER_AGGREGATE_ID = "aggregateId";
    public static final String HEADER_CORRELATION_ID = "X-Correlation-Id";
    public static final String HEADER_CAUSATION_ID = "causationId";

    private final ObjectMapper objectMapper;

    public EventEnvelopeCodec(ObjectMapper objectMapper) {
        this.objectMapper = objectMapper;
    }

    public String encode(EventEnvelope<?> envelope) {
        try {
            return objectMapper.writeValueAsString(envelope);
        } catch (Exception ex) {
            throw new IllegalStateException(
                    "cannot serialize event %s of %s".formatted(envelope.eventType(), envelope.aggregateType()), ex);
        }
    }

    public <P> EventEnvelope<P> decode(String json, Class<P> payloadType) {
        try {
            JavaType envelopeType = objectMapper.getTypeFactory()
                    .constructParametricType(EventEnvelope.class, payloadType);
            // Tolerance is enforced here, not left to the application's mapper
            // configuration: producers must be able to add a payload field and
            // deploy before consumers catch up, whatever the local ObjectMapper
            // happens to be configured with.
            return objectMapper.readerFor(envelopeType)
                    .without(DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES)
                    .readValue(json);
        } catch (Exception ex) {
            log.error("cannot deserialize event envelope: {}", abbreviate(json), ex);
            throw new IllegalStateException("malformed event envelope", ex);
        }
    }

    /** Reads the envelope metadata without committing to a payload type. */
    public EventEnvelope<JsonNode> decodeToTree(String json) {
        return decode(json, JsonNode.class);
    }

    public String eventTypeOf(String json) {
        try {
            return objectMapper.readTree(json).path("eventType").asText(null);
        } catch (Exception ex) {
            return null;
        }
    }

    /** Headers that travel with the record, so consumers can route without parsing the body. */
    public Map<String, String> headers(EventEnvelope<?> envelope) {
        Map<String, String> headers = new LinkedHashMap<>();
        headers.put(HEADER_EVENT_ID, envelope.eventId());
        headers.put(HEADER_EVENT_TYPE, envelope.eventType());
        headers.put(HEADER_AGGREGATE_TYPE, envelope.aggregateType());
        headers.put(HEADER_AGGREGATE_ID, envelope.aggregateId());
        if (envelope.correlationId() != null) {
            headers.put(HEADER_CORRELATION_ID, envelope.correlationId());
        }
        if (envelope.causationId() != null) {
            headers.put(HEADER_CAUSATION_ID, envelope.causationId());
        }
        return headers;
    }

    public String encodeHeaders(EventEnvelope<?> envelope) {
        try {
            return objectMapper.writeValueAsString(headers(envelope));
        } catch (Exception ex) {
            throw new IllegalStateException("cannot serialize event headers", ex);
        }
    }

    @SuppressWarnings("unchecked")
    public Map<String, String> decodeHeaders(String json) {
        if (json == null || json.isBlank()) {
            return Map.of();
        }
        try {
            return objectMapper.readValue(json, Map.class);
        } catch (Exception ex) {
            log.warn("ignoring unreadable event headers: {}", abbreviate(json));
            return Map.of();
        }
    }

    private static String abbreviate(String value) {
        if (value == null) {
            return "null";
        }
        return value.length() <= 200 ? value : value.substring(0, 200) + "...";
    }
}
