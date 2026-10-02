package kz.taxi.payment.infrastructure;

import org.springframework.boot.autoconfigure.condition.ConditionalOnMissingBean;
import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.boot.web.client.ClientHttpRequestFactories;
import org.springframework.boot.web.client.ClientHttpRequestFactorySettings;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.web.client.RestClient;

/**
 * Wires the account-service client.
 *
 * <p>The {@link RestClient} is built from the auto-configured
 * {@code RestClient.Builder}, which the platform has already customised with the
 * outbound interceptor. That is the whole trick: {@code Authorization},
 * {@code X-Internal-Token} and {@code X-Correlation-Id} travel with every call
 * without a line of code here, and a call made from a scheduled job (no user
 * token, no MDC) behaves correctly on its own.
 *
 * <p>Both beans are {@code @ConditionalOnMissingBean} so a test — the integration
 * test in particular — can replace the client with a stub and still exercise the
 * real schema, the real state machine and the real outbox.
 */
@Configuration(proxyBeanMethods = false)
@EnableConfigurationProperties({PaymentProperties.class, AccountServiceClientProperties.class})
public class PaymentInfrastructureConfiguration {

    /**
     * A dedicated client bean rather than injecting a builder everywhere: the base
     * URL and the timeouts are decided once. The timeouts matter as much as the URL —
     * a payment that hangs on the account service keeps a customer's money reserved,
     * so it fails fast and lets the saga compensate.
     */
    @Bean
    @ConditionalOnMissingBean(name = "accountServiceRestClient")
    public RestClient accountServiceRestClient(RestClient.Builder builder,
                                               AccountServiceClientProperties properties) {
        AccountServiceClientProperties.AccountService accountService = properties.getAccountService();
        ClientHttpRequestFactorySettings settings = ClientHttpRequestFactorySettings.DEFAULTS
                .withConnectTimeout(accountService.getConnectTimeout())
                .withReadTimeout(accountService.getReadTimeout());
        return builder
                .baseUrl(accountService.getUrl())
                .requestFactory(ClientHttpRequestFactories.get(settings))
                .build();
    }

    @Bean
    @ConditionalOnMissingBean(AccountServiceClient.class)
    public AccountServiceClient accountServiceClient(RestClient accountServiceRestClient,
                                                     AccountServiceProblemTranslator translator) {
        return new HttpAccountServiceClient(accountServiceRestClient, translator);
    }
}
