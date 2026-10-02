package kz.taxi.mobile.nav

import androidx.annotation.StringRes
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.KeyboardArrowRight
import androidx.compose.material.icons.automirrored.filled.List
import androidx.compose.material.icons.automirrored.filled.Send
import androidx.compose.material.icons.filled.AccountBox
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.Home
import androidx.compose.material.icons.filled.Person
import androidx.compose.material.icons.filled.Share
import androidx.compose.material.icons.filled.ShoppingCart
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FloatingActionButton
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.unit.dp
import kz.taxi.mobile.R
import kz.taxi.mobile.feature.home.ComingSoonBadge

/** The four destinations of the bottom navigation of the mockup. */
enum class MainTab(
    @StringRes val labelRes: Int,
    val icon: ImageVector,
    val route: String,
) {
    HOME(R.string.nav_home, Icons.Filled.Home, Routes.HOME),
    CATALOG(R.string.nav_catalog, Icons.Filled.ShoppingCart, Routes.CATALOG),
    ORDERS(R.string.nav_orders, Icons.AutoMirrored.Filled.List, Routes.ORDERS),
    PROFILE(R.string.nav_profile, Icons.Filled.Person, Routes.ACCOUNTS),
}

/**
 * What the raised "+" button offers. Only the actions that lead somewhere real are
 * unbadged; the QR action is marked as a placeholder instead of pretending to work.
 */
enum class QuickAction(
    @StringRes val labelRes: Int,
    val icon: ImageVector,
    val comingSoon: Boolean = false,
) {
    TRANSFER(R.string.quick_action_transfer, Icons.AutoMirrored.Filled.Send),
    NEW_ORDER(R.string.quick_action_new_order, Icons.Filled.ShoppingCart),
    ACCOUNTS(R.string.quick_action_accounts, Icons.Filled.AccountBox),
    QR(R.string.quick_action_qr, Icons.Filled.Share, comingSoon = true),
}

/**
 * The frame every bottom-navigation tab is rendered in: the shared bottom bar, the raised
 * "+" button and its quick-action sheet.
 */
@Composable
fun OrtaTabScaffold(
    selected: MainTab,
    onSelectTab: (MainTab) -> Unit,
    onQuickAction: (QuickAction) -> Unit,
    content: @Composable () -> Unit,
) {
    var sheetOpen by rememberSaveable { mutableStateOf(false) }

    Scaffold(
        containerColor = MaterialTheme.colorScheme.background,
        // The activity is not edge-to-edge, so the window already applies the system insets;
        // letting Scaffold add them again would double the top padding.
        contentWindowInsets = WindowInsets(0, 0, 0, 0),
        bottomBar = {
            OrtaBottomBar(
                selected = selected,
                onSelectTab = onSelectTab,
                onOpenQuickActions = { sheetOpen = true },
            )
        },
    ) { innerPadding ->
        Box(modifier = Modifier.fillMaxSize().padding(innerPadding)) { content() }
    }

    if (sheetOpen) {
        QuickActionsSheet(
            onDismiss = { sheetOpen = false },
            onQuickAction = { action ->
                sheetOpen = false
                onQuickAction(action)
            },
        )
    }
}

/** The bottom bar of the mockup: four labelled tabs and a raised round "+" between them. */
@Composable
private fun OrtaBottomBar(
    selected: MainTab,
    onSelectTab: (MainTab) -> Unit,
    onOpenQuickActions: () -> Unit,
) {
    val left = MainTab.entries.take(2)
    val right = MainTab.entries.drop(2)

    Box(modifier = Modifier.fillMaxWidth().height(BAR_AREA_HEIGHT)) {
        Surface(
            modifier = Modifier
                .align(Alignment.BottomCenter)
                .fillMaxWidth()
                .height(BAR_HEIGHT),
            shape = RoundedCornerShape(topStart = 22.dp, topEnd = 22.dp),
            color = MaterialTheme.colorScheme.surface,
            tonalElevation = 3.dp,
            shadowElevation = 8.dp,
        ) {
            Row(modifier = Modifier.fillMaxSize(), verticalAlignment = Alignment.CenterVertically) {
                left.forEach { tab ->
                    BottomBarItem(
                        tab = tab,
                        selected = tab == selected,
                        modifier = Modifier.weight(1f),
                        onClick = { onSelectTab(tab) },
                    )
                }
                // The slot under the raised button stays empty: the button covers it.
                Spacer(modifier = Modifier.weight(1f))
                right.forEach { tab ->
                    BottomBarItem(
                        tab = tab,
                        selected = tab == selected,
                        modifier = Modifier.weight(1f),
                        onClick = { onSelectTab(tab) },
                    )
                }
            }
        }

        // Half of the button sticks out above the bar, exactly like in the mockup.
        FloatingActionButton(
            onClick = onOpenQuickActions,
            modifier = Modifier.align(Alignment.TopCenter).size(56.dp),
            shape = CircleShape,
            containerColor = MaterialTheme.colorScheme.primary,
            contentColor = MaterialTheme.colorScheme.onPrimary,
        ) {
            Icon(
                imageVector = Icons.Filled.Add,
                contentDescription = stringResource(R.string.nav_quick_actions),
            )
        }
    }
}

@Composable
private fun BottomBarItem(
    tab: MainTab,
    selected: Boolean,
    modifier: Modifier = Modifier,
    onClick: () -> Unit,
) {
    val tint = if (selected) {
        MaterialTheme.colorScheme.primary
    } else {
        MaterialTheme.colorScheme.onSurfaceVariant
    }

    Column(
        modifier = modifier
            .fillMaxHeight()
            .selectable(selected = selected, role = Role.Tab, onClick = onClick)
            .padding(vertical = 8.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center,
    ) {
        Icon(
            imageVector = tab.icon,
            contentDescription = null,
            tint = tint,
            modifier = Modifier.size(22.dp),
        )
        Spacer(modifier = Modifier.height(3.dp))
        Text(
            text = stringResource(tab.labelRes),
            style = MaterialTheme.typography.labelSmall,
            color = tint,
            maxLines = 1,
        )
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun QuickActionsSheet(onDismiss: () -> Unit, onQuickAction: (QuickAction) -> Unit) {
    ModalBottomSheet(onDismissRequest = onDismiss) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 20.dp)
                .padding(bottom = 28.dp),
        ) {
            Text(
                text = stringResource(R.string.quick_actions_title),
                style = MaterialTheme.typography.titleMedium,
            )
            Spacer(modifier = Modifier.height(6.dp))

            QuickAction.entries.forEach { action ->
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .clickable { onQuickAction(action) }
                        .padding(vertical = 14.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Icon(
                        imageVector = action.icon,
                        contentDescription = null,
                        tint = MaterialTheme.colorScheme.primary,
                    )
                    Spacer(modifier = Modifier.width(14.dp))
                    Text(
                        text = stringResource(action.labelRes),
                        style = MaterialTheme.typography.bodyLarge,
                        modifier = Modifier.weight(1f),
                    )
                    if (action.comingSoon) {
                        ComingSoonBadge()
                    } else {
                        Icon(
                            imageVector = Icons.AutoMirrored.Filled.KeyboardArrowRight,
                            contentDescription = null,
                            tint = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
                }
            }
        }
    }
}

private val BAR_HEIGHT = 68.dp
private val BAR_AREA_HEIGHT = 92.dp
