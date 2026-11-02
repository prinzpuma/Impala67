package org.impala67.app.notebook

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
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Checkbox
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import org.impala67.app.ui.theme.Impala
import org.impala67.app.ui.theme.Radius
import org.impala67.app.ui.theme.Space
import org.impala67.app.ui.theme.TextSize
import uniffi.impala_ffi.PageKind
import uniffi.impala_ffi.PageSummary

/** Seiten-Auswahl (`openPicker`): Suche, Baum mit Aufklappen, Alle / Keine / Nur aktuelle Seite. */
@Composable
fun PagePicker(pages: List<PageSummary>, currentId: String?, onDismiss: () -> Unit, onCopy: (List<String>) -> Unit) {
    val c = Impala.colors
    val picked = remember { mutableStateListOf<String>().apply { currentId?.let(::add) } }
    val expanded = remember { mutableStateListOf<String>() }
    var query by remember { mutableStateOf("") }
    val byParent = remember(pages) { pages.groupBy { it.parentId } }
    val ids = remember(pages) { pages.map { it.id }.toSet() }
    val rows = if (query.isNotBlank()) pages.filter { it.title.contains(query.trim(), true) }.map { it to 0 } else buildList {
        fun walk(parent: String?, depth: Int) {
            byParent[parent].orEmpty().forEach { p -> add(p to depth); if (p.id in expanded) walk(p.id, depth + 1) }
        }
        walk(null, 0)
        // Seiten, deren Eltern fehlen (z. B. archiviert), trotzdem zeigen.
        pages.filter { it.parentId != null && it.parentId !in ids }.forEach { add(it to 0) }
    }
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("Seiten für Gemini Notebook auswählen") },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(Space.s2)) {
                Text("Kopiert die Inhalte als eine Quelle in die Zwischenablage — in Gemini Notebook dann „Quelle hinzufügen → Kopierter Text“ wählen und einfügen.", color = c.text2, fontSize = TextSize.xs)
                OutlinedTextField(query, { query = it }, Modifier.fillMaxWidth(), placeholder = { Text("Seiten durchsuchen…") }, singleLine = true)
                Row(verticalAlignment = Alignment.CenterVertically) {
                    TextButton({ picked.clear(); picked.addAll(pages.map { it.id }) }) { Text("Alle") }
                    TextButton({ picked.clear() }) { Text("Keine") }
                    TextButton({ picked.clear(); currentId?.let(picked::add); query = "" }) { Text("Nur aktuelle Seite") }
                    Text("${picked.size} ausgewählt", Modifier.weight(1f), color = c.text2, fontSize = TextSize.xs)
                }
                LazyColumn(Modifier.heightIn(max = 320.dp)) {
                    if (rows.isEmpty()) item { Text("Keine Seiten gefunden.", color = c.text2, fontSize = TextSize.sm, modifier = Modifier.padding(Space.s3)) }
                    items(rows, key = { it.first.id }) { (p, depth) ->
                        val kids = byParent[p.id].orEmpty().isNotEmpty() && query.isBlank()
                        Row(Modifier.fillMaxWidth().padding(start = (depth * 18).dp), verticalAlignment = Alignment.CenterVertically) {
                            Box(Modifier.size(24.dp).clickable(enabled = kids) { if (p.id in expanded) expanded.remove(p.id) else expanded.add(p.id) }, contentAlignment = Alignment.Center) {
                                if (kids) Text(if (p.id in expanded) "▾" else "▸", color = c.text2, fontSize = TextSize.xs)
                            }
                            Row(
                                Modifier.weight(1f).clip(RoundedCornerShape(Radius.sm)).background(if (p.id in picked) c.tint else c.panel)
                                    .clickable { if (p.id in picked) picked.remove(p.id) else picked.add(p.id) }.padding(horizontal = Space.s2),
                                verticalAlignment = Alignment.CenterVertically,
                            ) {
                                Text(
                                    p.icon.ifEmpty { "" } + (if (p.icon.isNotEmpty()) " " else "") + pageTitleOf(p),
                                    Modifier.weight(1f), color = c.text, fontSize = TextSize.sm, maxLines = 1, overflow = TextOverflow.Ellipsis,
                                    fontWeight = if (p.id == currentId) FontWeight.SemiBold else FontWeight.Normal,
                                )
                                if (p.id == currentId) Text("aktuell", color = c.accent, fontSize = TextSize.xs2)
                                Checkbox(p.id in picked, { on -> if (on) picked.add(p.id) else picked.remove(p.id) })
                            }
                        }
                    }
                }
            }
        },
        confirmButton = { TextButton({ onCopy(picked.toList()) }, enabled = picked.isNotEmpty()) { Text("Kopieren & Gemini Notebook öffnen") } },
        dismissButton = { TextButton(onDismiss) { Text("Abbrechen") } },
    )
}

/** Einordnen (`openPlaceDialog`): in Quellseiten einbetten, als Unterseite, andere Seite wählen oder nur behalten. */
@Composable
fun PlaceDialog(f: NlmFile, pages: List<PageSummary>, onDismiss: () -> Unit, onEmbed: (PageSummary) -> Unit, onSubpage: (PageSummary?) -> Unit, onKeep: () -> Unit) {
    val c = Impala.colors
    val sources = f.sourcePageIds.mapNotNull { id -> pages.firstOrNull { it.id == id } }
    var choose by remember { mutableStateOf(false) }
    var query by remember { mutableStateOf("") }
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(if (choose) "Seite wählen für ${f.name}" else "Einordnen: ${f.name}") },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(Space.s2)) {
                if (choose) {
                    OutlinedTextField(query, { query = it }, Modifier.fillMaxWidth(), placeholder = { Text("Seiten durchsuchen…") }, singleLine = true)
                    val hits = pages.filter { it.kind != PageKind.HEFT && (query.isBlank() || it.title.contains(query.trim(), true)) }.take(40)
                    LazyColumn(Modifier.heightIn(max = 320.dp)) {
                        if (hits.isEmpty()) item { Text("Keine Seiten gefunden.", color = c.text2) }
                        items(hits, key = { it.id }) { p -> Option(pageTitleOf(p)) { onEmbed(p) } }
                    }
                } else {
                    Text(if (sources.isNotEmpty()) "Herkunft erkannt: zuletzt wurden diese Seiten als Quelle kopiert." else "Keine Herkunft bekannt — Ziel selbst wählen.", color = c.text2, fontSize = TextSize.xs)
                    sources.filter { it.kind != PageKind.HEFT }.forEach { p -> Option("In „${pageTitleOf(p).take(44)}“ einbetten") { onEmbed(p) } }
                    Option("Als neue Unterseite" + (sources.firstOrNull()?.let { " unter „${pageTitleOf(it).take(30)}“" } ?: "")) { onSubpage(sources.firstOrNull()) }
                    Option("Andere Seite wählen…") { choose = true }
                    Option("Nur in der Mediathek behalten", onKeep)
                }
            }
        },
        confirmButton = { TextButton(onDismiss) { Text("Abbrechen") } },
    )
}

@Composable
private fun Option(label: String, onClick: () -> Unit) {
    val c = Impala.colors
    Text(
        label,
        Modifier.fillMaxWidth().padding(vertical = 2.dp).clip(RoundedCornerShape(Radius.md)).background(c.surface).clickable(onClick = onClick).padding(Space.s3),
        color = c.text, fontSize = TextSize.sm,
    )
}
