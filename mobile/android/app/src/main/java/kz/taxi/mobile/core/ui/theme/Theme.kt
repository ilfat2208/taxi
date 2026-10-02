package kz.taxi.mobile.core.ui.theme

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Typography
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.sp

private val TaxiBlue = Color(0xFF1F5FA9)
private val TaxiBlueDark = Color(0xFF164A85)
private val TaxiTeal = Color(0xFF0E7C7B)
private val TaxiAmber = Color(0xFFB26A00)
private val TaxiRed = Color(0xFFB3261E)

/** Semantic status colours, shared by every screen so a status always looks the same. */
object TaxiColors {
    val positive = Color(0xFF1B7F4B)
    val negative = TaxiRed
    val pending = TaxiAmber
    val neutral = Color(0xFF5A6472)
}

private val LightColors = lightColorScheme(
    primary = TaxiBlue,
    onPrimary = Color.White,
    primaryContainer = Color(0xFFD6E3F5),
    onPrimaryContainer = Color(0xFF0A2540),
    secondary = TaxiTeal,
    onSecondary = Color.White,
    error = TaxiRed,
    onError = Color.White,
    background = Color(0xFFF5F6F8),
    onBackground = Color(0xFF1A1C1E),
    surface = Color.White,
    onSurface = Color(0xFF1A1C1E),
    surfaceVariant = Color(0xFFE7EAEF),
    onSurfaceVariant = Color(0xFF44474E),
)

private val DarkColors = darkColorScheme(
    primary = Color(0xFF9DC3F0),
    onPrimary = Color(0xFF00325A),
    primaryContainer = TaxiBlueDark,
    onPrimaryContainer = Color(0xFFD6E3F5),
    secondary = Color(0xFF6FD3D2),
    onSecondary = Color(0xFF00302F),
    error = Color(0xFFF2B8B5),
    onError = Color(0xFF601410),
    background = Color(0xFF121417),
    onBackground = Color(0xFFE3E2E6),
    surface = Color(0xFF1B1E22),
    onSurface = Color(0xFFE3E2E6),
    surfaceVariant = Color(0xFF44474E),
    onSurfaceVariant = Color(0xFFC4C6CF),
)

private val TaxiTypography = Typography(
    headlineSmall = TextStyle(fontSize = 24.sp, fontWeight = FontWeight.SemiBold),
    titleLarge = TextStyle(fontSize = 20.sp, fontWeight = FontWeight.SemiBold),
    titleMedium = TextStyle(fontSize = 16.sp, fontWeight = FontWeight.Medium),
    bodyLarge = TextStyle(fontSize = 16.sp),
    bodyMedium = TextStyle(fontSize = 14.sp),
    labelLarge = TextStyle(fontSize = 14.sp, fontWeight = FontWeight.Medium),
    labelSmall = TextStyle(fontSize = 12.sp),
)

@Composable
fun TaxiTheme(
    darkTheme: Boolean = isSystemInDarkTheme(),
    content: @Composable () -> Unit,
) {
    MaterialTheme(
        colorScheme = if (darkTheme) DarkColors else LightColors,
        typography = TaxiTypography,
        content = content,
    )
}
