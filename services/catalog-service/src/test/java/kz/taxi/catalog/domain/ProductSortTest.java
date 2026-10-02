package kz.taxi.catalog.domain;

import kz.taxi.common.core.error.CommonErrorCode;
import kz.taxi.common.core.error.DomainException;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;
import org.junit.jupiter.params.provider.ValueSource;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/**
 * Sort parsing is a security boundary as much as a UX one: the value ends up in an
 * {@code ORDER BY} clause, so only whitelisted tokens may pass.
 */
class ProductSortTest {

    @ParameterizedTest
    @CsvSource({
            "price_asc,PRICE_ASC",
            "price_desc,PRICE_DESC",
            "newest,NEWEST",
            "relevance,RELEVANCE",
            "PRICE_ASC,PRICE_ASC",
            " newest ,NEWEST"
    })
    void parsesTheDocumentedWireValues(String input, ProductSort expected) {
        assertThat(ProductSort.parse(input)).isEqualTo(expected);
    }

    @Test
    void defaultsToRelevanceWhenNothingIsAsked() {
        assertThat(ProductSort.parse(null)).isEqualTo(ProductSort.RELEVANCE);
        assertThat(ProductSort.parse("  ")).isEqualTo(ProductSort.DEFAULT);
    }

    @ParameterizedTest
    @ValueSource(strings = {"price_asc; drop table product", "cheapest", "id desc", "1"})
    void rejectsAnythingOutsideTheWhitelist(String value) {
        assertThatThrownBy(() -> ProductSort.parse(value))
                .isInstanceOfSatisfying(DomainException.class, failure -> {
                    assertThat(failure.errorCode()).isEqualTo(CommonErrorCode.VALIDATION_FAILED);
                    assertThat(failure.errorCode().httpStatus()).isEqualTo(400);
                });
    }
}
