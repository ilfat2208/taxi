package kz.taxi.payment.infrastructure;

import kz.taxi.common.core.error.DomainException;
import kz.taxi.common.core.money.Currency;
import kz.taxi.payment.domain.PaymentErrorCode;
import lombok.extern.slf4j.Slf4j;
import org.springframework.web.client.HttpClientErrorException;
import org.springframework.web.client.RestClient;
import org.springframework.web.client.RestClientException;

import java.util.Optional;

/**
 * HTTP implementation of the account service contract.
 *
 * <p>The {@link RestClient} it uses is built from the auto-configured
 * {@code RestClient.Builder}, so the platform's outbound interceptor already adds
 * {@code Authorization}, {@code X-Internal-Token} and {@code X-Correlation-Id} —
 * this class never sets a header, which is also why it works unchanged from a
 * scheduled job (no user token) and from a request (user token forwarded).
 *
 * <p>Every failure goes through {@link AccountServiceProblemTranslator} before it
 * reaches the application layer, so no code above this class has to know what an
 * HTTP status is.
 */
@Slf4j
public class HttpAccountServiceClient implements AccountServiceClient {

    private static final String PUBLIC_ACCOUNTS = "/api/v1/accounts";
    private static final String INTERNAL_ACCOUNTS = "/api/v1/accounts/internal";

    private final RestClient client;
    private final AccountServiceProblemTranslator translator;

    public HttpAccountServiceClient(RestClient accountServiceRestClient,
                                    AccountServiceProblemTranslator translator) {
        this.client = accountServiceRestClient;
        this.translator = translator;
    }

    // ------------------------------------------------------------------ reads

    @Override
    public AccountSnapshot getAccount(String accountId) {
        AccountServiceDtos.PublicAccountResponse response = get(
                PUBLIC_ACCOUNTS + "/{accountId}", AccountServiceDtos.PublicAccountResponse.class,
                PaymentErrorCode.SOURCE_ACCOUNT_NOT_OWNED, "read the source account", accountId);
        return new AccountSnapshot(response.id(), response.ownerUserId(), response.ownerPhone(),
                response.currency(), response.status(), response.balanceMinor(), response.heldMinor(),
                response.availableMinor());
    }

    @Override
    public ResolvedAccount resolveByPhone(String phone, Currency currency) {
        AccountServiceDtos.ResolveAccountResponse response = get(
                INTERNAL_ACCOUNTS + "/resolve?phone={phone}&currency={currency}",
                AccountServiceDtos.ResolveAccountResponse.class,
                PaymentErrorCode.TARGET_ACCOUNT_NOT_FOUND, "resolve the recipient account", phone, currency);
        return new ResolvedAccount(response.accountId(), response.ownerUserId(), response.currency(),
                response.status());
    }

    @Override
    public Optional<HoldSnapshot> findActiveHold(String referenceType, String referenceId, String accountId) {
        String uri = INTERNAL_ACCOUNTS + "/holds?referenceType={referenceType}&referenceId={referenceId}"
                + "&accountId={accountId}";
        try {
            AccountServiceDtos.HoldResponse response = client.get()
                    .uri(uri, referenceType, referenceId, accountId)
                    .retrieve()
                    .body(AccountServiceDtos.HoldResponse.class);
            return Optional.ofNullable(response).map(HttpAccountServiceClient::toHold);
        } catch (HttpClientErrorException.NotFound notFound) {
            // "There is no active hold" is an answer, not a failure: the recovery job
            // needs to distinguish it from "the account service is down".
            return Optional.empty();
        } catch (RestClientException failure) {
            throw translator.translate(failure, PaymentErrorCode.HOLD_FAILED, "find the hold of a payment");
        }
    }

    @Override
    public Optional<HoldSnapshot> findHold(String holdId) {
        try {
            AccountServiceDtos.HoldResponse response = client.get()
                    .uri(INTERNAL_ACCOUNTS + "/holds/{holdId}", holdId)
                    .retrieve()
                    .body(AccountServiceDtos.HoldResponse.class);
            return Optional.ofNullable(response).map(HttpAccountServiceClient::toHold);
        } catch (HttpClientErrorException.NotFound notFound) {
            return Optional.empty();
        } catch (RestClientException failure) {
            throw translator.translate(failure, PaymentErrorCode.HOLD_FAILED, "read a hold");
        }
    }

