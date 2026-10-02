package kz.taxi.payment.infrastructure;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.autoconfigure.condition.ConditionalOnMissingBean;
import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.web.client.RestClient;

/**
 * Wiring for settlement.
 *
 * <p>The {@link RestClient} comes from the auto-configured builder, which the
 * platform decorates with {@code X-Internal-Token}, {@code Authorization} and
 * {@code X-Correlation-Id}: a settlement job is a workload, and the internal token
 * is what lets it read a merchant it does not own.
 */
@Configuration(proxyBeanMethods = false)
@EnableConfigurationProperties(SettlementProperties.class)
public class SettlementInfrastructureConfiguration {

    @Bean
    @ConditionalOnMissingBean(name = "catalogServiceRestClient")
    public RestClient catalogServiceRestClient(
            RestClient.Builder builder,
            @Value("${taxi.clients.catalog-service.url:http://127.0.0.1:8083}") String baseUrl) {
        return builder.baseUrl(baseUrl).build();
    }

    @Bean
    public CatalogMerchantClient catalogMerchantClient(RestClient catalogServiceRestClient) {
        return new CatalogMerchantClient(catalogServiceRestClient);
    }
}
