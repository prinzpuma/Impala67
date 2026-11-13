package org.impala67.app.notebook

import android.content.Intent
import android.net.Uri
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Icon
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.impala67.app.R
import org.impala67.app.core.ImpalaStore
import org.impala67.app.core.Touches
import org.impala67.app.ui.theme.Impala
import org.impala67.app.ui.theme.Radius
import org.impala67.app.ui.theme.Space
import org.impala67.app.ui.theme.TextSize
import uniffi.impala_ffi.PageSummary
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.util.UUID

private const val PRODUCT = "Gemini Notebook"

/**
 * Gemini Notebook (web/notebooklm.js, Tab „nlm:main“): Seiten als Quelle kopieren, Gemini Notebook extern öffnen,
 * heruntergeladene Ergebnisse importieren und aus der Inbox in Seiten einordnen.
 */
@OptIn(ExperimentalLayoutApi::class)
@Composable
fun NotebookScreen(
    store: ImpalaStore,
    currentPageId: String?,
    onOpenPage: (String) -> Unit,
    onToast: (String) -> Unit,
    modifier: Modifier = Modifier,
    background: androidx.compose.ui.graphics.Color = Impala.colors.panel,
) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val inbox = remember(context) { NotebookInbox(context.applicationContext) }
    val files by inbox.files.collectAsStateWithLifecycle()
    val pages by remember(store) { store.query(Touches.pagesMeta) { it.recentPages(UInt.MAX_VALUE) } }.collectAsStateWithLifecycle()
    var picker by remember { mutableStateOf(false) }
    var placing by remember { mutableStateOf<NlmFile?>(null) }
    var fresh by remember { mutableStateOf<NlmFile?>(null) }
    var saving by remember { mutableStateOf<NlmFile?>(null) }
    val c = Impala.colors
    val openExternal = { runCatching { context.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(NotebookInbox.PRODUCT_URL)).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)) } }
    val import = rememberLauncherForActivityResult(ActivityResultContracts.OpenMultipleDocuments()) { uris ->
        if (uris.isEmpty()) return@rememberLauncherForActivityResult
        scope.launch {
            val added = uris.mapNotNull { runCatching { inbox.add(it) }.getOrNull() }
            if (added.size == 1) fresh = added.first() else if (added.isNotEmpty()) onToast("${added.size} Dateien in die Inbox übernommen.")
        }
    }
    val save = rememberLauncherForActivityResult(ActivityResultContracts.CreateDocument("*/*")) { uri ->
        val f = saving ?: return@rememberLauncherForActivityResult
        saving = null
        if (uri != null) scope.launch {
            runCatching { withContext(Dispatchers.IO) { context.contentResolver.openOutputStream(uri, "wt")!!.use { out -> inbox.file(f).inputStream().use { it.copyTo(out) } } } }
                .onFailure { onToast("Speichern fehlgeschlagen.") }
        }
    }
    val titleOf = { id: String -> pages.orEmpty().firstOrNull { it.id == id }?.title?.ifBlank { "Ohne Titel" } }

    Box(modifier.fillMaxSize().background(background), contentAlignment = Alignment.TopCenter) {
        Column(Modifier.widthIn(max = 820.dp).fillMaxWidth().verticalScroll(rememberScrollState()).padding(horizontal = Space.s5, vertical = 30.dp), verticalArrangement = Arrangement.spacedBy(Space.s3)) {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Space.s2)) {
                Icon(painterResource(R.drawable.ic_i_book), null, tint = c.accent)
                Text(PRODUCT, color = c.text, fontSize = TextSize.xl, fontWeight = FontWeight.SemiBold)
            }
            Text("Google hat NotebookLM in $PRODUCT umbenannt — gleiches Produkt, neuer Name. Einbetten in der App blockiert Google, deshalb öffnet es extern.", color = c.text2, fontSize = TextSize.sm)
            FlowRow(horizontalArrangement = Arrangement.spacedBy(Space.s2), verticalArrangement = Arrangement.spacedBy(Space.s2)) {
                OutlinedButton({ picker = true }) { Text("Seiten als Quelle kopieren…") }
                OutlinedButton({ openExternal() }) { Text("$PRODUCT öffnen") }
                OutlinedButton({ import.launch(arrayOf("*/*")) }) { Text("Download importieren…") }
            }
            Text("Heruntergeladene Datei aus $PRODUCT (Podcast, Video, Mind Map, Folien …) importieren — sie landet in der Inbox und lässt sich in Seiten einordnen.", color = c.text2, fontSize = TextSize.xs)
            Text("Inbox", color = c.text, fontSize = TextSize.md, fontWeight = FontWeight.SemiBold, modifier = Modifier.padding(top = Space.s3))
            val open = files.filter { it.placedPageId == null }
            if (open.isEmpty()) Text("Inbox ist leer. Importierte Downloads erscheinen hier.", color = c.text2, fontSize = TextSize.sm)
            open.sortedByDescending { it.ts }.forEach { f ->
                InboxRow(
                    f, f.sourcePageIds.mapNotNull(titleOf).joinToString(", ").take(50),
                    onPlay = { if (!inbox.open(f)) onToast("Keine App zum Öffnen gefunden.") },
                    onPlace = { placing = f },
                    onSave = { saving = f; save.launch(f.name) },
                    onDelete = { scope.launch { inbox.delete(f.id) } },
                )
            }
            val placed = files.filter { it.placedPageId != null }
            if (placed.isNotEmpty()) {
                Text("Eingeordnet", color = c.text, fontSize = TextSize.md, fontWeight = FontWeight.SemiBold, modifier = Modifier.padding(top = Space.s3))
                placed.sortedByDescending { it.ts }.forEach { f ->
                    InboxRow(f, titleOf(f.placedPageId!!).orEmpty(), { if (!inbox.open(f)) onToast("Keine App zum Öffnen gefunden.") }, { placing = f }, { saving = f; save.launch(f.name) }, { scope.launch { inbox.delete(f.id) } })
                }
            }
        }
        fresh?.let { f ->
            InboxToast(f, f.sourcePageIds.mapNotNull(titleOf).joinToString(", ").take(60), Modifier.align(Alignment.BottomEnd).padding(Space.s4),
                onPlace = { fresh = null; placing = f }, onPlay = { fresh = null; inbox.open(f) }, onLater = { fresh = null })
        }
    }
    if (picker) PagePicker(pages.orEmpty(), currentPageId, onDismiss = { picker = false }) { ids ->
        scope.launch {
            val text = store.write { core -> ids.mapNotNull { id -> core.page(id)?.let { "# " + it.summary.title.ifBlank { "Ohne Titel" } + "\n\n" + it.content } }.joinToString("\n\n---\n\n") }
            if (text.isBlank()) { onToast("Die gewählten Seiten sind leer."); return@launch }
            inbox.rememberSources(ids)
            val cm = context.getSystemService(android.content.ClipboardManager::class.java)
            cm.setPrimaryClip(android.content.ClipData.newPlainText("Gemini Notebook", text))
            onToast("${ids.size} Seite(n) kopiert — in $PRODUCT: „Quelle hinzufügen → Kopierter Text“ → Einfügen.")
            picker = false
            openExternal()
        }
    }
    placing?.let { f ->
        PlaceDialog(
            f, pages.orEmpty(), onDismiss = { placing = null },
            onEmbed = { page ->
                placing = null
                scope.launch {
                    store.write { core -> core.page(page.id)?.content }?.let { content ->
                        store.dispatch("pageUpdate", mapOf("id" to page.id, "patch" to mapOf("content" to content.trimEnd() + NotebookInbox.embedMd(f))))
                        inbox.setPlaced(f.id, page.id)
                        onToast(f.kind.label + " in „" + page.title.ifBlank { "Ohne Titel" } + "“ eingebettet.")
                        onOpenPage(page.id)
                    }
                }
            },
            onSubpage = { parent ->
                placing = null
                scope.launch {
                    val id = UUID.randomUUID().toString()
                    val day = DateTimeFormatter.ofPattern("d.M.yyyy").format(Instant.ofEpochMilli(f.ts).atZone(ZoneId.systemDefault()))
                    store.dispatch(
                        "pageCreate",
                        mapOf(
                            "id" to id, "title" to f.kind.label + ": " + f.name.replace(Regex("\\.[a-zA-Z0-9]+$"), ""), "icon" to f.kind.emoji,
                            "parentId" to parent?.id, "workspaceId" to (parent?.workspaceId ?: "default"),
                            "content" to "Gemini-Notebook-" + f.kind.label + " vom " + day + NotebookInbox.embedMd(f), "tags" to listOf("notebooklm"),
                        ),
                    )
                    inbox.setPlaced(f.id, id)
                    onToast("Unterseite angelegt.")
                    onOpenPage(id)
                }
            },
            onKeep = { placing = null; onToast("Bleibt in der Mediathek.") },
        )
    }
}

