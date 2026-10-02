package kz.taxi.payment.support;

import org.springframework.test.context.DynamicPropertyRegistry;
import org.testcontainers.DockerClientFactory;
import org.testcontainers.containers.PostgreSQLContainer;

/**
 * The infrastructure a {@code *IT} runs against: Testcontainers in CI, an
 * already-running stack on a developer machine that sets {@code IT_DATABASE_URL}.
 *
 * <p><b>Why this exists.</b> {@code @Testcontainers(disabledWithoutDocker = true)}
 * turns an integration test into a <em>skipped</em> one on a machine where the
 * Docker CLI works but docker-java cannot negotiate with the daemon (all named
 * pipes answer with an empty {@code DockerInfo}). The suite then reports green
 * while proving nothing at all — the worst possible outcome for a test whose only
 * value is that it really touches a database. This helper keeps the container path
 * untouched (a GitHub-hosted runner always has a working daemon, so CI starts
 * exactly the container it started before) and adds an escape hatch:
 *
 * <pre>
 *   IT_DATABASE_URL=jdbc:postgresql://127.0.0.1:5432/it_payment
 *   IT_KAFKA_BOOTSTRAP=127.0.0.1:9092          (optional)
 *   POSTGRES_USER=taxi POSTGRES_PASSWORD=taxi  (the services' own variables)
 * </pre>
 *
 * <p><b>The host matters.</b> A machine that already runs its own PostgreSQL keeps the
 * IPv4 wildcard port, so {@code localhost} and {@code 127.0.0.1} can reach <em>that</em>
 * server rather than the container — the symptom is a confusing "role does not exist"
 * from Flyway. Use whichever address actually answers with the {@code taxi} role
 * ({@code [::1]} on the machine this was written on, where a native PostgreSQL owned the
 * IPv4 port); {@code scripts/it-local.ps1} probes the candidates and picks one.
 *
 * <p>When {@code IT_DATABASE_URL} is set, <em>nothing</em> is started: the test
 * connects through {@code spring.datasource.url} and Flyway migrates that database
 * during the first context refresh ({@code spring.flyway.create-schemas=true} creates
 * the service's schema inside it). The external database must therefore be dedicated
 * to tests — pointing {@code IT_DATABASE_URL} at a database that holds demo data
 * would let the migrations rewrite it.
 *
 * <p>Credentials are the ones the services already read ({@code POSTGRES_USER} /
 * {@code POSTGRES_PASSWORD}, defaulting to {@code taxi}/{@code taxi});
 * {@code IT_DATABASE_USER} and {@code IT_DATABASE_PASSWORD} override them when the
 * test database has its own owner. In container mode the credentials, like the JDBC
 * URL, come from the container — the same values {@code @ServiceConnection} used to
 * supply.
 *
 * <p>Kafka is deliberately <em>not</em> containerised: no {@code *IT} needs a broker
 * (the listeners are off, the outbox relay is off and the outbox rows are asserted
 * directly, which is the stronger assertion), so starting one would only add a second
 * race to the suite. {@code IT_KAFKA_BOOTSTRAP} merely forwards a broker address for a
 * test that ever needs one.
 *
 * <p><b>This file is intentionally identical in every module that has an {@code *IT}</b>
 * (payment, order, catalog). Maven gives a module no access to another module's test
 * sources, and adding a test-jar dependency is a change to the build that integration
 * test support does not justify. Keep the copies in step.
 */
public final class ItInfrastructure {

    /**
     * {@link #available()} as a method reference for JUnit's {@code @EnabledIf}: the
     * annotation needs a constant, and spelling the FQN out in every test class is
     * exactly the kind of string that survives a package rename in one file only.
     */
    public static final String AVAILABLE_METHOD = "kz.taxi.payment.support.ItInfrastructure#available";

    /** A JDBC URL of an already-running PostgreSQL: set it and no container is started. */
    public static final String DATABASE_URL = "IT_DATABASE_URL";

