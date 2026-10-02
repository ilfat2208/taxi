package kz.taxi.payment.infrastructure;

import org.springframework.boot.context.properties.ConfigurationProperties;

import java.time.Duration;

/**
 * Product and orchestration settings ({@code taxi.payments.*}).
 *
 * <p>Nothing here is a magic number in code: fees are a product decision, page
 * size is an API contract, and the saga timeout is the line between "the driving
 * request is still alive" and "nobody is coming back for this payment".
 */
@ConfigurationProperties(prefix = "taxi.payments")
public class PaymentProperties {

    /** Fee for P2P transfers in basis points. Free by default. */
    private long transferFeeBp = 0L;

    /** Marketplace fee in basis points (150 bp = 1.5%), charged on top of the order amount. */
    private long merchantFeeBp = 150L;

    private int pageSizeDefault = 20;
    private int pageSizeMax = 100;

    /**
     * Documented alias of {@code taxi.payments.saga.stuck-threshold}. Both are
     * honoured; the nested saga value wins when it is set, so an existing
     * deployment that already configures {@code stuck-threshold} keeps working.
     */
    private Duration sagaTimeout = Duration.ofMinutes(2);

    private final Saga saga = new Saga();

    public Duration stuckThreshold() {
        return saga.getStuckThreshold() != null ? saga.getStuckThreshold() : sagaTimeout;
    }

    public long getTransferFeeBp() {
        return transferFeeBp;
    }

    public void setTransferFeeBp(long transferFeeBp) {
        this.transferFeeBp = transferFeeBp;
    }

    public long getMerchantFeeBp() {
        return merchantFeeBp;
    }

    public void setMerchantFeeBp(long merchantFeeBp) {
        this.merchantFeeBp = merchantFeeBp;
    }

    public int getPageSizeDefault() {
        return pageSizeDefault;
    }

    public void setPageSizeDefault(int pageSizeDefault) {
        this.pageSizeDefault = pageSizeDefault;
    }

    public int getPageSizeMax() {
        return pageSizeMax;
    }

    public void setPageSizeMax(int pageSizeMax) {
        this.pageSizeMax = pageSizeMax;
    }

    public Duration getSagaTimeout() {
        return sagaTimeout;
    }

    public void setSagaTimeout(Duration sagaTimeout) {
        this.sagaTimeout = sagaTimeout;
    }

    public Saga getSaga() {
        return saga;
    }

    /** Recovery job settings. */
    public static class Saga {

        private Duration stuckThreshold;
        private long fixedDelayMs = 30_000L;
        private long initialDelayMs = 30_000L;
        private int batchSize = 50;
        private int maxAttempts = 5;

        public Duration getStuckThreshold() {
            return stuckThreshold;
        }

        public void setStuckThreshold(Duration stuckThreshold) {
            this.stuckThreshold = stuckThreshold;
        }

        public long getFixedDelayMs() {
            return fixedDelayMs;
        }

        public void setFixedDelayMs(long fixedDelayMs) {
            this.fixedDelayMs = fixedDelayMs;
        }

        public long getInitialDelayMs() {
            return initialDelayMs;
        }

        public void setInitialDelayMs(long initialDelayMs) {
            this.initialDelayMs = initialDelayMs;
        }

        public int getBatchSize() {
            return batchSize;
        }

        public void setBatchSize(int batchSize) {
            this.batchSize = batchSize;
        }

        public int getMaxAttempts() {
            return maxAttempts;
        }

        public void setMaxAttempts(int maxAttempts) {
            this.maxAttempts = maxAttempts;
        }
    }
}
