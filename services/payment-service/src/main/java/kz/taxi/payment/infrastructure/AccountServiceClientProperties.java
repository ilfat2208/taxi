package kz.taxi.payment.infrastructure;

import org.springframework.boot.context.properties.ConfigurationProperties;

import java.time.Duration;

/**
 * Downstream clients ({@code taxi.clients.*}).
 *
 * <p>The timeouts are explicit rather than inherited from the HTTP client default
 * (which is "wait forever"): a payment that hangs on the account service holds a
 * hold open and a customer's money captive, so it must fail fast and let the saga
 * compensate or the recovery job resolve it.
 */
@ConfigurationProperties(prefix = "taxi.clients")
public class AccountServiceClientProperties {

    private final AccountService accountService = new AccountService();

    public AccountService getAccountService() {
        return accountService;
    }

    public static class AccountService {

        private String url = "http://localhost:8081";
        private Duration connectTimeout = Duration.ofSeconds(2);
        private Duration readTimeout = Duration.ofSeconds(5);

        public String getUrl() {
            return url;
        }

        public void setUrl(String url) {
            this.url = url;
        }

        public Duration getConnectTimeout() {
            return connectTimeout;
        }

        public void setConnectTimeout(Duration connectTimeout) {
            this.connectTimeout = connectTimeout;
        }

        public Duration getReadTimeout() {
            return readTimeout;
        }

        public void setReadTimeout(Duration readTimeout) {
            this.readTimeout = readTimeout;
        }
    }
}
