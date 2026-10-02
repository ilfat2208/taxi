package kz.taxi.mobile.core.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import kz.taxi.mobile.core.error.ApiError
import kz.taxi.mobile.core.money.Money
import kz.taxi.mobile.core.ui.theme.TaxiColors

/** The standard page frame: a title row with an optional back arrow. */
@Composable
fun ScreenScaffold(
    title: String,
    onBack: (() -> Unit)? = null,
    actions: @Composable () -> Unit = {},
    content: @Composable () -> Unit,
) {
    Column(modifier = Modifier.fillMaxSize()) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .background(MaterialTheme.colorScheme.primary)
                .padding(horizontal = 8.dp, vertical = 14.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            if (onBack != null) {
                IconButton(onClick = onBack) {
                    Icon(
                        imageVector = Icons.AutoMirrored.Filled.ArrowBack,
                        contentDescription = "Назад",
                        tint = MaterialTheme.colorScheme.onPrimary,
                    )
                }
            } else {
                Spacer(modifier = Modifier.width(12.dp))
            }
            Text(
                text = title,
                style = MaterialTheme.typography.titleLarge,
                color = MaterialTheme.colorScheme.onPrimary,
                modifier = Modifier.weight(1f),
            )
            actions()
        }
        content()
    }
}

/** Full-width money line, used for balances and totals. */
@Composable
fun MoneyText(
    amountMinor: Long,
    currency: String = Money.KZT,
    signed: Boolean = false,
    style: androidx.compose.ui.text.TextStyle = MaterialTheme.typography.headlineSmall,
    color: Color = MaterialTheme.colorScheme.onSurface,
    modifier: Modifier = Modifier,
) {
    Text(
        text = if (signed) Money.formatSigned(amountMinor, currency) else Money.format(amountMinor, currency),
        style = style,
        color = color,
        modifier = modifier,
        maxLines = 1,
    )
}

/** A soft chip for a status string. */
@Composable
fun StatusChip(status: String, modifier: Modifier = Modifier) {
    val (background, foreground) = statusColors(status)
    Box(
        modifier = modifier
            .background(background, RoundedCornerShape(50))
            .padding(horizontal = 10.dp, vertical = 4.dp),
    ) {
        Text(
            text = statusLabel(status),
            style = MaterialTheme.typography.labelSmall,
            color = foreground,
            fontWeight = FontWeight.Medium,
        )
    }
}

private fun statusColors(status: String): Pair<Color, Color> = when (status.uppercase()) {
    "COMPLETED", "PAID", "ACTIVE", "SETTLED" -> TaxiColors.positive.copy(alpha = 0.14f) to TaxiColors.positive
    "FAILED", "CANCELLED", "DECLINED", "REJECTED" -> TaxiColors.negative.copy(alpha = 0.12f) to TaxiColors.negative
    "INITIATED", "PENDING", "PENDING_PAYMENT", "PROCESSING" -> TaxiColors.pending.copy(alpha = 0.14f) to TaxiColors.pending
    else -> TaxiColors.neutral.copy(alpha = 0.12f) to TaxiColors.neutral
}

/** Prints a business status the way it is named in the product, in Russian. */
fun statusLabel(status: String): String = when (status.uppercase()) {
    "COMPLETED" -> "Выполнен"
    "PAID" -> "Оплачен"
    "PENDING" -> "В обработке"
    "PENDING_PAYMENT" -> "Ожидает оплаты"
    "INITIATED" -> "Создан"
    "FAILED" -> "Отклонён"
    "CANCELLED" -> "Отменён"
    "ACTIVE" -> "Активен"
    "BLOCKED" -> "Заблокирован"
    "CLOSED" -> "Закрыт"
    "DEBIT" -> "Списание"
    "CREDIT" -> "Пополнение"
    else -> status
}

@Composable
fun SectionCard(
    modifier: Modifier = Modifier,
    content: @Composable () -> Unit,
) {
    Card(
        modifier = modifier.fillMaxWidth(),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
        elevation = CardDefaults.cardElevation(defaultElevation = 1.dp),
    ) {
        Column(modifier = Modifier.padding(16.dp)) { content() }
    }
}

/**
 * The error surface. Always shows the Russian message, and — because support asks for it —
 * the machine-readable code and the `correlationId` from the RFC 7807 document.
 */
@Composable
fun ErrorCard(
    error: ApiError,
    modifier: Modifier = Modifier,
    onRetry: (() -> Unit)? = null,
    onDismiss: (() -> Unit)? = null,
) {
    Card(
        modifier = modifier.fillMaxWidth(),
        colors = CardDefaults.cardColors(
            containerColor = MaterialTheme.colorScheme.errorContainer.copy(alpha = 0.55f),
        ),
    ) {
        Column(modifier = Modifier.padding(14.dp)) {
            Row(verticalAlignment = Alignment.Top) {
                Text(
                    text = error.message,
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onErrorContainer,
                    modifier = Modifier.weight(1f),
                )
                if (onDismiss != null) {
                    TextButton(onClick = onDismiss) { Text("Скрыть") }
                }
            }
            val diagnostics = error.diagnostics
            if (diagnostics != null) {
                Spacer(modifier = Modifier.height(6.dp))
                Text(
                    text = diagnostics,
                    style = MaterialTheme.typography.labelSmall,
                    fontFamily = FontFamily.Monospace,
                    color = MaterialTheme.colorScheme.onErrorContainer.copy(alpha = 0.75f),
                )
            }
            if (onRetry != null) {
                Spacer(modifier = Modifier.height(4.dp))
                TextButton(onClick = onRetry) { Text("Повторить") }
            }
        }
    }
}

