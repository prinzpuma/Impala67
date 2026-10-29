package org.impala67.app.ui.desk

import android.content.ClipData
import android.content.Intent
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
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
import androidx.compose.ui.platform.ClipEntry
import androidx.compose.ui.platform.LocalClipboard
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.launch
import org.impala67.app.R
import org.impala67.app.core.ImpalaStore
import org.impala67.app.notes.CoverDialog
import org.impala67.app.notes.HistoryDialog
import org.impala67.app.notes.IconDialog
import org.impala67.app.notes.MovePageDialog
import org.impala67.app.notes.duplicatePage
import org.impala67.app.notes.internalLink
import org.impala67.app.notes.markdownFileName
import org.impala67.app.notes.markdownText
import org.impala67.app.notes.pageTitle
import org.impala67.app.notes.printPage
import org.impala67.app.notes.printableHtml
import org.impala67.app.notes.writeText
import org.impala67.app.ui.shell.ShellNav
import org.impala67.app.ui.theme.Impala
import uniffi.impala_ffi.PageKind
import uniffi.impala_ffi.PageSummary

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
    val clipboard = LocalClipboard.current
    var menuOpen by remember { mutableStateOf(false) }
    var dialog by remember { mutableStateOf<PageDialog?>(null) }
    var moving by remember { mutableStateOf<PageSummary?>(null) }
    var pendingMarkdown by remember { mutableStateOf<String?>(null) }
    val later: (String) -> Unit = { nav.toast("$it folgt mit einem der nächsten Module.") }
    val saveMarkdown = rememberLauncherForActivityResult(ActivityResultContracts.CreateDocument("text/markdown")) { uri ->
        val text = pendingMarkdown
        pendingMarkdown = null
        if (uri != null && text != null) scope.launch { writeText(context, uri, text) }
    }

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

    fun exportPdf() {
        scope.launch {
            val d = store.write { it.page(pageId) } ?: return@launch
            if (d.summary.kind == PageKind.HEFT) return@launch later("PDF-Export für Hefte")
            val heading = listOf(d.summary.icon, d.summary.title).filter { it.isNotBlank() }.joinToString(" ")
            printPage(context, d.summary.title, printableHtml(heading, d.content))
        }
    }

    fun exportMarkdown() {
        scope.launch {
            val d = store.write { it.page(pageId) } ?: return@launch
            pendingMarkdown = markdownText(d.summary.title, d.content)
            saveMarkdown.launch(markdownFileName(d.summary.title))
        }
    }

    fun copyLink() {
        val link = internalLink(pageId)
        scope.launch {
            clipboard.setClipEntry(ClipEntry(ClipData.newPlainText("Interner Link", link)))
            nav.toast("Interner Link kopiert: $link — auf anderen Seiten als [Text]($link) einfügen.")
        }
    }

    fun openMove() {
        scope.launch { store.write { it.page(pageId) }?.summary?.let { moving = it } }
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
                MenuEntry(R.drawable.ic_i_printer, "Als PDF exportieren / drucken") { menuOpen = false; exportPdf() }
                MenuEntry(R.drawable.ic_i_download, "Als Markdown (.md) speichern") { menuOpen = false; exportMarkdown() }
                MenuEntry(R.drawable.ic_i_link, "Internen Link kopieren") { menuOpen = false; copyLink() }
                HorizontalDivider(color = c.edgeSoft)
                MenuEntry(R.drawable.ic_i_history, "Verlauf") { menuOpen = false; dialog = PageDialog.History }
                MenuEntry(R.drawable.ic_i_smile, "Icon ändern") { menuOpen = false; dialog = PageDialog.Icon }
                MenuEntry(R.drawable.ic_i_image, "Cover ändern") { menuOpen = false; dialog = PageDialog.Cover }
                HorizontalDivider(color = c.edgeSoft)
                MenuEntry(R.drawable.ic_i_folder_move, "Verschieben nach…") { menuOpen = false; openMove() }
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

    when (dialog) {
        PageDialog.History -> HistoryDialog(store, pageId) { dialog = null }
        PageDialog.Icon -> IconDialog(store, pageId) { dialog = null }
        PageDialog.Cover -> CoverDialog(store, pageId) { dialog = null }
        null -> Unit
    }
    moving?.let { page -> MovePageDialog(store, page) { moving = null } }
}

/** Dialoge der offenen Seite aus dem ⋯-Menü. */
private enum class PageDialog { History, Icon, Cover }
