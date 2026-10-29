package org.impala67.app.notes

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.produceState
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.launch
import org.impala67.app.core.ImpalaStore
import org.impala67.app.editor.MarkdownView
import org.impala67.app.ui.theme.Impala
import org.impala67.app.ui.theme.ImpalaColors
import org.impala67.app.ui.theme.Radius
import org.impala67.app.ui.theme.TextSize
import uniffi.impala_ffi.PageSummary
import uniffi.impala_ffi.PageVersion

/** Verschieben-Dialog (`openMoveDialog` in web/app-dialogs.js): Arbeitsbereiche und Seiten als Ziel. */
@Composable
fun MovePageDialog(store: ImpalaStore, page: PageSummary, onDismiss: () -> Unit) {
    val c = Impala.colors
    val scope = rememberCoroutineScope()
    val targets by produceState(emptyList<MoveTarget>(), page.id) { value = store.write { moveTargets(it, page.id) } }
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("„${pageTitle(page)}“ verschieben nach…") },
        text = {
            LazyColumn(Modifier.fillMaxWidth().heightIn(max = 360.dp)) {
                items(targets, key = { it.workspaceId + ":" + (it.pageId ?: "") }) { t ->
                    Text(
                        t.label,
                        Modifier.fillMaxWidth().heightIn(min = 40.dp).clickable {
                            scope.launch {
                                store.write { core ->
                                    val target = t.pageId
                                    if (target != null) core.movePage(page.id, target, null)
                                    else core.movePageToWorkspace(page.id, t.workspaceId)
                                }
                                onDismiss()
                            }
                        }.padding(start = (14 + t.depth * 16).dp, end = 8.dp, top = 10.dp, bottom = 10.dp),
                        color = if (t.depth == 0) c.text2 else c.text,
                        fontSize = TextSize.base,
                        fontWeight = if (t.depth == 0) FontWeight.SemiBold else FontWeight.Normal,
                    )
                }
            }
        },
        confirmButton = {},
        dismissButton = { TextButton(onClick = onDismiss) { Text("Abbrechen") } },
    )
}

/** Verlauf-Dialog (`openHistory` in web/app-dialogs.js): Versionen, Vorschau und „Wiederherstellen“. */
@Composable
fun HistoryDialog(store: ImpalaStore, pageId: String, onDismiss: () -> Unit) {
    val c = Impala.colors
    val scope = rememberCoroutineScope()
    val versions by produceState<List<PageVersion>?>(null, pageId) {
        value = store.write { it.pageHistory(pageId) }.reversed().take(50)
    }
    var selected by remember(pageId) { mutableIntStateOf(0) }
    val list = versions.orEmpty()
    val version = list.getOrNull(selected)
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("Verlauf") },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                if (versions != null && list.isEmpty()) Text("Keine Versionen", color = c.text2, fontSize = TextSize.sm)
                LazyColumn(Modifier.fillMaxWidth().heightIn(max = 160.dp)) {
                    itemsIndexed(list) { i, v ->
                        Row(
                            Modifier.fillMaxWidth().heightIn(min = 36.dp).clip(RoundedCornerShape(Radius.sm))
                                .background(if (i == selected) c.accent.copy(alpha = 0.14f) else Color.Transparent)
                                .clickable { selected = i }.padding(horizontal = 8.dp),
                            verticalAlignment = Alignment.CenterVertically,
                            horizontalArrangement = Arrangement.spacedBy(8.dp),
                        ) {
                            Text(formatDate(v.time), Modifier.weight(1f), color = c.text, fontSize = TextSize.sm)
                            if (i == 0) Text("aktuell", color = c.text2, fontSize = TextSize.xs)
                        }
                    }
                }
                if (version != null) {
                    Text(version.title, color = c.text, fontWeight = FontWeight.SemiBold, fontSize = TextSize.base)
                    Column(Modifier.fillMaxWidth().heightIn(max = 240.dp).verticalScroll(rememberScrollState())) {
                        MarkdownView(version.content)
                    }
                }
            }
        },
        confirmButton = {
            TextButton(
                enabled = version != null && selected != 0,
                onClick = {
                    val v = version ?: return@TextButton
                    scope.launch {
                        store.dispatch("pageUpdate", mapOf("id" to pageId, "patch" to mapOf("title" to v.title, "content" to v.content)))
                        onDismiss()
                    }
                },
            ) { Text("Diese Version wiederherstellen") }
        },
        dismissButton = { TextButton(onClick = onDismiss) { Text("Schließen") } },
    )
}

