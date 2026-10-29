package org.impala67.app.ui.desk

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.expandHorizontally
import androidx.compose.animation.shrinkHorizontally
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.foundation.layout.width
import androidx.compose.material3.FloatingActionButton
import androidx.compose.material3.Icon
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.VerticalDivider
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.res.painterResource
import androidx.navigation3.runtime.NavKey
import org.impala67.app.R
import org.impala67.app.core.ImpalaStore
import org.impala67.app.ui.theme.Impala
import org.impala67.app.ui.theme.Space
import org.impala67.app.ui.shell.ShellNav

/** Ab dieser Breite ist das KI-Panel beim Start offen (Seitenleiste + Inhalt + Panel passen nebeneinander). */
private const val AI_OPEN_MIN_WIDTH_DP = 1000

/**
 * Tablet-Rahmen wie die PWA am Desktop/iPad (`#app`-Raster in css/layout.css): links die Seitenleiste
 * (260 dp), in der Mitte Tab-Leiste + Inhalt, rechts das einklappbare KI-Panel (340 dp); eingeklappt
 * öffnet der Sparkles-Knopf unten rechts es wieder (`#btnAiFab`). Im Heft (immersiv) nur der Inhalt.
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
    // Auf schmalen Fenstern (Telefon quer) startet das KI-Panel eingeklappt, damit der Inhalt Platz hat.
    val roomy = LocalConfiguration.current.screenWidthDp >= AI_OPEN_MIN_WIDTH_DP
    var aiOpen by rememberSaveable { mutableStateOf(roomy) }
    val chrome = !nav.immersive
    Box(Modifier.fillMaxSize()) {
        Row(Modifier.fillMaxSize().then(if (chrome) Modifier.safeDrawingPadding() else Modifier)) {
            if (chrome) {
                DeskSidebar(store, nav, current, Modifier.width(SidebarWidth))
                VerticalDivider(color = c.edgeSoft)
            }
            Column(Modifier.weight(1f).fillMaxHeight()) {
                if (chrome) DeskTabBar(store, nav, canGoBack)
                content(Modifier.weight(1f))
            }
            AnimatedVisibility(chrome && aiOpen, enter = expandHorizontally(), exit = shrinkHorizontally()) {
                Row {
                    VerticalDivider(color = c.edgeSoft)
                    DeskAiPanel(onClose = { aiOpen = false }, onLater = { nav.toast("$it folgt mit dem KI-Modul.") }, modifier = Modifier.width(AiPanelWidth))
                }
            }
        }
        if (chrome && !aiOpen) {
            FloatingActionButton(
                onClick = { aiOpen = true },
                modifier = Modifier.align(Alignment.BottomEnd).safeDrawingPadding().padding(Space.s5),
                containerColor = c.accent,
                contentColor = c.onAccent,
            ) { Icon(painterResource(R.drawable.ic_i_sparkles), "KI öffnen") }
        }
        SnackbarHost(snackbar, Modifier.align(Alignment.BottomCenter).safeDrawingPadding())
    }
}
