package kz.taxi.trip.api;

import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import kz.taxi.trip.api.dto.TripDtos;
import kz.taxi.trip.domain.Tariff;
import kz.taxi.trip.domain.TariffRates;
import kz.taxi.trip.infrastructure.TripProperties;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.Arrays;
import java.util.List;

/**
 * The public price list of the pilot city.
 *
 * <p>Separate from {@link TripController} on purpose: ordering a ride is a rider's action
 * and needs a token, while a price list is what a client shows on the very first screen —
 * before login, when it has nothing but a phone number. Mixing the two would have meant
 * either an authorised picker or a controller with two personalities.
 *
 * <p>Prices come from {@code taxi.trip.tariffs} (validated at startup by
 * {@link TripProperties#validate()}), so this endpoint cannot disagree with what the
 * pricing engine charges: both read the same object.
 */
@RestController
@RequestMapping("/api/v1/trips")
@Tag(name = "Tariffs", description = "The public price list: what a ride costs per class")
public class TariffController {

    private final TripProperties properties;

    public TariffController(TripProperties properties) {
        this.properties = properties;
    }

    @GetMapping("/tariffs")
    @Operation(summary = "Tariff catalogue",
            description = "Public: a client shows prices before it has a token. Rates are minor units, "
                    + "the currency sits next to each amount, and the commission is in basis points.")
    public TripDtos.TariffCatalogueResponse tariffs() {
        List<TripDtos.TariffView> views = Arrays.stream(Tariff.values())
                .map(tariff -> {
                    TariffRates rates = properties.getTariffs().get(tariff);
                    return new TripDtos.TariffView(tariff.name(), rates.baseMinor(), rates.perKmMinor(),
                            rates.perMinuteMinor(), rates.minFareMinor());
                })
                .toList();

        return new TripDtos.TariffCatalogueResponse(
                properties.getCurrency().name(),
                properties.getCommissionBp(),
                properties.getQuoteTtl().toSeconds(),
                views,
                "тарифы — конфигурация сервиса (taxi.trip.tariffs), а не таблица в базе: "
                        + "цена поездки считается по этим коэффициентам");
    }
}
