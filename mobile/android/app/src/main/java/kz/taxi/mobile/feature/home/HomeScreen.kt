package kz.taxi.mobile.feature.home

import androidx.annotation.StringRes
import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.pager.HorizontalPager
import androidx.compose.foundation.pager.rememberPagerState
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.KeyboardArrowDown
import androidx.compose.material.icons.filled.LocationOn
import androidx.compose.material.icons.filled.Notifications
import androidx.compose.material.icons.filled.Search
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.focus.onFocusChanged
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.lerp
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.role
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import kz.taxi.mobile.R
import kz.taxi.mobile.core.ui.LocalAppContainer
import kz.taxi.mobile.core.ui.StatusChip
import kz.taxi.mobile.core.ui.theme.TaxiColors
import kz.taxi.mobile.ui.AppViewModels

/**
 * The ORTA home screen: brand header, city and notifications, the search stub, the grid of
 * services, the banner carousel and — provided by the caller — the raised quick-action button.
 *
 * The bottom bar is **not** drawn here: it belongs to `OrtaTabScaffold`, which hosts all four
 * tabs, so switching tabs never rebuilds the bar.
 */
@Composable
fun HomeScreen(
    onOpenSearch: () -> Unit,
    onOpenService: (ServiceKey) -> Unit,
    onOpenProfile: () -> Unit,
) {
    val container = LocalAppContainer.current
    val viewModel: HomeViewModel = viewModel(factory = AppViewModels.home(container.sessionManager))
    val state by viewModel.state.collectAsStateWithLifecycle()
    val session by viewModel.session.collectAsStateWithLifecycle()

    var cityMenuOpen by remember { mutableStateOf(false) }
    var noticesOpen by rememberSaveable { mutableStateOf(false) }

    Column(modifier = Modifier.fillMaxSize()) {
        HomeHeader(
            initials = session?.initials.orEmpty(),
            cityLabel = stringResource(state.city.labelRes),
            cityMenuOpen = cityMenuOpen,
            onCityMenuOpenChange = { cityMenuOpen = it },
            onCitySelected = viewModel::selectCity,
            hasUnreadNotices = state.hasUnreadNotices,
            onOpenNotices = {
                viewModel.markNoticesRead()
                noticesOpen = true
            },
            onOpenProfile = onOpenProfile,
        )

        Column(
            modifier = Modifier
                .fillMaxSize()
                .verticalScroll(rememberScrollState())
                .padding(horizontal = 16.dp),
        ) {
            HomeSearchStub(onClick = onOpenSearch)
            Spacer(modifier = Modifier.height(18.dp))
            ServiceGrid(onOpenService = onOpenService)
            Spacer(modifier = Modifier.height(20.dp))
            BannerCarousel()
            Spacer(modifier = Modifier.height(24.dp))
        }
    }

    if (noticesOpen) {
        NoticesSheet(notices = state.notices, onDismiss = { noticesOpen = false })
    }
}

