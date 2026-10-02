package kz.taxi.common.web.autoconfigure;

import com.fasterxml.jackson.databind.ObjectMapper;
import kz.taxi.common.web.error.GlobalExceptionHandler;
import kz.taxi.common.web.filter.CorrelationIdFilter;
import kz.taxi.common.web.filter.RequestLoggingFilter;
import kz.taxi.common.web.idempotency.IdempotencyGuard;
import kz.taxi.common.web.idempotency.IdempotencyKeyFilter;
import kz.taxi.common.web.idempotency.IdempotencyProperties;
import kz.taxi.common.web.idempotency.IdempotencyStore;
import kz.taxi.common.web.idempotency.InMemoryIdempotencyStore;
import kz.taxi.common.web.idempotency.RedisIdempotencyStore;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.boot.autoconfigure.AutoConfiguration;
import org.springframework.boot.autoconfigure.condition.ConditionalOnMissingBean;
import org.springframework.boot.autoconfigure.condition.ConditionalOnWebApplication;
import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Import;
import org.springframework.data.redis.core.StringRedisTemplate;

/**
 * Auto-configuration for the shared REST boundary.
 *
 * <p>A service gets correlation ids, RFC 7807 errors, request logging and
 * idempotency support simply by depending on {@code common-web} — no
 * {@code @Import} or component scan of platform packages in the service.
 */
@AutoConfiguration
@ConditionalOnWebApplication(type = ConditionalOnWebApplication.Type.SERVLET)
@EnableConfigurationProperties(IdempotencyProperties.class)
@Import({GlobalExceptionHandler.class,
        CorrelationIdFilter.class,
        RequestLoggingFilter.class,
        IdempotencyKeyFilter.class})
@Slf4j
public class CommonWebAutoConfiguration {

    @Bean
    @ConditionalOnMissingBean
    public IdempotencyStore idempotencyStore(IdempotencyProperties properties,
                                            ObjectProvider<StringRedisTemplate> redisTemplate,
                                            ObjectMapper objectMapper) {
        StringRedisTemplate template = redisTemplate.getIfAvailable();
        if (properties.store() == IdempotencyProperties.Store.REDIS && template != null) {
            log.info("idempotency store: redis (ttl={}, prefix={})", properties.ttl(), properties.keyPrefix());
            return new RedisIdempotencyStore(template, objectMapper, properties);
        }
        log.warn("idempotency store: in-memory (not shared between replicas) — "
                + "set taxi.idempotency.store=redis and configure Redis for production");
        return new InMemoryIdempotencyStore(properties.ttl());
    }

    @Bean
    @ConditionalOnMissingBean
    public IdempotencyGuard idempotencyGuard(IdempotencyStore idempotencyStore, ObjectMapper objectMapper) {
        return new IdempotencyGuard(idempotencyStore, objectMapper);
    }
}
