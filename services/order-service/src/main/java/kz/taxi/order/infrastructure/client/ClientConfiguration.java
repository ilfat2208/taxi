package kz.taxi.order.infrastructure.client;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.boot.autoconfigure.condition.ConditionalOnMissingBean;
import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.http.client.ClientHttpRequestFactory;
import org.springframework.http.client.SimpleClientHttpRequestFactory;
import org.springframework.web.client.RestClient;

/**
 * Builds one {@link RestClient} per downstream service.
 *
 * <p>The builder is the auto-configured one, not a hand-rolled client: that is what
 * gives every outbound call the platform's
 * {@code OutboundAuthForwardingInterceptor} — the caller's {@code Authorization},
 * the service's {@code X-Internal-Token} and the {@code X-Correlation-Id} of the
 * request that started the saga — without a single header being set by hand here.
 *
 * <p>Only the request factory is replaced, to put a connect and a read timeout on
 * each call. Everything else (message converters, error handling, the interceptor)
 * stays as the platform configured it.
 */
@Configuration(proxyBeanMethods = false)
@EnableConfigurationProperties(ClientProperties.class)
public class ClientConfiguration {

    @Bean
    @ConditionalOnMissingBean
    public DownstreamErrors downstreamErrors(ObjectMapper objectMapper) {
        return new DownstreamErrors(objectMapper);
    }

    @Bean
    @ConditionalOnMissingBean
    public CatalogClient catalogClient(RestClient.Builder builder,
                                       ClientProperties properties,
                                       DownstreamErrors errors) {
        return new CatalogClient(restClient(builder, properties.catalogService()), errors);
    }

    @Bean
    @ConditionalOnMissingBean
    public PaymentClient paymentClient(RestClient.Builder builder,
                                       ClientProperties properties,
                                       DownstreamErrors errors) {
        return new PaymentClient(restClient(builder, properties.paymentService()), errors);
    }

    private static RestClient restClient(RestClient.Builder builder, ClientProperties.Endpoint endpoint) {
        if (endpoint.isConfigured()) {
            builder.baseUrl(endpoint.url());
        }
        builder.requestFactory(requestFactory(endpoint));
        return builder.build();
    }

    private static ClientHttpRequestFactory requestFactory(ClientProperties.Endpoint endpoint) {
        SimpleClientHttpRequestFactory factory = new SimpleClientHttpRequestFactory();
        factory.setConnectTimeout(toMillis(endpoint.connectTimeout()));
        factory.setReadTimeout(toMillis(endpoint.readTimeout()));
        return factory;
    }

    private static int toMillis(java.time.Duration duration) {
        long millis = duration.toMillis();
        return millis > Integer.MAX_VALUE ? Integer.MAX_VALUE : (int) millis;
    }
}
