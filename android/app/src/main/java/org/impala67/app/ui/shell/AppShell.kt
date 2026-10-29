package org.impala67.app.ui.shell

import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Badge
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.ExperimentalMaterial3ExpressiveApi
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.IconButtonDefaults
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.material3.adaptive.ExperimentalMaterial3AdaptiveApi
import androidx.compose.material3.adaptive.currentWindowAdaptiveInfoV2
import androidx.compose.material3.adaptive.navigation3.rememberListDetailSceneStrategy
import androidx.compose.material3.adaptive.navigationsuite.NavigationSuiteItem
import androidx.compose.material3.adaptive.navigationsuite.NavigationSuiteScaffold
import androidx.compose.material3.adaptive.navigationsuite.NavigationSuiteScaffoldDefaults
import androidx.compose.material3.adaptive.navigationsuite.NavigationSuiteType
import androidx.compose.runtime.Composable
import androidx.compose.runtime.SideEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.res.painterResource
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.navigation3.rememberViewModelStoreNavEntryDecorator
import androidx.navigation3.runtime.entryProvider
import androidx.navigation3.runtime.rememberNavBackStack
import androidx.navigation3.runtime.rememberSaveableStateHolderNavEntryDecorator
import androidx.navigation3.ui.NavDisplay
import org.impala67.app.R
import org.impala67.app.core.ImpalaStore
import org.impala67.app.core.Touches
import org.impala67.app.settings.DevicePrefs
import org.impala67.app.ui.desk.DeskShell
import org.impala67.app.ui.theme.Impala
import java.util.TimeZone

/** Ab dieser Fensterbreite (Material „expanded“) gilt das Tablet-Layout der PWA ([DeskShell]). */
private const val DESK_MIN_WIDTH_DP = 840

/**
 * Rahmen der App – auf breiten Fenstern (Tablet) das Desktop-Layout der PWA ([DeskShell]), sonst: Navigationsleiste (Telefon) bzw. -schiene (Tablet) aus `NavigationSuiteScaffold`,
 * „+“ als Leisteneintrag (Telefon) bzw. Expressive-FAB-Menü (Tablet), Inhalt über Navigation 3 mit
 * List-Detail auf breiten Bildschirmen (Ziele: [appEntries]). Zurück nimmt das oberste Ziel vom Stapel.
 */
@OptIn(ExperimentalMaterial3Api::class, ExperimentalMaterial3AdaptiveApi::class, ExperimentalMaterial3ExpressiveApi::class)
@Composable
fun AppShell(store: ImpalaStore, prefs: DevicePrefs) {
    val backStack = rememberNavBackStack(HomeRoute)
    val current = backStack.lastOrNull() ?: HomeRoute
    val snackbar = remember { SnackbarHostState() }
    val scope = rememberCoroutineScope()
    val nav = remember(backStack, store) { ShellNav(backStack, scope, store, snackbar) }
    val due by remember(store) {
        store.query(Touches.cards) { core ->
            val q = core.studyQueue(null, TimeZone.getDefault().getOffset(System.currentTimeMillis()) / 60_000, false)
            (q.new + q.review + q.learn).toInt()
        }
    }.collectAsStateWithLifecycle()

    val suiteType = NavigationSuiteScaffoldDefaults.navigationSuiteType(currentWindowAdaptiveInfoV2())
    val bar = suiteType == NavigationSuiteType.NavigationBar || suiteType == NavigationSuiteType.ShortNavigationBarCompact ||
        suiteType == NavigationSuiteType.ShortNavigationBarMedium
    var newSheet by rememberSaveable { mutableStateOf(false) }

    val content: @Composable (Modifier) -> Unit = { m ->
        NavDisplay(
            backStack = backStack,
            modifier = m,
            onBack = nav::back,
            entryDecorators = listOf(rememberSaveableStateHolderNavEntryDecorator(), rememberViewModelStoreNavEntryDecorator()),
            sceneStrategies = listOf(rememberListDetailSceneStrategy()),
            entryProvider = entryProvider { appEntries(nav, store, prefs) },
        )
    }
    val desk = LocalConfiguration.current.screenWidthDp >= DESK_MIN_WIDTH_DP
    SideEffect { nav.desk = desk }
    if (desk) {
        DeskShell(store, nav, current, canGoBack = backStack.size > 1, snackbar = snackbar, content = content)
        return
    }

    NavigationSuiteScaffold(
        navigationSuiteType = if (nav.immersive) NavigationSuiteType.None else suiteType,
        navigationItems = {
            TopLevel.entries.forEach { top ->
                if (bar && top == TopLevel.Study) {
                    NavigationSuiteItem(
                        selected = false,
                        onClick = { newSheet = true },
                        icon = { Icon(painterResource(R.drawable.ic_i_plus), "Neu") },
                        label = null,
                    )
                }
                NavigationSuiteItem(
                    selected = current.topLevel() == top,
                    onClick = { nav.go(top) },
                    icon = { Icon(painterResource(top.icon), null) },
                    label = { Text(top.label) },
                    badge = (due ?: 0).takeIf { top == TopLevel.Study && it > 0 }?.let { n -> { Badge { Text("$n") } } },
                )
            }
        },
        primaryActionContent = { if (!bar) NewMenu(onNote = { nav.create(heft = false) }, onHeft = { nav.create(heft = true) }) },
        primaryActionContentHorizontalAlignment = Alignment.CenterHorizontally,
        containerColor = Impala.colors.panel,
    ) {
        Scaffold(
            topBar = {
                if (!nav.immersive) TopAppBar(
                    title = { Text(current.title()) },
                    navigationIcon = {
                        if (backStack.size > 1 && current != current.topLevel().route) {
                            IconButton(nav::back, shapes = IconButtonDefaults.shapes()) {
                                Icon(painterResource(R.drawable.ic_i_chevron_left), "Zurück")
                            }
                        }
                    },
                    actions = {
                        IconButton({ nav.open(SearchRoute) }, shapes = IconButtonDefaults.shapes()) { Icon(painterResource(R.drawable.ic_i_search), "Suchen") }
                        IconButton({ nav.open(AiRoute) }, shapes = IconButtonDefaults.shapes()) { Icon(painterResource(R.drawable.ic_i_sparkles), "KI-Assistent") }
                    },
                    colors = TopAppBarDefaults.topAppBarColors(containerColor = Impala.colors.panel),
                )
            },
            snackbarHost = { SnackbarHost(snackbar) },
            containerColor = Impala.colors.panel,
        ) { padding ->
            content(Modifier.padding(padding))
        }
    }
    if (newSheet) NewSheet(onNote = { nav.create(heft = false) }, onHeft = { nav.create(heft = true) }) { newSheet = false }
}
