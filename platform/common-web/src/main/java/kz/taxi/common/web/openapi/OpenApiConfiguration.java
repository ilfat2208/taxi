package kz.taxi.common.web.openapi;

import io.swagger.v3.oas.models.Components;
import io.swagger.v3.oas.models.OpenAPI;
import io.swagger.v3.oas.models.info.Contact;
import io.swagger.v3.oas.models.info.Info;
import io.swagger.v3.oas.models.info.License;
import io.swagger.v3.oas.models.security.SecurityRequirement;
import io.swagger.v3.oas.models.security.SecurityScheme;
import io.swagger.v3.oas.models.servers.Server;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.autoconfigure.AutoConfiguration;
import org.springframework.boot.autoconfigure.condition.ConditionalOnClass;
import org.springframework.boot.autoconfigure.condition.ConditionalOnMissingBean;
import org.springframework.boot.autoconfigure.condition.ConditionalOnWebApplication;
import org.springframework.context.annotation.Bean;

import java.util.List;

/**
 * Shared OpenAPI document: bearer auth is declared once so Swagger UI shows an
 * "Authorize" button in every service, and the correlation header is documented
 * as the first-class tracing tool it is.
 */
@AutoConfiguration
@ConditionalOnClass(OpenAPI.class)
@ConditionalOnWebApplication(type = ConditionalOnWebApplication.Type.SERVLET)
public class OpenApiConfiguration {

    @Bean
    @ConditionalOnMissingBean
    public OpenAPI taxiOpenApi(@Value("${spring.application.name:service}") String applicationName,
                                @Value("${taxi.openapi.title:Taxi Clone API}") String title,
                                @Value("${taxi.openapi.version:1.0.0}") String version) {
        return new OpenAPI()
                .info(new Info()
                        .title(title)
                        .version(version)
                        .description("""
                                Taxi fintech super-app platform.

                                Every endpoint that moves money requires an `Idempotency-Key` header.
                                Send `X-Correlation-Id` to trace a request across services; it is echoed
                                back and attached to every Kafka event the request produces.""")
                        .contact(new Contact().name("Platform team").email("platform@taxi.local"))
                        .license(new License().name("Apache-2.0")))
                .servers(List.of(new Server().url("/").description("current host (%s)".formatted(applicationName))))
                .components(new Components()
                        .addSecuritySchemes("bearer-jwt", new SecurityScheme()
                                .type(SecurityScheme.Type.HTTP)
                                .scheme("bearer")
                                .bearerFormat("JWT")
                                .description("Access token issued by POST /api/v1/auth/token on the api-gateway")))
                .addSecurityItem(new SecurityRequirement().addList("bearer-jwt"));
    }
}
