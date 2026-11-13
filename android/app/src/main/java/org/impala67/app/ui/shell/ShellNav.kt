package org.impala67.app.ui.shell

import android.content.Context
import androidx.compose.material3.SnackbarHostState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.navigation3.runtime.NavBackStack
import androidx.navigation3.runtime.NavKey
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.launch
import org.impala67.app.core.ImpalaStore
import org.impala67.app.daily.dailyKey
import org.impala67.app.daily.dailyTitle
import org.impala67.app.share.Incoming
import org.impala67.app.share.importSharedFiles
import org.impala67.app.share.importSharedText
import uniffi.impala_ffi.PageKind
import uniffi.impala_ffi.PageSummary

/** Navigation und App-weite Aktionen, die Bildschirme als Callbacks bekommen. */
class ShellNav(
    private val backStack: NavBackStack<NavKey>,
    private val scope: CoroutineScope,
    private val store: ImpalaStore,
    private val snackbar: SnackbarHostState,
) {
    /** Heft offen: Telefon-Shell ohne Leisten (Heft bringt eigene Kopfzeile mit); [desk] behält Leisten, blendet nur den KI-Knopf aus. */
    var immersive by mutableStateOf(false)

    /** Tablet-Layout wie die PWA am Desktop/iPad: Seitenleiste, Tab-Leiste, KI-Panel (`ui/desk/`). */
    var desk by mutableStateOf(false)

    /** KI-Panel rechts offen (nur [desk]; in der PWA `body:not(.panel-collapsed)`), startet zu. */
    var aiPanelOpen by mutableStateOf(false)

    /** Einstellungsfenster offen (nur [desk], wie `.settings-modal-v2`): gewählter Bereich, null = zu. */
    var settingsSection by mutableStateOf<String?>(null)

    /** Einstellungen öffnen: auf dem Tablet als Fenster, auf dem Telefon als Liste (+ Bereich). */
    fun openSettings(section: String? = null) {
        if (desk) { settingsSection = section ?: "overview"; return }
        open(SettingsRoute)
        if (section != null) open(SettingsSectionRoute(section))
    }

    /** Offene Tabs (nur [desk]; in der PWA `S.tabs`): Seiten-IDs, `chat:<id>` und [ANKI_TAB]. */
    val tabs = mutableStateListOf<String>()

    /** Mit „Zurück“ verlassene Ziele für „Vor“ (`S.navHistory` hinter `S.navIndex`); neue Navigation leert sie. */
    private val forwardStack = mutableStateListOf<NavKey>()
    val canGoForward: Boolean get() = forwardStack.isNotEmpty()

    /** Nächste Seitensuche öffnet ihr Ergebnis in einem neuen Tab („In neuem Tab öffnen…“ im „+“-Menü). */
    var searchInNewTab by mutableStateOf(false)

    fun open(key: NavKey) {
        forwardStack.clear()
        if (desk) tabKey(key)?.let { trackTab(it, newTab = false) }
        backStack.add(key)
    }

    /** Seite in einem neuen Tab öffnen (Seiten-⋯ „In neuem Tab öffnen“). */
    fun openNewTab(id: String) = openNewTab(PageRoute(id))

    /** Ziel mit eigenem Tab ([tabKey]) in einem neuen Tab öffnen. */
    fun openNewTab(key: NavKey) {
        forwardStack.clear()
        tabKey(key)?.let { trackTab(it, newTab = true) }
        backStack.add(key)
    }

    /** Neuen Chat in einem eigenen Tab beginnen (`startNewChat({ newTab: true })`); die ID vergibt die App. */
    fun openNewChatTab() = openNewTab(ChatRoute(java.util.UUID.randomUUID().toString()))

    /** Tab antippen: sein Ziel zeigen. */
    fun openTab(tab: String) = open(tabRoute(tab))

    /**
     * Wie `activateTab` in tabs.js: Ist das Ziel schon offen, wird nur sein Tab aktiv; sonst ersetzt es
     * den aktiven Tab (bzw. bekommt einen neuen Tab, wenn keiner aktiv ist). Höchstens 12 Tabs.
     */
    private fun trackTab(tab: String, newTab: Boolean) {
        if (tab in tabs) return
        val i = currentTab?.let(tabs::indexOf) ?: -1
        if (newTab || i < 0) {
            tabs.add(tab)
            if (tabs.size > MAX_TABS) tabs.removeAt(0)
        } else tabs[i] = tab
    }

    /** Tab schließen; war er sichtbar, rückt der Nachbar nach (sonst Start). */
    fun closeTab(tab: String) {
        val i = tabs.indexOf(tab)
        if (i < 0) return
        tabs.removeAt(i)
        if (currentTab != tab) return
        forwardStack.clear()
        backStack.removeAll { tabKey(it) == tab }
        val next = tabs.getOrNull(i) ?: tabs.getOrNull(i - 1)
        if (next != null) backStack.add(tabRoute(next)) else go(TopLevel.Home)
    }

    /** Tab an eine andere Stelle schieben (Tab-Leiste/Seitenleiste: halten und ziehen). */
    fun moveTab(from: Int, to: Int) {
        if (from !in tabs.indices || to !in tabs.indices || from == to) return
        tabs.add(to, tabs.removeAt(from))
    }

    /**
     * Gespeicherte Tabs übernehmen (`restoreSession` in tabs.js), solange noch keiner offen ist; beim
     * frischen Start (nur Start auf dem Stapel) öffnet der aktive Tab – sonst der letzte.
     */
    fun restoreSession(saved: List<String>, active: String?, startLibrary: Boolean = false) {
        if (tabs.isNotEmpty()) return
        tabs.addAll(saved.takeLast(MAX_TABS))
        if (backStack.size == 1 && backStack[0] == HomeRoute) {
            if (startLibrary) {
                org.impala67.app.library.LibraryViewModel.initialMode = org.impala67.app.library.LibraryMode.HEFTE
                backStack.add(LibraryRoute)
            } else if (saved.isNotEmpty()) {
                val show = active?.takeIf { it in tabs } ?: tabs.last()
                backStack.add(tabRoute(show))
            }
        }
    }

    /** Aktive Seite (für Tab-Leiste und Seitenleiste). */
    val currentPageId: String? get() = (backStack.lastOrNull() as? PageRoute)?.id

    /** Zuletzt geöffnete Seite im Verlauf (für „Nur aktuelle Seite“ in Gemini Notebook). */
    val lastPageId: String? get() = (backStack.lastOrNull { it is PageRoute } as? PageRoute)?.id

    /** Aktiver Tab (`S.activeTabId`), `null` auf Start, Bibliothek, Papierkorb … */
    val currentTab: String? get() = backStack.lastOrNull()?.let(::tabKey)

    /** Zurück; landet man auf einem Ziel ohne Tab, übernimmt es den Tab des verlassenen Ziels. */
    fun back() {
        val leaving = currentTab
        // Die Suche ist wie die Befehlspalette eine Ebene, kein Verlaufsschritt: „Vor“ öffnet sie nicht erneut.
        backStack.removeLastOrNull()?.takeIf { it != SearchRoute }?.let(forwardStack::add)
        adoptTab(leaving)
    }

    /** Vor (`navForward`): das zuletzt mit „Zurück“ verlassene Ziel wieder zeigen. */
    fun forward() {
        val next = forwardStack.removeLastOrNull() ?: return
        val leaving = currentTab
        backStack.add(next)
        adoptTab(leaving)
    }

    private fun adoptTab(leaving: String?) {
        val now = currentTab ?: return
        if (!desk || now in tabs) return
        val i = leaving?.let(tabs::indexOf) ?: -1
        if (i >= 0) tabs[i] = now else tabs.add(now)
    }

    /** Hauptbereich wechseln: Start bleibt unten liegen, damit „Zurück“ dorthin führt. */
    fun go(top: TopLevel) {
        forwardStack.clear()
        backStack.clear()
        backStack.add(HomeRoute)
        if (top != TopLevel.Home) backStack.add(top.route)
    }

    fun toast(text: String) { scope.launch { snackbar.showSnackbar(text) } }

    /** Anlege-Auswahl offen (wie `S.pendingNewPage` in der PWA); null = geschlossen. */
    var pendingNewPage by mutableStateOf<NewPageRequest?>(null)

    /** „Neu anlegen“ öffnen: Seite oder Heft wählen, dann anlegen (wie `newPageFlow` in der PWA). */
    fun askNewPage(parentId: String? = null, workspaceId: String? = null, newTab: Boolean = false) {
        pendingNewPage = NewPageRequest(parentId, workspaceId, newTab)
    }

    /** Typ gewählt: Seite bzw. Heft anlegen und öffnen. */
    fun pickNewPage(heft: Boolean) {
        val req = pendingNewPage ?: return
        pendingNewPage = null
        scope.launch {
            val id = store.write {
                if (heft) it.createHeft("Neues Heft", req.parentId, req.workspaceId) else it.createPage("Neue Seite", "", req.parentId, req.workspaceId)
            }
            if (req.newTab) openNewTab(id) else open(PageRoute(id))
        }
    }

    /** Vorlage gewählt: Titel, Inhalt, Icon und Schlagwörter übernehmen (wie `data-tpluse` in der PWA). */
    fun pickTemplate(tpl: PageSummary) {
        val req = pendingNewPage ?: return
        pendingNewPage = null
        scope.launch {
            val id = store.write {
                if (tpl.kind == PageKind.HEFT) return@write it.createHeft(tpl.title, req.parentId, req.workspaceId)
                val content = it.page(tpl.id)?.content.orEmpty()
                it.createPage(tpl.title, content, req.parentId, req.workspaceId)
            }
            if (tpl.icon.isNotEmpty() || tpl.tags.isNotEmpty()) {
                store.dispatch("pageUpdate", mapOf("id" to id, "patch" to mapOf("icon" to tpl.icon.ifEmpty { null }, "tags" to tpl.tags)))
            }
            if (req.newTab) openNewTab(id) else open(PageRoute(id))
        }
    }

    /** Shortcut oder geteilte Inhalte ausführen (siehe [Incoming]). */
    fun receive(incoming: Incoming, context: Context) {
        scope.launch {
            when (incoming) {
                Incoming.NewNote -> open(PageRoute(store.write { it.createPage("Neue Seite", "", null, null) }))
                Incoming.NewHeft -> open(PageRoute(store.write { it.createHeft("Neues Heft", null, null) }))
                Incoming.Study -> { go(TopLevel.Study); open(ReviewRoute()) }
                is Incoming.Text -> open(PageRoute(importSharedText(store, incoming)))
                is Incoming.Files -> {
                    toast("Wird importiert …")
                    importSharedFiles(context, store, incoming.uris)?.let { open(PageRoute(it)) }
                        ?: toast("Die geteilte Datei ließ sich nicht lesen.")
                }
            }
        }
    }

    /** Aktionen aus „Mehr“ und Suche (IDs wie in der PWA). */
    fun action(id: String) = when (id) {
        "settings" -> openSettings()
        "sync" -> openSettings("sync")
        "trash" -> open(TrashRoute)
        "archive" -> open(ArchiveRoute)
        "library" -> open(LibraryRoute)
        "newpage" -> askNewPage()
        "cards" -> go(TopLevel.Study)
        "cards-manage" -> { go(TopLevel.Study); open(CardBrowserRoute()) }
        "search" -> open(SearchRoute)
        "newchat" -> openNewChatTab()
        "stats", "lernzeit" -> { go(TopLevel.Study); open(StatsRoute) }
        "graph" -> open(GraphRoute)
        "notebook", "notebooklm" -> open(NotebookRoute)
        "daily" -> openDaily(java.time.LocalDate.now())
        "daily-calendar" -> open(DailyRoute)
        else -> toast("Folgt mit einem der nächsten Module.")
    }

    /** Tagesseite öffnen, bei Bedarf samt Ordner „Daily Notes“ anlegen (`openDailyNote`). */
    fun openDaily(day: java.time.LocalDate) {
        scope.launch {
            runCatching { store.write { it.openDailyNote(dailyKey(day), dailyTitle(day)) } }
                .onSuccess { open(PageRoute(it)) }
                .onFailure { toast("Tagesseite konnte nicht angelegt werden.") }
        }
    }
}

