package kz.taxi.mobile.core.ui

import androidx.compose.runtime.staticCompositionLocalOf
import kz.taxi.mobile.AppContainer

/** The dependency container, provided once by `MainActivity`. */
val LocalAppContainer = staticCompositionLocalOf<AppContainer> {
    error("AppContainer was not provided; wrap the UI in CompositionLocalProvider(LocalAppContainer provides container)")
}
