package kz.taxi.mobile.feature.accounts

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
import androidx.compose.material3.Button
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
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
import kz.taxi.mobile.core.ui.SectionCard
import kz.taxi.mobile.core.ui.ThinDivider
import kz.taxi.mobile.core.ui.statusLabel
import kz.taxi.mobile.core.ui.theme.TaxiColors
import kz.taxi.mobile.ui.AppViewModels

/** Dashboard: balances, quick actions and the selected account's recent activity. */
@Composable
fun AccountsScreen(
    onOpenTransfer: () -> Unit,
    onOpenPayments: () -> Unit,
    onOpenCatalog: () -> Unit,
    onOpenOrders: () -> Unit,
    onOpenCart: () -> Unit,
    onLogout: () -> Unit,
) {
    val container = LocalAppContainer.current
    val viewModel: AccountsViewModel = viewModel(
        factory = AppViewModels.accounts(container.accountsRepository, container.sessionManager),
    )
    val state by viewModel.state.collectAsStateWithLifecycle()
    val session by viewModel.session.collectAsStateWithLifecycle()

    LaunchedEffect(Unit) { viewModel.refresh() }

    Column(modifier = Modifier.fillMaxSize()) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .background(MaterialTheme.colorScheme.primary)
                .padding(horizontal = 20.dp, vertical = 16.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Column(modifier = Modifier.weight(1f)) {
                Text(
                    text = session?.displayName ?: "Профиль",
                    style = MaterialTheme.typography.titleLarge,
                    color = MaterialTheme.colorScheme.onPrimary,
                )
                Text(
                    text = session?.phone.orEmpty(),
                    style = MaterialTheme.typography.labelSmall,
                    color = MaterialTheme.colorScheme.onPrimary.copy(alpha = 0.8f),
                )
            }
            TextButton(onClick = onLogout) {
                Text("Выйти", color = MaterialTheme.colorScheme.onPrimary)
            }
        }

        Column(
            modifier = Modifier
                .fillMaxSize()
                .verticalScroll(rememberScrollState())
                .padding(16.dp),
        ) {
            val error = state.error
            if (error != null) {
                ErrorCard(error = error, onRetry = viewModel::refresh, onDismiss = viewModel::dismissError)
                Spacer(modifier = Modifier.height(12.dp))
            }

            val notification = state.notification
            if (notification != null) {
                Box(
                    modifier = Modifier
                        .fillMaxWidth()
                        .background(TaxiColors.positive.copy(alpha = 0.12f), RoundedCornerShape(10.dp))
                        .padding(12.dp),
                ) {
                    Text(text = notification, style = MaterialTheme.typography.bodyMedium)
                }
                Spacer(modifier = Modifier.height(12.dp))
            }

            if (state.isLoading) {
                LoadingBox(label = "Загружаем счета…")
            } else {
                SectionCard {
                    Text(
                        text = "Доступно всего",
                        style = MaterialTheme.typography.labelLarge,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                    Spacer(modifier = Modifier.height(4.dp))
                    MoneyText(amountMinor = state.totalAvailableMinor)
                    Spacer(modifier = Modifier.height(2.dp))
                    Text(
                        text = "Счетов: ${state.accounts.size}",
                        style = MaterialTheme.typography.labelSmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }

                Spacer(modifier = Modifier.height(14.dp))

                Text(text = "Быстрые действия", style = MaterialTheme.typography.titleMedium)
                Spacer(modifier = Modifier.height(8.dp))
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                ) {
                    Button(onClick = onOpenTransfer, modifier = Modifier.weight(1f)) { Text("Перевести") }
                    OutlinedButton(onClick = onOpenPayments, modifier = Modifier.weight(1f)) { Text("История") }
                }
                Spacer(modifier = Modifier.height(8.dp))
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                ) {
                    OutlinedButton(onClick = onOpenCatalog, modifier = Modifier.weight(1f)) { Text("Магазин") }
                    OutlinedButton(onClick = onOpenOrders, modifier = Modifier.weight(1f)) { Text("Заказы") }
                }
                Spacer(modifier = Modifier.height(8.dp))
                OutlinedButton(onClick = onOpenCart, modifier = Modifier.fillMaxWidth()) { Text("Корзина") }

                Spacer(modifier = Modifier.height(18.dp))

                Text(text = "Мои счета", style = MaterialTheme.typography.titleMedium)
                Spacer(modifier = Modifier.height(8.dp))

                if (state.isEmpty) {
                    SectionCard {
                        Text(
                            text = "У вас пока нет счетов в тенге.",
                            style = MaterialTheme.typography.bodyMedium,
                        )
                        Spacer(modifier = Modifier.height(10.dp))
                        Button(
                            onClick = viewModel::openAccount,
                            enabled = !state.isOpeningAccount,
                        ) {
                            Text(if (state.isOpeningAccount) "Открываем…" else "Открыть счёт KZT")
                        }
                    }
                } else {
                    state.accounts.forEach { account ->
                        val selected = account.id == state.selectedAccount?.id
                        AccountCard(
                            displayName = account.displayName ?: account.currency,
                            type = account.type,
                            currency = account.currency,
                            balanceMinor = account.balanceMinor,
                            heldMinor = account.heldMinor,
                            availableMinor = account.availableMinor,
                            status = account.status,
                            selected = selected,
                            onClick = { viewModel.selectAccount(account.id) },
                        )
                        Spacer(modifier = Modifier.height(10.dp))
                    }

                    Spacer(modifier = Modifier.height(4.dp))
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.spacedBy(8.dp),
                    ) {
                        OutlinedButton(
                            onClick = viewModel::openAccount,
                            modifier = Modifier.weight(1f),
                            enabled = !state.isOpeningAccount,
                        ) {
                            Text(if (state.isOpeningAccount) "Открываем…" else "Открыть счёт")
                        }
                        if (session?.isAdmin == true) {
                            Button(
                                onClick = { viewModel.topUpSelected(DEMO_TOP_UP_MINOR) },
                                modifier = Modifier.weight(1f),
                                enabled = !state.isToppingUp,
                            ) {
                                Text(if (state.isToppingUp) "Пополняем…" else "Демо +${Money.formatPlain(DEMO_TOP_UP_MINOR)}")
                            }
                        }
                    }
                }

                Spacer(modifier = Modifier.height(20.dp))

                Text(text = "Последние операции", style = MaterialTheme.typography.titleMedium)
                Spacer(modifier = Modifier.height(8.dp))
                SectionCard {
                    when {
                        state.isLoadingTransactions -> LoadingBox(label = "Загружаем операции…")
                        state.transactions.isEmpty() -> Text(
                            text = "Операций по этому счёту пока нет.",
                            style = MaterialTheme.typography.bodyMedium,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                        else -> state.transactions.forEachIndexed { index, transaction ->
                            if (index > 0) ThinDivider()
                            Row(verticalAlignment = Alignment.CenterVertically) {
                                Column(modifier = Modifier.weight(1f)) {
                                    Text(
                                        text = transaction.description
                                            ?: statusLabel(transaction.operation),
                                        style = MaterialTheme.typography.bodyMedium,
                                        maxLines = 1,
                                    )
                                    Text(
                                        text = "${statusLabel(transaction.operation)} · ${statusLabel(transaction.direction)}",
                                        style = MaterialTheme.typography.labelSmall,
                                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                                    )
                                }
                                Spacer(modifier = Modifier.width(8.dp))
                                MoneyText(
                                    amountMinor = if (transaction.isCredit) transaction.amountMinor else -transaction.amountMinor,
                                    currency = transaction.currency,
                                    signed = true,
                                    style = MaterialTheme.typography.titleMedium,
                                    color = if (transaction.isCredit) TaxiColors.positive else TaxiColors.negative,
                                )
                            }
                        }
                    }
                }

                Spacer(modifier = Modifier.height(24.dp))
            }
        }
    }
}

