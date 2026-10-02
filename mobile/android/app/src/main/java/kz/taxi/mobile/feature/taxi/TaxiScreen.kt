package kz.taxi.mobile.feature.taxi

import androidx.annotation.StringRes
import androidx.compose.foundation.layout.Arrangement
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
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.filled.Info
import androidx.compose.material.icons.filled.Warning
import androidx.compose.material3.Button
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import kz.taxi.mobile.R
import kz.taxi.mobile.core.ui.ScreenScaffold
import kz.taxi.mobile.core.ui.SectionCard
import kz.taxi.mobile.core.ui.StatusChip
import kz.taxi.mobile.core.ui.ThinDivider
import kz.taxi.mobile.core.ui.theme.TaxiColors

/**
 * The ORTA Taxi entry point.
 *
 * Ordering a ride does not exist yet — the trip vertical is the next phase of
 * `docs/taxi-roadmap.md`. This screen therefore says so in plain words and lists what is
 * already working, instead of drawing a map and a "call a car" button that would do nothing.
 */
@Composable
fun TaxiScreen(
    onBack: () -> Unit,
    onOpenAccounts: () -> Unit,
    onOpenCatalog: () -> Unit,
) {
    ScreenScaffold(title = stringResource(R.string.taxi_title), onBack = onBack) {
        Column(
            modifier = Modifier
                .fillMaxSize()
                .verticalScroll(rememberScrollState())
                .padding(16.dp),
        ) {
            SectionCard {
                Row(verticalAlignment = Alignment.Top) {
                    Icon(
                        imageVector = Icons.Filled.Warning,
                        contentDescription = null,
                        tint = TaxiColors.pending,
                        modifier = Modifier.size(22.dp),
                    )
                    Spacer(modifier = Modifier.width(10.dp))
                    Column(modifier = Modifier.weight(1f)) {
                        Text(
                            text = stringResource(R.string.taxi_state_title),
                            style = MaterialTheme.typography.titleMedium,
                        )
                        Spacer(modifier = Modifier.height(6.dp))
                        Text(
                            text = stringResource(R.string.taxi_state_body),
                            style = MaterialTheme.typography.bodyMedium,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
                }
            }

            Spacer(modifier = Modifier.height(18.dp))

            Text(
                text = stringResource(R.string.taxi_ready_section),
                style = MaterialTheme.typography.titleMedium,
            )
            Spacer(modifier = Modifier.height(8.dp))
            SectionCard {
                ReadyRow(R.string.taxi_ready_driver, first = true)
                ReadyRow(R.string.taxi_ready_online)
                ReadyRow(R.string.taxi_ready_map)
                ReadyRow(R.string.taxi_ready_money)
            }

            Spacer(modifier = Modifier.height(18.dp))

            Text(
                text = stringResource(R.string.taxi_planned_section),
                style = MaterialTheme.typography.titleMedium,
            )
            Spacer(modifier = Modifier.height(8.dp))
            SectionCard {
                PlannedRow(R.string.taxi_planned_request, first = true)
                PlannedRow(R.string.taxi_planned_quote)
                PlannedRow(R.string.taxi_planned_payment)
                PlannedRow(R.string.taxi_planned_history)
            }

            Spacer(modifier = Modifier.height(20.dp))

            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                Button(onClick = onOpenAccounts, modifier = Modifier.weight(1f)) {
                    Text(stringResource(R.string.taxi_open_accounts))
                }
                OutlinedButton(onClick = onOpenCatalog, modifier = Modifier.weight(1f)) {
                    Text(stringResource(R.string.taxi_open_catalog))
                }
            }

            Spacer(modifier = Modifier.height(24.dp))
        }
    }
}

@Composable
private fun ReadyRow(@StringRes textRes: Int, first: Boolean = false) {
    if (!first) ThinDivider()
    StatusRow(
        textRes = textRes,
        icon = {
            Icon(
                imageVector = Icons.Filled.CheckCircle,
                contentDescription = null,
                tint = TaxiColors.positive,
                modifier = Modifier.size(18.dp),
            )
        },
        chip = { StatusChip(status = stringResource(R.string.status_done)) },
    )
}

@Composable
private fun PlannedRow(@StringRes textRes: Int, first: Boolean = false) {
    if (!first) ThinDivider()
    StatusRow(
        textRes = textRes,
        icon = {
            Icon(
                imageVector = Icons.Filled.Info,
                contentDescription = null,
                tint = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.size(18.dp),
            )
        },
        chip = { StatusChip(status = stringResource(R.string.status_soon)) },
    )
}

@Composable
private fun StatusRow(
    @StringRes textRes: Int,
    icon: @Composable () -> Unit,
    chip: @Composable () -> Unit,
) {
    Row(
        modifier = Modifier.fillMaxWidth().padding(vertical = 6.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        icon()
        Spacer(modifier = Modifier.width(10.dp))
        Text(
            text = stringResource(textRes),
            style = MaterialTheme.typography.bodyMedium,
            modifier = Modifier.weight(1f),
        )
        Spacer(modifier = Modifier.width(8.dp))
        chip()
    }
}
