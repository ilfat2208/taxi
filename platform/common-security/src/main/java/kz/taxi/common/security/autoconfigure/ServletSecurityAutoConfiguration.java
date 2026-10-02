package kz.taxi.common.security.autoconfigure;

import com.fasterxml.jackson.databind.ObjectMapper;
import kz.taxi.common.security.JwtSupport;
import kz.taxi.common.security.SecurityMode;
import kz.taxi.common.security.SecurityProperties;
import kz.taxi.common.security.web.RestAccessDeniedHandler;
import kz.taxi.common.security.web.RestAuthenticationEntryPoint;
import kz.taxi.common.security.web.SecurityExceptionHandler;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.autoconfigure.AutoConfiguration;
import org.springframework.boot.autoconfigure.condition.ConditionalOnMissingBean;
import org.springframework.boot.autoconfigure.condition.ConditionalOnWebApplication;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Import;
import org.springframework.core.convert.converter.Converter;
import org.springframework.http.HttpMethod;
import org.springframework.security.authentication.AbstractAuthenticationToken;
import org.springframework.security.config.Customizer;
import org.springframework.security.config.annotation.method.configuration.EnableMethodSecurity;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.config.http.SessionCreationPolicy;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.security.oauth2.jwt.JwtDecoder;
import org.springframework.security.web.SecurityFilterChain;
import org.springframework.web.cors.CorsConfiguration;
import org.springframework.web.cors.CorsConfigurationSource;
import org.springframework.web.cors.UrlBasedCorsConfigurationSource;

import java.util.List;

/**
 * The default security posture of a servlet service.
 *
 * <p>Stateless by design: no HTTP session, no CSRF token, no form login. Every
 * request carries a JWT and every service validates it locally — against the shared
 * secret in HMAC mode, against the issuer's public key set in JWKS mode — and
 * authorization is expressed either as path rules (below) or as
 * {@code @PreAuthorize} on use cases.
 *
 * <p>A service may replace the whole chain by declaring its own
 * {@link SecurityFilterChain} bean — the {@code @ConditionalOnMissingBean}
 * makes that a one-line override rather than a fight with auto-configuration.
 */
@AutoConfiguration(after = SecurityCoreAutoConfiguration.class)
@ConditionalOnWebApplication(type = ConditionalOnWebApplication.Type.SERVLET)
@EnableMethodSecurity
@Import(SecurityExceptionHandler.class)
@Slf4j
public class ServletSecurityAutoConfiguration {

    /**
     * Decoder selected by {@code taxi.security.mode}.
     *
     * <p>HMAC is the default and behaves exactly as before. In JWKS mode the service
     * verifies RS256 tokens against the issuer's public key set and holds no signing
     * material at all — which is the entire reason the mode exists: with one shared
     * HS256 secret, any service could mint itself an ADMIN token.
     */
    @Bean
    @ConditionalOnMissingBean
    public JwtDecoder jwtDecoder(SecurityProperties properties) {
        if (properties.mode() == SecurityMode.JWKS) {
            return JwtSupport.jwksDecoder(properties.requiredJwkSetUri(),
                    properties.effectiveIssuer(), properties.jwksCacheTtl());
        }
        return JwtSupport.jwtDecoder(properties.jwtSecret());
    }

    @Bean
    @ConditionalOnMissingBean(name = "taxiJwtAuthenticationConverter")
    public Converter<Jwt, AbstractAuthenticationToken> taxiJwtAuthenticationConverter(
            SecurityProperties properties) {
        return JwtSupport.authenticationConverter(properties.rolesClaim());
    }

    @Bean
    @ConditionalOnMissingBean
    public RestAuthenticationEntryPoint restAuthenticationEntryPoint(
            ObjectMapper objectMapper,
            @Value("${taxi.web.problem-base-uri:https://docs.taxi.local/errors}") String problemBaseUri) {
        return new RestAuthenticationEntryPoint(objectMapper, problemBaseUri);
    }

    @Bean
    @ConditionalOnMissingBean
    public RestAccessDeniedHandler restAccessDeniedHandler(
            ObjectMapper objectMapper,
            @Value("${taxi.web.problem-base-uri:https://docs.taxi.local/errors}") String problemBaseUri) {
        return new RestAccessDeniedHandler(objectMapper, problemBaseUri);
    }

    @Bean
    @ConditionalOnMissingBean
    public CorsConfigurationSource corsConfigurationSource(SecurityProperties properties) {
        CorsConfiguration configuration = new CorsConfiguration();
        configuration.setAllowedOriginPatterns(properties.corsAllowedOrigins());
        configuration.setAllowedMethods(List.of("GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"));
        configuration.setAllowedHeaders(List.of("*"));
        configuration.setExposedHeaders(List.of("X-Correlation-Id", "Location"));
        configuration.setAllowCredentials(false);
        configuration.setMaxAge(3600L);

        UrlBasedCorsConfigurationSource source = new UrlBasedCorsConfigurationSource();
        source.registerCorsConfiguration("/**", configuration);
        return source;
    }

    @Bean
    @ConditionalOnMissingBean(SecurityFilterChain.class)
    public SecurityFilterChain taxiSecurityFilterChain(
            HttpSecurity http,
            SecurityProperties properties,
            Converter<Jwt, AbstractAuthenticationToken> taxiJwtAuthenticationConverter,
            RestAuthenticationEntryPoint authenticationEntryPoint,
            RestAccessDeniedHandler accessDeniedHandler) throws Exception {

        String[] publicPaths = properties.publicPaths().toArray(String[]::new);
        log.info("applying stateless JWT security: publicPaths={}", properties.publicPaths());

        http
                .csrf(csrf -> csrf.disable())
                .cors(Customizer.withDefaults())
                .httpBasic(basic -> basic.disable())
                .formLogin(form -> form.disable())
                .logout(logout -> logout.disable())
                .sessionManagement(session -> session.sessionCreationPolicy(SessionCreationPolicy.STATELESS))
                .authorizeHttpRequests(auth -> auth
                        .requestMatchers(HttpMethod.OPTIONS, "/**").permitAll()
                        .requestMatchers(publicPaths).permitAll()
                        .anyRequest().authenticated())
                .oauth2ResourceServer(oauth2 -> oauth2
                        .jwt(jwt -> jwt.jwtAuthenticationConverter(taxiJwtAuthenticationConverter))
                        .authenticationEntryPoint(authenticationEntryPoint))
                .exceptionHandling(handling -> handling
                        .authenticationEntryPoint(authenticationEntryPoint)
                        .accessDeniedHandler(accessDeniedHandler));

        return http.build();
    }
}
