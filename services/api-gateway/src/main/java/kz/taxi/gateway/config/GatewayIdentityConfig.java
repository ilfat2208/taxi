package kz.taxi.gateway.config;

import kz.taxi.common.security.JwtIssuer;
import kz.taxi.common.security.SecurityMode;
import kz.taxi.common.security.SecurityProperties;
import kz.taxi.gateway.identity.RsaSigningKeyProvider;
import lombok.extern.slf4j.Slf4j;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

/**
 * Token issuing lives only here.
 *
 * <p>Domain services validate tokens but cannot create them. In HMAC mode that is a
 * convention backed by nothing but discipline — the signing secret is present in every
 * service, so any of them *could* mint a credential. In JWKS mode it is a property of the
 * system: only the gateway holds a private key, everyone else holds public keys.
 *
 * <p>Moving to a real OIDC provider later means deleting this class, exactly as before.
 */
@Configuration
@Slf4j
public class GatewayIdentityConfig {

    /**
     * The issuer's key pair, shared by the token issuer and the JWKS endpoint.
     *
     * <p>One bean, so the key that signs and the key that is published can never drift
     * apart — a mismatch would make every service reject every token.
     */
    @Bean
    public RsaSigningKeyProvider rsaSigningKeyProvider(SecurityProperties properties) {
        return new RsaSigningKeyProvider(properties);
    }

    @Bean
    public JwtIssuer jwtIssuer(SecurityProperties properties, RsaSigningKeyProvider signingKeyProvider) {
        if (properties.mode() == SecurityMode.JWKS) {
            log.info("issuing RS256 tokens with kid={}", signingKeyProvider.signingKey().getKeyID());
            return new JwtIssuer(properties, signingKeyProvider.signingKey());
        }
        return new JwtIssuer(properties);
    }
}
