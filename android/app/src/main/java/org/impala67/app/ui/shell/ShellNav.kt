package org.impala67.app.ui.shell

import androidx.compose.material3.SnackbarHostState
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
    fun open(key: NavKey) { backStack.add(key) }

    fun back() { backStack.removeLastOrNull() }

    /** Hauptbereich wechseln: Start bleibt unten liegen, damit „Zurück“ dorthin führt. */
    fun go(top: TopLevel) {
        backStack.clear()
        backStack.add(HomeRoute)
        if (top != TopLevel.Home) backStack.add(top.route)
    }

    fun toast(text: String) { scope.launch { snackbar.showSnackbar(text) } }

    /** Leere Notiz bzw. leeres Heft anlegen und öffnen (Vorlagenwahl folgt). */
    fun create(heft: Boolean, parentId: String? = null) = scope.launch {
        val id = store.write { if (heft) it.createHeft("", parentId, null) else it.createPage("", "", parentId, null) }
        open(PageRoute(id))
    }

    /** Aktionen aus „Mehr“ und Suche (IDs wie in der PWA). */
    fun action(id: String) = when (id) {
        "settings" -> open(SettingsRoute)
        "sync" -> { open(SettingsRoute); open(SettingsSectionRoute("sync")) }
        "trash" -> open(TrashRoute)
        "archive" -> open(ArchiveRoute)
        "newpage" -> { create(heft = false); Unit }
        "cards" -> go(TopLevel.Study)
        else -> toast("Folgt mit einem der nächsten Module.")
    }
}
