package org.impala67.app.study.transfer

import android.content.Context
import android.net.Uri
import android.provider.OpenableColumns
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Checkbox
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
import androidx.compose.ui.platform.LocalClipboardManager
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.impala67.app.core.ImpalaStore
import org.impala67.app.study.stats.LearnData
import org.impala67.app.ui.theme.Impala
import org.impala67.app.ui.theme.Space
import org.impala67.app.ui.theme.TextSize
import uniffi.impala_ffi.CardStage
import java.io.File
import java.util.UUID

/** Aktive Karten (ohne Papierkorb und Archiv) für den Export, mit Lernstand für das Anki-Paket. */
suspend fun exportCards(store: ImpalaStore): List<ApkgCard> = store.write { core ->
    val stats = LearnData.parse(core.learningStatsJson()).cards.associateBy { it.id }
    core.decks().flatMap { core.cardsInDeck(it.name) }.filter { !it.trashed && !it.archived }.distinctBy { it.id }.map { c ->
        val s = stats[c.id]
        ApkgCard(PlainCard(c.front, c.back, c.deck), c.stage == CardStage.NEW, s?.due, s?.stability ?: 0.0, s?.lapses ?: 0, c.suspended)
    }
}

/** „Karten exportieren“: Textdatei, CSV oder Anki-Paket über die Dateiauswahl des Systems. */
@Composable
fun CardExportDialog(store: ImpalaStore, onToast: (String) -> Unit, onDismiss: () -> Unit) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    var kind by remember { mutableStateOf("txt") }
    val save = rememberLauncherForActivityResult(ActivityResultContracts.CreateDocument("*/*")) { uri ->
        if (uri == null) return@rememberLauncherForActivityResult
        scope.launch {
            runCatching {
                val cards = exportCards(store)
                val bytes = withContext(Dispatchers.IO) {
                    when (kind) {
                        "csv" -> CardText.exportCsv(cards.map { it.card }).toByteArray()
                        "apkg" -> Apkg.export(cards, File(context.cacheDir, "export.anki2"))
                        else -> CardText.exportTxt(cards.map { it.card }).toByteArray()
                    }
                }
                withContext(Dispatchers.IO) { context.contentResolver.openOutputStream(uri, "wt")!!.use { it.write(bytes) } }
                cards.size
            }.onSuccess { onToast("$it Karten exportiert."); onDismiss() }
                .onFailure { onToast("Export fehlgeschlagen: ${it.message}") }
        }
    }
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("Karten exportieren") },
        text = {
            Row(horizontalArrangement = Arrangement.spacedBy(Space.s2), modifier = Modifier.horizontalScroll(rememberScrollState())) {
                OutlinedButton({ kind = "txt"; save.launch("impala67-karten.txt") }) { Text("Textdatei") }
                OutlinedButton({ kind = "csv"; save.launch("impala67-karten.csv") }) { Text("CSV") }
                OutlinedButton({ kind = "apkg"; save.launch("impala67.apkg") }) { Text("Anki-Paket") }
            }
        },
        confirmButton = { TextButton(onDismiss) { Text("Schließen") } },
    )
}

