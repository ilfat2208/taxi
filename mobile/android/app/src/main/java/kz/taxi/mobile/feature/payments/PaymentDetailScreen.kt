package kz.taxi.mobile.feature.payments

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
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.MaterialTheme
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
import kz.taxi.mobile.data.dto.PaymentTransitionDto
import kz.taxi.mobile.ui.AppViewModels

@Composable
fun PaymentDetailScreen(
    paymentId: String,
    onBack: () -> Unit,
) {
    val container = LocalAppContainer.current
    val viewModel: PaymentDetailViewModel = viewModel(
        factory = AppViewModels.paymentDetail(container.paymentsRepository, paymentId),
    )
    val state by viewModel.state.collectAsStateWithLifecycle()

    ScreenScaffold(title = "Платёж", onBack = onBack) {
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

            if (state.isLoading) {
                LoadingBox(label = "Загружаем платёж…")
                return@Column
            }

            val detail = state.detail ?: return@Column
            val payment = detail.payment

            SectionCard {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text(text = "Статус", style = MaterialTheme.typography.labelLarge, modifier = Modifier.weight(1f))
                    StatusChip(status = payment.status)
                }
                Spacer(modifier = Modifier.height(8.dp))
                MoneyText(
                    amountMinor = payment.totalMinor,
                    currency = payment.currency,
                    color = if (payment.isFailed) TaxiColors.negative else MaterialTheme.colorScheme.onSurface,
                )
                Spacer(modifier = Modifier.height(10.dp))
                KeyValueRow(label = "Номер платежа", value = payment.paymentNumber)
                KeyValueRow(label = "Тип", value = statusLabel(payment.type))
                KeyValueRow(label = "Сумма", value = Money.format(payment.amountMinor, payment.currency))
                KeyValueRow(label = "Комиссия", value = Money.format(payment.feeMinor, payment.currency))
                KeyValueRow(label = "Итого", value = Money.format(payment.totalMinor, payment.currency))
                payment.description?.takeIf { it.isNotBlank() }?.let {
                    KeyValueRow(label = "Комментарий", value = it)
                }
                payment.createdAt?.let { KeyValueRow(label = "Создан", value = it) }
                payment.completedAt?.let { KeyValueRow(label = "Завершён", value = it) }
                payment.failureCode?.let { KeyValueRow(label = "Код ошибки", value = it) }
                payment.failureReason?.let { KeyValueRow(label = "Причина", value = it) }
                payment.orderId?.let { KeyValueRow(label = "Заказ", value = it) }
            }

            Spacer(modifier = Modifier.height(14.dp))

            SectionCard {
                Text(text = "Идентификаторы", style = MaterialTheme.typography.titleMedium)
                Spacer(modifier = Modifier.height(6.dp))
                KeyValueRow(label = "paymentId", value = payment.paymentId)
                payment.sourceAccountId?.let { KeyValueRow(label = "Счёт списания", value = it) }
                payment.targetAccountId?.let { KeyValueRow(label = "Счёт получателя", value = it) }
            }

            Spacer(modifier = Modifier.height(14.dp))

            Text(text = "История статусов", style = MaterialTheme.typography.titleMedium)
            Spacer(modifier = Modifier.height(8.dp))
            SectionCard {
                if (detail.transitions.isEmpty()) {
                    Text(
                        text = "Переходы статусов недоступны.",
                        style = MaterialTheme.typography.bodyMedium,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                } else {
                    detail.transitions.forEachIndexed { index, transition ->
                        if (index > 0) ThinDivider()
                        TransitionRow(transition)
                    }
                }
            }

            Spacer(modifier = Modifier.height(24.dp))
        }
    }
}

@Composable
private fun TransitionRow(transition: PaymentTransitionDto) {
    Row(
        modifier = Modifier.fillMaxWidth(),
        verticalAlignment = Alignment.Top,
        horizontalArrangement = Arrangement.Start,
    ) {
        Column(modifier = Modifier.weight(1f)) {
            Text(
                text = buildString {
                    transition.fromStatus?.let { append(statusLabel(it)).append(" → ") }
                    append(statusLabel(transition.toStatus))
                },
                style = MaterialTheme.typography.bodyMedium,
            )
            transition.reason?.takeIf { it.isNotBlank() }?.let {
                Text(
                    text = it,
                    style = MaterialTheme.typography.labelSmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
        }
        Spacer(modifier = Modifier.width(8.dp))
        Column(horizontalAlignment = Alignment.End) {
            Text(
                text = transition.actor.orEmpty(),
                style = MaterialTheme.typography.labelSmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            Text(
                text = transition.createdAt.orEmpty(),
                style = MaterialTheme.typography.labelSmall,
                fontFamily = FontFamily.Monospace,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
    }
}
