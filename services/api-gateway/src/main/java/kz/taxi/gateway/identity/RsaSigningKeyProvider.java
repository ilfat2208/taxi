package kz.taxi.gateway.identity;

import com.nimbusds.jose.JWSAlgorithm;
import com.nimbusds.jose.jwk.JWKSet;
import com.nimbusds.jose.jwk.KeyUse;
import com.nimbusds.jose.jwk.RSAKey;
import com.nimbusds.jose.jwk.gen.RSAKeyGenerator;
import kz.taxi.common.security.SecurityProperties;
import lombok.extern.slf4j.Slf4j;

import java.security.KeyFactory;
import java.security.PrivateKey;
import java.security.interfaces.RSAPrivateCrtKey;
import java.security.interfaces.RSAPublicKey;
import java.security.spec.PKCS8EncodedKeySpec;
import java.security.spec.RSAPublicKeySpec;
import java.util.Base64;

/**
 * The issuer's RSA key pair.
 *
 * <p>Loaded from {@code taxi.security.signing-key} — a PKCS#8 PEM or a JWK JSON
 * document — which is how a real deployment gets a stable key that survives
 * restarts and is shared by every gateway replica.
 *
 * <p>When nothing is configured a 2048-bit key is generated in memory on first use
 * (local development, one replica, nothing to configure). <b>That key only lives in
 * this process:</b> restarting the gateway mints a new key pair, so every access token
 * issued before the restart stops validating (the JWKS document no longer contains the
 * key that signed it) and every client has to authenticate again. It also means two
 * gateway replicas would disagree about the key set. Never run an environment with more
 * than one replica, or anything that must survive a deploy, without setting
 * {@code taxi.security.signing-key}.
 */
@Slf4j
public class RsaSigningKeyProvider {

    /** RSA-2048 is the floor for anything signed with SHA-256 today. */
    private static final int KEY_SIZE_BITS = 2048;

    private final SecurityProperties properties;
    private final Object lock = new Object();
    private volatile RSAKey signingKey;

    public RsaSigningKeyProvider(SecurityProperties properties) {
        this.properties = properties;
    }

    /** Private key used for RS256 signing. Generated once per process when not configured. */
    public RSAKey signingKey() {
        RSAKey key = signingKey;
        if (key == null) {
            synchronized (lock) {
                key = signingKey;
                if (key == null) {
                    key = load();
                    signingKey = key;
                }
            }
        }
        return key;
    }

    /**
     * Public half, as the document published at {@code /.well-known/jwks.json}.
     *
     * <p>Only public parameters are exported — the private key must never appear in a
     * response body, and the {@code kid} travels with it so a verifier can pick the right
     * key during a rotation.
     */
    public JWKSet publicJwkSet() {
        return new JWKSet(signingKey().toPublicJWK());
    }

    private RSAKey load() {
        String configured = properties.signingKey();
        if (configured == null || configured.isBlank()) {
            return generateEphemeralKey();
        }
        String value = configured.trim();
        return value.startsWith("{") ? parseJwk(value) : parsePem(value, configured);
    }

    private RSAKey generateEphemeralKey() {
        log.warn("taxi.security.signing-key is not configured: generating an ephemeral RSA key in this process. "
                + "Tokens issued before a gateway restart will no longer validate and multiple replicas would "
                + "publish different key sets. Configure a PKCS#8 PEM or JWK for anything beyond local development.");
        try {
            return new RSAKeyGenerator(KEY_SIZE_BITS).keyIDFromThumbprint(true)
                    .algorithm(JWSAlgorithm.RS256)
                    .keyUse(KeyUse.SIGNATURE)
                    .generate();
        } catch (Exception ex) {
            throw new IllegalStateException("cannot generate an RSA signing key", ex);
        }
    }

    private RSAKey parseJwk(String json) {
        try {
            RSAKey key = RSAKey.parse(json);
            if (!key.isPrivate()) {
                throw new IllegalStateException(
                        "taxi.security.signing-key must contain the private JWK (it is the issuer's key)");
            }
            return normalize(key);
        } catch (java.text.ParseException ex) {
            throw new IllegalStateException(
                    "taxi.security.signing-key is not a valid RSA JWK document", ex);
        }
    }

