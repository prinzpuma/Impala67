package org.impala67.app.ui.desk

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.expandHorizontally
import androidx.compose.animation.shrinkHorizontally
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.WindowInsetsSides
import androidx.compose.foundation.layout.only
import androidx.compose.foundation.layout.safeDrawing
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.material3.FloatingActionButton
import androidx.compose.material3.Icon
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.VerticalDivider
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.painterResource
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.navigation3.runtime.NavKey
import org.impala67.app.ImpalaApp
import org.impala67.app.R
import org.impala67.app.ai.AiChatViewModel
import org.impala67.app.core.ImpalaStore
import org.impala67.app.ui.theme.Impala
import org.impala67.app.ui.theme.Space
import org.impala67.app.ui.shell.ShellNav

/**
 * Tablet-Rahmen wie die PWA am Desktop/iPad (`#app`-Raster in css/layout.css): links die Seitenleiste
 * (236 dp, per ☰ einklappbar), in der Mitte Tab-Leiste + Inhalt, rechts das KI-Panel (320 dp). Das Panel
 * startet wie in der PWA eingeklappt (`body.panel-collapsed`); der Sparkles-Knopf unten rechts öffnet es
 * (`#btnAiFab`). Auch im Heft bleiben Seitenleiste und Tabs – wie in der PWA.
 */
@Composable
fun DeskShell(
    store: ImpalaStore,
    nav: ShellNav,
    current: NavKey,
    canGoBack: Boolean,
    snackbar: SnackbarHostState,
    content: @Composable (Modifier) -> Unit,
) {
    val c = Impala.colors
    var sidebarOpen by rememberSaveable { mutableStateOf(true) }
    val app = LocalContext.current.applicationContext as ImpalaApp
    val ai: AiChatViewModel = viewModel { AiChatViewModel(store, app.prefs) }
    // Chat aus der Seitenleiste oder ein neuer Chat klappt das KI-Panel auf.
    val openRequest by ai.openRequests.collectAsStateWithLifecycle()
    LaunchedEffect(openRequest) { if (openRequest > 0) nav.aiPanelOpen = true }
    Box(Modifier.fillMaxSize()) {
        // Jede Spalte malt ihre Fläche bis an den Rand (auch unter Kamera-Loch/Notch im Querformat) und
        // rückt nur ihren Inhalt aus den Systembereichen heraus.
        val safe = WindowInsets.safeDrawing
        Row(Modifier.fillMaxSize()) {
            AnimatedVisibility(sidebarOpen, enter = expandHorizontally(), exit = shrinkHorizontally()) {
                Row(Modifier.fillMaxHeight()) {
                    DeskSidebar(
                        store, nav, current, ai,
                        Modifier.background(c.sidebar).windowInsetsPadding(safe.only(WindowInsetsSides.Start + WindowInsetsSides.Vertical))
                            .width(SidebarWidth),
                    )
                    VerticalDivider(color = c.edgeSoft)
                }
            }
            var sides = WindowInsetsSides.Vertical
            if (!sidebarOpen) sides += WindowInsetsSides.Start
            if (!nav.aiPanelOpen) sides += WindowInsetsSides.End
            Column(Modifier.weight(1f).fillMaxHeight().background(c.panel).windowInsetsPadding(safe.only(sides))) {
                DeskTabBar(store, nav, canGoBack, onToggleSidebar = { sidebarOpen = !sidebarOpen })
                content(Modifier.weight(1f))
            }
            AnimatedVisibility(nav.aiPanelOpen, enter = expandHorizontally(), exit = shrinkHorizontally()) {
                Row(Modifier.background(c.panel)) {
                    VerticalDivider(color = c.edgeSoft)
                    DeskAiPanel(
                        ai = ai,
                        activePageId = nav.currentPageId,
                        onOpenSettings = { nav.action("settings") },
                        onClose = { nav.aiPanelOpen = false },
                        modifier = Modifier.windowInsetsPadding(safe.only(WindowInsetsSides.End + WindowInsetsSides.Vertical)).width(AiPanelWidth),
                    )
                }
            }
        }
        // Im Heft sitzt der KI-Knopf rechts oben in den Ecken-Knöpfen (`.heft-chat`) statt unten rechts.
        if (!nav.aiPanelOpen && !nav.immersive) {
            FloatingActionButton(
                onClick = { nav.aiPanelOpen = true },
                modifier = Modifier.align(Alignment.BottomEnd).safeDrawingPadding().padding(Space.s5),
                containerColor = c.accent,
                contentColor = c.onAccent,
            ) { Icon(painterResource(R.drawable.ic_i_sparkles), "KI öffnen") }
        }
        SnackbarHost(snackbar, Modifier.align(Alignment.BottomCenter).safeDrawingPadding())
    }
}