/** „Karten importieren“: Datei wählen, Vorschau prüfen, importieren (Duplikate wahlweise). */
@Composable
fun CardImportDialog(store: ImpalaStore, defaultDeck: String?, onToast: (String) -> Unit, onDismiss: () -> Unit) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val clipboard = LocalClipboardManager.current
    val c = Impala.colors
    var parsed by remember { mutableStateOf<Pair<String, ParsedCards>?>(null) }
    var duplicates by remember { mutableStateOf(0) }
    var withDuplicates by remember { mutableStateOf(false) }
    var showFormat by remember { mutableStateOf(false) }
    var busy by remember { mutableStateOf(false) }
    val pick = rememberLauncherForActivityResult(ActivityResultContracts.OpenDocument()) { uri ->
        if (uri == null) return@rememberLauncherForActivityResult
        scope.launch {
            runCatching {
                val name = displayName(context, uri)
                val bytes = withContext(Dispatchers.IO) { context.contentResolver.openInputStream(uri)!!.use { it.readBytes() } }
                val result = if (name.endsWith(".apkg", true)) {
                    val cards = withContext(Dispatchers.IO) { Apkg.import(bytes, File(context.cacheDir, "import.anki2")) }
                        ?: error("Keine collection.anki2 im Archiv — das neue .apkg-Format (anki21b, zstd-komprimiert) wird nicht unterstützt. In Anki beim Export „Support older Anki versions“ anhaken.")
                    ParsedCards(cards, emptyList(), "Anki-Paket")
                } else CardText.parse(bytes.decodeToString(), defaultDeck ?: "Standard")
                val known = existingKeys(store)
                duplicates = result.cards.count { !known.add(CardText.key(it)) }
                parsed = name to result
            }.onFailure { onToast("Import fehlgeschlagen: ${it.message}") }
        }
    }
    val p = parsed
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(if (p == null) "Karten importieren" else "Import prüfen") },
        text = {
            Column(Modifier.heightIn(max = 460.dp).verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(Space.s2)) {
                if (p == null) {
                    Text("Textdatei (empfohlen), CSV/TSV bzw. Anki-Text oder Anki-Paket (.apkg ohne Medien).", color = c.text2, fontSize = TextSize.sm)
                    Row(horizontalArrangement = Arrangement.spacedBy(Space.s2)) {
                        OutlinedButton({ pick.launch(arrayOf("text/*", "application/octet-stream", "application/zip", "*/*")) }) { Text("Datei wählen…") }
                        OutlinedButton({ clipboard.setText(AnnotatedString(CardText.AI_CARD_PROMPT)); onToast("KI-Anweisung kopiert.") }) { Text("KI-Anweisung kopieren") }
                    }
                    TextButton({ showFormat = !showFormat }) { Text(if (showFormat) "TXT-Format ausblenden" else "TXT-Format anzeigen") }
                    if (showFormat) Text(CardText.FORMAT_EXAMPLE, fontFamily = FontFamily.Monospace, fontSize = TextSize.xs, color = c.text)
                } else {
                    val (name, r) = p
                    Text("$name · ${r.format}", color = c.text2, fontSize = TextSize.sm)
                    Text("${r.cards.size} Karten · ${r.cards.map { it.deck }.distinct().size} Stapel · $duplicates Duplikate", color = c.text, fontWeight = FontWeight.SemiBold)
                    if (r.errors.isNotEmpty()) Text("${r.errors.size} Problem(e)\n" + r.errors.take(4).joinToString("\n"), color = c.warn, fontSize = TextSize.xs)
                    if (r.cards.isEmpty()) Text("Keine gültigen Karten gefunden.", color = c.text2)
                    r.cards.take(5).forEach { Text("• ${it.front.take(80)}  (${it.deck})", fontSize = TextSize.sm, color = c.text, maxLines = 2) }
                    if (duplicates > 0) Row(verticalAlignment = Alignment.CenterVertically) {
                        Checkbox(withDuplicates, { withDuplicates = it })
                        Text("Duplikate ebenfalls importieren", fontSize = TextSize.sm)
                    }
                }
            }
        },
        confirmButton = {
            if (p != null) TextButton(
                {
                    busy = true
                    scope.launch {
                        runCatching { importCards(store, p.second.cards, withDuplicates) }
                            .onSuccess { n -> onToast("$n Karten in ${p.second.cards.map { it.deck }.distinct().size} Stapel importiert."); onDismiss() }
                            .onFailure { busy = false; onToast("Import fehlgeschlagen: ${it.message}") }
                    }
                },
                enabled = p.second.cards.isNotEmpty() && !busy,
            ) { Text("Importieren") }
        },
        dismissButton = { TextButton(onDismiss) { Text(if (p == null) "Schließen" else "Abbrechen") } },
    )
}

private suspend fun existingKeys(store: ImpalaStore): MutableSet<String> = store.write { core ->
    core.decks().flatMap { core.cardsInDeck(it.name) }.filter { !it.trashed }.map { CardText.key(PlainCard(it.front, it.back, it.deck)) }.toHashSet()
}

private suspend fun importCards(store: ImpalaStore, cards: List<PlainCard>, withDuplicates: Boolean): Int {
    val known = existingKeys(store)
    var n = 0
    for (card in cards) {
        val key = CardText.key(card)
        if (!withDuplicates && key in known) continue
        store.dispatch("cardCreate", mapOf("id" to UUID.randomUUID().toString(), "front" to card.front, "back" to card.back, "deck" to card.deck))
        known += key
        n++
    }
    return n
}

private fun displayName(context: Context, uri: Uri): String =
    context.contentResolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)?.use {
        if (it.moveToFirst()) it.getString(0) else null
    } ?: "Datei"