/** Icon-Dialog (`openIconPicker` in web/render.js): Emoji wählen oder entfernen. */
@Composable
fun IconDialog(store: ImpalaStore, pageId: String, onDismiss: () -> Unit) {
    val scope = rememberCoroutineScope()
    fun set(icon: String?) {
        onDismiss()
        scope.launch { store.dispatch("pageUpdate", mapOf("id" to pageId, "patch" to mapOf("icon" to icon))) }
    }
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("Icon wählen") },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                PageIcons.chunked(6).forEach { row ->
                    Row(horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                        row.forEach { emoji ->
                            Box(
                                Modifier.size(44.dp).clip(RoundedCornerShape(Radius.sm)).clickable { set(emoji) },
                                contentAlignment = Alignment.Center,
                            ) { Text(emoji, fontSize = 22.sp) }
                        }
                    }
                }
            }
        },
        confirmButton = { TextButton(onClick = { set(null) }) { Text("Entfernen") } },
        dismissButton = { TextButton(onClick = onDismiss) { Text("Schließen") } },
    )
}

/** Cover-Dialog (`openCoverPicker` in web/render.js): Vorlagen wählen oder entfernen. */
@Composable
fun CoverDialog(store: ImpalaStore, pageId: String, onDismiss: () -> Unit) {
    val c = Impala.colors
    val scope = rememberCoroutineScope()
    fun set(cover: String?) {
        onDismiss()
        scope.launch { store.dispatch("pageUpdate", mapOf("id" to pageId, "patch" to mapOf("cover" to cover, "coverImg" to null))) }
    }
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("Cover wählen") },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                CoverNames.chunked(5).forEach { row ->
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        row.forEach { name ->
                            Box(
                                Modifier.size(56.dp).clip(RoundedCornerShape(Radius.sm))
                                    .background(Brush.linearGradient(coverColors(name, c)))
                                    .clickable { set(name) },
                            )
                        }
                    }
                }
            }
        },
        confirmButton = { TextButton(onClick = { set(null) }) { Text("Entfernen") } },
        dismissButton = { TextButton(onClick = onDismiss) { Text("Schließen") } },
    )
}

/** Emojis aus der Icon-Auswahl in render.js (openIconPicker). */
private val PageIcons = listOf(
    "📝", "📘", "📕", "📙", "📗", "🧪", "🧮", "⚡", "🧢", "📐", "🔬", "💡",
    "🎯", "📊", "🗂", "📎", "✅", "⭐", "🔥", "🎓", "🧠", "📚", "🛠", "🚀",
)

/** Cover-Namen aus `COVER_PRESETS` (library.js) und den Zusatzvorlagen in render.js. */
private val CoverNames = listOf("sunset", "ocean", "forest", "grape", "mono", "aurora", "karo", "linien", "punkte")

/**
 * Farben je Cover wie `.cover-*` in styles.css. Aurora, Karo, Linien und Punkte sind vereinfacht
 * (Akzentfarbe statt Muster).
 */
private fun coverColors(name: String, c: ImpalaColors): List<Color> = when (name) {
    "sunset" -> listOf(Color(0xFFFF9A4D), Color(0xFFFF5F6D))
    "ocean" -> listOf(Color(0xFF2B5876), Color(0xFF4E4376))
    "forest" -> listOf(Color(0xFF134E5E), Color(0xFF71B280))
    "grape" -> listOf(Color(0xFF6A11CB), Color(0xFF2575FC))
    "mono" -> listOf(Color(0xFF3A3A3A), Color(0xFF101010))
    "aurora" -> listOf(c.accent, Color(0xFF5EEAD4))
    else -> listOf(c.accent.copy(alpha = 0.3f), c.surface)
}
