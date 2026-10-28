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
import androidx.compose.material3.adaptive.navigation3.ListDetailSceneStrategy
import androidx.compose.material3.adaptive.navigation3.rememberListDetailSceneStrategy
import androidx.compose.material3.adaptive.navigationsuite.NavigationSuiteItem
import androidx.compose.material3.adaptive.currentWindowAdaptiveInfo
import androidx.compose.material3.adaptive.navigationsuite.NavigationSuiteScaffold
import androidx.compose.material3.adaptive.navigationsuite.NavigationSuiteScaffoldDefaults
import androidx.compose.material3.adaptive.navigationsuite.NavigationSuiteType
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.painterResource
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.lifecycle.viewmodel.navigation3.rememberViewModelStoreNavEntryDecorator
import androidx.navigation3.runtime.NavKey
import androidx.navigation3.runtime.entryProvider
import androidx.navigation3.runtime.rememberNavBackStack
import androidx.navigation3.runtime.rememberSaveableStateHolderNavEntryDecorator
import androidx.navigation3.ui.NavDisplay
import kotlinx.coroutines.launch
import org.impala67.app.R
import org.impala67.app.core.ImpalaStore
import org.impala67.app.core.Touches
import org.impala67.app.home.HomeActions
import org.impala67.app.home.HomeScreen
import org.impala67.app.home.HomeViewModel
import org.impala67.app.settings.DevicePrefs
import org.impala67.app.ui.theme.Impala
import java.util.TimeZone

/**
 * Rahmen der App: Navigationsleiste (Telefon) bzw. -schiene (Tablet) aus `NavigationSuiteScaffold`,
 * „+“ als Expressive-FAB-Menü, Inhalt über Navigation 3 mit List-Detail auf breiten Bildschirmen.
 * Zurück (auch die vorausschauende Geste) nimmt das oberste Ziel vom Stapel.
 */
