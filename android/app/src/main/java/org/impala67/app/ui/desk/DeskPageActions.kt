package org.impala67.app.ui.desk

import android.content.Intent
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.HorizontalDivider
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.launch
import org.impala67.app.R
import org.impala67.app.core.ImpalaStore
import org.impala67.app.notes.pageTitle
import org.impala67.app.ui.shell.ShellNav
import org.impala67.app.ui.theme.Impala

/**
 * Knöpfe rechts in der Tab-Leiste für die offene Seite (`topbarActionsHtml` in render.js):
 * Teilen (Android-Teilen mit Titel und Markdown), Favoriten-Stern und ⋯. Was es nativ noch nicht
 * gibt, meldet ein Hinweis; Menüpunkte mit gleichem Namen wie in der PWA.
 */
@Composable
fun PageActions(store: ImpalaStore, nav: ShellNav, pageId: String, favorite: Boolean) {
    val c = Impala.colors
    val scope = rememberCoroutineScope()
    val context = LocalContext.current
    var menuOpen by remember { mutableStateOf(false) }
    val later: (String) -> Unit = { nav.toast("$it folgt mit einem der nächsten Module.") }

    fun toggleFavorite() {
        scope.launch { store.dispatch("pageUpdate", mapOf("id" to pageId, "patch" to mapOf("favorite" to !favorite))) }
    }

    fun share() {
        scope.launch {
            val page = store.write { it.page(pageId) } ?: return@launch
            val intent = Intent(Intent.ACTION_SEND).apply {
                type = "text/plain"
                putExtra(Intent.EXTRA_SUBJECT, pageTitle(page.summary))
                putExtra(Intent.EXTRA_TEXT, page.content)
            }
            context.startActivity(Intent.createChooser(intent, null))
        }
    }

    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(2.dp)) {
        SmallButton(R.drawable.ic_i_upload, "Teilen") { share() }
        SmallButton(R.drawable.ic_i_star, if (favorite) "Aus Favoriten entfernen" else "Zu Favoriten", active = favorite) { toggleFavorite() }
        Box {
            SmallButton(R.drawable.ic_i_dots, "Weitere Optionen") { menuOpen = true }
            DropdownMenu(menuOpen, { menuOpen = false }, containerColor = c.menu) {
                MenuEntry(R.drawable.ic_i_undo, "Rückgängig") { menuOpen = false; later("Rückgängig") }
                MenuEntry(R.drawable.ic_i_redo, "Wiederholen") { menuOpen = false; later("Wiederholen") }
                HorizontalDivider(color = c.edgeSoft)
                MenuEntry(R.drawable.ic_i_star, if (favorite) "Favorit entfernen" else "Zu Favoriten") { menuOpen = false; toggleFavorite() }
                MenuEntry(R.drawable.ic_i_printer, "Als PDF exportieren / drucken") { menuOpen = false; later("PDF-Export") }
                MenuEntry(R.drawable.ic_i_download, "Als Markdown (.md) speichern") { menuOpen = false; later("Markdown-Export") }
                MenuEntry(R.drawable.ic_i_link, "Internen Link kopieren") { menuOpen = false; later("Link kopieren") }
                HorizontalDivider(color = c.edgeSoft)
                MenuEntry(R.drawable.ic_i_history, "Verlauf") { menuOpen = false; later("Verlauf") }
                MenuEntry(R.drawable.ic_i_smile, "Icon ändern") { menuOpen = false; later("Icon-Auswahl") }
                MenuEntry(R.drawable.ic_i_image, "Cover ändern") { menuOpen = false; later("Cover-Auswahl") }
                HorizontalDivider(color = c.edgeSoft)
                MenuEntry(R.drawable.ic_i_folder_move, "Verschieben nach…") { menuOpen = false; later("Verschieben") }
                MenuEntry(R.drawable.ic_i_archive, "Archivieren") {
                    menuOpen = false
                    nav.closeTab(pageId)
                    scope.launch { store.write { it.archivePage(pageId) } }
                }
                MenuEntry(R.drawable.ic_i_trash, "Löschen", danger = true) {
                    menuOpen = false
                    nav.closeTab(pageId)
                    scope.launch { store.write { it.trashPage(pageId) } }
                }
            }
        }
    }
}
