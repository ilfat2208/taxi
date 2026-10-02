package kz.taxi.gateway.identity;

import com.nimbusds.jose.crypto.RSASSAVerifier;
import com.nimbusds.jose.jwk.JWKSet;
import com.nimbusds.jose.jwk.RSAKey;
import com.nimbusds.jose.jwk.gen.RSAKeyGenerator;
import com.nimbusds.jwt.SignedJWT;
import kz.taxi.common.security.JwtIssuer;
import kz.taxi.common.security.SecurityMode;
import kz.taxi.common.security.SecurityProperties;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import java.security.KeyPair;
import java.security.KeyPairGenerator;
import java.security.interfaces.RSAPrivateCrtKey;
import java.time.Duration;
import java.util.Base64;
import java.util.List;
import java.util.Set;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/**
 * How the issuer gets its key: configured PEM/JWK in a real deployment, generated in
 * memory for local development.
 */
class RsaSigningKeyProviderTest {

    private static SecurityProperties properties(String signingKey) {
        return new SecurityProperties(null, Duration.ofMinutes(15), "https://identity.taxi.test",
                "roles", List.of(), List.of(), SecurityMode.JWKS,
                "https://identity.taxi.test/.well-known/jwks.json",
                "https://identity.taxi.test", Duration.ofMinutes(5), signingKey);
    }

    private static String pkcs8Pem(KeyPair pair) {
        String body = Base64.getMimeEncoder(64, "\n".getBytes())
                .encodeToString(pair.getPrivate().getEncoded());
        return "-----BEGIN PRIVATE KEY-----\n" + body + "\n-----END PRIVATE KEY-----\n";
    }

    @Test
    @DisplayName("loads a PKCS#8 PEM and rebuilds the public half from it")
    void loads_pkcs8_pem() throws Exception {
        KeyPairGenerator generator = KeyPairGenerator.getInstance("RSA");
        generator.initialize(2048);
        KeyPair pair = generator.generateKeyPair();

        RsaSigningKeyProvider provider = new RsaSigningKeyProvider(properties(pkcs8Pem(pair)));

        RSAKey key = provider.signingKey();
        assertThat(key.isPrivate()).isTrue();
        assertThat(key.toRSAPublicKey().getModulus()).isEqualTo(((RSAPrivateCrtKey) pair.getPrivate()).getModulus());
        // A PEM carries no kid, so one is derived from the key material itself.
        assertThat(key.getKeyID()).isEqualTo(key.computeThumbprint().toString());
    }

    @Test
    @DisplayName("a PKCS#8 key loaded from configuration signs tokens the published set verifies")
    void pem_key_signs_verifiable_tokens() throws Exception {
        KeyPairGenerator generator = KeyPairGenerator.getInstance("RSA");
        generator.initialize(2048);
        KeyPair pair = generator.generateKeyPair();
        RsaSigningKeyProvider provider = new RsaSigningKeyProvider(properties(pkcs8Pem(pair)));

        JwtIssuer issuer = new JwtIssuer(properties(pkcs8Pem(pair)), provider.signingKey());
        SignedJWT token = SignedJWT.parse(issuer.issue("U-1", null, null, Set.of("CUSTOMER")).accessToken());

        assertThat(token.getHeader().getKeyID())
                .isEqualTo(provider.publicJwkSet().getKeys().get(0).getKeyID());
        assertThat(token.verify(new RSASSAVerifier(provider.signingKey().toRSAPublicKey()))).isTrue();
        assertThat(issuer.keyId()).isEqualTo(provider.signingKey().getKeyID());
    }

    @Test
    @DisplayName("loads a JWK document, keeping the kid it declares")
    void loads_jwk_json() throws Exception {
        RSAKey configured = new RSAKeyGenerator(2048).keyID("provisioned-key-7").generate();

        RsaSigningKeyProvider provider = new RsaSigningKeyProvider(properties(configured.toJSONString()));

        assertThat(provider.signingKey().getKeyID()).isEqualTo("provisioned-key-7");
        assertThat(provider.publicJwkSet().getKeyByKeyId("provisioned-key-7")).isNotNull();
    }

    @Test
    @DisplayName("refuses a public-only JWK: the issuer must be able to sign")
    void refuses_public_only_jwk() throws Exception {
        RSAKey publicOnly = new RSAKeyGenerator(2048).keyID("k").generate().toPublicJWK();

        RsaSigningKeyProvider provider = new RsaSigningKeyProvider(properties(publicOnly.toJSONString()));

        assertThatThrownBy(provider::signingKey)
                .isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("private JWK");
    }

    @Test
    @DisplayName("explains how to convert a PKCS#1 PEM instead of failing cryptically")
    void rejects_pkcs1_pem_with_guidance() {
        RsaSigningKeyProvider provider = new RsaSigningKeyProvider(
                properties("-----BEGIN RSA PRIVATE KEY-----\nMIIBOgIBAAJBAK\n-----END RSA PRIVATE KEY-----"));

        assertThatThrownBy(provider::signingKey)
                .isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("openssl pkcs8");
    }

    @Test
    @DisplayName("generates an ephemeral key when nothing is configured")
    void generates_when_unconfigured() {
        RsaSigningKeyProvider provider = new RsaSigningKeyProvider(properties(" "));

        RSAKey first = provider.signingKey();

        assertThat(first.isPrivate()).isTrue();
        assertThat(first.getKeyID()).isNotBlank();
        // One key per process: signing and publishing must never disagree.
        assertThat(provider.signingKey()).isSameAs(first);
        assertThat(provider.publicJwkSet().getKeys()).hasSize(1);
        assertThat(provider.publicJwkSet().getKeys().get(0).isPrivate()).isFalse();
    }

    @Test
    @DisplayName("accepts a PEM whose newlines arrived escaped, as environment variables do")
    void accepts_escaped_newlines() throws Exception {
        KeyPairGenerator generator = KeyPairGenerator.getInstance("RSA");
        generator.initialize(2048);
        KeyPair pair = generator.generateKeyPair();
        String escaped = pkcs8Pem(pair).replace("\n", "\\n");

        RsaSigningKeyProvider provider = new RsaSigningKeyProvider(properties(escaped));

        assertThat(provider.signingKey().isPrivate()).isTrue();
    }

    @Test
    @DisplayName("the published set is a JWK Set document with public parameters only")
    void publishes_public_document() throws Exception {
        RSAKey configured = new RSAKeyGenerator(2048).keyID("provisioned-key-8").generate();
        RsaSigningKeyProvider provider = new RsaSigningKeyProvider(properties(configured.toJSONString()));

        JWKSet published = provider.publicJwkSet();

        assertThat(published.toJSONObject(true).toString()).doesNotContain("privateExponent");
        assertThat(published.getKeys()).hasSize(1);
        assertThat(published.getKeyByKeyId("provisioned-key-8")).isNotNull();
    }
}