@Composable
private fun AccountCard(
    displayName: String,
    type: String,
    currency: String,
    balanceMinor: Long,
    heldMinor: Long,
    availableMinor: Long,
    status: String,
    selected: Boolean,
    onClick: () -> Unit,
) {
    val border = if (selected) {
        MaterialTheme.colorScheme.primary
    } else {
        MaterialTheme.colorScheme.surfaceVariant
    }
    Box(
        modifier = Modifier
            .fillMaxWidth()
            .background(MaterialTheme.colorScheme.surface, RoundedCornerShape(14.dp))
            .padding(1.dp)
            .background(border, RoundedCornerShape(14.dp))
            .padding(1.dp)
            .background(MaterialTheme.colorScheme.surface, RoundedCornerShape(13.dp)),
    ) {
        Column(modifier = Modifier.padding(14.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Column(modifier = Modifier.weight(1f)) {
                    Text(text = displayName, style = MaterialTheme.typography.titleMedium)
                    Text(
                        text = "$type · $currency",
                        style = MaterialTheme.typography.labelSmall,
                        fontFamily = FontFamily.Monospace,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
                Text(
                    text = statusLabel(status),
                    style = MaterialTheme.typography.labelSmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
            Spacer(modifier = Modifier.height(8.dp))
            MoneyText(amountMinor = balanceMinor, currency = currency)
            Spacer(modifier = Modifier.height(6.dp))
            KeyValueRow(label = "Доступно", value = Money.format(availableMinor, currency))
            if (heldMinor > 0) {
                KeyValueRow(label = "Заблокировано", value = Money.format(heldMinor, currency))
            }
            Spacer(modifier = Modifier.height(6.dp))
            TextButton(onClick = onClick) {
                Text(if (selected) "Выбран" else "Выбрать счёт")
            }
        }
    }
}

/** Amount used by the operator-only demo funding button: 5 000,00 KZT. */
private const val DEMO_TOP_UP_MINOR = 500_000L
