package kz.taxi.catalog.domain;

import kz.taxi.common.core.error.CommonErrorCode;
import kz.taxi.common.core.error.DomainException;
import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/** The error contract of the service: a client switches on the code, not on the text. */
class CatalogErrorCodeTest {

    @Test
    void everyCodeCarriesItsOwnHttpStatus() {
        assertThat(CatalogErrorCode.PRODUCT_NOT_FOUND.httpStatus()).isEqualTo(404);
        assertThat(CatalogErrorCode.PRODUCT_NOT_AVAILABLE.httpStatus()).isEqualTo(409);
        assertThat(CatalogErrorCode.DUPLICATE_SKU.httpStatus()).isEqualTo(409);
        assertThat(CatalogErrorCode.MERCHANT_NOT_FOUND.httpStatus()).isEqualTo(404);
        assertThat(CatalogErrorCode.MERCHANT_ALREADY_EXISTS.httpStatus()).isEqualTo(409);
        assertThat(CatalogErrorCode.NOT_MERCHANT_OWNER.httpStatus()).isEqualTo(403);
        assertThat(CatalogErrorCode.INSUFFICIENT_STOCK.httpStatus()).isEqualTo(409);
        assertThat(CatalogErrorCode.RESERVATION_NOT_FOUND.httpStatus()).isEqualTo(404);
        assertThat(CatalogErrorCode.RESERVATION_NOT_ACTIVE.httpStatus()).isEqualTo(409);
        assertThat(CatalogErrorCode.MIXED_CURRENCIES.httpStatus()).isEqualTo(400);
        assertThat(CatalogErrorCode.STOCK_ADJUSTMENT_INVALID.httpStatus()).isEqualTo(422);
        assertThat(CatalogErrorCode.INVALID_QUANTITY.httpStatus()).isEqualTo(400);
    }

    @Test
    void codeMatchesTheEnumNameAndEveryCodeIsDocumented() {
        for (CatalogErrorCode code : CatalogErrorCode.values()) {
            assertThat(code.code()).isEqualTo(code.name());
            assertThat(code.defaultMessage()).isNotBlank();
        }
    }

    @Test
    void domainExceptionsCarryTheCodeAndItsStatus() {
        DomainException failure = DomainException.of(CatalogErrorCode.INSUFFICIENT_STOCK,
                "product {} has {} available", "P1", 0);

        assertThat(failure.errorCode()).isEqualTo(CatalogErrorCode.INSUFFICIENT_STOCK);
        assertThat(failure.errorCode().httpStatus()).isEqualTo(409);
        assertThat(failure.getMessage()).isEqualTo("product P1 has 0 available");
        assertThat(failure.getStackTrace()).isEmpty();
    }

    @Test
    void detailsSurviveDecoration() {
        DomainException failure = DomainException.of(CatalogErrorCode.DUPLICATE_SKU)
                .withDetail("sku", "TECH-1")
                .withDetail("merchantId", "M1");

        assertThat(failure.details()).containsEntry("sku", "TECH-1").containsEntry("merchantId", "M1");
        assertThat(failure.getMessage()).isEqualTo(CatalogErrorCode.DUPLICATE_SKU.defaultMessage());
    }

    @Test
    void unpublishedStatusCannotBeReserved() {
        Product product = Product.publish("M1", "SKU-1", "Наушники", null, "Электроника", "JBL",
                kz.taxi.common.core.money.Currency.KZT, 1_000L, null);
        product.changeStatus(ProductStatus.ARCHIVED);

        assertThat(product.isArchived()).isTrue();
        assertThat(product.isSellable()).isFalse();
        assertThatThrownBy(product::requireSellable)
                .isInstanceOfSatisfying(DomainException.class, failure -> {
                    assertThat(failure.errorCode()).isEqualTo(CatalogErrorCode.PRODUCT_NOT_AVAILABLE);
                    assertThat(failure.errorCode().httpStatus()).isEqualTo(409);
                });
    }

    @Test
    void activeAndOutOfStockOffersAreSellable() {
        Product product = Product.publish("M1", "SKU-1", "Наушники", null, "Электроника", "JBL",
                kz.taxi.common.core.money.Currency.KZT, 1_000L, null);

        assertThat(product.isSellable()).isTrue();
        product.changeStatus(ProductStatus.OUT_OF_STOCK);
        assertThat(product.isSellable()).isTrue();
        product.changeStatus(ProductStatus.DRAFT);
        assertThat(product.isSellable()).isFalse();
        assertThat(ProductStatus.DRAFT.publiclyVisible()).isTrue();
        assertThat(ProductStatus.ARCHIVED.publiclyVisible()).isFalse();
    }

    @Test
    void invalidPriceIsRefusedBeforeItReachesTheDatabase() {
        assertThatThrownBy(() -> Product.publish("M1", "SKU-1", "Наушники", null, "Электроника", "JBL",
                kz.taxi.common.core.money.Currency.KZT, 0L, null))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("priceMinor must be positive");
    }

    @Test
    void blankRequiredFieldsAreReportedAsValidationFailures() {
        assertThatThrownBy(() -> Product.publish("M1", "  ", "Наушники", null, "Электроника", "JBL",
                kz.taxi.common.core.money.Currency.KZT, 1_000L, null))
                .isInstanceOfSatisfying(DomainException.class,
                        failure -> assertThat(failure.errorCode())
                                .isEqualTo(CommonErrorCode.VALIDATION_FAILED));
    }
}
