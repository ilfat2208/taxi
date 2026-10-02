package kz.taxi.trip.infrastructure.client;

import kz.taxi.trip.domain.TripErrorCode;
import lombok.extern.slf4j.Slf4j;
import org.springframework.web.client.RestClient;
import org.springframework.web.client.RestClientException;
import org.springframework.web.client.RestClientResponseException;

import java.util.List;

/**
 * Asks dispatch-service who is free.
 *
 * <p>It calls the service's <em>internal</em> endpoint
 * ({@code /api/v1/dispatch/internal/nearest}), authenticated with the workload token.
 * The dispatcher-facing endpoint answers the same question but requires the DISPATCHER
 * role, and a trip is not a person: it has no role to present. The internal endpoint
 * exists exactly for this — one service asking another a question the rider's token has
 * no authority to ask.
 */
@Slf4j
public class HttpDriverFinder implements DriverFinder {

    private static final String INTERNAL_NEAREST = "/api/v1/dispatch/internal/nearest";

    private final RestClient client;
    private final DownstreamErrors errors;

    public HttpDriverFinder(RestClient dispatchServiceRestClient, DownstreamErrors errors) {
        this.client = dispatchServiceRestClient;
        this.errors = errors;
    }

    @Override
    public List<Candidate> nearest(double lat, double lon, int radiusM, int limit) {
        try {
            ClientDtos.NearestResponse response = client.get()
                    .uri(INTERNAL_NEAREST + "?lat={lat}&lon={lon}&radiusM={radiusM}&limit={limit}",
                            lat, lon, radiusM, limit)
                    .retrieve()
                    .body(ClientDtos.NearestResponse.class);
            if (response == null || response.candidates() == null) {
                throw errors.emptyBody(TripErrorCode.DISPATCH_SERVICE_ERROR, DownstreamErrors.DISPATCH_SERVICE,
                        "find the nearest drivers");
            }
            List<Candidate> candidates = response.candidates().stream()
                    .map(candidate -> new Candidate(candidate.driverId(), candidate.displayName(),
                            candidate.distanceM(), candidate.lat(), candidate.lon(), candidate.ageSeconds()))
                    .toList();
            log.debug("dispatch returned {} candidates within {} m", candidates.size(), response.radiusM());
            return candidates;
        } catch (RestClientResponseException answered) {
            // A refusal here (a radius dispatch refuses, a malformed query) is an
            // incident of the integration, never "there are no cars": reading it as an
            // empty city would send riders away while cars are standing.
            throw errors.unanswered(TripErrorCode.DISPATCH_SERVICE_ERROR, DownstreamErrors.DISPATCH_SERVICE,
                    "find the nearest drivers", errors.describe(answered));
        } catch (RestClientException unavailable) {
            throw errors.noAnswer(DownstreamErrors.DISPATCH_SERVICE, "find the nearest drivers", unavailable);
        }
    }
}
