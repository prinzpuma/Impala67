package org.impala67.app.ui.desk

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.EnterTransition
import androidx.compose.animation.ExitTransition
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.ui.graphics.Color
import org.impala67.app.ui.theme.Radius
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
import androidx.compose.foundation.layout.union
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.compositeOver
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.unit.dp
import org.impala67.app.settings.SettingsDialog
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
import org.impala67.app.ui.shell.ShellNav

/**
 * Tablet-Rahmen wie die PWA am Desktop/iPad (`#app`-Raster in css/layout.css): links die Seitenleiste
 * (236 dp, per ☰ einklappbar), in der Mitte Tab-Leiste + Inhalt, rechts das KI-Panel (320 dp). Das Panel
 * startet wie in der PWA eingeklappt (`body.panel-collapsed`); der Sparkles-Knopf unten rechts öffnet es
 * (`#btnAiFab`). Auch im Heft bleiben Seitenleiste und Tabs – wie in der PWA.
 */
/** Rand und Abstand der Karten im Komfortabel-Modus (`--app-gap` in layout.css). */
private val AppGap = 6.dp

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
        // Kompakt (`body.density-compact`, Standard): Spalten randlos bis an die Kante, getrennt durch Linien.
        // Komfortabel: dunkler App-Hintergrund, Spalten als abgerundete Karten mit gleichem Rand und Abstand
        // (`--app-gap` in layout.css); der Rand wächst nur, wo Systemleisten oder Kamera-Loch mehr verlangen.
        val compact = Impala.appearance.compact
        val motion = !Impala.appearance.reduceMotion
        val enter = if (motion) expandHorizontally() else EnterTransition.None
        val exit = if (motion) shrinkHorizontally() else ExitTransition.None
        val card = RoundedCornerShape(Radius.lg)
        fun Modifier.column(color: Color, sides: WindowInsetsSides) =
            if (compact) background(color).windowInsetsPadding(safe.only(sides))
            else clip(card).border(1.dp, c.edgeSoft, card).background(color)
        // Kompakt: Hintergrund hinter den Trennlinien, sonst scheint durch die halbtransparente Linie das helle Fenster.
        val outer = if (compact) Modifier.fillMaxSize().background(c.panel)
        else Modifier.fillMaxSize().background(c.bg0).windowInsetsPadding(safe.union(WindowInsets(AppGap, AppGap, AppGap, AppGap)))
        Row(outer, horizontalArrangement = Arrangement.spacedBy(if (compact) 0.dp else AppGap)) {
            AnimatedVisibility(sidebarOpen, enter = enter, exit = exit) {
                Row(Modifier.fillMaxHeight()) {
                    DeskSidebar(
                        store, nav, current, ai,
                        Modifier.column(c.sidebar, WindowInsetsSides.Start + WindowInsetsSides.Vertical)
                            .width(if (compact) SidebarWidth else SidebarWidthComfortable),
                    )
                    if (compact) VerticalDivider(color = c.edgeSoft)
                }
            }
            var sides = WindowInsetsSides.Vertical
            if (!sidebarOpen) sides += WindowInsetsSides.Start
            if (!nav.aiPanelOpen) sides += WindowInsetsSides.End
            Column(Modifier.weight(1f).fillMaxHeight().column(c.panel, sides)) {
                DeskTabBar(store, nav, canGoBack, onToggleSidebar = { sidebarOpen = !sidebarOpen })
                content(Modifier.weight(1f))
            }
            AnimatedVisibility(nav.aiPanelOpen, enter = enter, exit = exit) {
                Row(Modifier.fillMaxHeight().column(c.panel, WindowInsetsSides.End + WindowInsetsSides.Vertical)) {
                    if (compact) VerticalDivider(color = c.edgeSoft)
                    DeskAiPanel(
                        ai = ai,
                        activePageId = nav.currentPageId,
                        onOpenSettings = { nav.action("settings") },
                        onClose = { nav.aiPanelOpen = false },
                        modifier = Modifier.width(AiPanelWidth),
                    )
                }
            }
        }
        // Im Heft sitzt der KI-Knopf rechts oben in den Ecken-Knöpfen (`.heft-chat`) statt unten rechts.
        if (!nav.aiPanelOpen && !nav.immersive) {
            // `#btnAiFab`: 42-dp-Kreis mit Akzent-Tönung, 22 dp vom Rand.
            Box(
                Modifier.align(Alignment.BottomEnd).safeDrawingPadding().padding(22.dp).size(42.dp).clip(CircleShape)
                    .background(c.tint2.compositeOver(c.panel)).border(1.dp, c.accentBorder, CircleShape)
                    .clickable(onClickLabel = "KI öffnen", role = Role.Button) { nav.aiPanelOpen = true },
                contentAlignment = Alignment.Center,
            ) { Icon(painterResource(R.drawable.ic_i_sparkles), "KI öffnen", Modifier.size(18.dp), tint = c.text) }
        }
        nav.settingsSection?.let { section ->
            SettingsDialog(
                section, store, app.prefs,
                onSection = { nav.settingsSection = it },
                onDismiss = { nav.settingsSection = null },
                toast = nav::toast,
            )
        }
        SnackbarHost(snackbar, Modifier.align(Alignment.BottomCenter).safeDrawingPadding())
    }
}
