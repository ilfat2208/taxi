package kz.taxi.common.security;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.nimbusds.jose.jwk.JWKSet;
import com.sun.net.httpserver.HttpServer;

import java.io.IOException;
import java.io.OutputStream;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicInteger;

/**
 * A real (but tiny) JWKS endpoint backed by the JDK HTTP server.
 *
 * <p>Tests use an actual HTTP endpoint rather than a stubbed key source on purpose: the
 * behaviour under test — how often the key set is fetched, and what happens when it
 * changes — only exists in the HTTP path. The request counter is what turns "the decoder
 * caches" from a claim in a comment into something a test can fail on.
 */
final class JwksTestServer implements AutoCloseable {

    static final String PATH = "/.well-known/jwks.json";

    private static final ObjectMapper MAPPER = new ObjectMapper();

    private final HttpServer server;
    private final AtomicInteger requests = new AtomicInteger();
    private volatile String body;

    private JwksTestServer(JWKSet keySet) throws IOException {
        this.body = json(keySet);
        this.server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        this.server.createContext(PATH, exchange -> {
            requests.incrementAndGet();
            byte[] payload = body.getBytes(StandardCharsets.UTF_8);
            exchange.getResponseHeaders().add("Content-Type", "application/json");
            exchange.sendResponseHeaders(200, payload.length);
            try (OutputStream out = exchange.getResponseBody()) {
                out.write(payload);
            }
        });
        // Single-threaded and explicit: a test that asserts fetch counts must not race
        // with the server's own scheduling.
        this.server.setExecutor(Executors.newSingleThreadExecutor(runnable -> {
            Thread thread = new Thread(runnable, "test-jwks-server");
            thread.setDaemon(true);
            return thread;
        }));
        this.server.start();
    }

    static JwksTestServer start(JWKSet keySet) {
        try {
            return new JwksTestServer(keySet);
        } catch (IOException ex) {
            throw new IllegalStateException("cannot start the test JWKS server", ex);
        }
    }

    /** Publishes a new document — simulates a rotation at the issuer. */
    void serve(JWKSet keySet) {
        this.body = json(keySet);
    }

    String url() {
        return "http://127.0.0.1:" + server.getAddress().getPort() + PATH;
    }

    int requests() {
        return requests.get();
    }

    private static String json(JWKSet keySet) {
        try {
            return MAPPER.writeValueAsString(keySet.toJSONObject(true));
        } catch (Exception ex) {
            throw new IllegalStateException("cannot serialize the test key set", ex);
        }
    }

    @Override
    public void close() {
        server.stop(0);
    }
}