    /**
     * Reads a PKCS#8 PEM private key ({@code -----BEGIN PRIVATE KEY-----}).
     *
     * <p>PKCS#8 carries no public key, so the public half is rebuilt from the CRT
     * parameters (modulus and public exponent) — the two numbers a verifier needs.
     * The older PKCS#1 ({@code BEGIN RSA PRIVATE KEY}) layout is rejected explicitly
     * rather than parsed by hand: ASN.1 surgery in an identity provider is exactly the
     * kind of code nobody wants to debug. Convert once with
     * {@code openssl pkcs8 -topk8 -nocrypt -in key.pem -out key-pkcs8.pem}.
     */
    private RSAKey parsePem(String value, String original) {
        if (original.contains("BEGIN RSA PRIVATE KEY")) {
            throw new IllegalStateException("taxi.security.signing-key is a PKCS#1 (BEGIN RSA PRIVATE KEY) PEM; "
                    + "convert it to PKCS#8 first: openssl pkcs8 -topk8 -nocrypt -in key.pem -out key-pkcs8.pem");
        }
        // Values coming from environment variables often arrive with literal \n escapes.
        String pem = original.replace("\\n", "\n");
        String body = pem.replaceAll("-----BEGIN [A-Z0-9 ]+-----", "")
                .replaceAll("-----END [A-Z0-9 ]+-----", "")
                .replaceAll("\\s", "");
        if (body.isEmpty()) {
            throw new IllegalStateException("taxi.security.signing-key is not a usable PEM or JWK document");
        }
        try {
            byte[] der = Base64.getDecoder().decode(body);
            KeyFactory keyFactory = KeyFactory.getInstance("RSA");
            PrivateKey privateKey = keyFactory.generatePrivate(new PKCS8EncodedKeySpec(der));
            if (!(privateKey instanceof RSAPrivateCrtKey crt)) {
                throw new IllegalStateException(
                        "taxi.security.signing-key must be an RSA private key in PKCS#8 form");
            }
            RSAPublicKey publicKey = (RSAPublicKey) keyFactory.generatePublic(
                    new RSAPublicKeySpec(crt.getModulus(), crt.getPublicExponent()));
            return normalize(new RSAKey.Builder(publicKey).privateKey(crt).build());
        } catch (IllegalStateException ex) {
            throw ex;
        } catch (Exception ex) {
            throw new IllegalStateException("cannot read taxi.security.signing-key as a PKCS#8 RSA private key "
                    + "(value length " + value.length() + ")", ex);
        }
    }

    /**
     * Makes a loaded key publishable and matchable by verifiers.
     *
     * <p>Two things are filled in when the configured key does not carry them:
     * <ul>
     *   <li><b>kid</b> — a PEM has no key id of its own and a JWK may omit it. The RFC 7638
     *       thumbprint is the natural choice: derived from the key material, so it is stable
     *       across restarts, it changes exactly when the key changes, and the JOSE header
     *       written by {@code JwtIssuer} therefore always names a key that this JWKS document
     *       advertises. Without it, a verifier receiving {@code kid=…} would look up a key id
     *       that the published set does not contain and reject every token;</li>
     *   <li><b>alg/use</b> — the gateway signs RS256 and nothing else, and saying so in the
     *       document lets a verifier reject a mismatched key without trying it.</li>
     * </ul>
     */
    private RSAKey normalize(RSAKey key) {
        try {
            RSAKey.Builder builder = new RSAKey.Builder(key)
                    .algorithm(JWSAlgorithm.RS256)
                    .keyUse(KeyUse.SIGNATURE);
            if (key.getKeyID() == null || key.getKeyID().isBlank()) {
                builder.keyIDFromThumbprint();
            }
            return builder.build();
        } catch (Exception ex) {
            throw new IllegalStateException("cannot derive a key id for taxi.security.signing-key", ex);
        }
    }
}
