package kz.taxi.trip.infrastructure.client;

import kz.taxi.common.core.error.DomainException;
import kz.taxi.common.core.money.Currency;
import kz.taxi.trip.domain.TripErrorCode;
import lombok.extern.slf4j.Slf4j;
import org.springframework.web.client.HttpClientErrorException;
import org.springframework.web.client.RestClient;
import org.springframework.web.client.RestClientException;
import org.springframework.web.client.RestClientResponseException;

import java.util.Optional;

/**
 * HTTP implementation of the money contract.
 *
 * <p>The mapping this class exists for is the one that decides whether a rider sees a
 * sensible message or a 500: a refusal by the account service is a refusal of the trip
 * API. In particular
 *
 * <table>
 *   <tr><th>account-service</th><th>here</th></tr>
 *   <tr><td>422 {@code INSUFFICIENT_FUNDS}</td><td>422 {@code INSUFFICIENT_FUNDS} — the rider cannot pay for this ride</td></tr>
 *   <tr><td>422 {@code LIMIT_EXCEEDED}/{@code VELOCITY_EXCEEDED}</td><td>422 {@code INSUFFICIENT_FUNDS} — the wallet refuses to pay, and the rider can act on either</td></tr>
 *   <tr><td>404 unknown account</td><td>422 {@code RIDER_ACCOUNT_NOT_FOUND}</td></tr>
 *   <tr><td>409 hold not active / expired</td><td>409 {@code HOLD_FAILED} or {@code CAPTURE_FAILED}</td></tr>
 *   <tr><td>5xx, timeout, connection refused</td><td>503 {@code DOWNSTREAM_UNAVAILABLE}</td></tr>
 *   <tr><td>a 2xx that is not the agreed shape</td><td>502 {@code ACCOUNT_SERVICE_ERROR}</td></tr>
 * </table>
 */
@Slf4j
public class HttpRideAccountClient implements RideAccountClient {

    private static final String INTERNAL_ACCOUNTS = "/api/v1/accounts/internal";

    private final RestClient client;
    private final DownstreamErrors errors;

    public HttpRideAccountClient(RestClient accountServiceRestClient, DownstreamErrors errors) {
        this.client = accountServiceRestClient;
        this.errors = errors;
    }

    @Override
    public ResolvedAccount resolveByPhone(String phone, Currency currency) {
        try {
            ClientDtos.ResolveAccountResponse response = client.get()
                    .uri(INTERNAL_ACCOUNTS + "/resolve?phone={phone}&currency={currency}", phone, currency)
                    .retrieve()
                    .body(ClientDtos.ResolveAccountResponse.class);
            if (response == null) {
                throw errors.emptyBody(TripErrorCode.ACCOUNT_SERVICE_ERROR, DownstreamErrors.ACCOUNT_SERVICE,
                        "resolve the rider's wallet");
            }
            return new ResolvedAccount(response.accountId(), response.ownerUserId(),
                    response.currency(), response.status());
        } catch (RestClientResponseException answered) {
            DownstreamErrors.Problem problem = errors.describe(answered);
            if (problem.httpStatus() == 404) {
                // No wallet for this phone is a state of the rider, not an incident: he
                // has to open an account before he can be quoted a price for a ride.
                throw errors.refused(TripErrorCode.RIDER_ACCOUNT_NOT_FOUND, DownstreamErrors.ACCOUNT_SERVICE,
                        "resolve the rider's wallet", problem);
            }
            throw errors.unanswered(TripErrorCode.ACCOUNT_SERVICE_ERROR, DownstreamErrors.ACCOUNT_SERVICE,
                    "resolve the rider's wallet", problem);
        } catch (RestClientException unavailable) {
            throw errors.noAnswer(DownstreamErrors.ACCOUNT_SERVICE, "resolve the rider's wallet", unavailable);
        }
    }

    @Override
    public Optional<HoldView> findActiveHold(String referenceType, String referenceId, String accountId) {
        String uri = INTERNAL_ACCOUNTS + "/holds?referenceType={referenceType}&referenceId={referenceId}"
                + "&accountId={accountId}";
        try {
            ClientDtos.HoldResponse response = client.get()
                    .uri(uri, referenceType, referenceId, accountId)
                    .retrieve()
                    .body(ClientDtos.HoldResponse.class);
            return Optional.ofNullable(response).map(HttpRideAccountClient::toHold);
        } catch (HttpClientErrorException.NotFound notFound) {
            // "There is no active hold" is an answer, not a failure: it is what a
            // retried assignment looks like before it reserves anything.
            return Optional.empty();
        } catch (RestClientException failure) {
            throw errors.noAnswer(DownstreamErrors.ACCOUNT_SERVICE, "read the fare reservation of a trip", failure);
        }
    }

