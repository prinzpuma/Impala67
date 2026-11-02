package org.impala67.app.ui.shell

import androidx.compose.material3.adaptive.ExperimentalMaterial3AdaptiveApi
import androidx.compose.material3.adaptive.navigation3.ListDetailSceneStrategy
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.navigation3.runtime.EntryProviderScope
import androidx.navigation3.runtime.NavKey
import org.impala67.app.ai.AiChatViewModel
import org.impala67.app.ai.ChatView
import org.impala67.app.core.ImpalaStore
import org.impala67.app.heft.HeftThumbnail
import org.impala67.app.home.HomeActions
import org.impala67.app.home.HomeScreen
import org.impala67.app.home.HomeViewModel
import org.impala67.app.library.LibraryScreen
import org.impala67.app.more.MoreScreen
import org.impala67.app.notes.ArchiveScreen
import org.impala67.app.notes.NotesScreen
import org.impala67.app.notes.TrashScreen
import org.impala67.app.search.SearchScreen
import org.impala67.app.settings.DevicePrefs
import org.impala67.app.settings.SettingsSection
import org.impala67.app.settings.SettingsSections
import org.impala67.app.study.CardBrowserScreen
import org.impala67.app.sync.ConflictsScreen
import org.impala67.app.study.ReviewScreen
import org.impala67.app.study.StudyScreen

/** Alle Ziele der App: welche Route welchen Bildschirm zeigt und in welchem Bereich (Liste/Detail). */
@OptIn(ExperimentalMaterial3AdaptiveApi::class)
fun EntryProviderScope<NavKey>.appEntries(nav: ShellNav, store: ImpalaStore, prefs: DevicePrefs) {
    entry<HomeRoute> {
        HomeScreen(
            viewModel { HomeViewModel(store, prefs) },
            HomeActions(
                openPage = { nav.open(PageRoute(it)) },
                newPage = { nav.askNewPage() },
                study = { nav.go(TopLevel.Study) },
                settings = { nav.openSettings("home") },
                conflicts = { nav.open(ConflictsRoute) },
                toast = nav::toast,
                heftThumbnail = { id, m -> HeftThumbnail(store, id, m) },
            ),
        )
    }
    entry<NotesRoute>(metadata = ListDetailSceneStrategy.listPane(detailPlaceholder = {
        Placeholder("Keine Seite gewählt", "Wähle eine Seite aus der Liste.")
    })) {
        NotesScreen(store, onOpenPage = { nav.open(PageRoute(it)) }, onNewPage = { nav.askNewPage(parentId = it) })
    }
    entry<PageRoute>(metadata = ListDetailSceneStrategy.detailPane()) { PageEntry(store, it.id, nav) }
    entry<StudyRoute> {
        StudyScreen(
            store,
            onStudyDeck = { nav.open(ReviewRoute(it)) },
            onBrowse = { nav.open(CardBrowserRoute(it)) },
            onStudyMixed = { nav.open(ReviewRoute(mix = true)) },
        )
    }
    entry<ReviewRoute> { ReviewScreen(store, it.deck, onExit = nav::back, mix = it.mix) }
    entry<CardBrowserRoute> { CardBrowserScreen(store, it.deck, onBack = nav::back) }
    entry<MoreRoute> { MoreScreen(onAction = nav::action) }
    entry<TrashRoute> { TrashScreen(store, onOpenPage = { nav.open(PageRoute(it)) }) }
    entry<ArchiveRoute> { ArchiveScreen(store, onOpenPage = { nav.open(PageRoute(it)) }) }
    entry<LibraryRoute> { LibraryScreen(store, onOpenPage = { nav.open(PageRoute(it)) }, onToast = nav::toast) }
    entry<SearchRoute> {
        SearchScreen(
            store,
            onOpenPage = { id ->
                val newTab = nav.searchInNewTab
                nav.searchInNewTab = false
                nav.back()
                if (newTab) nav.openNewTab(id) else nav.open(PageRoute(id))
            },
            onAction = { nav.searchInNewTab = false; nav.back(); nav.action(it) },
            onClose = { nav.searchInNewTab = false; nav.back() },
        )
    }
    entry<AiRoute> {
        ChatView(viewModel { AiChatViewModel(store, prefs) }, activePageId = null, onOpenSettings = { nav.action("settings") })
    }
    // Chat im eigenen Tab (Tablet): eigener Verlauf, getrennt vom KI-Panel – ein Chat lebt nur an einer Stelle.
    entry<ChatRoute> { route ->
        ChatView(viewModel { AiChatViewModel(store, prefs).also { it.open(route.id) } }, activePageId = null, onOpenSettings = { nav.action("settings") })
    }
    entry<SettingsRoute>(metadata = ListDetailSceneStrategy.listPane(detailPlaceholder = {
        SettingsSection("overview", store, prefs, nav::toast, onOpen = { nav.open(SettingsSectionRoute(it)) })
    })) { SettingsSections(onOpen = { nav.open(SettingsSectionRoute(it)) }) }
    entry<SettingsSectionRoute>(metadata = ListDetailSceneStrategy.detailPane()) {
        SettingsSection(it.section, store, prefs, nav::toast, onOpen = { s -> nav.open(SettingsSectionRoute(s)) })
    }
    entry<ConflictsRoute> { ConflictsScreen(store, onDone = nav::back) }
}
