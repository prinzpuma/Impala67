package org.impala67.app

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.ExperimentalMaterial3ExpressiveApi
import androidx.compose.material3.LoadingIndicator
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.SideEffect
import androidx.compose.ui.platform.LocalView
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat
import org.impala67.app.settings.AccentColor
import org.impala67.app.settings.Density
import org.impala67.app.settings.FontScale
import org.impala67.app.settings.ThemeMode
import org.impala67.app.ui.theme.Appearance
import org.impala67.app.settings.resolve
import androidx.compose.runtime.produceState
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.core.splashscreen.SplashScreen.Companion.installSplashScreen
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import org.impala67.app.core.ImpalaStore
import org.impala67.app.ui.shell.AppShell
import org.impala67.app.ui.theme.ImpalaTheme

/** Einzige Activity: Compose von Rand zu Rand, Startbild bis der Kern geladen ist. */
class MainActivity : ComponentActivity() {
    @OptIn(ExperimentalMaterial3ExpressiveApi::class)
    override fun onCreate(savedInstanceState: Bundle?) {
        val app = application as ImpalaApp
        installSplashScreen().setKeepOnScreenCondition { !app.store.isCompleted }
        enableEdgeToEdge()
        super.onCreate(savedInstanceState)
        setContent {
            val mode by app.prefs.themeMode.collectAsState(ThemeMode.SYSTEM)
            val accent by app.prefs.accent.collectAsState(AccentColor.WALLPAPER)
            val dark = if (mode == ThemeMode.SYSTEM) isSystemInDarkTheme() else mode == ThemeMode.DARK
            // Statusleisten-Symbole folgen dem App-Design, nicht dem System (sonst dunkel auf dunkel).
            val view = LocalView.current
            val hideBars by app.prefs.hideSystemBars.collectAsState(true)
            SideEffect {
                WindowCompat.getInsetsController(window, view).apply {
                    isAppearanceLightStatusBars = !dark
                    isAppearanceLightNavigationBars = !dark
                    // Vollbild: Leisten weg, die App nutzt die ganze Höhe; Wischen vom Rand blendet sie kurz ein.
                    systemBarsBehavior = WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
                    if (hideBars) hide(WindowInsetsCompat.Type.systemBars()) else show(WindowInsetsCompat.Type.systemBars())
                }
            }
            val density by app.prefs.density.collectAsState(Density.COMPACT)
            val fontScale by app.prefs.fontScale.collectAsState(FontScale.NORMAL)
            val reduceMotion by app.prefs.reduceMotion.collectAsState(false)
            val haptics by app.prefs.nativeHaptics.collectAsState(true)
            ImpalaTheme(
                dark = dark,
                accent = accent.resolve(dark),
                fontScale = fontScale.factor,
                appearance = Appearance(compact = density == Density.COMPACT, reduceMotion = reduceMotion),
                haptics = haptics,
            ) {
                val store by produceState<ImpalaStore?>(null) { value = app.store.await() }
                store?.let { AppShell(it, app.prefs) }
                    ?: Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) { LoadingIndicator() }
            }
        }
    }

    /** Sichtbar: Live-Sync verbinden und nachholen, was auf anderen Geräten geändert wurde. */
    override fun onStart() {
        super.onStart()
        val app = application as ImpalaApp
        app.cloudSync.onForeground()
        app.drive.onForeground()
    }

    /** Start-Schnappschuss beim Wechsel in den Hintergrund: der nächste Start spielt weniger Events ab. */
    override fun onStop() {
        super.onStop()
        val app = application as ImpalaApp
        app.cloudSync.onBackground()
        app.drive.onBackground()
        if (app.store.isCompleted) app.scope.launch(Dispatchers.IO) { runCatching { app.store.await().core.saveCheckpoint() } }
    }
}
