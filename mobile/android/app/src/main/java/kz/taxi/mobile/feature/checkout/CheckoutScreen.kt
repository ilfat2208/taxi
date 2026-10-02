package kz.taxi.mobile.feature.checkout

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.RadioButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import kz.taxi.mobile.core.money.Money
import kz.taxi.mobile.core.ui.ErrorCard
import kz.taxi.mobile.core.ui.TaxiOutlinedField
import kz.taxi.mobile.core.ui.KeyValueRow
import kz.taxi.mobile.core.ui.LoadingBox
import kz.taxi.mobile.core.ui.LocalAppContainer
import kz.taxi.mobile.core.ui.MoneyText
import kz.taxi.mobile.core.ui.ScreenScaffold
import kz.taxi.mobile.core.ui.SectionCard
import kz.taxi.mobile.core.ui.StatusChip
import kz.taxi.mobile.core.ui.SubmitButton
import kz.taxi.mobile.core.ui.ThinDivider
import kz.taxi.mobile.core.ui.theme.TaxiColors
import kz.taxi.mobile.data.dto.AccountDto
import kz.taxi.mobile.data.dto.OrderDto
import kz.taxi.mobile.ui.AppViewModels

@Composable
fun CheckoutScreen(
    onBack: () -> Unit,
    onOpenOrders: () -> Unit,
) {
    val container = LocalAppContainer.current
    val viewModel: CheckoutViewModel = viewModel(
        factory = AppViewModels.checkout(container.accountsRepository, container.ordersRepository),
    )
    val state by viewModel.state.collectAsStateWithLifecycle()

    val order = state.order
    if (order != null) {
        OrderCreatedContent(
            order = order,
            idempotencyKey = state.idempotencyKey,
            onOpenOrders = onOpenOrders,
            onClose = { viewModel.dismissOrder(); onBack() },
        )
        return
    }

    ScreenScaffold(title = "Оформление заказа", onBack = onBack) {
        Column(
            modifier = Modifier
                .fillMaxSize()
                .verticalScroll(rememberScrollState())
                .padding(16.dp),
        ) {
            val error = state.error
            if (error != null) {
                ErrorCard(error = error, onRetry = viewModel::submit, onDismiss = viewModel::dismissError)
                if (state.retryReusesKey) {
                    Spacer(modifier = Modifier.height(6.dp))
                    Text(
                        text = "Повтор отправит запрос с тем же Idempotency-Key — второй заказ не создастся.",
                        style = MaterialTheme.typography.labelSmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
                Spacer(modifier = Modifier.height(12.dp))
            }

            TaxiOutlinedField(
                value = state.deliveryAddress,
                onValueChange = viewModel::onAddressChange,
                label = "Адрес доставки",
                isError = state.addressError != null,
                supportingText = state.addressError,
                singleLine = false,
                minLines = 2,
                enabled = !state.isSubmitting,
            )

            Spacer(modifier = Modifier.height(12.dp))

            TaxiOutlinedField(
                value = state.contactPhone,
                onValueChange = viewModel::onPhoneChange,
                label = "Контактный телефон",
                keyboardType = KeyboardType.Phone,
                isError = state.phoneError != null,
                supportingText = state.phoneError,
                enabled = !state.isSubmitting,
            )

            Spacer(modifier = Modifier.height(12.dp))

            TaxiOutlinedField(
                value = state.comment,
                onValueChange = viewModel::onCommentChange,
                label = "Комментарий курьеру (необязательно)",
                singleLine = false,
                minLines = 2,
                enabled = !state.isSubmitting,
            )

            Spacer(modifier = Modifier.height(18.dp))

            Text(text = "Счёт списания", style = MaterialTheme.typography.titleMedium)
            Spacer(modifier = Modifier.height(8.dp))

            if (state.isLoadingAccounts) {
                LoadingBox(label = "Загружаем счета…")
            } else if (state.accounts.isEmpty()) {
                SectionCard {
                    Text(
                        text = "Нет счетов для оплаты",
                        style = MaterialTheme.typography.titleMedium,
                    )
                    Spacer(modifier = Modifier.height(6.dp))
                    Text(
                        text = "Откройте счёт, чтобы оплатить заказ.",
                        style = MaterialTheme.typography.bodyMedium,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
            } else {
                state.accounts.forEach { account ->
                    CheckoutAccountRow(
                        account = account,
                        selected = account.id == state.sourceAccount?.id,
                        enabled = !state.isSubmitting,
                        onClick = { viewModel.selectAccount(account.id) },
                    )
                    Spacer(modifier = Modifier.height(8.dp))
                }
            }

            state.idempotencyKey?.let { key ->
                Spacer(modifier = Modifier.height(8.dp))
                SectionCard {
                    Text(
                        text = "Ключ идемпотентности",
                        style = MaterialTheme.typography.labelLarge,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                    Spacer(modifier = Modifier.height(4.dp))
                    Text(
                        text = key,
                        style = MaterialTheme.typography.labelSmall,
                        fontFamily = FontFamily.Monospace,
                    )
                }
            }

            Spacer(modifier = Modifier.height(18.dp))

            SubmitButton(
                text = if (state.retryReusesKey) "Повторить оформление" else "Оформить заказ",
                inFlight = state.isSubmitting,
                enabled = state.canSubmit,
                onClick = viewModel::submit,
            )

            Spacer(modifier = Modifier.height(24.dp))
        }
    }
}

@Composable
private fun CheckoutAccountRow(
    account: AccountDto,
    selected: Boolean,
    enabled: Boolean,
    onClick: () -> Unit,
) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .background(MaterialTheme.colorScheme.surface, RoundedCornerShape(12.dp))
            .clickable(enabled = enabled, onClick = onClick)
            .padding(horizontal = 8.dp, vertical = 10.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.Start,
    ) {
        RadioButton(selected = selected, onClick = onClick, enabled = enabled)
        Spacer(modifier = Modifier.width(4.dp))
        Column(modifier = Modifier.weight(1f)) {
            Text(
                text = account.displayName ?: account.currency,
                style = MaterialTheme.typography.bodyLarge,
            )
            Text(
                text = "Доступно ${Money.format(account.availableMinor, account.currency)}",
                style = MaterialTheme.typography.labelSmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
    }
}

/** The order as created, with its per-merchant payments. */
@Composable
private fun OrderCreatedContent(
    order: OrderDto,
    idempotencyKey: String?,
    onOpenOrders: () -> Unit,
    onClose: () -> Unit,
) {
    ScreenScaffold(title = "Заказ создан", onBack = onClose) {
        Column(
            modifier = Modifier
                .fillMaxSize()
                .verticalScroll(rememberScrollState())
                .padding(16.dp),
        ) {
            Column(
                modifier = Modifier
                    .fillMaxWidth()
                    .background(TaxiColors.positive.copy(alpha = 0.12f), RoundedCornerShape(12.dp))
                    .padding(16.dp),
            ) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text(
                        text = "Номер заказа",
                        style = MaterialTheme.typography.labelLarge,
                        modifier = Modifier.weight(1f),
                    )
                    StatusChip(status = order.status)
                }
                Spacer(modifier = Modifier.height(4.dp))
                Text(
                    text = order.orderNumber,
                    style = MaterialTheme.typography.titleLarge,
                    fontFamily = FontFamily.Monospace,
                )
                Spacer(modifier = Modifier.height(8.dp))
                MoneyText(amountMinor = order.totalMinor, currency = order.currency)
            }

            Spacer(modifier = Modifier.height(14.dp))

            SectionCard {
                Text(text = "Состав заказа", style = MaterialTheme.typography.titleMedium)
                Spacer(modifier = Modifier.height(8.dp))
                order.items.forEach { item ->
                    Row(modifier = Modifier.fillMaxWidth().padding(vertical = 3.dp)) {
                        Column(modifier = Modifier.weight(1f)) {
                            Text(
                                text = item.title ?: "Товар",
                                style = MaterialTheme.typography.bodyMedium,
                            )
                            Text(
                                text = "${Money.format(item.unitPriceMinor, item.currency)} × ${item.quantity}",
                                style = MaterialTheme.typography.labelSmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                        }
                        Text(
                            text = Money.format(item.lineTotalMinor, item.currency),
                            style = MaterialTheme.typography.bodyMedium,
                        )
                    }
                }
                ThinDivider()
                KeyValueRow(label = "Товары", value = Money.format(order.subtotalMinor, order.currency))
                KeyValueRow(label = "Доставка", value = Money.format(order.deliveryFeeMinor, order.currency))
                KeyValueRow(label = "Итого", value = Money.format(order.totalMinor, order.currency))
            }

            Spacer(modifier = Modifier.height(14.dp))

            Text(text = "Платежи продавцам", style = MaterialTheme.typography.titleMedium)
            Spacer(modifier = Modifier.height(8.dp))
            if (order.payments.isEmpty()) {
                SectionCard {
                    Text(
                        text = "Платежи по заказу не вернулись.",
                        style = MaterialTheme.typography.bodyMedium,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
            } else {
                order.payments.forEach { payment ->
                    SectionCard(modifier = Modifier.padding(bottom = 8.dp)) {
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            Text(
                                text = "Продавец",
                                style = MaterialTheme.typography.labelLarge,
                                modifier = Modifier.weight(1f),
                            )
                            StatusChip(status = payment.status)
                        }
                        Spacer(modifier = Modifier.height(6.dp))
                        KeyValueRow(label = "merchantId", value = payment.merchantId ?: "—")
                        KeyValueRow(label = "Сумма", value = Money.format(payment.amountMinor, payment.currency))
                        KeyValueRow(label = "Комиссия", value = Money.format(payment.feeMinor, payment.currency))
                        KeyValueRow(label = "Итого", value = Money.format(payment.totalMinor, payment.currency))
                        KeyValueRow(label = "paymentId", value = payment.paymentId)
                    }
                }
            }

            order.failureReason?.let {
                SectionCard {
                    Text(text = "Причина отказа", style = MaterialTheme.typography.titleMedium)
                    Spacer(modifier = Modifier.height(4.dp))
                    Text(text = it, style = MaterialTheme.typography.bodyMedium)
                }
                Spacer(modifier = Modifier.height(12.dp))
            }

            if (idempotencyKey != null) {
                Text(
                    text = "Idempotency-Key: $idempotencyKey",
                    style = MaterialTheme.typography.labelSmall,
                    fontFamily = FontFamily.Monospace,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                Spacer(modifier = Modifier.height(12.dp))
            }

            SubmitButton(text = "Мои заказы", inFlight = false, onClick = onOpenOrders)
            Spacer(modifier = Modifier.height(8.dp))
            OutlinedButton(onClick = onClose, modifier = Modifier.fillMaxWidth()) {
                Text("Закрыть")
            }
            Spacer(modifier = Modifier.height(24.dp))
        }
    }
}