    // ------------------------------------------------------------------ money

    @Override
    public HoldSnapshot placeHold(HoldRequest request) {
        AccountServiceDtos.HoldResponse response = post(INTERNAL_ACCOUNTS + "/holds",
                new AccountServiceDtos.PlaceHoldRequest(request.accountId(), request.amountMinor(),
                        request.currency(), request.referenceType(), request.referenceId(),
                        request.idempotencyKey(), request.reason()),
                AccountServiceDtos.HoldResponse.class,
                PaymentErrorCode.HOLD_FAILED, "reserve funds for a payment");
        return toHold(response);
    }

    @Override
    public CaptureResult capture(String holdId, CaptureRequest request) {
        AccountServiceDtos.CaptureHoldResponse response = post(
                INTERNAL_ACCOUNTS + "/holds/{holdId}/capture", holdId,
                new AccountServiceDtos.CaptureHoldRequest(request.targetAccountId(), request.referenceType(),
                        request.referenceId(), request.operation(), request.description()),
                AccountServiceDtos.CaptureHoldResponse.class,
                PaymentErrorCode.HOLD_FAILED, "move reserved funds");
        return new CaptureResult(response.holdId(), response.status(), response.transactionId(),
                response.sourceAccountId(), response.targetAccountId(), response.amountMinor(),
                response.currency(), response.replayed());
    }

    @Override
    public void release(String holdId, String reason) {
        try {
            client.post()
                    .uri(INTERNAL_ACCOUNTS + "/holds/{holdId}/release", holdId)
                    .body(new AccountServiceDtos.ReleaseHoldRequest(reason))
                    .retrieve()
                    .toBodilessEntity();
        } catch (RestClientException failure) {
            throw translator.translate(failure, PaymentErrorCode.HOLD_FAILED, "release reserved funds");
        }
    }

    @Override
    public CreditResult credit(CreditRequest request) {
        AccountServiceDtos.CreditResponse response = post(INTERNAL_ACCOUNTS + "/credits",
                new AccountServiceDtos.CreditRequest(request.accountId(), request.amountMinor(),
                        request.currency(), request.referenceType(), request.referenceId(),
                        request.operation(), request.description()),
                AccountServiceDtos.CreditResponse.class,
                PaymentErrorCode.HOLD_FAILED, "credit a refunded amount");
        return new CreditResult(response.accountId(), response.transactionId(), response.amountMinor(),
                response.currency(), response.balanceAfterMinor(), response.replayed());
    }

    // ------------------------------------------------------------------ plumbing

    private <T> T get(String uri,
                      Class<T> responseType,
                      PaymentErrorCode fallback,
                      String operation,
                      Object... uriVariables) {
        try {
            return requireBody(client.get().uri(uri, uriVariables).retrieve().body(responseType), operation);
        } catch (RestClientException failure) {
            throw translator.translate(failure, fallback, operation);
        }
    }

    private <T> T post(String uri,
                       Object body,
                       Class<T> responseType,
                       PaymentErrorCode fallback,
                       String operation) {
        try {
            return requireBody(client.post().uri(uri).body(body).retrieve().body(responseType), operation);
        } catch (RestClientException failure) {
            throw translator.translate(failure, fallback, operation);
        }
    }

    private <T> T post(String uri,
                       String uriVariable,
                       Object body,
                       Class<T> responseType,
                       PaymentErrorCode fallback,
                       String operation) {
        try {
            return requireBody(client.post().uri(uri, uriVariable).body(body).retrieve().body(responseType), operation);
        } catch (RestClientException failure) {
            throw translator.translate(failure, fallback, operation);
        }
    }

    private static <T> T requireBody(T body, String operation) {
        if (body == null) {
            // A 2xx with no body means the contract was not honoured; saying so is
            // better than a NullPointerException three frames later.
            throw DomainException.of(PaymentErrorCode.ACCOUNT_SERVICE_ERROR,
                    "account-service answered {} without a body", operation);
        }
        return body;
    }

    private static HoldSnapshot toHold(AccountServiceDtos.HoldResponse response) {
        return new HoldSnapshot(response.holdId(), response.accountId(), response.amountMinor(),
                response.currency(), response.status(), response.availableMinor(), response.expiresAt(),
                response.replayed());
    }
}
