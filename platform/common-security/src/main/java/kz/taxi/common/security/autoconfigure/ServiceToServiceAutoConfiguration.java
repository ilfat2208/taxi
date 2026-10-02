package kz.taxi.common.security.autoconfigure;

import com.fasterxml.jackson.databind.ObjectMapper;
import kz.taxi.common.security.SecurityProperties;
import kz.taxi.common.security.web.InternalApiTokenFilter;
import kz.taxi.common.security.web.OutboundAuthForwardingInterceptor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.autoconfigure.AutoConfiguration;
import org.springframework.boot.autoconfigure.condition.ConditionalOnClass;
import org.springframework.boot.autoconfigure.condition.ConditionalOnMissingBean;
import org.springframework.boot.autoconfigure.condition.ConditionalOnWebApplication;
import org.springframework.boot.autoconfigure.web.client.RestClientAutoConfiguration;
import org.springframework.boot.web.client.RestClientCustomizer;
import org.springframework.context.annotation.Bean;
import org.springframework.web.client.RestClient;

/**
 * Cross-service plumbing: internal API protection on the way in, identity and
 * correlation propagation on the way out.
 *
 * <p>The interceptor is registered as a {@link RestClientCustomizer}, so any
 * service that injects the auto-configured {@code RestClient.Builder} gets it for
 * free and nobody has to remember to add the headers by hand.
 */
@AutoConfiguration(after = {SecurityCoreAutoConfiguration.class, RestClientAutoConfiguration.class})
@ConditionalOnWebApplication(type = ConditionalOnWebApplication.Type.SERVLET)
@ConditionalOnClass(RestClient.class)
@Slf4j
public class ServiceToServiceAutoConfiguration {

    @Bean
    @ConditionalOnMissingBean
    public InternalApiTokenFilter internalApiTokenFilter(
            ObjectMapper objectMapper,
            @Value("${taxi.internal.token:}") String internalToken,
            @Value("${taxi.web.problem-base-uri:https://docs.taxi.local/errors}") String problemBaseUri) {
        return new InternalApiTokenFilter(objectMapper, internalToken, problemBaseUri);
    }

    @Bean
    @ConditionalOnMissingBean
    public OutboundAuthForwardingInterceptor outboundAuthForwardingInterceptor(
            @Value("${taxi.internal.token:}") String internalToken,
            @Value("${taxi.security.forward-authorization:true}") boolean forwardAuthorization) {
        return new OutboundAuthForwardingInterceptor(internalToken, forwardAuthorization);
    }

    @Bean
    public RestClientCustomizer taxiRestClientCustomizer(
            ObjectProvider<OutboundAuthForwardingInterceptor> interceptor, SecurityProperties properties) {
        return builder -> interceptor.ifAvailable(builder::requestInterceptor);
    }
}
