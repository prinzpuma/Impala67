package org.impala67.app.ui.shell

import androidx.compose.material3.adaptive.ExperimentalMaterial3AdaptiveApi
import androidx.compose.material3.adaptive.navigation3.ListDetailSceneStrategy
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.navigation3.runtime.EntryProviderScope
import androidx.navigation3.runtime.NavKey
import org.impala67.app.core.ImpalaStore
import org.impala67.app.home.HomeActions
import org.impala67.app.home.HomeScreen
import org.impala67.app.home.HomeViewModel
import org.impala67.app.more.MoreScreen
import org.impala67.app.notes.ArchiveScreen
import org.impala67.app.notes.NotesScreen
import org.impala67.app.notes.TrashScreen
import org.impala67.app.settings.DevicePrefs
import org.impala67.app.settings.SettingsSection
import org.impala67.app.settings.SettingsSections

/** Alle Ziele der App: welche Route welchen Bildschirm zeigt und in welchem Bereich (Liste/Detail). */
@OptIn(ExperimentalMaterial3AdaptiveApi::class)
fun EntryProviderScope<NavKey>.appEntries(nav: ShellNav, store: ImpalaStore, prefs: DevicePrefs) {
    entry<HomeRoute> {
        HomeScreen(
            viewModel { HomeViewModel(store, prefs) },
            HomeActions(
                openPage = { nav.open(PageRoute(it)) },
                newPage = { nav.create(heft = false) },
                study = { nav.go(TopLevel.Study) },
                settings = { nav.open(SettingsRoute); nav.open(SettingsSectionRoute("home")) },
                conflicts = { nav.open(ConflictsRoute) },
                toast = nav::toast,
            ),
        )
    }
    entry<NotesRoute>(metadata = ListDetailSceneStrategy.listPane(detailPlaceholder = {
        Placeholder("Keine Seite gewählt", "Wähle eine Seite aus der Liste.")
    })) {
        NotesScreen(store, onOpenPage = { nav.open(PageRoute(it)) }, onNewPage = { nav.create(heft = false, parentId = it) })
    }
    entry<PageRoute>(metadata = ListDetailSceneStrategy.detailPane()) { PagePlaceholder(store, it.id) }
    entry<StudyRoute> { Placeholder("Lernen", "Stapel und Lernmodus folgen (render-anki.js).") }
    entry<MoreRoute> { MoreScreen(onAction = nav::action) }
    entry<TrashRoute> { TrashScreen(store, onOpenPage = { nav.open(PageRoute(it)) }) }
    entry<ArchiveRoute> { ArchiveScreen(store, onOpenPage = { nav.open(PageRoute(it)) }) }
    entry<SearchRoute> { Placeholder("Suche", "Volltextsuche folgt (search.js → ImpalaCore.search).") }
    entry<AiRoute> { Placeholder("KI-Assistent", "Chat folgt (ai.js → Rust-KI im Kern).") }
    entry<SettingsRoute>(metadata = ListDetailSceneStrategy.listPane(detailPlaceholder = {
        SettingsSection("overview", store, prefs, nav::toast)
    })) { SettingsSections(onOpen = { nav.open(SettingsSectionRoute(it)) }) }
    entry<SettingsSectionRoute>(metadata = ListDetailSceneStrategy.detailPane()) { SettingsSection(it.section, store, prefs, nav::toast) }
    entry<ConflictsRoute> { Placeholder("Sync-Konflikte", "Konfliktlöser folgt (ImpalaCore.conflicts).") }
}