@Composable
private fun InboxRow(f: NlmFile, sub: String, onPlay: () -> Unit, onPlace: () -> Unit, onSave: () -> Unit, onDelete: () -> Unit) {
    val c = Impala.colors
    val date = DateTimeFormatter.ofPattern("d.M.yyyy").format(Instant.ofEpochMilli(f.ts).atZone(ZoneId.systemDefault()))
    Row(
        Modifier.fillMaxWidth().clip(RoundedCornerShape(Radius.md)).background(c.surface).padding(Space.s3),
        verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Space.s2),
    ) {
        Icon(painterResource(f.kind.icon), null, Modifier.size(18.dp), tint = c.accent)
        Column(Modifier.weight(1f)) {
            Text(f.name, color = c.text, fontSize = TextSize.sm, maxLines = 1, overflow = TextOverflow.Ellipsis)
            Text(f.kind.label + " · " + date + (if (sub.isNotEmpty()) " · Quelle: $sub" else ""), color = c.text2, fontSize = TextSize.xs, maxLines = 1)
        }
        RowIcon(R.drawable.ic_i_play, "Öffnen/Abspielen", onPlay)
        RowIcon(R.drawable.ic_i_pin, "Einordnen", onPlace)
        RowIcon(R.drawable.ic_i_download, "Herunterladen", onSave)
        RowIcon(R.drawable.ic_i_trash, "Löschen", onDelete)
    }
}