@Composable
fun LoadingBox(modifier: Modifier = Modifier, label: String = "Загрузка…") {
    Column(
        modifier = modifier.fillMaxWidth().padding(32.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        CircularProgressIndicator(modifier = Modifier.size(32.dp), strokeWidth = 3.dp)
        Spacer(modifier = Modifier.height(10.dp))
        Text(text = label, style = MaterialTheme.typography.bodyMedium)
    }
}

@Composable
fun EmptyState(
    title: String,
    subtitle: String? = null,
    modifier: Modifier = Modifier,
) {
    Column(
        modifier = modifier.fillMaxWidth().padding(32.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Text(
            text = title,
            style = MaterialTheme.typography.titleMedium,
            textAlign = TextAlign.Center,
        )
        if (subtitle != null) {
            Spacer(modifier = Modifier.height(6.dp))
            Text(
                text = subtitle,
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                textAlign = TextAlign.Center,
            )
        }
    }
}

/**
 * The money-moving submit button.
 *
 * [inFlight] must be `true` for the whole duration of the request: a second tap while the
 * payment is in flight is what would otherwise create a duplicate submit.
 */
@Composable
fun SubmitButton(
    text: String,
    inFlight: Boolean,
    modifier: Modifier = Modifier,
    enabled: Boolean = true,
    onClick: () -> Unit,
) {
    Button(
        onClick = onClick,
        modifier = modifier.fillMaxWidth().height(52.dp),
        enabled = enabled && !inFlight,
    ) {
        if (inFlight) {
            CircularProgressIndicator(
                modifier = Modifier.size(20.dp),
                strokeWidth = 2.dp,
                color = MaterialTheme.colorScheme.onPrimary,
            )
            Spacer(modifier = Modifier.width(10.dp))
            Text("Отправляем…")
        } else {
            Text(text)
        }
    }
}

@Composable
fun TaxiOutlinedField(
    value: String,
    onValueChange: (String) -> Unit,
    label: String,
    modifier: Modifier = Modifier,
    keyboardType: KeyboardType = KeyboardType.Text,
    singleLine: Boolean = true,
    isError: Boolean = false,
    supportingText: String? = null,
    enabled: Boolean = true,
    minLines: Int = 1,
) {
    OutlinedTextField(
        value = value,
        onValueChange = onValueChange,
        label = { Text(label) },
        modifier = modifier.fillMaxWidth(),
        singleLine = singleLine,
        minLines = minLines,
        enabled = enabled,
        isError = isError,
        supportingText = supportingText?.let { { Text(it) } },
        keyboardOptions = KeyboardOptions(keyboardType = keyboardType),
    )
}

/** Horizontal single-choice filter, used by the payments and orders lists. */
@Composable
fun FilterRow(
    options: List<String>,
    selected: String?,
    labelFor: (String) -> String,
    onSelect: (String?) -> Unit,
    modifier: Modifier = Modifier,
) {
    Row(
        modifier = modifier
            .fillMaxWidth()
            .horizontalScroll(rememberScrollState())
            .padding(vertical = 4.dp),
        horizontalArrangement = Arrangement.spacedBy(8.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        FilterChipButton(label = "Все", active = selected == null) { onSelect(null) }
        options.forEach { option ->
            FilterChipButton(label = labelFor(option), active = selected == option) { onSelect(option) }
        }
    }
}

@Composable
private fun FilterChipButton(label: String, active: Boolean, onClick: () -> Unit) {
    val padding = androidx.compose.foundation.layout.PaddingValues(horizontal = 12.dp, vertical = 6.dp)
    if (active) {
        Button(onClick = onClick, contentPadding = padding) {
            Text(label, style = MaterialTheme.typography.labelLarge)
        }
    } else {
        OutlinedButton(onClick = onClick, contentPadding = padding) {
            Text(label, style = MaterialTheme.typography.labelLarge)
        }
    }
}

/** "Load more" footer for the hand-rolled pagination used by the lists. */
@Composable
fun PaginationFooter(
    hasNext: Boolean,
    isLoadingMore: Boolean,
    onLoadMore: () -> Unit,
    modifier: Modifier = Modifier,
) {
    if (!hasNext) return
    Box(modifier = modifier.fillMaxWidth().padding(12.dp), contentAlignment = Alignment.Center) {
        if (isLoadingMore) {
            CircularProgressIndicator(modifier = Modifier.size(22.dp), strokeWidth = 2.dp)
        } else {
            OutlinedButton(onClick = onLoadMore) { Text("Показать ещё") }
        }
    }
}

@Composable
fun KeyValueRow(
    label: String,
    value: String,
    modifier: Modifier = Modifier,
    valueColor: Color = MaterialTheme.colorScheme.onSurface,
) {
    Row(
        modifier = modifier.fillMaxWidth().padding(vertical = 3.dp),
        verticalAlignment = Alignment.Top,
    ) {
        Text(
            text = label,
            style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            modifier = Modifier.weight(1f),
        )
        Text(
            text = value,
            style = MaterialTheme.typography.bodyMedium,
            color = valueColor,
            textAlign = TextAlign.End,
            modifier = Modifier.weight(1.2f),
        )
    }
}

@Composable
fun ThinDivider(modifier: Modifier = Modifier) {
    HorizontalDivider(
        modifier = modifier.padding(vertical = 8.dp),
        color = MaterialTheme.colorScheme.surfaceVariant,
    )
}

@Composable
fun VerticalScrollColumn(
    modifier: Modifier = Modifier,
    content: @Composable () -> Unit,
) {
    Column(
        modifier = modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .padding(16.dp),
    ) { content() }
}
