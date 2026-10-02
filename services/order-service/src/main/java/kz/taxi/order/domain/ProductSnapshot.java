package kz.taxi.order.domain;

import kz.taxi.common.core.error.DomainException;
import kz.taxi.common.core.money.Currency;

/**
 * What the catalog told us about a product at the moment it entered a cart or an order.
 *
 * <p>It exists so that neither the cart page nor an order needs a catalog call to
 * be rendered. The catalog remains the only authority on sellability and current
 * price; this record is what the customer was shown.
 *
 * @param merchantId     the seller, needed to route the merchant payment at checkout
 * @param title          product title, snapshot
 * @param imageUrl       product image, snapshot, may be null when the catalog has none
 * @param unitPriceMinor price per unit in minor units
 * @param currency       the currency the price is quoted in
 */
public record ProductSnapshot(String merchantId,
                              String title,
                              String imageUrl,
                              long unitPriceMinor,
                              Currency currency) {

    public ProductSnapshot {
        if (merchantId == null || merchantId.isBlank()) {
            throw DomainException.of(OrderErrorCode.PRODUCT_UNAVAILABLE,
                    "the catalog returned a product without a merchant");
        }
        if (unitPriceMinor <= 0) {
            throw DomainException.of(OrderErrorCode.PRODUCT_UNAVAILABLE,
                    "the catalog returned a non-positive price ({})", unitPriceMinor);
        }
        if (currency == null) {
            throw DomainException.of(OrderErrorCode.PRODUCT_UNAVAILABLE,
                    "the catalog returned a product price without a currency");
        }
        title = title == null || title.isBlank() ? "Product" : title;
        // The columns are VARCHAR(200)/VARCHAR(512): a longer catalog title would
        // fail the insert, and failing a checkout over an image URL is absurd.
        title = truncate(title, 200);
        imageUrl = truncate(imageUrl, 512);
    }

    private static String truncate(String value, int max) {
        if (value == null) {
            return null;
        }
        return value.length() <= max ? value : value.substring(0, max);
    }
}
