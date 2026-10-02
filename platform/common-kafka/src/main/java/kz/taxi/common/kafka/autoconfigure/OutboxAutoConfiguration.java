package kz.taxi.common.kafka.autoconfigure;

import kz.taxi.common.kafka.codec.EventEnvelopeCodec;
import kz.taxi.common.kafka.outbox.OutboxProperties;
import kz.taxi.common.kafka.outbox.OutboxRelay;
import kz.taxi.common.kafka.outbox.OutboxRepository;
import kz.taxi.common.kafka.outbox.OutboxWriter;
import jakarta.persistence.EntityManager;
import lombok.extern.slf4j.Slf4j;
import org.springframework.boot.autoconfigure.AutoConfiguration;
import org.springframework.boot.autoconfigure.condition.ConditionalOnBean;
import org.springframework.boot.autoconfigure.condition.ConditionalOnClass;
import org.springframework.boot.autoconfigure.condition.ConditionalOnMissingBean;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.context.annotation.Bean;
import org.springframework.kafka.core.KafkaTemplate;
import org.springframework.scheduling.annotation.EnableScheduling;

/**
 * Wires the transactional outbox.
 *
 * <p>Requires JPA (the outbox table lives in the service's own database) and a
 * {@code KafkaTemplate}. Both are transitive through {@code common-kafka}, so a
 * service only needs to add the {@code outbox_message} table to its Flyway
 * migrations — one table, per service, in the service's own schema.
 */
@AutoConfiguration(after = KafkaMessagingAutoConfiguration.class)
@ConditionalOnClass({EntityManager.class, KafkaTemplate.class})
@ConditionalOnBean(OutboxRepository.class)
@EnableConfigurationProperties(OutboxProperties.class)
@EnableScheduling
@Slf4j
public class OutboxAutoConfiguration {

    @Bean
    @ConditionalOnMissingBean
    public OutboxWriter outboxWriter(OutboxRepository outboxRepository, EventEnvelopeCodec codec) {
        return new OutboxWriter(outboxRepository, codec);
    }

    @Bean
    @ConditionalOnMissingBean
    @ConditionalOnProperty(prefix = "taxi.outbox", name = "enabled", havingValue = "true", matchIfMissing = true)
    public OutboxRelay outboxRelay(OutboxRepository outboxRepository,
                                   KafkaTemplate<String, String> kafkaTemplate,
                                   EventEnvelopeCodec codec,
                                   OutboxProperties properties) {
        log.info("outbox relay enabled: batchSize={}, pollInterval={}, maxAttempts={}",
                properties.batchSize(), properties.pollInterval(), properties.maxAttempts());
        return new OutboxRelay(outboxRepository, kafkaTemplate, codec, properties);
    }
}