/** Ziel der Anlege-Auswahl: Eltern, Arbeitsbereich und ob die neue Seite in einem neuen Tab öffnet. */
data class NewPageRequest(val parentId: String?, val workspaceId: String?, val newTab: Boolean)

/** Tab der Karteikarten (`anki:main`): Übersicht, Lernen und Kartenbrowser teilen ihn. */
const val ANKI_TAB = "anki:main"

/** Präfix der Chat-Tabs (`chat:<id>`). */
const val CHAT_TAB = "chat:"

private const val MAX_TABS = 12

/** Welcher Tab zu einem Ziel gehört; `null` = Ziel ohne eigenen Tab (Start, Bibliothek, Papierkorb …). */
fun tabKey(key: NavKey): String? = when (key) {
    is PageRoute -> key.id
    is ChatRoute -> CHAT_TAB + key.id
    StudyRoute, is ReviewRoute, is CardBrowserRoute, StatsRoute, CardArchiveRoute -> ANKI_TAB
    else -> null
}

/** Ziel eines Tabs (Karteikarten: die Stapelübersicht). */
fun tabRoute(tab: String): NavKey = when {
    tab == ANKI_TAB -> StudyRoute
    tab.startsWith(CHAT_TAB) -> ChatRoute(tab.removePrefix(CHAT_TAB))
    else -> PageRoute(tab)
}
