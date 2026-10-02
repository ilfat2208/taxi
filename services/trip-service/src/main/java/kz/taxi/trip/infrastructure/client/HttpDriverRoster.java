package kz.taxi.trip.infrastructure.client;

import kz.taxi.trip.domain.TripErrorCode;
import lombok.extern.slf4j.Slf4j;
import org.springframework.web.client.RestClient;
import org.springframework.web.client.RestClientException;
import org.springframework.web.client.RestClientResponseException;

/**
 * Talks to driver-service on the internal API.
 *
 * <p>One mapping decides how good the ride feels: a driver who is not free is
 * {@link TripErrorCode#DRIVER_NOT_AVAILABLE} and nothing more. The ride then tries the
 * next candidate instead of failing — losing a race for a car is the normal outcome of
 * a busy city, not an error, and a rider must not be told "something went wrong"
 * because somebody else's trip started first.
 */
@Slf4j
public class HttpDriverRoster implements DriverRoster {

    private static final String INTERNAL_TRIP = "/api/v1/drivers/internal/{driverId}/trip";

    private final RestClient client;
    private final DownstreamErrors errors;

    public HttpDriverRoster(RestClient driverServiceRestClient, DownstreamErrors errors) {
        this.client = driverServiceRestClient;
        this.errors = errors;
    }

    @Override
    public DriverView assignTrip(String driverId, String tripId) {
        try {
            ClientDtos.DriverResponse response = client.post()
                    .uri(INTERNAL_TRIP, driverId)
                    .body(new ClientDtos.AssignDriverTripRequest(tripId))
                    .retrieve()
                    .body(ClientDtos.DriverResponse.class);
            return requireBody(response, "claim a driver for a trip");
        } catch (RestClientResponseException answered) {
            DownstreamErrors.Problem problem = errors.describe(answered);
            if (isDriverNotFree(problem)) {
                log.debug("driver {} could not take trip {} ({})", driverId, tripId, problem.summary());
                throw errors.refused(TripErrorCode.DRIVER_NOT_AVAILABLE, DownstreamErrors.DRIVER_SERVICE,
                        "claim a driver for a trip", problem);
            }
            throw errors.unanswered(TripErrorCode.DRIVER_SERVICE_ERROR, DownstreamErrors.DRIVER_SERVICE,
                    "claim a driver for a trip", problem);
        } catch (RestClientException unavailable) {
            throw errors.noAnswer(DownstreamErrors.DRIVER_SERVICE, "claim a driver for a trip", unavailable);
        }
    }

    @Override
    public DriverView finishTrip(String driverId) {
        try {
            ClientDtos.DriverResponse response = client.delete()
                    .uri(INTERNAL_TRIP, driverId)
                    .retrieve()
                    .body(ClientDtos.DriverResponse.class);
            return requireBody(response, "release a driver after a trip");
        } catch (RestClientResponseException answered) {
            DownstreamErrors.Problem problem = errors.describe(answered);
            if ("DRIVER_HAS_NO_TRIP".equals(problem.code())) {
                // He was already released — by an earlier attempt of this very call, or by
                // support. The desired end state is reached, so the saga's retry must not
                // fail on it.
                log.debug("driver {} had no active trip to finish ({})", driverId, problem.summary());
                return new DriverView(driverId, null, "ONLINE", null, true);
            }
            throw errors.unanswered(TripErrorCode.DRIVER_SERVICE_ERROR, DownstreamErrors.DRIVER_SERVICE,
                    "release a driver after a trip", problem);
        } catch (RestClientException unavailable) {
            throw errors.noAnswer(DownstreamErrors.DRIVER_SERVICE, "release a driver after a trip", unavailable);
        }
    }

    private static boolean isDriverNotFree(DownstreamErrors.Problem problem) {
        String code = problem.code();
        return problem.httpStatus() == 409
                || "DRIVER_ALREADY_ON_TRIP".equals(code)
                || "DRIVER_NOT_ON_DUTY".equals(code)
                || "DRIVER_NOT_FOUND".equals(code);
    }

    private DriverView requireBody(ClientDtos.DriverResponse response, String operation) {
        if (response == null) {
            throw errors.emptyBody(TripErrorCode.DRIVER_SERVICE_ERROR, DownstreamErrors.DRIVER_SERVICE, operation);
        }
        return new DriverView(response.driverId(), response.displayName(), response.status(),
                response.currentTripId(), response.available());
    }
}
