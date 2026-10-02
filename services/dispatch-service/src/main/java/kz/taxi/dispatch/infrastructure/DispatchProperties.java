package kz.taxi.dispatch.infrastructure;

import lombok.Getter;
import lombok.Setter;
import org.springframework.boot.context.properties.ConfigurationProperties;

import java.time.Duration;

/**
 * Knobs of the live fleet view.
 *
 * <p>{@code staleAfter} is the most consequential number in this service: it is
 * how long a position stays believable. Too short and drivers blink in and out of
 * the map on a bad connection; too long and dispatch offers trips to cars that
 * left the area minutes ago.
 */
@ConfigurationProperties(prefix = "taxi.dispatch")
@Getter
@Setter
public class DispatchProperties {

    /** A position older than this is shown, but flagged and never offered a trip. */
    private Duration staleAfter = Duration.ofSeconds(20);

    /**
     * Positions expire on their own: a driver app that stopped sending (killed,
     * out of battery, lost signal) must fall out of the index without anybody
     * running a cleanup job.
     */
    private Duration positionTtl = Duration.ofMinutes(2);

    private int maxBatchSize = 100;

    private int defaultRadiusM = 3_000;

    private int maxRadiusM = 20_000;

    private int defaultLimit = 10;

    private int maxLimit = 50;
}
