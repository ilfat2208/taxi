package kz.taxi.mobile.feature.catalog

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
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import kz.taxi.mobile.core.money.Money
import kz.taxi.mobile.core.ui.EmptyState
import kz.taxi.mobile.core.ui.ErrorCard
import kz.taxi.mobile.core.ui.FilterRow
import kz.taxi.mobile.core.ui.TaxiOutlinedField
import kz.taxi.mobile.core.ui.LoadingBox
import kz.taxi.mobile.core.ui.LocalAppContainer
import kz.taxi.mobile.core.ui.PaginationFooter
import kz.taxi.mobile.core.ui.ScreenScaffold
import kz.taxi.mobile.data.dto.ProductDto
import kz.taxi.mobile.data.dto.ProductSort
import kz.taxi.mobile.ui.AppViewModels

@Composable
fun CatalogScreen(
    onBack: () -> Unit,
    onOpenProduct: (String) -> Unit,
    onOpenCart: () -> Unit,
) {
    val container = LocalAppContainer.current
    val viewModel: CatalogViewModel = viewModel(
        factory = AppViewModels.catalog(container.catalogRepository),
    )
    val state by viewModel.state.collectAsStateWithLifecycle()

    ScreenScaffold(
        title = "Магазин",
        onBack = onBack,
        actions = {
            TextButton(onClick = onOpenCart) {
                Text("Корзина", color = MaterialTheme.colorScheme.onPrimary)
            }
        },
    ) {
        Column(modifier = Modifier.fillMaxSize().padding(horizontal = 16.dp)) {
            TaxiOutlinedField(
                value = state.query,
                onValueChange = viewModel::onQueryChange,
                label = "Поиск товаров",
                keyboardType = KeyboardType.Text,
            )

            Spacer(modifier = Modifier.height(6.dp))

            FilterRow(
                options = state.categories.take(MAX_CATEGORY_CHIPS),
                selected = state.category,
                labelFor = { it },
                onSelect = viewModel::onCategoryChange,
            )

            FilterRow(
                options = SortOptions,
                selected = state.sort,
                labelFor = { sortLabel(it) },
                onSelect = { sort -> sort?.let(viewModel::onSortChange) },
            )

            val error = state.error
            if (error != null) {
                ErrorCard(error = error, onRetry = viewModel::refresh, onDismiss = viewModel::dismissError)
                Spacer(modifier = Modifier.height(8.dp))
            }

            when {
                state.isInitialLoading -> LoadingBox(label = "Загружаем товары…")
                state.isEmpty -> EmptyState(
                    title = "Ничего не найдено",
                    subtitle = "Измените запрос или выберите другую категорию.",
                )
                else -> LazyColumn(
                    modifier = Modifier.fillMaxSize(),
                    contentPadding = PaddingValues(bottom = 24.dp),
                    verticalArrangement = Arrangement.spacedBy(8.dp),
                ) {
                    items(items = state.items, key = { it.id }) { product ->
                        ProductRow(product = product, onClick = { onOpenProduct(product.id) })
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
private fun ProductRow(product: ProductDto, onClick: () -> Unit) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .clickable(onClick = onClick)
            .padding(vertical = 10.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Column(modifier = Modifier.weight(1f)) {
            Text(
                text = product.title,
                style = MaterialTheme.typography.bodyLarge,
                maxLines = 2,
            )
            Text(
                text = listOfNotNull(product.merchantName, product.category, product.brand)
                    .joinToString(" · "),
                style = MaterialTheme.typography.labelSmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                maxLines = 1,
            )
            Spacer(modifier = Modifier.height(2.dp))
            Text(
                text = if (product.stock > 0) "В наличии: ${product.stock}" else "Нет в наличии",
                style = MaterialTheme.typography.labelSmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
        Spacer(modifier = Modifier.width(12.dp))
        Text(
            text = Money.format(product.priceMinor, product.currency),
            style = MaterialTheme.typography.titleMedium,
        )
    }
}

private val SortOptions = listOf(
    ProductSort.RELEVANCE,
    ProductSort.PRICE_ASC,
    ProductSort.PRICE_DESC,
    ProductSort.NEWEST,
)

private fun sortLabel(sort: String): String = when (sort) {
    ProductSort.PRICE_ASC -> "Сначала дешевле"
    ProductSort.PRICE_DESC -> "Сначала дороже"
    ProductSort.NEWEST -> "Новинки"
    else -> "По релевантности"
}

private const val MAX_CATEGORY_CHIPS = 8
