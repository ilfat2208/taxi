package kz.taxi.payment.api;

import kz.taxi.payment.api.dto.PaymentDtos;
import kz.taxi.payment.infrastructure.PaymentProperties;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * The public list of payment methods.
 *
 * <p>The point of the endpoint is honesty, so that is what the test checks: a method the
 * platform cannot execute must arrive with {@code implemented=false} and a reason, and the
 * fees must be the configured ones rather than numbers typed into the controller.
 */
class PaymentControllerMethodsTest {

    private final PaymentProperties properties = new PaymentProperties();

    private PaymentController controller() {
        // Only the methods endpoint is exercised here; the write paths need a saga and a
        // guard, and they have their own tests.
        return new PaymentController(null, null, null, null, properties);
    }

    @Test
    @DisplayName("баланс доступен, карта объявлена планом с причиной")
    void balance_works_and_card_is_declared_as_planned() {
        PaymentDtos.PaymentMethodsResponse response = controller().methods();

        assertThat(response.methods()).extracting(PaymentDtos.PaymentMethodView::code)
                .containsExactly("BALANCE", "CARD");

        PaymentDtos.PaymentMethodView balance = response.methods().get(0);
        assertThat(balance.implemented()).isTrue();
        assertThat(balance.detail()).isNotBlank();

        PaymentDtos.PaymentMethodView card = response.methods().get(1);
        assertThat(card.implemented())
                .as("карта не реализована: клиент должен показать «скоро», а не кнопку в пустоту")
                .isFalse();
        assertThat(card.detail()).contains("не подключён");
    }

    @Test
    @DisplayName("комиссии приходят из конфигурации, а не из кода контроллера")
    void fees_come_from_configuration() {
        properties.setMerchantFeeBp(275L);
        properties.setTransferFeeBp(50L);

        PaymentDtos.PaymentMethodsResponse response = controller().methods();

        assertThat(response.merchantFeeBp()).isEqualTo(275);
        assertThat(response.transferFeeBp()).isEqualTo(50);
    }

    @Test
    @DisplayName("клиенту сказано, что комиссии — конфигурация и в базисных пунктах")
    void the_note_explains_the_units() {
        assertThat(controller().methods().note()).contains("базисных пунктах");
    }
}
