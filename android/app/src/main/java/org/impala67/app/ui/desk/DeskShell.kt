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
import org.impala67.app.ui.shell.ANKI_TAB
import org.impala67.app.ui.shell.CHAT_TAB
import org.impala67.app.ui.shell.ChatRoute
import org.impala67.app.ui.shell.ReviewRoute
import org.impala67.app.ui.shell.SearchRoute
import org.impala67.app.ui.shell.ShellNav
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.gestures.detectHorizontalDragGestures
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.layout.isImeVisible
import androidx.compose.foundation.layout.requiredWidth
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.snapshotFlow
import androidx.compose.ui.input.key.Key
import androidx.compose.ui.input.key.KeyEvent
import androidx.compose.ui.input.key.KeyEventType
import androidx.compose.ui.input.key.isCtrlPressed
import androidx.compose.ui.input.key.isMetaPressed
import androidx.compose.ui.input.key.key
import androidx.compose.ui.input.key.onPreviewKeyEvent
import androidx.compose.ui.input.key.type
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.role
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.zIndex
import kotlinx.coroutines.FlowPreview
import kotlinx.coroutines.flow.debounce
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.launch
import kotlin.math.roundToInt

/**
 * Tablet-Rahmen wie die PWA am Desktop/iPad (`#app`-Raster in css/layout.css): links die Seitenleiste
 * (236 dp, per ☰ einklappbar), in der Mitte Tab-Leiste + Inhalt, rechts das KI-Panel (320 dp). Das Panel
 * startet wie in der PWA eingeklappt (`body.panel-collapsed`); der Sparkles-Knopf unten rechts öffnet es
 * (`#btnAiFab`). Auch im Heft bleiben Seitenleiste und Tabs – wie in der PWA.
 */
/** Rand und Abstand der Karten im Komfortabel-Modus (`--app-gap` in layout.css). */
private val AppGap = 6.dp

