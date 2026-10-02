package kz.taxi.gateway;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;

/**
 * API gateway: the only public entry point.
 *
 * <p>Responsibilities kept deliberately narrow:
 * <ul>
 *   <li>issue access tokens (local development identity provider);</li>
 *   <li>validate the token once at the edge and forward the caller downstream;</li>
 *   <li>route to services, mint the correlation id, and rate limit per caller;</li>
 *   <li>aggregate the OpenAPI documents of all services into one portal.</li>
 * </ul>
 *
 * <p>It holds no business logic and no database: if the gateway is down the
 * platform loses its edge, not its data.
 */
@SpringBootApplication
public class ApiGatewayApplication {

    public static void main(String[] args) {
        SpringApplication.run(ApiGatewayApplication.class, args);
    }
}