@Composable
private fun RowIcon(icon: Int, label: String, onClick: () -> Unit) {
    Box(Modifier.size(34.dp).clip(RoundedCornerShape(Radius.sm)).clickable(onClick = onClick), contentAlignment = Alignment.Center) {
        Icon(painterResource(icon), label, Modifier.size(16.dp), tint = Impala.colors.text2)
    }
}

/** Hinweis nach einem Import (`showInboxToast`): nie automatisch einbetten. */
@Composable
private fun InboxToast(f: NlmFile, source: String, modifier: Modifier, onPlace: () -> Unit, onPlay: () -> Unit, onLater: () -> Unit) {
    val c = Impala.colors
    Column(modifier.widthIn(max = 320.dp).clip(RoundedCornerShape(Radius.lg)).background(c.menu).padding(Space.s3), verticalArrangement = Arrangement.spacedBy(2.dp)) {
        Text(f.kind.label + " übernommen", color = c.text, fontSize = TextSize.sm, fontWeight = FontWeight.SemiBold)
        Text(f.name, color = c.text2, fontSize = TextSize.xs, maxLines = 1, overflow = TextOverflow.Ellipsis)
        if (source.isNotEmpty()) Text("Quelle: $source", color = c.text2, fontSize = TextSize.xs)
        Row {
            TextButton(onPlace) { Text("Einordnen") }
            TextButton(onPlay) { Text("Öffnen") }
            TextButton(onLater) { Text("Später") }
        }
    }
}

internal fun pageTitleOf(p: PageSummary) = p.title.ifBlank { "Ohne Titel" }
