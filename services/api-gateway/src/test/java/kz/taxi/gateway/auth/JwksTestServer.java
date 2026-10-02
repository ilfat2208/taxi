package kz.taxi.gateway.auth;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.nimbusds.jose.jwk.JWKSet;
import com.sun.net.httpserver.HttpServer;

import java.io.IOException;
import java.io.OutputStream;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.Executors;

/**
 * A real (but tiny) JWKS endpoint for the gateway tests.
 *
 * <p>Needed because the gateway in JWKS mode verifies tokens through an actual key set
 * URL; stubbing the decoder would skip exactly the wiring this test exists to prove.
 */
final class JwksTestServer implements AutoCloseable {

    static final String PATH = "/.well-known/jwks.json";

    private static final ObjectMapper MAPPER = new ObjectMapper();

    private final HttpServer server;
    private final String body;

    private JwksTestServer(JWKSet keySet) throws IOException {
        this.body = MAPPER.writeValueAsString(keySet.toJSONObject(true));
        this.server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        this.server.createContext(PATH, exchange -> {
            byte[] payload = body.getBytes(StandardCharsets.UTF_8);
            exchange.getResponseHeaders().add("Content-Type", "application/json");
            exchange.sendResponseHeaders(200, payload.length);
            try (OutputStream out = exchange.getResponseBody()) {
                out.write(payload);
            }
        });
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

    String url() {
        return "http://127.0.0.1:" + server.getAddress().getPort() + PATH;
    }

    @Override
    public void close() {
        server.stop(0);
    }
}
