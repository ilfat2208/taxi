package kz.taxi.mobile.feature.cart

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.Button
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import kz.taxi.mobile.core.money.Money
import kz.taxi.mobile.core.ui.EmptyState
import kz.taxi.mobile.core.ui.ErrorCard
import kz.taxi.mobile.core.ui.LoadingBox
import kz.taxi.mobile.core.ui.LocalAppContainer
import kz.taxi.mobile.core.ui.MoneyText
import kz.taxi.mobile.core.ui.ScreenScaffold
import kz.taxi.mobile.core.ui.SectionCard
import kz.taxi.mobile.core.ui.ThinDivider
import kz.taxi.mobile.data.dto.CartItemDto
import kz.taxi.mobile.ui.AppViewModels

@Composable
fun CartScreen(
    onBack: () -> Unit,
    onCheckout: () -> Unit,
    onOpenCatalog: () -> Unit,
) {
    val container = LocalAppContainer.current
    val viewModel: CartViewModel = viewModel(
        factory = AppViewModels.cart(container.cartRepository),
    )
    val state by viewModel.state.collectAsStateWithLifecycle()

    ScreenScaffold(
        title = "Корзина",
        onBack = onBack,
        actions = {
            if (state.items.isNotEmpty()) {
                TextButton(onClick = viewModel::clear, enabled = !state.isClearing) {
                    Text("Очистить", color = MaterialTheme.colorScheme.onPrimary)
                }
            }
        },
    ) {
        Column(modifier = Modifier.fillMaxSize().padding(horizontal = 16.dp)) {
            val error = state.error
            if (error != null) {
                ErrorCard(error = error, onRetry = viewModel::load, onDismiss = viewModel::dismissError)
                Spacer(modifier = Modifier.height(8.dp))
            }

            when {
                state.isLoading -> LoadingBox(label = "Загружаем корзину…")
                state.isEmpty -> Column {
                    EmptyState(
                        title = "Корзина пуста",
                        subtitle = "Добавьте товары из магазина.",
                    )
                    OutlinedButton(onClick = onOpenCatalog, modifier = Modifier.fillMaxWidth()) {
                        Text("В магазин")
                    }
                }
                else -> {
                    LazyColumn(
                        modifier = Modifier.weight(1f),
                        contentPadding = PaddingValues(vertical = 8.dp),
                        verticalArrangement = Arrangement.spacedBy(4.dp),
                    ) {
                        items(items = state.items, key = { it.itemId }) { item ->
                            CartItemRow(
                                item = item,
                                busy = state.busyItemId == item.itemId,
                                onIncrement = { viewModel.increment(item) },
                                onDecrement = { viewModel.decrement(item) },
                                onRemove = { viewModel.remove(item.itemId) },
                            )
                        }
                    }

                    SectionCard(modifier = Modifier.padding(bottom = 8.dp)) {
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            Text(
                                text = "Товаров: ${state.cart?.itemCount ?: 0}",
                                style = MaterialTheme.typography.bodyMedium,
                                modifier = Modifier.weight(1f),
                            )
                            MoneyText(
                                amountMinor = state.subtotalMinor,
                                currency = state.currency,
                                style = MaterialTheme.typography.titleLarge,
                            )
                        }
                        Spacer(modifier = Modifier.height(4.dp))
                        Text(
                            text = "Доставка и комиссия рассчитываются при оформлении.",
                            style = MaterialTheme.typography.labelSmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }

                    Button(
                        onClick = onCheckout,
                        modifier = Modifier.fillMaxWidth().height(52.dp),
                    ) {
                        Text("Оформить заказ")
                    }
                    Spacer(modifier = Modifier.height(20.dp))
                }
            }
        }
    }
}

@Composable
private fun CartItemRow(
    item: CartItemDto,
    busy: Boolean,
    onIncrement: () -> Unit,
    onDecrement: () -> Unit,
    onRemove: () -> Unit,
) {
    Column(modifier = Modifier.fillMaxWidth().padding(vertical = 8.dp)) {
        Text(text = item.title, style = MaterialTheme.typography.bodyLarge, maxLines = 2)
        Spacer(modifier = Modifier.height(2.dp))
        Text(
            text = "${Money.format(item.unitPriceMinor, item.currency)} × ${item.quantity}",
            style = MaterialTheme.typography.labelSmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        Spacer(modifier = Modifier.height(6.dp))
        Row(verticalAlignment = Alignment.CenterVertically) {
            OutlinedButton(onClick = onDecrement, enabled = !busy) { Text("−") }
            Spacer(modifier = Modifier.width(8.dp))
            Text(text = item.quantity.toString(), style = MaterialTheme.typography.titleMedium)
            Spacer(modifier = Modifier.width(8.dp))
            OutlinedButton(onClick = onIncrement, enabled = !busy) { Text("+") }
            Spacer(modifier = Modifier.weight(1f))
            Text(
                text = Money.format(item.lineTotalMinor, item.currency),
                style = MaterialTheme.typography.titleMedium,
            )
        }
        Spacer(modifier = Modifier.height(4.dp))
        TextButton(onClick = onRemove, enabled = !busy) { Text("Удалить") }
        ThinDivider()
    }
}
