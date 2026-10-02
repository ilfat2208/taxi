package kz.taxi.gateway.config;

import org.springframework.cloud.gateway.filter.ratelimit.KeyResolver;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.security.core.context.ReactiveSecurityContextHolder;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.security.oauth2.server.resource.authentication.JwtAuthenticationToken;
import reactor.core.publisher.Mono;

/**
 * Rate limiting key.
 *
 * <p>Limits are counted per authenticated user, not per IP: mobile carriers NAT
 * thousands of subscribers behind one address, so IP-based limits punish
 * innocent users and let a single abuser with many addresses through. Anonymous
 * traffic (login, catalog browsing) falls back to the client address.
 */
@Configuration
public class RateLimitConfig {

    @Bean
    public KeyResolver principalOrIpKeyResolver() {
        return exchange -> ReactiveSecurityContextHolder.getContext()
                .map(context -> context.getAuthentication())
                .filter(authentication -> authentication instanceof JwtAuthenticationToken)
                .map(authentication -> "user:" + ((JwtAuthenticationToken) authentication).getToken().getSubject())
                .switchIfEmpty(Mono.defer(() -> {
                    var remoteAddress = exchange.getRequest().getRemoteAddress();
                    String host = remoteAddress == null || remoteAddress.getAddress() == null
                            ? "unknown"
                            : remoteAddress.getAddress().getHostAddress();
                    return Mono.just("ip:" + host);
                }));
    }

    /** Convenience for logging filters that need the subject of the current token. */
    public static Mono<String> currentSubject() {
        return ReactiveSecurityContextHolder.getContext()
                .map(context -> context.getAuthentication())
                .filter(Jwt.class::isInstance)
                .map(authentication -> ((Jwt) authentication.getPrincipal()).getSubject())
                .defaultIfEmpty("anonymous");
    }
}
