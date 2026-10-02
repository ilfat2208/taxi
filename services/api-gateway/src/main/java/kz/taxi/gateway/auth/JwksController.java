package kz.taxi.gateway.auth;

import com.nimbusds.jose.jwk.JWKSet;
import kz.taxi.common.security.SecurityProperties;
import kz.taxi.gateway.identity.RsaSigningKeyProvider;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.CacheControl;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;
import reactor.core.publisher.Mono;

import java.util.Map;

/**
 * Publishes the issuer's public keys — the JWKS document every service validates against.
 *
 * <p>This is the endpoint that removes the shared secret from the platform: services
 * switch to {@code taxi.security.mode=JWKS}, point
 * {@code taxi.security.jwk-set-uri} here, and drop {@code jwt-secret} entirely. They
 * keep only public parameters, so a compromised service can no longer mint tokens.
 *
 * <p>The path {@code /.well-known/jwks.json} is the convention (RFC 8414 / OpenID
 * Connect Discovery), which keeps this endpoint compatible with a real OIDC provider: a
 * deployment can replace the gateway with one and change nothing but a URL.
 *
 * <p>It is deliberately anonymous — a token cannot be required to learn how to validate
 * a token. It is safe to be anonymous because the document contains public keys only.
 * The response is cached: a JWKS fetch is triggered whenever a service sees an unknown
 * {@code kid}, so an uncached endpoint would let anyone hammer this controller by sending
 * garbage key ids.
 */
@RestController
@Slf4j
public class JwksController {

    public static final String JWKS_PATH = "/.well-known/jwks.json";

    private final RsaSigningKeyProvider signingKeyProvider;
    private final SecurityProperties properties;

    public JwksController(RsaSigningKeyProvider signingKeyProvider, SecurityProperties properties) {
        this.signingKeyProvider = signingKeyProvider;
        this.properties = properties;
    }

    /** The key set, in the JWK Set JSON format ({@code {"keys":[...]}}) verifiers expect. */
    @GetMapping(path = JWKS_PATH, produces = MediaType.APPLICATION_JSON_VALUE)
    public Mono<ResponseEntity<Map<String, Object>>> jwks() {
        JWKSet keySet = signingKeyProvider.publicJwkSet();
        Map<String, Object> document = keySet.toJSONObject(true);
        log.debug("serving JWKS with {} public key(s)", keySet.getKeys().size());
        return Mono.just(ResponseEntity.ok()
                .cacheControl(CacheControl.maxAge(properties.jwksCacheTtl()).cachePublic())
                .body(document));
    }
}
