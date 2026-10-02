package kz.taxi.common.security;

import com.nimbusds.jose.JOSEException;
import com.nimbusds.jose.JOSEObjectType;
import com.nimbusds.jose.JWSAlgorithm;
import com.nimbusds.jose.JWSHeader;
import com.nimbusds.jose.JWSSigner;
import com.nimbusds.jose.KeyLengthException;
import com.nimbusds.jose.crypto.MACSigner;
import com.nimbusds.jose.crypto.RSASSASigner;
import com.nimbusds.jose.jwk.RSAKey;
import com.nimbusds.jwt.JWTClaimsSet;
import com.nimbusds.jwt.SignedJWT;
import kz.taxi.common.core.id.Ulid;

import java.time.Instant;
import java.util.Collection;
import java.util.Date;
import java.util.LinkedHashSet;
import java.util.Set;

/**
 * Issues access tokens.
 *
 * <p>Only the api-gateway holds an {@code JwtIssuer}: in a real deployment this
 * is the identity provider, and services only ever validate tokens. Keeping
 * issuing out of the domain services means a compromised service cannot mint
 * credentials for another.
 *
 * <p>Two signing keys are supported, mirroring {@link SecurityMode}:
 * <ul>
 *   <li>{@link #JwtIssuer(SecurityProperties)} — HS256 with the shared secret, the
 *       local-development default, unchanged;</li>
 *   <li>{@link #JwtIssuer(SecurityProperties, RSAKey)} — RS256 with a private key that
 *       only the issuer holds, so resource servers can validate with the public key
 *       set alone.</li>
 * </ul>
 */
public class JwtIssuer {

    /** Token plus metadata a caller needs when returning it to a client. */
    public record IssuedToken(String accessToken, String tokenType, long expiresInSeconds, Instant expiresAt) {
    }

    private final SecurityProperties properties;
    private final JWSSigner signer;
    private final JWSAlgorithm algorithm;
    private final String keyId;

    /** HS256 issuer: symmetric, exactly the behaviour the platform had before JWKS support. */
    public JwtIssuer(SecurityProperties properties) {
        this.properties = properties;
        try {
            this.signer = new MACSigner(JwtSupport.secretKey(properties.jwtSecret()));
        } catch (KeyLengthException ex) {
            // JwtSupport already rejects a short secret; this keeps the failure at
            // startup with a message that says what to fix.
            throw new IllegalStateException("JWT secret is not usable for HS256 signing", ex);
        }
        this.algorithm = JWSAlgorithm.HS256;
        this.keyId = null;
    }

    /**
     * RS256 issuer: signs with the issuer's private key.
     *
     * <p>Every token carries the key's {@code kid} in the JOSE header. Rotation is the
     * reason it exists: a verifier looks up the key *by* {@code kid} in the published
     * key set. Without it, a verifier that holds two keys during a rollover has to guess
     * or try each key in turn — which turns a rotation into a pile of failed requests,
     * and (worse) makes it tempting to "just accept whatever verifies". With {@code kid},
     * the old and the new key coexist in the JWKS document, each token names the key that
     * signed it, and rotation is invisible to clients.
     *
     * @param properties security properties supplying issuer, TTL and roles claim
     * @param signingKey private RSA key; its {@code kid} (or its RFC 7638 thumbprint when
     *                   no {@code kid} is set) is published in the JOSE header
     */
    public JwtIssuer(SecurityProperties properties, RSAKey signingKey) {
        if (signingKey == null || !signingKey.isPrivate()) {
            throw new IllegalStateException(
                    "JWKS mode requires a private RSA signing key; configure taxi.security.signing-key");
        }
        this.properties = properties;
        this.algorithm = JWSAlgorithm.RS256;
        this.keyId = resolveKeyId(signingKey);
        try {
            this.signer = new RSASSASigner(signingKey);
        } catch (JOSEException ex) {
            // A key nimbus cannot use must fail at startup, not at the first login.
            throw new IllegalStateException("RSA signing key is not usable for RS256 signing", ex);
        }
    }

    /**
     * Key id for the JOSE header.
     *
     * <p>A {@code kid} supplied with the key (a JWK document carries one) wins; a bare
     * PEM has none, so the RFC 7638 thumbprint of the key is used instead. The thumbprint
     * is derived from the key material itself, which means a rotated key automatically
     * gets a different — and stable — {@code kid} without anyone inventing names, and the
     * JWKS document the issuer publishes always advertises exactly the same value.
     */
    private static String resolveKeyId(RSAKey signingKey) {
        String configured = signingKey.getKeyID();
        if (configured != null && !configured.isBlank()) {
            return configured;
        }
        try {
            return signingKey.computeThumbprint().toString();
        } catch (JOSEException ex) {
            throw new IllegalStateException("cannot derive a key id for the RSA signing key", ex);
        }
    }

    public IssuedToken issue(String userId,
                             String phone,
                             String displayName,
                             Collection<String> roles) {
        Instant issuedAt = Instant.now();
        Instant expiresAt = issuedAt.plus(properties.jwtTtl());

        Set<String> normalizedRoles = new LinkedHashSet<>();
        if (roles != null) {
            roles.stream()
                    .filter(role -> role != null && !role.isBlank())
                    .map(role -> role.trim().toUpperCase())
                    .forEach(normalizedRoles::add);
        }
        if (normalizedRoles.isEmpty()) {
            normalizedRoles.add(Roles.CUSTOMER);
        }

        JWTClaimsSet claims = new JWTClaimsSet.Builder()
                .issuer(properties.effectiveIssuer())
                .subject(userId)
                .jwtID(Ulid.nextId())
                .issueTime(Date.from(issuedAt))
                .notBeforeTime(Date.from(issuedAt))
                .expirationTime(Date.from(expiresAt))
                .claim(properties.rolesClaim(), normalizedRoles)
                .claim("phone", phone)
                .claim("name", displayName)
                .build();

        JWSHeader.Builder header = new JWSHeader.Builder(algorithm).type(JOSEObjectType.JWT);
        if (keyId != null) {
            header.keyID(keyId);
        }

        try {
            SignedJWT jwt = new SignedJWT(header.build(), claims);
            jwt.sign(signer);
            return new IssuedToken(jwt.serialize(), "Bearer", properties.jwtTtl().toSeconds(), expiresAt);
        } catch (Exception ex) {
            throw new IllegalStateException("cannot sign access token", ex);
        }
    }

    /** Algorithm actually used for signing: HS256 in HMAC mode, RS256 in JWKS mode. */
    public JWSAlgorithm algorithm() {
        return algorithm;
    }

    /** Key id published in the JOSE header, or {@code null} for HMAC tokens. */
    public String keyId() {
        return keyId;
    }

    public SecurityProperties properties() {
        return properties;
    }
}
