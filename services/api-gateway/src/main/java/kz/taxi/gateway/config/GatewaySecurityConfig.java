package kz.taxi.gateway.config;

import com.fasterxml.jackson.databind.ObjectMapper;
import kz.taxi.common.core.context.CorrelationContext;
import kz.taxi.common.security.JwtSupport;
import kz.taxi.common.security.SecurityMode;
import kz.taxi.common.security.SecurityProperties;
import kz.taxi.gateway.auth.JwksController;
import kz.taxi.gateway.platform.GatewayPublicPaths;
import kz.taxi.gateway.security.BlockingReactiveJwtDecoder;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.core.convert.converter.Converter;
import org.springframework.core.io.buffer.DataBuffer;
import org.springframework.http.HttpMethod;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.security.authentication.AbstractAuthenticationToken;
import org.springframework.security.config.annotation.web.reactive.EnableWebFluxSecurity;
import org.springframework.security.config.web.server.ServerHttpSecurity;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.security.oauth2.jwt.NimbusReactiveJwtDecoder;
import org.springframework.security.oauth2.jwt.ReactiveJwtDecoder;
import org.springframework.security.oauth2.server.resource.authentication.ReactiveJwtAuthenticationConverterAdapter;
import org.springframework.security.web.server.SecurityWebFilterChain;
import org.springframework.security.web.server.ServerAuthenticationEntryPoint;
import org.springframework.security.web.server.authorization.ServerAccessDeniedHandler;
import org.springframework.web.server.ServerWebExchange;
import reactor.core.publisher.Mono;

import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.LinkedHashMap;
import java.util.Map;

/**
 * Edge security for the reactive gateway.
 *
 * <p>The gateway validates the JWT locally (no call back to an identity provider
 * on the hot path) and forwards the request unchanged. Domain services validate
 * the same token again — defence in depth, and it keeps every service runnable
 * and testable on its own.
 */
@Configuration
@EnableWebFluxSecurity
public class GatewaySecurityConfig {

    /**
     * Decoder selected by {@code taxi.security.mode}, mirroring the services.
     *
     * <p>HMAC mode is unchanged. In JWKS mode the gateway validates against the key set
     * it publishes itself (or against an external OIDC provider's, when the platform is
     * fronted by one) — the same {@code JwtSupport} factory the servlet services use, so
     * the caching and rotation behaviour cannot differ between the edge and the services.
     */
    @Bean
    public ReactiveJwtDecoder reactiveJwtDecoder(SecurityProperties properties) {
        if (properties.mode() == SecurityMode.JWKS) {
            return BlockingReactiveJwtDecoder.wrapping(
                    JwtSupport.jwksDecoder(properties.requiredJwkSetUri(),
                            properties.effectiveIssuer(), properties.jwksCacheTtl()));
        }
        return NimbusReactiveJwtDecoder
                .withSecretKey(JwtSupport.secretKey(properties.jwtSecret()))
                .macAlgorithm(org.springframework.security.oauth2.jose.jws.MacAlgorithm.HS256)
                .build();
    }

    @Bean
    public Converter<Jwt, Mono<AbstractAuthenticationToken>> reactiveJwtAuthenticationConverter(
            SecurityProperties properties) {
        return new ReactiveJwtAuthenticationConverterAdapter(
                JwtSupport.authenticationConverter(properties.rolesClaim()));
    }

    /** 401 in problem+json shape, identical to what the services return. */
    @Bean
    public ServerAuthenticationEntryPoint reactiveAuthenticationEntryPoint(ObjectMapper objectMapper) {
        return (exchange, authException) -> {
            exchange.getResponse().setStatusCode(HttpStatus.UNAUTHORIZED);
            exchange.getResponse().getHeaders().setContentType(MediaType.APPLICATION_PROBLEM_JSON);
            Map<String, Object> body = new LinkedHashMap<>();
            body.put("type", "https://docs.taxi.local/errors/UNAUTHORIZED");
            body.put("title", "Unauthorized");
            body.put("status", 401);
            body.put("code", "UNAUTHORIZED");
            body.put("detail", "a valid bearer token is required for %s %s"
                    .formatted(exchange.getRequest().getMethod(), exchange.getRequest().getPath()));
            body.put("instance", exchange.getRequest().getPath().value());
            body.put("correlationId", correlationIdOf(exchange));
            body.put("timestamp", Instant.now().toString());
            DataBuffer buffer = exchange.getResponse().bufferFactory()
                    .wrap(toJson(objectMapper, body).getBytes(StandardCharsets.UTF_8));
            return exchange.getResponse().writeWith(Mono.just(buffer));
        };
    }