@OptIn(ExperimentalLayoutApi::class)
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
    val app = LocalContext.current.applicationContext as ImpalaApp
    val prefs = app.prefs
    val scope = rememberCoroutineScope()
    // Eingeklappt und Breite bleiben über Neustarts (PWA: localStorage `impala67.sidebarCollapsed`, `--sidebar-w`).
    val collapsed by prefs.sidebarCollapsed.collectAsStateWithLifecycle(false)
    val sidebarOpen = !collapsed
    val savedWidth by prefs.sidebarWidth.collectAsStateWithLifecycle(0)
    var dragWidth by remember { mutableStateOf<Dp?>(null) }
    val tabsInSidebar by prefs.tabsInSidebar.collectAsStateWithLifecycle(false)
    val ai: AiChatViewModel = viewModel { AiChatViewModel(store, prefs) }
    // Chat aus der Seitenleiste oder ein neuer Chat klappt das KI-Panel auf.
    val openRequest by ai.openRequests.collectAsStateWithLifecycle()
    LaunchedEffect(openRequest) { if (openRequest > 0) nav.aiPanelOpen = true }
    DeskSession(store, nav)
    val imeOpen = WindowInsets.isImeVisible
    Box(Modifier.fillMaxSize().onPreviewKeyEvent { deskShortcut(it, nav, current) }) {
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
            val standard = if (compact) SidebarWidth else SidebarWidthComfortable
            val width = dragWidth ?: savedWidth.takeIf { it > 0 }?.dp ?: standard
            AnimatedVisibility(sidebarOpen, enter = enter, exit = exit) {
                Row(Modifier.fillMaxHeight()) {
                    DeskSidebar(
                        store, nav, current, ai, tabsInSidebar,
                        Modifier.column(c.sidebar, WindowInsetsSides.Start + WindowInsetsSides.Vertical).width(width),
                    )
                    SidebarResizer(
                        width,
                        onDrag = { dragWidth = it.coerceIn(SidebarMin, SidebarMax) },
                        onDragEnd = { dragWidth?.let { w -> scope.launch { prefs.setSidebarWidth(w.value.roundToInt()) } }; dragWidth = null },
                        onReset = { scope.launch { prefs.setSidebarWidth(0) } },
                        line = compact,
                    )
                }
            }
            var sides = WindowInsetsSides.Vertical
            if (!sidebarOpen) sides += WindowInsetsSides.Start
            if (!nav.aiPanelOpen) sides += WindowInsetsSides.End
            Column(Modifier.weight(1f).fillMaxHeight().column(c.panel, sides)) {
                DeskTabBar(store, nav, canGoBack, tabsInSidebar, onToggleSidebar = { scope.launch { prefs.setSidebarCollapsed(sidebarOpen) } })
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
                        onExpand = {
                            // `#btnChatExpand`: der Chat zieht in einen eigenen Tab, das Panel beginnt neu.
                            val id = ai.chatId.value
                            ai.newChat(reveal = false)
                            nav.aiPanelOpen = false
                            if (id.isEmpty()) nav.openNewChatTab() else nav.openNewTab(ChatRoute(id))
                        },
                        modifier = Modifier.width(AiPanelWidth),
                    )
                }
            }
        }
        // Im Heft sitzt der KI-Knopf rechts oben in den Ecken-Knöpfen (`.heft-chat`) statt unten rechts. Bei offener
        // Tastatur und beim Lernen tritt er zurück (wie das Dock der PWA), damit er weder Eingabe noch Antwortknöpfe verdeckt.
        // Im Chat-Tab ist die KI schon offen.
        if (!nav.aiPanelOpen && !nav.immersive && !imeOpen && current !is ReviewRoute && current !is ChatRoute) {
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

/** Grenzen beim Ziehen der Seitenleiste (`SIDEBAR_W_MIN`/`SIDEBAR_W_MAX` in app-sidebar-events.js). */
private val SidebarMin = 180.dp
private val SidebarMax = 560.dp

/**
 * Breitengriff (`#sidebarResizer`, „Ziehen zum Verbreitern · Doppelklick = Standardbreite“): 12 dp breite
 * Trefferfläche an der Kante; im kompakten Modus mit der Trennlinie in der Mitte, beim Ziehen in Akzentfarbe.
 */
@Composable
private fun SidebarResizer(width: Dp, onDrag: (Dp) -> Unit, onDragEnd: () -> Unit, onReset: () -> Unit, line: Boolean) {
    val c = Impala.colors
    val density = LocalDensity.current
    var active by remember { mutableStateOf(false) }
    val current by rememberUpdatedState(width)
    Box(
        Modifier.fillMaxHeight().width(if (line) 1.dp else 0.dp)
            .background(if (active) c.accent else if (line) c.edgeSoft else Color.Transparent)
            .zIndex(1f),
        contentAlignment = Alignment.Center,
    ) {
        Box(
            Modifier.fillMaxHeight().requiredWidth(12.dp)
                .semantics { contentDescription = "Seitenleiste verbreitern"; role = Role.Button }
                .pointerInput(Unit) { detectTapGestures(onDoubleTap = { onReset() }) }
                .pointerInput(Unit) {
                    var w = 0.dp
                    detectHorizontalDragGestures(
                        onDragStart = { active = true; w = current },
                        onHorizontalDrag = { change, dx ->
                            change.consume()
                            w += with(density) { dx.toDp() }
                            onDrag(w)
                        },
                        onDragEnd = { active = false; onDragEnd() },
                        onDragCancel = { active = false; onDragEnd() },
                    )
                },
        )
    }
}

/**
 * Offene Tabs wie `restoreSession`/`saveSessionSoon` in tabs.js: beim Start aus dem Ereignisprotokoll holen
 * (nur Ziele, die es noch gibt), danach jede Änderung kurz gesammelt zurückschreiben – geräteübergreifend.
 */
@OptIn(FlowPreview::class)
@Composable
private fun DeskSession(store: ImpalaStore, nav: ShellNav) {
    LaunchedEffect(store, nav) {
        val (saved, active) = store.write { core ->
            val ui = core.uiTabs()
            val pages = core.recentPages(UInt.MAX_VALUE).mapTo(HashSet()) { it.id }
            val chats = core.chats().mapTo(HashSet()) { it.id }
            ui.tabs.filter { t -> t == ANKI_TAB || (t.startsWith(CHAT_TAB) && t.removePrefix(CHAT_TAB) in chats) || t in pages } to ui.activeTabId
        }
        nav.restoreSession(saved, active)
        snapshotFlow { nav.tabs.toList() to nav.currentTab }
            .debounce(350)
            .distinctUntilChanged()
            .collect { (tabs, current) ->
                runCatching { store.write { it.setUiTabs(tabs, current ?: tabs.lastOrNull()) } }
            }
    }
}

/**
 * Tastenkürzel am Tablet mit Tastatur (shortcuts.js): Strg/Cmd+K öffnet und schließt die Suche,
 * Escape schließt die Suche bzw. das KI-Panel. Menüs und Dialoge schließen ihr Escape selbst.
 */
private fun deskShortcut(e: KeyEvent, nav: ShellNav, current: NavKey): Boolean {
    if (e.type != KeyEventType.KeyDown) return false
    val search = current == SearchRoute
    return when {
        e.key == Key.K && (e.isCtrlPressed || e.isMetaPressed) -> { if (search) nav.back() else nav.open(SearchRoute); true }
        e.key == Key.Escape && search -> { nav.back(); true }
        e.key == Key.Escape && nav.aiPanelOpen -> { nav.aiPanelOpen = false; true }
        else -> false
    }
}