/** Brand, city chip, bell and avatar. The brand stays on the light background of the mockup. */
@Composable
private fun HomeHeader(
    initials: String,
    cityLabel: String,
    cityMenuOpen: Boolean,
    onCityMenuOpenChange: (Boolean) -> Unit,
    onCitySelected: (HomeCity) -> Unit,
    hasUnreadNotices: Boolean,
    onOpenNotices: () -> Unit,
    onOpenProfile: () -> Unit,
) {
    val profileDescription = stringResource(R.string.home_profile)
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .padding(start = 20.dp, end = 10.dp, top = 14.dp, bottom = 12.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Column(modifier = Modifier.weight(1f)) {
            Text(
                text = stringResource(R.string.app_name),
                style = MaterialTheme.typography.headlineSmall,
                fontWeight = FontWeight.Bold,
                color = MaterialTheme.colorScheme.primary,
            )
            Text(
                text = stringResource(R.string.brand_tagline),
                style = MaterialTheme.typography.labelSmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }

        Box {
            Surface(
                modifier = Modifier
                    .clip(RoundedCornerShape(50))
                    .clickable { onCityMenuOpenChange(true) }
                    .semantics { contentDescription = cityLabel },
                color = MaterialTheme.colorScheme.primaryContainer,
                shape = RoundedCornerShape(50),
            ) {
                Row(
                    modifier = Modifier.padding(horizontal = 10.dp, vertical = 7.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Icon(
                        imageVector = Icons.Filled.LocationOn,
                        contentDescription = null,
                        tint = MaterialTheme.colorScheme.primary,
                        modifier = Modifier.size(15.dp),
                    )
                    Spacer(modifier = Modifier.width(4.dp))
                    Text(
                        text = cityLabel,
                        style = MaterialTheme.typography.labelLarge,
                        color = MaterialTheme.colorScheme.onPrimaryContainer,
                        maxLines = 1,
                    )
                    Icon(
                        imageVector = Icons.Filled.KeyboardArrowDown,
                        contentDescription = stringResource(R.string.city_pick),
                        tint = MaterialTheme.colorScheme.onPrimaryContainer,
                        modifier = Modifier.size(18.dp),
                    )
                }
            }

            DropdownMenu(
                expanded = cityMenuOpen,
                onDismissRequest = { onCityMenuOpenChange(false) },
            ) {
                HomeCity.entries.forEach { city ->
                    DropdownMenuItem(
                        text = { Text(stringResource(city.labelRes)) },
                        onClick = {
                            onCitySelected(city)
                            onCityMenuOpenChange(false)
                        },
                    )
                }
            }
        }

        Box {
            IconButton(onClick = onOpenNotices) {
                Icon(
                    imageVector = Icons.Filled.Notifications,
                    contentDescription = stringResource(R.string.home_notifications),
                    tint = MaterialTheme.colorScheme.onSurface,
                )
            }
            if (hasUnreadNotices) {
                Box(
                    modifier = Modifier
                        .align(Alignment.TopEnd)
                        .padding(top = 8.dp, end = 8.dp)
                        .size(9.dp)
                        .clip(CircleShape)
                        .background(TaxiColors.negative),
                )
            }
        }

        Box(
            modifier = Modifier
                .size(38.dp)
                .clip(CircleShape)
                .background(MaterialTheme.colorScheme.primary)
                .clickable(onClick = onOpenProfile)
                .semantics { contentDescription = profileDescription },
            contentAlignment = Alignment.Center,
        ) {
            Text(
                text = initials.ifBlank { "?" },
                style = MaterialTheme.typography.labelLarge,
                fontWeight = FontWeight.Bold,
                color = MaterialTheme.colorScheme.onPrimary,
                maxLines = 1,
            )
        }
    }
}

/**
 * The search row is a stub: ORTA has no cross-service search yet, so it only *looks* like a
 * field. A tap — or keyboard focus, exactly like a real field — hands over to the catalog
 * screen, which does have a working search.
 */
@Composable
private fun HomeSearchStub(onClick: () -> Unit, modifier: Modifier = Modifier) {
    // rememberSaveable, not remember: after coming back the field may still hold focus, and
    // navigating on that stale focus would bounce the user straight back into the catalog.
    var handedOver by rememberSaveable { mutableStateOf(false) }
    val hint = stringResource(R.string.home_search_hint)
    val shape = RoundedCornerShape(14.dp)

    Surface(
        modifier = modifier
            .fillMaxWidth()
            .height(50.dp)
            .clip(shape)
            // onFocusChanged must sit before the focus target it observes (clickable below).
            .onFocusChanged { focus ->
                if (focus.isFocused && !handedOver) {
                    handedOver = true
                    onClick()
                }
            }
            .clickable(onClick = onClick)
            .semantics {
                contentDescription = hint
                role = Role.Button
            },
        shape = shape,
        color = MaterialTheme.colorScheme.surface,
        tonalElevation = 1.dp,
    ) {
        Row(
            modifier = Modifier
                .fillMaxSize()
                .padding(horizontal = 14.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Icon(
                imageVector = Icons.Filled.Search,
                contentDescription = null,
                tint = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.size(20.dp),
            )
            Spacer(modifier = Modifier.width(10.dp))
            Text(
                text = hint,
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                maxLines = 1,
            )
        }
    }
}

/** Two-column grid of services, built from plain rows so it can live inside a scroll column. */
@Composable
private fun ServiceGrid(onOpenService: (ServiceKey) -> Unit, modifier: Modifier = Modifier) {
    Column(
        modifier = modifier.fillMaxWidth(),
        verticalArrangement = Arrangement.spacedBy(GRID_SPACING),
    ) {
        HomeServices.tiles.chunked(GRID_COLUMNS).forEach { row ->
            Row(horizontalArrangement = Arrangement.spacedBy(GRID_SPACING)) {
                row.forEach { tile ->
                    ServiceTileCard(
                        tile = tile,
                        modifier = Modifier.weight(1f),
                        onClick = { onOpenService(tile.key) },
                    )
                }
                repeat(GRID_COLUMNS - row.size) { Spacer(modifier = Modifier.weight(1f)) }
            }
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun ServiceTileCard(tile: ServiceTile, modifier: Modifier = Modifier, onClick: () -> Unit) {
    val dark = isSystemInDarkTheme()
    Card(
        modifier = modifier,
        onClick = onClick,
        shape = RoundedCornerShape(18.dp),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
        elevation = CardDefaults.cardElevation(defaultElevation = 1.dp),
    ) {
        Box(modifier = Modifier.fillMaxWidth()) {
            Column(modifier = Modifier.padding(12.dp)) {
                // Placeholder illustration: a tinted rounded square with a core Material icon.
                Box(
                    modifier = Modifier
                        .size(54.dp)
                        .clip(RoundedCornerShape(16.dp))
                        .background(tile.accent.copy(alpha = if (dark) 0.24f else 0.14f)),
                    contentAlignment = Alignment.Center,
                ) {
                    Icon(
                        imageVector = tile.icon,
                        contentDescription = null,
                        tint = if (dark) lerp(tile.accent, Color.White, 0.35f) else tile.accent,
                        modifier = Modifier.size(28.dp),
                    )
                }
                Spacer(modifier = Modifier.height(10.dp))
                Text(
                    text = stringResource(tile.titleRes),
                    style = MaterialTheme.typography.titleMedium,
                    maxLines = 1,
                )
                tile.subtitleRes?.let { subtitleRes ->
                    Text(
                        text = stringResource(subtitleRes),
                        style = MaterialTheme.typography.labelSmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        maxLines = 2,
                    )
                }
            }

            if (tile.comingSoon) {
                ComingSoonBadge(
                    modifier = Modifier
                        .align(Alignment.TopEnd)
                        .padding(8.dp),
                )
            }
        }
    }
}

/** The one and only "Скоро" badge, so the promise looks the same everywhere. */
@Composable
fun ComingSoonBadge(modifier: Modifier = Modifier) {
    StatusChip(status = stringResource(R.string.status_soon), modifier = modifier)
}

/**
 * Three slides with three dots. The dots are real: they follow [HorizontalPager], they are
 * not painted decoration.
 *
 * The pager is opted into explicitly — it is still marked experimental in this Compose
 * version, and no dependency is added for it (foundation is already on the classpath).
 */
@OptIn(ExperimentalFoundationApi::class)
@Composable
private fun BannerCarousel(modifier: Modifier = Modifier) {
    val pages = listOf(
        R.string.home_banner_first_title to R.string.home_banner_first_body,
        R.string.home_banner_second_title to R.string.home_banner_second_body,
        R.string.home_banner_third_title to R.string.home_banner_third_body,
    )
    val pagerState = rememberPagerState(pageCount = { pages.size })

    Column(modifier = modifier.fillMaxWidth()) {
        HorizontalPager(
            state = pagerState,
            modifier = Modifier
                .fillMaxWidth()
                .height(BANNER_HEIGHT),
            pageSpacing = 10.dp,
        ) { page ->
            BannerCard(titleRes = pages[page].first, bodyRes = pages[page].second)
        }

        Spacer(modifier = Modifier.height(10.dp))

        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.Center,
            verticalAlignment = Alignment.CenterVertically,
        ) {
            pages.indices.forEach { index ->
                Box(
                    modifier = Modifier
                        .padding(horizontal = 3.dp)
                        .size(7.dp)
                        .clip(CircleShape)
                        .background(
                            if (index == pagerState.currentPage) {
                                MaterialTheme.colorScheme.primary
                            } else {
                                MaterialTheme.colorScheme.surfaceVariant
                            },
                        ),
                )
            }
        }
    }
}

@Composable
private fun BannerCard(@StringRes titleRes: Int, @StringRes bodyRes: Int, modifier: Modifier = Modifier) {
    Box(
        modifier = modifier
            .fillMaxWidth()
            .height(BANNER_HEIGHT)
            .clip(RoundedCornerShape(20.dp))
            .background(
                Brush.linearGradient(
                    listOf(
                        MaterialTheme.colorScheme.primary,
                        MaterialTheme.colorScheme.secondary,
                    ),
                ),
            ),
    ) {
        // A translucent circle keeps the card from looking empty without any image asset.
        Box(
            modifier = Modifier
                .align(Alignment.TopEnd)
                .offset(x = 26.dp, y = (-26).dp)
                .size(112.dp)
                .clip(CircleShape)
                .background(Color.White.copy(alpha = 0.12f)),
        )
        Column(
            modifier = Modifier
                .align(Alignment.BottomStart)
                .padding(18.dp),
        ) {
            Text(
                text = stringResource(titleRes),
                style = MaterialTheme.typography.titleMedium,
                fontWeight = FontWeight.Bold,
                color = Color.White,
            )
            Spacer(modifier = Modifier.height(6.dp))
            Text(
                text = stringResource(bodyRes),
                style = MaterialTheme.typography.bodyMedium,
                color = Color.White.copy(alpha = 0.9f),
            )
        }
    }
}

/** The bell sheet. There is no notifications API yet, so it shows the local notices only. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun NoticesSheet(notices: List<HomeNotice>, onDismiss: () -> Unit) {
    ModalBottomSheet(onDismissRequest = onDismiss) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 20.dp)
                .padding(bottom = 28.dp),
        ) {
            Text(
                text = stringResource(R.string.home_notifications),
                style = MaterialTheme.typography.titleMedium,
            )
            Spacer(modifier = Modifier.height(10.dp))
            if (notices.isEmpty()) {
                Text(
                    text = stringResource(R.string.home_notifications_empty),
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    textAlign = TextAlign.Start,
                )
            } else {
                notices.forEach { notice ->
                    Column(modifier = Modifier.fillMaxWidth().padding(vertical = 8.dp)) {
                        Text(text = stringResource(notice.titleRes), style = MaterialTheme.typography.bodyLarge)
                        Spacer(modifier = Modifier.height(2.dp))
                        Text(
                            text = stringResource(notice.bodyRes),
                            style = MaterialTheme.typography.bodyMedium,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
                }
            }
        }
    }
}

private const val GRID_COLUMNS = 2
private val GRID_SPACING = 12.dp
private val BANNER_HEIGHT = 148.dp
