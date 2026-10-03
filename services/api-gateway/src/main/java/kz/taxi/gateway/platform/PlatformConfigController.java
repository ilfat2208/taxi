package kz.taxi.gateway.platform;

import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import reactor.core.publisher.Mono;

import java.util.Map;

/**
 * The one call a client makes at startup.
 *
 * <p>Public: it is what a client asks <em>before</em> it has a token — the price list it
 * shows on the first screen, the payment methods it can offer, and the honest list of what
 * the platform does not do yet.
 */
@RestController
@RequestMapping("/api/v1/config")
@Tag(name = "Configuration", description = "Client configuration: tariffs, payment methods, verticals, features")
public class PlatformConfigController {

    private final PlatformConfigService service;

    public PlatformConfigController(PlatformConfigService service) {
        this.service = service;
    }

    @GetMapping
    @Operation(summary = "Client configuration",
            description = "Public. Aggregates the platform's own facts with the tariff catalogue and the payment "
                    + "methods. A downstream block that cannot be fetched stays in the answer as available=false "
                    + "with a reason, so one slow service does not take the whole configuration down.")
    public Mono<Map<String, Object>> config() {
        return service.config();
    }
}