    /** Optional overrides, for a test database whose owner is not {@code POSTGRES_USER}. */
    public static final String DATABASE_USER = "IT_DATABASE_USER";
    public static final String DATABASE_PASSWORD = "IT_DATABASE_PASSWORD";

    /** Optional {@code host:port} of an already-running Kafka, forwarded as-is. */
    public static final String KAFKA_BOOTSTRAP = "IT_KAFKA_BOOTSTRAP";

    private final String jdbcUrl;
    private final String username;
    private final String password;
    private final PostgreSQLContainer<?> container;

    private ItInfrastructure(String jdbcUrl, String username, String password, PostgreSQLContainer<?> container) {
        this.jdbcUrl = jdbcUrl;
        this.username = username;
        this.password = password;
        this.container = container;
    }

    /**
     * Whether a test class may run at all: an external database is configured, or
     * Docker is usable.
     *
     * <p>Meant to be referenced from JUnit's {@code @EnabledIf}, so it never throws and
     * never starts anything: a class whose condition is false is reported as
     * <em>skipped</em> (the old {@code disabledWithoutDocker} behaviour) instead of
     * failing on a machine with no Docker and no external database.
     */
    public static boolean available() {
        return external(env(DATABASE_URL)) != null || DockerClientFactory.instance().isDockerAvailable();
    }

    /**
     * Uses {@code IT_DATABASE_URL} when it is set and starts {@code container} otherwise.
     *
     * <p>Called from a static initializer, i.e. before the Spring context exists: the
     * container has to be running by the time {@link #register(DynamicPropertyRegistry)}
     * is asked for the JDBC URL. Testcontainers' own shutdown hook (Ryuk) stops a
     * started container after the JVM exits, exactly as the {@code @Container}
     * extension did.
     */
    public static ItInfrastructure start(PostgreSQLContainer<?> container) {
        String externalUrl = external(env(DATABASE_URL));
        if (externalUrl != null) {
            return new ItInfrastructure(externalUrl, external(env(DATABASE_USER)),
                    external(env(DATABASE_PASSWORD)), null);
        }
        if (!DockerClientFactory.instance().isDockerAvailable()) {
            throw new IllegalStateException("no " + DATABASE_URL + " is set and Docker is not usable, so "
                    + container.getDockerImageName() + " cannot be started; guard the class with "
                    + "@EnabledIf(\"" + ItInfrastructure.class.getName() + "#available\") or point "
                    + DATABASE_URL + " at a test database");
        }
        container.start();
        return new ItInfrastructure(container.getJdbcUrl(), container.getUsername(), container.getPassword(),
                container);
    }

    /**
     * Publishes the connection to Spring, overriding the service's own defaults.
     *
     * <p>Username and password are only overridden when they are known here: in external
     * mode the service keeps reading {@code POSTGRES_USER} / {@code POSTGRES_PASSWORD}
     * from its own configuration, so there is exactly one place that decides them.
     */
    public void register(DynamicPropertyRegistry registry) {
        registry.add("spring.datasource.url", () -> jdbcUrl);
        if (username != null) {
            registry.add("spring.datasource.username", () -> username);
        }
        if (password != null) {
            registry.add("spring.datasource.password", () -> password);
        }
        String kafka = external(env(KAFKA_BOOTSTRAP));
        if (kafka != null) {
            registry.add("spring.kafka.bootstrap-servers", () -> kafka);
        }
    }

    /** Where the tests are actually pointing — worth printing when something fails. */
    public String describe() {
        return container != null
                ? "Testcontainers " + container.getDockerImageName() + " (" + jdbcUrl + ")"
                : DATABASE_URL + "=" + jdbcUrl;
    }

    private static String env(String name) {
        return System.getenv(name);
    }

    private static String external(String value) {
        return value == null || value.isBlank() ? null : value.trim();
    }
}
