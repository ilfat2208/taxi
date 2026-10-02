package kz.taxi.common.security.autoconfigure;

import kz.taxi.common.security.CurrentUser;
import kz.taxi.common.security.JwtSupport;
import kz.taxi.common.security.SecurityMode;
import kz.taxi.common.security.SecurityProperties;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.InitializingBean;
import org.springframework.boot.autoconfigure.AutoConfiguration;
import org.springframework.boot.autoconfigure.condition.ConditionalOnMissingBean;
import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.context.annotation.Bean;

/**
 * Security primitives that do not depend on the web stack: properties,
 * {@link CurrentUser}, and a fail-fast check of the identity configuration.
 */
@AutoConfiguration
@EnableConfigurationProperties(SecurityProperties.class)
@Slf4j
public class SecurityCoreAutoConfiguration {

    @Bean
    @ConditionalOnMissingBean
    public CurrentUser currentUser(SecurityProperties properties) {
        return new CurrentUser(properties);
    }

    /**
     * Validates the identity configuration while the context starts.
     *
     * <p>A weak or missing configuration must fail the deployment, not the first login:
     * an HS256 key under 32 bytes is rejected by the signer anyway, and a JWKS-mode
     * service with no key set URL would start up healthy and then deny every request.
     * Both errors are much easier to act on during a rollout than at 3am from a 401 spike.
     *
     * <p>The check is mode-aware, and that is the whole point of the JWKS mode: a service
     * that verifies tokens against a public key set has no secret, so a missing
     * {@code jwt-secret} must be perfectly acceptable there — requiring it would force
     * every service to keep holding the key that can mint tokens.
     */
    @Bean
    public InitializingBean jwtSecretValidator(SecurityProperties properties) {
        return () -> {
            if (properties.mode() == SecurityMode.JWKS) {
                String jwkSetUri = properties.requiredJwkSetUri();
                log.info("JWT validation enabled (JWKS): jwkSetUri={}, issuer={}, cacheTtl={}, "
                                + "no signing material is held by this service",
                        jwkSetUri, properties.effectiveIssuer(), properties.jwksCacheTtl());
                return;
            }
            if (!properties.hasSecret()) {
                throw new IllegalStateException(
                        "taxi.security.jwt-secret is not configured; set the JWT_SECRET environment variable "
                                + "(or switch to asymmetric tokens with taxi.security.mode=JWKS)");
            }
            JwtSupport.secretKey(properties.jwtSecret());
            log.info("JWT validation enabled (HMAC): issuer={}, rolesClaim={}, ttl={}",
                    properties.effectiveIssuer(), properties.rolesClaim(), properties.jwtTtl());
        };
    }
}