    @Override
    public HoldView placeHold(HoldRequest request) {
        try {
            ClientDtos.HoldResponse response = client.post()
                    .uri(INTERNAL_ACCOUNTS + "/holds")
                    .body(new ClientDtos.PlaceHoldRequest(request.accountId(), request.amountMinor(),
                            request.currency().name(), request.referenceType(), request.referenceId(),
                            request.idempotencyKey(), request.reason()))
                    .retrieve()
                    .body(ClientDtos.HoldResponse.class);
            if (response == null) {
                throw errors.emptyBody(TripErrorCode.ACCOUNT_SERVICE_ERROR, DownstreamErrors.ACCOUNT_SERVICE,
                        "reserve the fare");
            }
            return toHold(response);
        } catch (RestClientResponseException answered) {
            throw refusalOfReservation(answered);
        } catch (RestClientException unavailable) {
            throw errors.noAnswer(DownstreamErrors.ACCOUNT_SERVICE, "reserve the fare", unavailable);
        }
    }

    @Override
    public CaptureView capture(String holdId, CaptureRequest request) {
        try {
            ClientDtos.CaptureHoldResponse response = client.post()
                    .uri(INTERNAL_ACCOUNTS + "/holds/{holdId}/capture", holdId)
                    .body(new ClientDtos.CaptureHoldRequest(request.targetAccountId(), request.referenceType(),
                            request.referenceId(), request.operation(), request.description()))
                    .retrieve()
                    .body(ClientDtos.CaptureHoldResponse.class);
            if (response == null) {
                throw errors.emptyBody(TripErrorCode.ACCOUNT_SERVICE_ERROR, DownstreamErrors.ACCOUNT_SERVICE,
                        "capture the fare");
            }
            return new CaptureView(response.holdId(), response.status(), response.transactionId(),
                    response.sourceAccountId(), response.targetAccountId(), response.amountMinor(),
                    response.currency(), response.replayed());
        } catch (RestClientResponseException answered) {
            DownstreamErrors.Problem problem = errors.describe(answered);
            throw errors.refused(TripErrorCode.CAPTURE_FAILED, DownstreamErrors.ACCOUNT_SERVICE,
                    "capture the fare", problem);
        } catch (RestClientException unavailable) {
            throw errors.noAnswer(DownstreamErrors.ACCOUNT_SERVICE, "capture the fare", unavailable);
        }
    }

    @Override
    public void release(String holdId, String reason) {
        try {
            client.post()
                    .uri(INTERNAL_ACCOUNTS + "/holds/{holdId}/release", holdId)
                    .body(new ClientDtos.ReleaseHoldRequest(reason))
                    .retrieve()
                    .toBodilessEntity();
        } catch (RestClientResponseException answered) {
            DownstreamErrors.Problem problem = errors.describe(answered);
            // A hold that is already released or expired is the desired end state: a
            // retried cancellation must not fail because the money is already back.
            if (problem.httpStatus() == 404 || "HOLD_NOT_FOUND".equals(problem.code())) {
                log.debug("nothing to release on hold {} ({})", holdId, problem.summary());
                return;
            }
            throw errors.refused(TripErrorCode.HOLD_FAILED, DownstreamErrors.ACCOUNT_SERVICE,
                    "release the fare", problem);
        } catch (RestClientException unavailable) {
            throw errors.noAnswer(DownstreamErrors.ACCOUNT_SERVICE, "release the fare", unavailable);
        }
    }

    // ------------------------------------------------------------------ mapping

    /**
     * Why a reservation was refused, in this service's words.
     *
     * <p>{@code INSUFFICIENT_FUNDS} is mirrored rather than wrapped: it is the one code
     * the rider's screen acts on ("top up your wallet"), and folding it into a generic
     * 409 would hide the only useful thing the account service said. The rider's own
     * limits are folded into the same code because from his point of view both mean
     * "this wallet will not pay for this ride"; the difference survives in
     * {@code details.downstreamCode} for the screen that wants to name the limit.
     */
    private DomainException refusalOfReservation(RestClientResponseException answered) {
        DownstreamErrors.Problem problem = errors.describe(answered);
        String code = problem.code();
        if ("INSUFFICIENT_FUNDS".equals(code) || "LIMIT_EXCEEDED".equals(code)
                || "VELOCITY_EXCEEDED".equals(code)) {
            return errors.refused(TripErrorCode.INSUFFICIENT_FUNDS, DownstreamErrors.ACCOUNT_SERVICE,
                    "reserve the fare", problem);
        }
        if (problem.httpStatus() == 404 || "ACCOUNT_NOT_FOUND".equals(code)) {
            return errors.refused(TripErrorCode.RIDER_ACCOUNT_NOT_FOUND, DownstreamErrors.ACCOUNT_SERVICE,
                    "reserve the fare", problem);
        }
        return errors.refused(TripErrorCode.HOLD_FAILED, DownstreamErrors.ACCOUNT_SERVICE,
                "reserve the fare", problem);
    }

    private static HoldView toHold(ClientDtos.HoldResponse response) {
        return new HoldView(response.holdId(), response.accountId(), response.amountMinor(), response.currency(),
                response.status(), response.availableMinor(), response.expiresAt(), response.replayed());
    }
}