    @Bean
    public ServerAccessDeniedHandler reactiveAccessDeniedHandler(ObjectMapper objectMapper) {
        return (exchange, deniedException) -> {
            exchange.getResponse().setStatusCode(HttpStatus.FORBIDDEN);
            exchange.getResponse().getHeaders().setContentType(MediaType.APPLICATION_PROBLEM_JSON);
            Map<String, Object> body = new LinkedHashMap<>();
            body.put("type", "https://docs.taxi.local/errors/FORBIDDEN");
            body.put("title", "Forbidden");
            body.put("status", 403);
            body.put("code", "FORBIDDEN");
            body.put("detail", "you do not have permission to perform this operation");
            body.put("instance", exchange.getRequest().getPath().value());
            body.put("correlationId", correlationIdOf(exchange));
            body.put("timestamp", Instant.now().toString());
            DataBuffer buffer = exchange.getResponse().bufferFactory()
                    .wrap(toJson(objectMapper, body).getBytes(StandardCharsets.UTF_8));
            return exchange.getResponse().writeWith(Mono.just(buffer));
        };
    }

    /**
     * Correlation id for security responses.
     *
     * <p>Reads the exchange attribute published by {@code CorrelationIdGlobalFilter},
     * because the correlation filter runs before the security chain but the id is not
     * visible as a request header until the request is decorated downstream.
     */
    private static String correlationIdOf(ServerWebExchange exchange) {
        Object attribute = exchange.getAttributes().get(CorrelationContext.MDC_KEY);
        if (attribute instanceof String value && !value.isBlank()) {
            return value;
        }
        return exchange.getRequest().getHeaders().getFirst(CorrelationContext.HEADER);
    }

    @Bean
    public SecurityWebFilterChain gatewaySecurityWebFilterChain(
            ServerHttpSecurity http,
            SecurityProperties properties,
            ReactiveJwtDecoder jwtDecoder,
            Converter<Jwt, Mono<AbstractAuthenticationToken>> reactiveJwtAuthenticationConverter,
            ServerAuthenticationEntryPoint reactiveAuthenticationEntryPoint,
            ServerAccessDeniedHandler reactiveAccessDeniedHandler) {

        String[] publicPaths = properties.publicPaths().toArray(String[]::new);

        return http
                .csrf(ServerHttpSecurity.CsrfSpec::disable)
                .httpBasic(ServerHttpSecurity.HttpBasicSpec::disable)
                .formLogin(ServerHttpSecurity.FormLoginSpec::disable)
                .logout(ServerHttpSecurity.LogoutSpec::disable)
                .authorizeExchange(exchanges -> exchanges
                        .pathMatchers(HttpMethod.OPTIONS).permitAll()
                        // The JWKS document is public by construction: a verifier needs
                        // the public keys before it has a token to present. Denying it
                        // would make JWKS mode unusable, and it exposes public keys only.
                        .pathMatchers(HttpMethod.GET, JwksController.JWKS_PATH).permitAll()
                        // Browsing is anonymous, acting is not — the same reasoning as in a
                        // real storefront: a visitor looks at prices before signing in.
                        // The list lives in GatewayPublicPaths because it is also part of
                        // the answer to `GET /api/v1/config`: a client asks what it may call
                        // before login, and it must get the paths the edge actually permits,
                        // not a second hand-written copy of them.
                        .pathMatchers(HttpMethod.GET,
                                GatewayPublicPaths.ANONYMOUS_GET.toArray(String[]::new)).permitAll()
                        .pathMatchers(publicPaths).permitAll()
                        .anyExchange().authenticated())
                .oauth2ResourceServer(oauth2 -> oauth2
                        .jwt(jwt -> jwt
                                .jwtDecoder(jwtDecoder)
                                .jwtAuthenticationConverter(reactiveJwtAuthenticationConverter))
                        .authenticationEntryPoint(reactiveAuthenticationEntryPoint))
                .exceptionHandling(handling -> handling
                        .authenticationEntryPoint(reactiveAuthenticationEntryPoint)
                        .accessDeniedHandler(reactiveAccessDeniedHandler))
                .build();
    }

    private static String toJson(ObjectMapper objectMapper, Map<String, Object> body) {
        try {
            return objectMapper.writeValueAsString(body);
        } catch (Exception ex) {
            return "{\"code\":\"INTERNAL_ERROR\"}";
        }
    }
}
