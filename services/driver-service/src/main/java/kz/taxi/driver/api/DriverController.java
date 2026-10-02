package kz.taxi.driver.api;

import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;
import kz.taxi.common.security.AuthenticatedUser;
import kz.taxi.common.security.CurrentUser;
import kz.taxi.driver.api.dto.DriverDtos;
import kz.taxi.driver.application.DriverApplicationService;
import kz.taxi.driver.domain.Driver;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;

/**
 * The driver's own API.
 *
 * <p>Every endpoint is about {@code me}: there is deliberately no
 * {@code /api/v1/drivers/{id}} here. A driver reading a colleague's profile (or
 * worse, toggling his duty) is not a feature that needs authorization later — it
 * is a feature that should not exist. Operator and dispatch access will arrive as
 * separate, explicitly authorized endpoints, because those have a reason to exist.
 *
 * <p>Thin on purpose: no business rules and no status codes invented locally. The
 * rules live in the aggregate, which is the only place that knows whether a
 * driver may go on duty.
 */
@RestController
@RequestMapping("/api/v1/drivers")
@Tag(name = "Drivers", description = "Driver profile, documents and duty state")
public class DriverController {

    private final DriverApplicationService driverService;
    private final DriverMapper mapper;
    private final CurrentUser currentUser;

    public DriverController(DriverApplicationService driverService,
                            DriverMapper mapper,
                            CurrentUser currentUser) {
        this.driverService = driverService;
        this.mapper = mapper;
        this.currentUser = currentUser;
    }

    @PostMapping
    @ResponseStatus(HttpStatus.CREATED)
    @Operation(summary = "Register the caller as a driver")
    public DriverDtos.DriverResponse register(@Valid @RequestBody DriverDtos.RegisterDriverRequest request) {
        AuthenticatedUser user = currentUser.require();
        Driver driver = driverService.register(user.userId(), user.phone(), request.displayName());
        return mapper.toResponse(driver, List.of());
    }

    @GetMapping("/me")
    @Operation(summary = "Own profile with documents and duty state")
    public DriverDtos.DriverResponse me() {
        Driver driver = driverService.requireByUserId(currentUser.require().userId());
        return mapper.toResponse(driver, driverService.documents(driver.getId()));
    }

    @PostMapping("/me/documents")
    @Operation(summary = "Submit a document; renews it when one of the same kind exists")
    public DriverDtos.DocumentResponse submitDocument(@Valid @RequestBody DriverDtos.DocumentRequest request) {
        AuthenticatedUser user = currentUser.require();
        return mapper.toDocument(driverService.issueDocument(user.userId(), request.kind(), request.expiresAt()));
    }

    @PostMapping("/me/status")
    @Operation(summary = "Go on or off duty")
    public DriverDtos.DriverResponse changeStatus(@Valid @RequestBody DriverDtos.ChangeStatusRequest request) {
        AuthenticatedUser user = currentUser.require();
        Driver driver = driverService.changeStatus(user.userId(), request.status());
        return mapper.toResponse(driver, driverService.documents(driver.getId()));
    }
}
