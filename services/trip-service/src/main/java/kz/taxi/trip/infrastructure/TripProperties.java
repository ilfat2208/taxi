package kz.taxi.trip.infrastructure;

import jakarta.annotation.PostConstruct;
import kz.taxi.common.core.money.Currency;
import kz.taxi.trip.domain.Tariff;
import kz.taxi.trip.domain.TariffRates;
import lombok.Getter;
import lombok.Setter;
import org.springframework.boot.context.properties.ConfigurationProperties;

import java.time.Duration;
import java.util.EnumMap;
import java.util.Map;

/**
 * Knobs of the ride: prices, the quote's lifetime, and how the route is approximated.
 *
 * <p>Prices are configuration and not code, because they are a product decision per
 * city: a release must not be needed to change what a kilometre costs. The defaults
 * below are the pilot city's, so a deployment that sets nothing still prices rides.
 *
 * <p>{@link #validate()} runs at startup and refuses to boot with an incomplete
 * tariff. The alternative — discovering that {@code COMFORT} has no base fare when a
 * rider asks for a comfort car — is a 500 in front of a customer, which is exactly
 * what a startup check exists to prevent.
 */
@ConfigurationProperties(prefix = "taxi.trip")
@Getter
@Setter
public class TripProperties {

    /**
     * The currency rides are priced and charged in.
     *
     * <p>Fixed per deployment for Ф2: a tariff is per city, and a city has one
     * currency. The value must match the accounts the riders pay from, which is why
     * it is also the currency the rider's wallet is resolved in.
     */
    private Currency currency = Currency.KZT;

    /**
     * The platform's cut, in basis points: {@code 1200} is 12%.
     *
     * <p>Basis points and not percent, like every other rate on the platform: 12.5%
     * has no exact float representation and this number is multiplied by real money.
     */
    private int commissionBp = 1_200;

    /**
     * How long a quoted price stays valid.
     *
     * <p>Short on purpose. A quote is a promise the platform may have to honour
     * whatever happens to the tariff meanwhile, and a rider who needs an hour to
     * decide is a rider whose ride would be priced by a stale estimate.
     */
    private Duration quoteTtl = Duration.ofMinutes(5);

    /** How far dispatch looks for a car, in metres. */
    private int searchRadiusM = 5_000;

    /** How many candidates dispatch may return; the trip takes the first one it can claim. */
    private int searchLimit = 10;

    /** Detour factor applied to the straight line until a real router is wired in. */
    private double roadFactor = 1.35d;

    /** Average speed used to turn a distance into a duration. */
    private double averageSpeedKph = 28d;

    /** Time allowed for the car to reach the rider, added to every ride's duration. */
    private Duration pickupTime = Duration.ofMinutes(3);

    private int pageSizeDefault = 20;

    private int pageSizeMax = 100;

    /**
     * The price list, per class.
     *
     * <p>A map keyed by the enum, so a typo in the configuration file is a startup
     * failure ("no enum constant CLASS") rather than a tariff that silently disappears.
     */
    private Map<Tariff, TariffRates> tariffs = new EnumMap<>(defaultTariffs());

    /** The pilot city's price list, in tiyn: 350.00 KZT to get in, 120.00 KZT a kilometre. */
    private static Map<Tariff, TariffRates> defaultTariffs() {
        Map<Tariff, TariffRates> defaults = new EnumMap<>(Tariff.class);
        defaults.put(Tariff.ECONOMY, new TariffRates(35_000L, 12_000L, 2_500L, 50_000L));
        defaults.put(Tariff.COMFORT, new TariffRates(60_000L, 18_000L, 3_500L, 80_000L));
        return defaults;
    }

    @PostConstruct
    void validate() {
        if (commissionBp < 0 || commissionBp >= 10_000) {
            throw new IllegalStateException(
                    "taxi.trip.commission-bp must be within [0, 10000) but was " + commissionBp);
        }
        if (roadFactor < 1d) {
            throw new IllegalStateException("taxi.trip.road-factor must be at least 1 but was " + roadFactor);
        }
        if (averageSpeedKph <= 0d) {
            throw new IllegalStateException("taxi.trip.average-speed-kph must be positive");
        }
        if (pickupTime == null || pickupTime.isNegative()) {
            throw new IllegalStateException("taxi.trip.pickup-time must not be negative");
        }
        for (Tariff tariff : Tariff.values()) {
            TariffRates rates = tariffs.get(tariff);
            if (rates == null || !rates.isComplete()) {
                throw new IllegalStateException(
                        "taxi.trip.tariffs.%s is missing or incomplete: a base fare and a minimum fare are required"
                                .formatted(tariff.name()));
            }
        }
    }
}
