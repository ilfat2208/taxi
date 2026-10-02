package kz.taxi.mobile.feature.home

import androidx.annotation.StringRes
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.Send
import androidx.compose.material.icons.filled.AccountBox
import androidx.compose.material.icons.filled.Build
import androidx.compose.material.icons.filled.Email
import androidx.compose.material.icons.filled.Home
import androidx.compose.material.icons.filled.LocationOn
import androidx.compose.material.icons.filled.Person
import androidx.compose.material.icons.filled.Share
import androidx.compose.material.icons.filled.ShoppingCart
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import kz.taxi.mobile.R

/**
 * Every service of the ORTA super-app that is visible on the home screen.
 *
 * [QR] is not a tile: it is the "show my QR" quick action, which reuses the same placeholder
 * screen. It lives here so one lookup serves both the grid and the navigation layer.
 */
enum class ServiceKey { TAXI, CARGO, MARKET, HOME, SERVICES, BUILD, DELIVERY, BUSINESS, QR }

/**
 * A tile of the home grid.
 *
 * The illustration is deliberately a placeholder: `material-icons-extended` is **not** a
 * dependency (see `gradle/libs.versions.toml`), so each tile draws a core Material icon on a
 * tinted rounded square. Nothing is downloaded — there are no image assets in the app.
 */
data class ServiceTile(
    val key: ServiceKey,
    @StringRes val titleRes: Int,
    @StringRes val subtitleRes: Int? = null,
    /** One-line explanation, shown by [kz.taxi.mobile.feature.comingsoon.ComingSoonScreen]. */
    @StringRes val messageRes: Int,
    val icon: ImageVector,
    val accent: Color,
    /** `true` when the vertical does not exist yet and the tile is only a promise. */
    val comingSoon: Boolean,
)

/**
 * The catalog behind the home grid. Accent colours are literals on purpose: the shared
 * palette in `core/ui/theme/Theme.kt` only names semantic colours, and these are decorative.
 */
object HomeServices {

    val taxi = ServiceTile(
        key = ServiceKey.TAXI,
        titleRes = R.string.service_taxi_title,
        subtitleRes = R.string.service_taxi_subtitle,
        messageRes = R.string.taxi_state_body,
        icon = Icons.Filled.LocationOn,
        accent = Color(0xFF1F5FA9),
        comingSoon = false,
    )

    val cargo = ServiceTile(
        key = ServiceKey.CARGO,
        titleRes = R.string.service_cargo_title,
        subtitleRes = R.string.service_cargo_subtitle,
        messageRes = R.string.service_cargo_message,
        icon = Icons.AutoMirrored.Filled.Send,
        accent = Color(0xFF0E7C7B),
        comingSoon = true,
    )

    val market = ServiceTile(
        key = ServiceKey.MARKET,
        titleRes = R.string.service_market_title,
        subtitleRes = R.string.service_market_subtitle,
        messageRes = R.string.service_market_subtitle,
        icon = Icons.Filled.ShoppingCart,
        accent = Color(0xFF1B7F4B),
        comingSoon = false,
    )

    val home = ServiceTile(
        key = ServiceKey.HOME,
        titleRes = R.string.service_home_title,
        subtitleRes = R.string.service_home_subtitle,
        messageRes = R.string.service_home_message,
        icon = Icons.Filled.Home,
        accent = Color(0xFF6A4FA3),
        comingSoon = true,
    )

    val services = ServiceTile(
        key = ServiceKey.SERVICES,
        titleRes = R.string.service_services_title,
        subtitleRes = R.string.service_services_subtitle,
        messageRes = R.string.service_services_message,
        icon = Icons.Filled.Person,
        accent = Color(0xFFB26A00),
        comingSoon = true,
    )

    val build = ServiceTile(
        key = ServiceKey.BUILD,
        titleRes = R.string.service_build_title,
        subtitleRes = R.string.service_build_subtitle,
        messageRes = R.string.service_build_message,
        icon = Icons.Filled.Build,
        accent = Color(0xFF8D5B2B),
        comingSoon = true,
    )

    val delivery = ServiceTile(
        key = ServiceKey.DELIVERY,
        titleRes = R.string.service_delivery_title,
        subtitleRes = R.string.service_delivery_subtitle,
        messageRes = R.string.service_delivery_message,
        icon = Icons.Filled.Email,
        accent = Color(0xFF0F6E8C),
        comingSoon = true,
    )

    val business = ServiceTile(
        key = ServiceKey.BUSINESS,
        titleRes = R.string.service_business_title,
        subtitleRes = R.string.service_business_subtitle,
        messageRes = R.string.service_business_message,
        icon = Icons.Filled.AccountBox,
        accent = Color(0xFF44474E),
        comingSoon = true,
    )

    /** The QR quick action: honest placeholder, so it wears the "Скоро" badge as well. */
    val qr = ServiceTile(
        key = ServiceKey.QR,
        titleRes = R.string.quick_action_qr,
        messageRes = R.string.quick_action_qr_message,
        icon = Icons.Filled.Share,
        accent = Color(0xFF1F5FA9),
        comingSoon = true,
    )

    /** The order of this list is the order of the grid, two tiles per row. */
    val tiles: List<ServiceTile> = listOf(
        taxi, cargo, market, home, services, build, delivery, business,
    )

    private val index: Map<ServiceKey, ServiceTile> = (tiles + qr).associateBy { it.key }

    fun byKey(key: ServiceKey): ServiceTile = index.getValue(key)
}
