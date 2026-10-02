package kz.taxi.mobile.feature.transfer

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
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
import androidx.compose.material3.RadioButton
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
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
import kz.taxi.mobile.core.util.PhoneNumbers
import kz.taxi.mobile.data.dto.AccountDto
import kz.taxi.mobile.ui.AppViewModels

@Composable
fun TransferScreen(onBack: () -> Unit) {
    val container = LocalAppContainer.current
    val viewModel: TransferViewModel = viewModel(
        factory = AppViewModels.transfer(container.accountsRepository, container.paymentsRepository),
    )
    val state by viewModel.state.collectAsStateWithLifecycle()

    val title = when (state.step) {
        TransferStep.FORM -> "Перевод"
        TransferStep.REVIEW -> "Проверьте перевод"
        TransferStep.SUCCESS -> "Перевод выполнен"
    }

    ScreenScaffold(
        title = title,
        onBack = {
            when (state.step) {
                TransferStep.FORM -> onBack()
                TransferStep.REVIEW -> viewModel.backToForm()
                TransferStep.SUCCESS -> viewModel.startNew()
            }
        },
    ) {
        Column(
            modifier = Modifier
                .fillMaxSize()
                .verticalScroll(rememberScrollState())
                .padding(16.dp),
        ) {
            val error = state.error
            if (error != null) {
                ErrorCard(
                    error = error,
                    onRetry = if (state.step == TransferStep.REVIEW) viewModel::submit else null,
                    onDismiss = viewModel::dismissError,
                )
                if (state.step == TransferStep.REVIEW && state.retryReusesKey) {
                    Spacer(modifier = Modifier.height(6.dp))
                    Text(
                        text = "Повтор отправит тот же запрос с тем же Idempotency-Key — " +
                            "дубликат платежа не создастся.",
                        style = MaterialTheme.typography.labelSmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
                Spacer(modifier = Modifier.height(14.dp))
            }

            when (state.step) {
                TransferStep.FORM -> TransferForm(state = state, viewModel = viewModel)
                TransferStep.REVIEW -> TransferReview(state = state, viewModel = viewModel)
                TransferStep.SUCCESS -> TransferSuccess(state = state, viewModel = viewModel)
            }

            Spacer(modifier = Modifier.height(24.dp))
        }
    }
}

@Composable
private fun TransferForm(state: TransferUiState, viewModel: TransferViewModel) {
    if (state.isLoadingAccounts) {
        LoadingBox(label = "Загружаем счета…")
        return
    }

    if (state.accounts.isEmpty()) {
        SectionCard {
            Text(
                text = "Нет счетов для перевода",
                style = MaterialTheme.typography.titleMedium,
            )
            Spacer(modifier = Modifier.height(6.dp))
            Text(
                text = "Откройте счёт на главном экране, чтобы отправлять переводы.",
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
        return
    }

    Text(text = "Счёт списания", style = MaterialTheme.typography.titleMedium)
    Spacer(modifier = Modifier.height(8.dp))
    state.accounts.forEach { account ->
        SourceAccountRow(
            account = account,
            selected = account.id == state.sourceAccount?.id,
            onClick = { viewModel.selectAccount(account.id) },
        )
        Spacer(modifier = Modifier.height(8.dp))
    }

    Spacer(modifier = Modifier.height(8.dp))

    TaxiOutlinedField(
        value = state.recipientPhone,
        onValueChange = viewModel::onPhoneChange,
        label = "Телефон получателя",
        keyboardType = KeyboardType.Phone,
        isError = state.phoneError != null,
        supportingText = state.phoneError,
    )

    Spacer(modifier = Modifier.height(12.dp))

    TaxiOutlinedField(
        value = state.amountText,
        onValueChange = viewModel::onAmountChange,
        label = "Сумма, KZT",
        keyboardType = KeyboardType.Decimal,
        isError = state.amountError != null,
        supportingText = state.amountError ?: state.amountMinor?.let { "Будет списано ${Money.format(it)}" },
    )

    Spacer(modifier = Modifier.height(12.dp))

    TaxiOutlinedField(
        value = state.description,
        onValueChange = viewModel::onDescriptionChange,
        label = "Комментарий (необязательно)",
    )

    Spacer(modifier = Modifier.height(20.dp))

    SubmitButton(
        text = "Продолжить",
        inFlight = false,
        enabled = state.canReview,
        onClick = viewModel::toReview,
    )
}

@Composable
private fun TransferReview(state: TransferUiState, viewModel: TransferViewModel) {
    val source = state.sourceAccount
    val amountMinor = state.amountMinor ?: 0L

    SectionCard {
        Text(text = "Детали перевода", style = MaterialTheme.typography.titleMedium)
        Spacer(modifier = Modifier.height(8.dp))
        KeyValueRow(label = "Со счёта", value = source?.displayName ?: source?.currency ?: "—")
        KeyValueRow(
            label = "Доступно",
            value = source?.let { Money.format(it.availableMinor, it.currency) } ?: "—",
        )
        ThinDivider()
        KeyValueRow(label = "Получатель", value = PhoneNumbers.pretty(state.recipientPhone))
        KeyValueRow(
            label = "Сумма",
            value = Money.format(amountMinor, source?.currency ?: Money.KZT),
        )
        if (state.description.isNotBlank()) {
            KeyValueRow(label = "Комментарий", value = state.description)
        }
        ThinDivider()
        Text(
            text = "Комиссию рассчитывает сервер — итог будет виден в деталях платежа.",
            style = MaterialTheme.typography.labelSmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
    }

    Spacer(modifier = Modifier.height(14.dp))

    state.idempotencyKey?.let { key ->
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
            Spacer(modifier = Modifier.height(4.dp))
            Text(
                text = "Повторная отправка использует этот же ключ, поэтому платёж не задвоится.",
                style = MaterialTheme.typography.labelSmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
        Spacer(modifier = Modifier.height(14.dp))
    }

    SubmitButton(
        text = if (state.retryReusesKey) "Повторить с тем же ключом" else "Подтвердить перевод",
        inFlight = state.isSubmitting,
        onClick = viewModel::submit,
    )
    Spacer(modifier = Modifier.height(8.dp))
    OutlinedButton(
        onClick = viewModel::backToForm,
        modifier = Modifier.fillMaxWidth(),
        enabled = !state.isSubmitting,
    ) {
        Text("Изменить")
    }
}

@Composable
private fun TransferSuccess(state: TransferUiState, viewModel: TransferViewModel) {
    val payment = state.payment
    if (payment == null) {
        LoadingBox(label = "Обрабатываем…")
        return
    }

    Box(
        modifier = Modifier
            .fillMaxWidth()
            .background(TaxiColors.positive.copy(alpha = 0.12f), RoundedCornerShape(12.dp))
            .padding(16.dp),
    ) {
        Column {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(
                    text = "Перевод отправлен",
                    style = MaterialTheme.typography.titleMedium,
                    modifier = Modifier.weight(1f),
                )
                StatusChip(status = payment.status)
            }
            Spacer(modifier = Modifier.height(8.dp))
            MoneyText(amountMinor = payment.amountMinor, currency = payment.currency)
            Spacer(modifier = Modifier.height(4.dp))
            Text(
                text = "Номер платежа",
                style = MaterialTheme.typography.labelSmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            Text(
                text = payment.paymentNumber,
                style = MaterialTheme.typography.bodyMedium,
                fontFamily = FontFamily.Monospace,
            )
        }
    }

    Spacer(modifier = Modifier.height(14.dp))

    SectionCard {
        KeyValueRow(label = "Получатель", value = PhoneNumbers.pretty(state.recipientPhone))
        KeyValueRow(label = "Сумма", value = Money.format(payment.amountMinor, payment.currency))
        KeyValueRow(label = "Комиссия", value = Money.format(payment.feeMinor, payment.currency))
        KeyValueRow(
            label = "Итого списано",
            value = Money.format(payment.totalMinor, payment.currency),
        )
        payment.completedAt?.let { KeyValueRow(label = "Завершён", value = it) }
        payment.failureReason?.let { KeyValueRow(label = "Причина", value = it) }
        if (state.idempotencyKey != null) {
            ThinDivider()
            Text(
                text = "Idempotency-Key: ${state.idempotencyKey}",
                style = MaterialTheme.typography.labelSmall,
                fontFamily = FontFamily.Monospace,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
    }

    Spacer(modifier = Modifier.height(18.dp))

    SubmitButton(
        text = "Повторить операцию",
        inFlight = false,
        onClick = viewModel::repeat,
    )
    Spacer(modifier = Modifier.height(8.dp))
    Text(
        text = "Повтор начнёт новый перевод и получит новый Idempotency-Key.",
        style = MaterialTheme.typography.labelSmall,
        color = MaterialTheme.colorScheme.onSurfaceVariant,
    )
    Spacer(modifier = Modifier.height(8.dp))
    OutlinedButton(onClick = viewModel::startNew, modifier = Modifier.fillMaxWidth()) {
        Text("Новый перевод")
    }
}

@Composable
private fun SourceAccountRow(
    account: AccountDto,
    selected: Boolean,
    onClick: () -> Unit,
) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .background(MaterialTheme.colorScheme.surface, RoundedCornerShape(12.dp))
            .clickable(onClick = onClick)
            .padding(horizontal = 8.dp, vertical = 10.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.Start,
    ) {
        RadioButton(selected = selected, onClick = onClick)
        Spacer(modifier = Modifier.width(4.dp))
        Column(modifier = Modifier.weight(1f)) {
            Text(
                text = account.displayName ?: account.currency,
                style = MaterialTheme.typography.bodyLarge,
            )
            Text(
                text = "${account.type} · ${account.currency}",
                style = MaterialTheme.typography.labelSmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
        Column(horizontalAlignment = Alignment.End) {
            Text(
                text = Money.format(account.availableMinor, account.currency),
                style = MaterialTheme.typography.bodyMedium,
            )
            Text(
                text = "доступно",
                style = MaterialTheme.typography.labelSmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
    }
}
