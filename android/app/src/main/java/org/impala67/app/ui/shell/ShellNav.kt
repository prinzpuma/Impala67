package org.impala67.app.ui.shell

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

/** Navigation und App-weite Aktionen, die Bildschirme als Callbacks bekommen. */
class ShellNav(
    private val backStack: NavBackStack<NavKey>,
    private val scope: CoroutineScope,
    private val store: ImpalaStore,
    private val snackbar: SnackbarHostState,
) {
    /** Vollbild ohne Leisten der Shell (Heft bringt eigene Kopfzeile und Werkzeuge mit). */
    var immersive by mutableStateOf(false)

    /** Tablet-Layout wie die PWA am Desktop/iPad: Seitenleiste, Tab-Leiste, KI-Panel (`ui/desk/`). */
    var desk by mutableStateOf(false)

    /** Offene Seiten-Tabs (nur [desk]; in der PWA `S.tabs`). */
    val tabs = mutableStateListOf<String>()

    fun open(key: NavKey) {
        if (desk && key is PageRoute) trackTab(key.id, newTab = false)
        backStack.add(key)
    }

    /** Seite in einem neuen Tab öffnen (Seiten-⋯ „In neuem Tab öffnen“). */
    fun openNewTab(id: String) {
        trackTab(id, newTab = true)
        backStack.add(PageRoute(id))
    }

    /**
     * Wie `openPage` in tabs.js: Ist die Seite schon offen, wird nur ihr Tab aktiv; sonst ersetzt sie
     * die Seite im aktiven Tab (bzw. bekommt einen neuen Tab, wenn keine Seite offen ist).
     */
    private fun trackTab(id: String, newTab: Boolean) {
        if (id in tabs) return
        val i = (backStack.lastOrNull() as? PageRoute)?.let { tabs.indexOf(it.id) } ?: -1
        if (newTab || i < 0) tabs.add(id) else tabs[i] = id
    }

    /** Tab schließen; war er sichtbar, rückt der Nachbar nach (sonst Start). */
    fun closeTab(id: String) {
        val i = tabs.indexOf(id)
        if (i < 0) return
        tabs.removeAt(i)
        if ((backStack.lastOrNull() as? PageRoute)?.id != id) return
        backStack.removeAll { it is PageRoute && it.id == id }
        val next = tabs.getOrNull(i) ?: tabs.getOrNull(i - 1)
        if (next != null) backStack.add(PageRoute(next)) else go(TopLevel.Home)
    }

    /** Aktive Seite (für Tab-Leiste und Seitenleiste). */
    val currentPageId: String? get() = (backStack.lastOrNull() as? PageRoute)?.id

    fun back() { backStack.removeLastOrNull() }

    /** Hauptbereich wechseln: Start bleibt unten liegen, damit „Zurück“ dorthin führt. */
    fun go(top: TopLevel) {
        backStack.clear()
        backStack.add(HomeRoute)
        if (top != TopLevel.Home) backStack.add(top.route)
    }

    fun toast(text: String) { scope.launch { snackbar.showSnackbar(text) } }

    /** Leere Notiz bzw. leeres Heft anlegen und öffnen (Vorlagenwahl folgt). */
    fun create(heft: Boolean, parentId: String? = null, newTab: Boolean = false) = scope.launch {
        val id = store.write { if (heft) it.createHeft("", parentId, null) else it.createPage("", "", parentId, null) }
        if (newTab) openNewTab(id) else open(PageRoute(id))
    }

    /** Aktionen aus „Mehr“ und Suche (IDs wie in der PWA). */
    fun action(id: String) = when (id) {
        "settings" -> open(SettingsRoute)
        "sync" -> { open(SettingsRoute); open(SettingsSectionRoute("sync")) }
        "trash" -> open(TrashRoute)
        "archive" -> open(ArchiveRoute)
        "newpage" -> { create(heft = false); Unit }
        "cards" -> go(TopLevel.Study)
        "cards-manage" -> { go(TopLevel.Study); open(CardBrowserRoute()) }
        "search" -> open(SearchRoute)
        else -> toast("Folgt mit einem der nächsten Module.")
    }
}
