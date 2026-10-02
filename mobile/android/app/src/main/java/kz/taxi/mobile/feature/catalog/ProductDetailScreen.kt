package kz.taxi.mobile.feature.catalog

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
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
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
import kz.taxi.mobile.core.ui.SubmitButton
import kz.taxi.mobile.core.ui.ThinDivider
import kz.taxi.mobile.core.ui.theme.TaxiColors
import kz.taxi.mobile.ui.AppViewModels

@Composable
fun ProductDetailScreen(
    productId: String,
    onBack: () -> Unit,
    onOpenCart: () -> Unit,
) {
    val container = LocalAppContainer.current
    val viewModel: ProductDetailViewModel = viewModel(
        factory = AppViewModels.productDetail(
            container.catalogRepository,
            container.cartRepository,
            productId,
        ),
    )
    val state by viewModel.state.collectAsStateWithLifecycle()

    ScreenScaffold(title = "Товар", onBack = onBack) {
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
                LoadingBox(label = "Загружаем товар…")
                return@Column
            }

            val product = state.product ?: return@Column

            SectionCard {
                Text(text = product.title, style = MaterialTheme.typography.titleLarge)
                Spacer(modifier = Modifier.height(6.dp))
                MoneyText(amountMinor = product.priceMinor, currency = product.currency)
                Spacer(modifier = Modifier.height(10.dp))
                if (product.stock > 0) {
                    Box(
                        modifier = Modifier
                            .background(TaxiColors.positive.copy(alpha = 0.12f), RoundedCornerShape(50))
                            .padding(horizontal = 10.dp, vertical = 4.dp),
                    ) {
                        Text(
                            text = "В наличии: ${product.stock}",
                            style = MaterialTheme.typography.labelSmall,
                            color = TaxiColors.positive,
                        )
                    }
                } else {
                    Box(
                        modifier = Modifier
                            .background(TaxiColors.negative.copy(alpha = 0.12f), RoundedCornerShape(50))
                            .padding(horizontal = 10.dp, vertical = 4.dp),
                    ) {
                        Text(
                            text = "Нет в наличии",
                            style = MaterialTheme.typography.labelSmall,
                            color = TaxiColors.negative,
                        )
                    }
                }
            }

            Spacer(modifier = Modifier.height(14.dp))

            SectionCard {
                KeyValueRow(label = "Продавец", value = product.merchantName ?: product.merchant?.displayName ?: "—")
                product.merchant?.city?.let { KeyValueRow(label = "Город", value = it) }
                product.category?.let { KeyValueRow(label = "Категория", value = it) }
                product.brand?.let { KeyValueRow(label = "Бренд", value = it) }
                product.onHand?.let { KeyValueRow(label = "На складе", value = it.toString()) }
                product.reserved?.let { KeyValueRow(label = "Зарезервировано", value = it.toString()) }
                KeyValueRow(label = "ID товара", value = product.id)
            }

            product.description?.takeIf { it.isNotBlank() }?.let { description ->
                Spacer(modifier = Modifier.height(14.dp))
                SectionCard {
                    Text(text = "Описание", style = MaterialTheme.typography.titleMedium)
                    Spacer(modifier = Modifier.height(6.dp))
                    Text(text = description, style = MaterialTheme.typography.bodyMedium)
                }
            }

            Spacer(modifier = Modifier.height(18.dp))

            TaxiOutlinedField(
                value = state.quantity.toString(),
                onValueChange = { text ->
                    text.filter(Char::isDigit).take(2).toIntOrNull()?.let(viewModel::onQuantityChange)
                },
                label = "Количество",
                keyboardType = KeyboardType.Number,
                supportingText = "Итого: ${Money.format(product.priceMinor * state.quantity, product.currency)}",
            )

            Spacer(modifier = Modifier.height(14.dp))

            SubmitButton(
                text = "Добавить в корзину",
                inFlight = state.isAddingToCart,
                enabled = product.isAvailable,
                onClick = viewModel::addToCart,
            )

            val added = state.addedMessage
            if (added != null) {
                Spacer(modifier = Modifier.height(10.dp))
                Box(
                    modifier = Modifier
                        .fillMaxWidth()
                        .background(TaxiColors.positive.copy(alpha = 0.12f), RoundedCornerShape(10.dp))
                        .padding(12.dp),
                ) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Text(
                            text = added,
                            style = MaterialTheme.typography.bodyMedium,
                            modifier = Modifier.weight(1f),
                        )
                        TextButton(onClick = { viewModel.consumeMessage(); onOpenCart() }) {
                            Text("В корзину")
                        }
                    }
                }
            }

            Spacer(modifier = Modifier.height(10.dp))
            OutlinedButton(onClick = onOpenCart, modifier = Modifier.fillMaxWidth()) {
                Text("Открыть корзину")
            }

            Spacer(modifier = Modifier.height(24.dp))
        }
    }
}