@OptIn(ExperimentalMaterial3Api::class, ExperimentalMaterial3AdaptiveApi::class, ExperimentalMaterial3ExpressiveApi::class)
@Composable
fun AppShell(store: ImpalaStore, prefs: DevicePrefs) {
    val backStack = rememberNavBackStack(HomeRoute)
    val current = backStack.lastOrNull() ?: HomeRoute
    val snackbar = remember { SnackbarHostState() }
    val scope = rememberCoroutineScope()
    val due by remember(store) {
        store.query(Touches.cards) { core ->
            val q = core.studyQueue(null, TimeZone.getDefault().getOffset(System.currentTimeMillis()) / 60_000, false)
            (q.new + q.review + q.learn).toInt()
        }
    }.collectAsStateWithLifecycle()

    // Hauptbereich wechseln: Start bleibt unten liegen, damit „Zurück“ dorthin führt.
    fun go(top: TopLevel) {
        backStack.clear()
        backStack.add(HomeRoute)
        if (top != TopLevel.Home) backStack.add(top.route)
    }
    fun open(key: NavKey) { backStack.add(key) }
    fun create(heft: Boolean) = scope.launch {
        val id = store.write { if (heft) it.createHeft("", null, null) else it.createPage("", "", null, null) }
        open(PageRoute(id))
    }

    // Telefon: „+“ als mittlerer Eintrag der Leiste (wie das Dock der PWA); Tablet: FAB-Menü in der Schiene.
    val suiteType = NavigationSuiteScaffoldDefaults.navigationSuiteType(currentWindowAdaptiveInfo())
    val bar = suiteType == NavigationSuiteType.NavigationBar || suiteType == NavigationSuiteType.ShortNavigationBarCompact ||
        suiteType == NavigationSuiteType.ShortNavigationBarMedium
    var newSheet by rememberSaveable { mutableStateOf(false) }

    NavigationSuiteScaffold(
        navigationSuiteType = suiteType,
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
                    onClick = { go(top) },
                    icon = { Icon(painterResource(top.icon), null) },
                    label = { Text(top.label) },
                    badge = (due ?: 0).takeIf { top == TopLevel.Study && it > 0 }?.let { n -> { Badge { Text("$n") } } },
                )
            }
        },
        primaryActionContent = { if (!bar) NewMenu(onNote = { create(heft = false) }, onHeft = { create(heft = true) }) },
        primaryActionContentHorizontalAlignment = Alignment.CenterHorizontally,
        containerColor = Impala.colors.panel,
    ) {
        Scaffold(
            topBar = {
                TopAppBar(
                    title = { Text(current.topLevel().label) },
                    navigationIcon = {
                        if (backStack.size > 1 && current != current.topLevel().route) {
                            IconButton({ backStack.removeLastOrNull() }, shapes = IconButtonDefaults.shapes()) {
                                Icon(painterResource(R.drawable.ic_i_chevron_left), "Zurück")
                            }
                        }
                    },
                    actions = {
                        IconButton({ open(SearchRoute) }, shapes = IconButtonDefaults.shapes()) { Icon(painterResource(R.drawable.ic_i_search), "Suchen") }
                        IconButton({ open(AiRoute) }, shapes = IconButtonDefaults.shapes()) { Icon(painterResource(R.drawable.ic_i_sparkles), "KI-Assistent") }
                    },
                    colors = TopAppBarDefaults.topAppBarColors(containerColor = Impala.colors.panel),
                )
            },
            snackbarHost = { SnackbarHost(snackbar) },
            containerColor = Impala.colors.panel,
        ) { padding ->
            NavDisplay(
                backStack = backStack,
                modifier = Modifier.padding(padding),
                onBack = { backStack.removeLastOrNull() },
                entryDecorators = listOf(rememberSaveableStateHolderNavEntryDecorator(), rememberViewModelStoreNavEntryDecorator()),
                sceneStrategies = listOf(rememberListDetailSceneStrategy()),
                entryProvider = entryProvider {
                    entry<HomeRoute> {
                        HomeScreen(
                            viewModel { HomeViewModel(store, prefs) },
                            HomeActions(
                                openPage = { open(PageRoute(it)) },
                                newPage = { create(heft = false) },
                                study = { go(TopLevel.Study) },
                                settings = { open(SettingsRoute("home")) },
                                conflicts = { open(ConflictsRoute) },
                                toast = { scope.launch { snackbar.showSnackbar(it) } },
                            ),
                        )
                    }
                    entry<NotesRoute>(metadata = ListDetailSceneStrategy.listPane(detailPlaceholder = {
                        Placeholder("Keine Seite gewählt", "Wähle links eine Seite.")
                    })) { Placeholder("Notizen", "Seitenbaum und Notizliste folgen (mobile-notes.js, Seitenleiste).") }
                    entry<PageRoute>(metadata = ListDetailSceneStrategy.detailPane()) { key -> PagePlaceholder(store, key.id) }
                    entry<StudyRoute> { Placeholder("Lernen", "Stapel und Lernmodus folgen (render-anki.js).") }
                    entry<MoreRoute> { Placeholder("Mehr", "Bibliothek, Graph, Archiv, Papierkorb, Einstellungen folgen.") }
                    entry<SearchRoute> { Placeholder("Suche", "Volltextsuche folgt (search.js → ImpalaCore.search).") }
                    entry<AiRoute> { Placeholder("KI-Assistent", "Chat folgt (ai.js → Rust-KI im Kern).") }
                    entry<SettingsRoute> { Placeholder("Einstellungen", "Folgt (settings.js).") }
                    entry<ConflictsRoute> { Placeholder("Sync-Konflikte", "Konfliktlöser folgt (ImpalaCore.conflicts).") }
                },
            )
        }
    }
    if (newSheet) NewSheet(onNote = { create(heft = false) }, onHeft = { create(heft = true) }) { newSheet = false }
}
