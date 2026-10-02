package kz.taxi.gateway.security;

import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.security.oauth2.jwt.JwtDecoder;
import org.springframework.security.oauth2.jwt.JwtException;
import org.springframework.security.oauth2.jwt.ReactiveJwtDecoder;
import reactor.core.publisher.Mono;
import reactor.core.scheduler.Schedulers;

/**
 * Reactive view over the shared {@link JwtDecoder}.
 *
 * <p>The gateway is the only reactive component in the platform, and it validates JWTs
 * with exactly the same code path as the servlet services: one JWKS implementation, one
 * caching policy, one place where the rotation rules live — instead of a servlet story
 * and a reactive story that drift apart. The cost is that a JWKS download happens off the
 * event loop (on a bounded-elastic thread), which is acceptable precisely because it is
 * rare: the key set is fetched once per cache TTL, or once when a token arrives with an
 * unknown {@code kid}, never per request.
 */
public final class BlockingReactiveJwtDecoder implements ReactiveJwtDecoder {

    private final JwtDecoder delegate;

    private BlockingReactiveJwtDecoder(JwtDecoder delegate) {
        this.delegate = delegate;
    }

    public static ReactiveJwtDecoder wrapping(JwtDecoder delegate) {
        return new BlockingReactiveJwtDecoder(delegate);
    }

    @Override
    public Mono<Jwt> decode(String token) throws JwtException {
        return Mono.fromCallable(() -> delegate.decode(token))
                .subscribeOn(Schedulers.boundedElastic());
    }
}
