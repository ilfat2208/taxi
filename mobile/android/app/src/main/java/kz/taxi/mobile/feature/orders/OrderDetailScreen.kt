package kz.taxi.mobile.feature.orders

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
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
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import kz.taxi.mobile.core.money.Money
import kz.taxi.mobile.core.ui.ErrorCard
import kz.taxi.mobile.core.ui.KeyValueRow
import kz.taxi.mobile.core.ui.LoadingBox
import kz.taxi.mobile.core.ui.LocalAppContainer
import kz.taxi.mobile.core.ui.MoneyText
import kz.taxi.mobile.core.ui.ScreenScaffold
import kz.taxi.mobile.core.ui.SectionCard
import kz.taxi.mobile.core.ui.StatusChip
import kz.taxi.mobile.core.ui.ThinDivider
import kz.taxi.mobile.core.ui.statusLabel
import kz.taxi.mobile.core.ui.theme.TaxiColors
import kz.taxi.mobile.ui.AppViewModels

@Composable
fun OrderDetailScreen(
    orderId: String,
    onBack: () -> Unit,
) {
    val container = LocalAppContainer.current
    val viewModel: OrderDetailViewModel = viewModel(
        factory = AppViewModels.orderDetail(container.ordersRepository, orderId),
    )
    val state by viewModel.state.collectAsStateWithLifecycle()

    ScreenScaffold(title = "Заказ", onBack = onBack) {
        Column(
            modifier = Modifier
                .fillMaxSize()
                .verticalScroll(rememberScrollState())
                .padding(16.dp),
        ) {
            val error = state.error
            if (error != null) {
                ErrorCard(error = error, onRetry = viewModel::load, onDismiss = viewModel::dismissError)
                Spacer(modifier = Modifier.height(12.dp))
            }

            state.message?.let { message ->
                Box(
                    modifier = Modifier
                        .fillMaxWidth()
                        .background(TaxiColors.positive.copy(alpha = 0.12f), RoundedCornerShape(10.dp))
                        .padding(12.dp),
                ) {
                    Text(text = message, style = MaterialTheme.typography.bodyMedium)
                }
                Spacer(modifier = Modifier.height(12.dp))
            }

            if (state.isLoading) {
                LoadingBox(label = "Загружаем заказ…")
                return@Column
            }

            val order = state.order ?: return@Column

            SectionCard {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text(
                        text = order.orderNumber,
                        style = MaterialTheme.typography.titleMedium,
                        fontFamily = FontFamily.Monospace,
                        modifier = Modifier.weight(1f),
                    )
                    StatusChip(status = order.status)
                }
                Spacer(modifier = Modifier.height(8.dp))
                MoneyText(amountMinor = order.totalMinor, currency = order.currency)
                Spacer(modifier = Modifier.height(10.dp))
                order.sagaState?.let { KeyValueRow(label = "Состояние саги", value = it) }
                order.paymentStatus?.let { KeyValueRow(label = "Статус платежа", value = statusLabel(it)) }
                order.createdAt?.let { KeyValueRow(label = "Создан", value = it) }
                order.paidAt?.let { KeyValueRow(label = "Оплачен", value = it) }
                order.updatedAt?.let { KeyValueRow(label = "Обновлён", value = it) }
            }

            Spacer(modifier = Modifier.height(14.dp))

            SectionCard {
                Text(text = "Доставка", style = MaterialTheme.typography.titleMedium)
                Spacer(modifier = Modifier.height(6.dp))
                KeyValueRow(label = "Адрес", value = order.deliveryAddress ?: "—")
                KeyValueRow(label = "Телефон", value = order.contactPhone ?: "—")
                order.comment?.takeIf { it.isNotBlank() }?.let {
                    KeyValueRow(label = "Комментарий", value = it)
                }
            }

            Spacer(modifier = Modifier.height(14.dp))

            SectionCard {
                Text(text = "Состав заказа", style = MaterialTheme.typography.titleMedium)
                Spacer(modifier = Modifier.height(8.dp))
                if (order.items.isEmpty()) {
                    Text(
                        text = "Позиции недоступны в этом ответе.",
                        style = MaterialTheme.typography.bodyMedium,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                } else {
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
                                text = payment.merchantId ?: "Продавец",
                                style = MaterialTheme.typography.labelSmall,
                                fontFamily = FontFamily.Monospace,
                                modifier = Modifier.weight(1f),
                            )
                            StatusChip(status = payment.status)
                        }
                        Spacer(modifier = Modifier.height(6.dp))
                        KeyValueRow(label = "Сумма", value = Money.format(payment.amountMinor, payment.currency))
                        KeyValueRow(label = "Комиссия", value = Money.format(payment.feeMinor, payment.currency))
                        KeyValueRow(label = "Итого", value = Money.format(payment.totalMinor, payment.currency))
                        KeyValueRow(label = "paymentId", value = payment.paymentId)
                    }
                }
            }

            order.failureReason?.let {
                Spacer(modifier = Modifier.height(6.dp))
                SectionCard {
                    Text(text = "Причина отказа", style = MaterialTheme.typography.titleMedium)
                    Spacer(modifier = Modifier.height(4.dp))
                    Text(text = it, style = MaterialTheme.typography.bodyMedium)
                }
            }

            Spacer(modifier = Modifier.height(14.dp))

            Text(text = "История заказа", style = MaterialTheme.typography.titleMedium)
            Spacer(modifier = Modifier.height(8.dp))
            SectionCard {
                if (order.history.isEmpty()) {
                    Text(
                        text = "История недоступна.",
                        style = MaterialTheme.typography.bodyMedium,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                } else {
                    order.history.forEachIndexed { index, entry ->
                        if (index > 0) ThinDivider()
                        Row(
                            modifier = Modifier.fillMaxWidth(),
                            verticalAlignment = Alignment.Top,
                            horizontalArrangement = Arrangement.Start,
                        ) {
                            Column(modifier = Modifier.weight(1f)) {
                                Text(
                                    text = buildString {
                                        entry.fromStatus?.let { append(statusLabel(it)).append(" → ") }
                                        append(statusLabel(entry.toStatus))
                                    },
                                    style = MaterialTheme.typography.bodyMedium,
                                )
                                entry.reason?.takeIf { it.isNotBlank() }?.let {
                                    Text(
                                        text = it,
                                        style = MaterialTheme.typography.labelSmall,
                                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                                    )
                                }
                            }
                            Spacer(modifier = Modifier.width(8.dp))
                            Text(
                                text = entry.createdAt.orEmpty(),
                                style = MaterialTheme.typography.labelSmall,
                                fontFamily = FontFamily.Monospace,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                        }
                    }
                }
            }

            if (order.isCancellable) {
                Spacer(modifier = Modifier.height(18.dp))
                OutlinedButton(
                    onClick = viewModel::cancel,
                    modifier = Modifier.fillMaxWidth(),
                    enabled = !state.isCancelling,
                ) {
                    Text(if (state.isCancelling) "Отменяем…" else "Отменить заказ")
                }
            }

            Spacer(modifier = Modifier.height(24.dp))
        }
    }
}
