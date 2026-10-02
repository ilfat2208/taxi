package kz.taxi.common.kafka.autoconfigure;

import com.fasterxml.jackson.databind.ObjectMapper;
import kz.taxi.common.kafka.KafkaTopics;
import kz.taxi.common.kafka.codec.EventEnvelopeCodec;
import kz.taxi.common.kafka.consumer.IdempotentEventHandler;
import kz.taxi.common.kafka.consumer.InMemoryProcessedEventStore;
import kz.taxi.common.kafka.consumer.ProcessedEventProperties;
import kz.taxi.common.kafka.consumer.ProcessedEventStore;
import kz.taxi.common.kafka.consumer.RedisProcessedEventStore;
import lombok.extern.slf4j.Slf4j;
import org.apache.kafka.clients.admin.NewTopic;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.autoconfigure.AutoConfiguration;
import org.springframework.boot.autoconfigure.condition.ConditionalOnClass;
import org.springframework.boot.autoconfigure.condition.ConditionalOnMissingBean;
import org.springframework.boot.autoconfigure.kafka.ConcurrentKafkaListenerContainerFactoryConfigurer;
import org.springframework.boot.autoconfigure.kafka.KafkaAutoConfiguration;
import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.context.annotation.Bean;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.kafka.config.ConcurrentKafkaListenerContainerFactory;
import org.springframework.kafka.core.ConsumerFactory;
import org.springframework.kafka.core.KafkaAdmin;
import org.springframework.kafka.core.KafkaTemplate;
import org.springframework.kafka.listener.DeadLetterPublishingRecoverer;
import org.springframework.kafka.listener.DefaultErrorHandler;
import org.springframework.util.backoff.FixedBackOff;

import java.util.Arrays;
import java.util.stream.Stream;

/**
 * Kafka wiring shared by every service.
 *
 * <p>What this buys over plain {@code @KafkaListener}:
 * <ul>
 *   <li>Deliberate failure semantics — 3 retries with a 1s backoff, then the
 *       record is published to {@code <topic>.DLT} instead of being retried
 *       forever (a poison record must not stall a partition).</li>
 *   <li>Offset commit only after successful handling
 *       ({@code AckMode.RECORD}), which is what makes the dedup store the
 *       second half of an at-least-once + idempotent-consumer story.</li>
 *   <li>Topics are declared as code, so a fresh cluster comes up correct
 *       without a manual {@code kafka-topics.sh} step.</li>
 * </ul>
 *
 * <p>Runs before Boot's {@code KafkaAutoConfiguration} so that this consumer
 * container factory (with the dead-letter error handler) wins over the default one.
 */
@AutoConfiguration(before = KafkaAutoConfiguration.class)
@ConditionalOnClass({KafkaTemplate.class, ConsumerFactory.class})
@EnableConfigurationProperties(ProcessedEventProperties.class)
@Slf4j
public class KafkaMessagingAutoConfiguration {

    @Bean
    @ConditionalOnMissingBean
    public EventEnvelopeCodec eventEnvelopeCodec(ObjectMapper objectMapper) {
        return new EventEnvelopeCodec(objectMapper);
    }

    @Bean
    @ConditionalOnMissingBean
    public DefaultErrorHandler kafkaDeadLetterErrorHandler(KafkaTemplate<String, String> kafkaTemplate) {
        DeadLetterPublishingRecoverer recoverer = new DeadLetterPublishingRecoverer(kafkaTemplate);
        DefaultErrorHandler handler = new DefaultErrorHandler(recoverer, new FixedBackOff(1000L, 3L));
        // The offset is committed after the record reaches the DLT, so a DLT write
        // failure does not silently lose the event.
        handler.setCommitRecovered(true);
        handler.addNotRetryableExceptions(IllegalArgumentException.class);
        return handler;
    }

    @Bean(name = "kafkaListenerContainerFactory")
    @ConditionalOnMissingBean(name = "kafkaListenerContainerFactory")
    public ConcurrentKafkaListenerContainerFactory<Object, Object> kafkaListenerContainerFactory(
            ObjectProvider<ConcurrentKafkaListenerContainerFactoryConfigurer> configurer,
            ConsumerFactory<Object, Object> consumerFactory,
            DefaultErrorHandler errorHandler) {

        ConcurrentKafkaListenerContainerFactory<Object, Object> factory =
                new ConcurrentKafkaListenerContainerFactory<>();
        // Boot's configurer applies every spring.kafka.listener.* property, so the
        // YAML stays the single place where consumer tuning lives.
        configurer.ifAvailable(customizer -> customizer.configure(factory, consumerFactory));
        if (factory.getConsumerFactory() == null) {
            factory.setConsumerFactory(consumerFactory);
        }

        factory.setCommonErrorHandler(errorHandler);
        // A service may start before its topics exist; that must not be fatal.
        factory.setMissingTopicsFatal(false);
        return factory;
    }

    @Bean
    @ConditionalOnMissingBean
    public ProcessedEventStore processedEventStore(ProcessedEventProperties properties,
                                                   ObjectProvider<StringRedisTemplate> redisTemplate) {
        StringRedisTemplate template = redisTemplate.getIfAvailable();
        if (properties.store() == ProcessedEventProperties.Store.REDIS && template != null) {
            log.info("consumer dedup store: redis (ttl={})", properties.ttl());
            return new RedisProcessedEventStore(template, properties);
        }
        log.warn("consumer dedup store: in-memory — duplicates across replicas will not be detected");
        return new InMemoryProcessedEventStore(properties.ttl());
    }

    @Bean
    @ConditionalOnMissingBean
    public IdempotentEventHandler idempotentEventHandler(EventEnvelopeCodec codec,
                                                         ProcessedEventStore processedEventStore) {
        return new IdempotentEventHandler(codec, processedEventStore);
    }

    /**
     * Declares every topic plus its dead-letter companion.
     *
     * <p>{@code KafkaAdmin} creates them on startup. Automatic topic creation is
     * left enabled only for convenience in local runs; the declaration here is
     * the source of truth for partitions and replication.
     */
    @Bean
    @ConditionalOnMissingBean
    public KafkaAdmin.NewTopics taxiNewTopics(@Value("${taxi.kafka.partitions:3}") int partitions,
                                               @Value("${taxi.kafka.replicas:1}") int replicas) {
        NewTopic[] topics = KafkaTopics.all().stream()
                .flatMap(topic -> Stream.of(
                        new NewTopic(topic, partitions, (short) replicas),
                        new NewTopic(KafkaTopics.deadLetterFor(topic), partitions, (short) replicas)))
                .toArray(NewTopic[]::new);
        log.info("declaring kafka topics: {}", Arrays.toString(topics));
        return new KafkaAdmin.NewTopics(topics);
    }
}
