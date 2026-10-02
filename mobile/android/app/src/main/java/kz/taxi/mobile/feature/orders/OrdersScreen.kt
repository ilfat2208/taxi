package kz.taxi.mobile.feature.orders

import androidx.compose.foundation.clickable
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
import kz.taxi.mobile.core.ui.EmptyState
import kz.taxi.mobile.core.ui.ErrorCard
import kz.taxi.mobile.core.ui.FilterRow
import kz.taxi.mobile.core.ui.LoadingBox
import kz.taxi.mobile.core.ui.LocalAppContainer
import kz.taxi.mobile.core.ui.PaginationFooter
import kz.taxi.mobile.core.ui.ScreenScaffold
import kz.taxi.mobile.core.ui.StatusChip
import kz.taxi.mobile.core.ui.statusLabel
import kz.taxi.mobile.data.dto.OrderDto
import kz.taxi.mobile.ui.AppViewModels

@Composable
fun OrdersScreen(
    onBack: () -> Unit,
    onOpenOrder: (String) -> Unit,
) {
    val container = LocalAppContainer.current
    val viewModel: OrdersViewModel = viewModel(
        factory = AppViewModels.orders(container.ordersRepository),
    )
    val state by viewModel.state.collectAsStateWithLifecycle()

    ScreenScaffold(
        title = "Мои заказы",
        onBack = onBack,
        actions = {
            Text("Всего: ${state.totalElements}", color = MaterialTheme.colorScheme.onPrimary)
        },
    ) {
        Column(modifier = Modifier.fillMaxSize().padding(horizontal = 16.dp)) {
            FilterRow(
                options = OrdersViewModel.FILTERABLE,
                selected = state.statusFilter,
                labelFor = ::statusLabel,
                onSelect = viewModel::setStatusFilter,
            )

            val error = state.error
            if (error != null) {
                ErrorCard(error = error, onRetry = viewModel::refresh, onDismiss = viewModel::dismissError)
                Spacer(modifier = Modifier.height(8.dp))
            }

            when {
                state.isInitialLoading -> LoadingBox(label = "Загружаем заказы…")
                state.isEmpty -> EmptyState(
                    title = "Заказов пока нет",
                    subtitle = "Оформите первый заказ в магазине.",
                )
                else -> LazyColumn(
                    modifier = Modifier.fillMaxSize(),
                    contentPadding = PaddingValues(bottom = 24.dp),
                    verticalArrangement = Arrangement.spacedBy(8.dp),
                ) {
                    items(items = state.items, key = { it.orderId }) { order ->
                        OrderRow(order = order, onClick = { onOpenOrder(order.orderId) })
                    }
                    item {
                        PaginationFooter(
                            hasNext = state.hasNext,
                            isLoadingMore = state.isLoadingMore,
                            onLoadMore = viewModel::loadMore,
                        )
                    }
                }
            }
        }
    }
}

@Composable
private fun OrderRow(order: OrderDto, onClick: () -> Unit) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .clickable(onClick = onClick)
            .padding(vertical = 10.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Column(modifier = Modifier.weight(1f)) {
            Text(
                text = order.orderNumber,
                style = MaterialTheme.typography.bodyLarge,
                fontFamily = FontFamily.Monospace,
            )
            Text(
                text = "Позиций: ${order.itemCount}",
                style = MaterialTheme.typography.labelSmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            Text(
                text = order.createdAt.orEmpty(),
                style = MaterialTheme.typography.labelSmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
        Spacer(modifier = Modifier.width(8.dp))
        Column(horizontalAlignment = Alignment.End) {
            Text(
                text = Money.format(order.totalMinor, order.currency),
                style = MaterialTheme.typography.titleMedium,
            )
            Spacer(modifier = Modifier.height(4.dp))
            StatusChip(status = order.status)
        }
    }
}
