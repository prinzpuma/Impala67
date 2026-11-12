package org.impala67.app.editor

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.DatePicker
import androidx.compose.material3.DatePickerDialog
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.rememberDatePickerState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.focus.onFocusChanged
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import kotlinx.coroutines.launch
import org.impala67.app.R
import org.impala67.app.core.ImpalaStore
import org.impala67.app.core.Touches
import org.impala67.app.notes.pageIconRes
import org.impala67.app.notes.pageTitle
import org.impala67.app.ui.theme.Impala
import org.impala67.app.ui.theme.ImpalaColors
import org.impala67.app.ui.theme.Radius
import uniffi.impala_ffi.DbColumn
import uniffi.impala_ffi.PageSummary
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneOffset
import java.time.format.DateTimeFormatter
import java.util.Locale

/** Spalten für „Als Vorlesungsübersicht“ (LECTURE_SCHEMA in web/db-view.js); die erste Zahlenspalte ist die Laufnummer. */
internal val LECTURE_SCHEMA = listOf(
    DbColumn("Thema", "title"), DbColumn("Nr", "number"), DbColumn("Datum", "date"),
    DbColumn("Schwierigkeit", "select"), DbColumn("Status", "select"), DbColumn("Klausurrelevanz", "select"),
    DbColumn("Themen", "multi_select"), DbColumn("Folien", "text"),
)

private val READ_ONLY = setOf(
    "formula", "rollup", "created_time", "last_edited_time", "created_by", "last_edited_by",
    "people", "relation", "files", "button", "unique_id", "verification",
)
private val PILL = setOf("select", "status", "multi_select")
private val WIDE = setOf("text", "rich_text", "url", "email")
private val ISO_DATE = Regex("^\\d{4}-\\d{2}-\\d{2}$")

// Bekannte Stufen bekommen eine sprechende Farbe, alles andere eine stabile aus dem Namen (db-view.js `tone`).
private val TONE_BY_VALUE = mapOf(
    "leicht" to "green", "niedrig" to "green", "gering" to "green", "erledigt" to "green", "fertig" to "green",
    "done" to "green", "zusammengefasst" to "green", "bestanden" to "green",
    "mittel" to "yellow", "in arbeit" to "yellow", "in bearbeitung" to "yellow", "in progress" to "yellow", "teilweise" to "yellow",
    "schwer" to "orange", "hoch" to "orange", "wichtig" to "orange",
    "sehr schwer" to "red", "sehr hoch" to "red", "offen" to "red", "nicht begonnen" to "gray", "not started" to "gray",
)
private val TONES = listOf("blue", "purple", "pink", "green", "orange", "yellow", "red", "gray")

private fun tone(v: String): String {
    TONE_BY_VALUE[v.lowercase()]?.let { return it }
    var h = 0
    for (ch in v) h = h * 31 + ch.code
    return TONES[Math.floorMod(h, TONES.size)]
}

private fun pillValues(kind: String, v: String) = (if (kind == "multi_select") v.split(",") else listOf(v)).map { it.trim() }.filter { it.isNotEmpty() }

private val DE_DATE = DateTimeFormatter.ofPattern("d. MMM yyyy", Locale.GERMAN)

private class DbRow(val page: PageSummary, val props: Map<String, String>)
private class DbData(val number: DbColumn?, val columns: List<DbColumn>, val rows: List<DbRow>)

/**
 * Datenbank-Seite (`dbViewHtml`): die Unterseiten als Karten mit ihren Eigenschaften, darüber die Anzahl,
 * darunter „Neue Zeile“. Jede Änderung ist ein `pageUpdate` der Zeile (über den Kern).
 */
@Composable
internal fun DatabaseView(store: ImpalaStore, pageId: String, onOpenPage: (String) -> Unit, modifier: Modifier = Modifier) {
    val data by remember(store, pageId) {
        store.query(Touches.pagesMeta) { core ->
            core.pageDb(pageId)?.let { schema ->
                val all = schema.filter { it.kind != "title" }
                val number = all.firstOrNull { it.kind == "number" }
                DbData(number, all.filter { it != number }, core.childrenOf(pageId, null).map { DbRow(it, core.pageProps(it.id)) })
            }
        }
    }.collectAsStateWithLifecycle()
    val db = data ?: return
    val c = Impala.colors
    val scope = rememberCoroutineScope()
    // Vorschläge je Auswahl-Spalte: alle bereits benutzten Werte (`datalist`).
    val suggestions = remember(db) {
        db.columns.filter { it.kind == "select" || it.kind == "status" }
            .associate { col -> col.name to db.rows.mapNotNull { it.props[col.name]?.trim()?.takeIf(String::isNotEmpty) }.distinct() }
    }
    fun set(row: String, col: String, value: String) { scope.launch { store.write { it.setPageProp(row, col, value) } } }

    Column(modifier.fillMaxWidth().padding(top = 8.dp, bottom = 20.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
        Text(if (db.rows.size == 1) "1 Eintrag" else "${db.rows.size} Einträge", color = c.text2, fontSize = 12.sp, modifier = Modifier.padding(start = 4.dp))
        db.rows.forEach { row ->
            DbItem(row, db, suggestions, onOpenPage, ::set)
        }
        val shape = RoundedCornerShape(Radius.lg)
        Row(
            Modifier.fillMaxWidth().heightIn(min = 40.dp).clip(shape).border(1.dp, c.edgeSoft, shape)
                .clickable { scope.launch { store.write { it.createPage("Neue Zeile", "", pageId, null) } } }
                .padding(horizontal = 12.dp),
            verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp),
        ) {
            Icon(painterResource(R.drawable.ic_i_plus), null, Modifier.size(16.dp), tint = c.text2)
            Text("Neue Zeile", color = c.text2, fontSize = 14.sp)
        }
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun DbItem(
    row: DbRow, db: DbData, suggestions: Map<String, List<String>>,
    onOpenPage: (String) -> Unit, set: (String, String, String) -> Unit,
) {
    val c = Impala.colors
    val shape = RoundedCornerShape(Radius.lg)
    Column(Modifier.fillMaxWidth().clip(shape).background(c.surface).border(1.dp, c.edgeSoft, shape).padding(start = 8.dp, end = 8.dp, top = 10.dp, bottom = 8.dp)) {
        val no = db.number?.let { row.props[it.name]?.trim() }.orEmpty()
        Row(
            Modifier.clip(RoundedCornerShape(Radius.sm)).clickable { onOpenPage(row.page.id) }.padding(horizontal = 8.dp, vertical = 2.dp),
            verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            if (no.isNotEmpty()) Text("#$no", color = c.text2, fontSize = 12.sp, fontWeight = FontWeight.SemiBold)
            Icon(painterResource(pageIconRes(row.page)), null, Modifier.size(18.dp), tint = c.text2)
            Text(pageTitle(row.page), color = c.text, fontSize = 16.sp, fontWeight = FontWeight.SemiBold)
        }
        if (db.columns.isEmpty()) return@Column
        // Umbrechendes Raster wie `.db-props` (Mindestbreite 124 dp; Text breit, Mehrfachauswahl ganze Zeile).
        BoxWithConstraints(Modifier.fillMaxWidth().padding(top = 4.dp)) {
            val cols = (maxWidth / 124.dp).toInt().coerceAtLeast(1)
            val cell = maxWidth / cols
            FlowRow(Modifier.fillMaxWidth()) {
                db.columns.forEach { col ->
                    val span = when (col.kind) { "multi_select" -> cols; in WIDE -> minOf(2, cols); else -> 1 }
                    DbField(row.page.id, col, row.props[col.name].orEmpty(), suggestions[col.name].orEmpty(), Modifier.width(cell * span), set)
                }
            }
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun DbField(rowId: String, col: DbColumn, raw: String, suggestions: List<String>, modifier: Modifier, set: (String, String, String) -> Unit) {
    val c = Impala.colors
    val readOnly = col.kind in READ_ONLY
    // Nur echte ISO-Tage als Datumsfeld; Bereiche/Freitext bleiben Text, sonst gingen sie verloren.
    val isDate = col.kind == "date" && (raw.isEmpty() || ISO_DATE.matches(raw))
    var editing by remember { mutableStateOf(false) }
    val shape = RoundedCornerShape(Radius.sm)
    Column(modifier.padding(horizontal = 3.dp, vertical = 2.dp)) {
        Text(col.name, color = c.text2, fontSize = 11.sp, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.padding(horizontal = 6.dp))
        var box = Modifier.fillMaxWidth().heightIn(min = 30.dp).clip(shape)
        if (editing && !isDate) box = box.background(c.surfaceSubtle).border(1.5.dp, c.accentBorder, shape)
        if (!readOnly && !editing) box = box.clickable { editing = true }
        Column(box.padding(horizontal = 6.dp, vertical = 4.dp)) {
            if (editing && !isDate) {
                DbInput(raw, col.kind, suggestions) { v -> editing = false; if (v != null) set(rowId, col.name, v) }
            } else {
                DbShow(col.kind, raw, readOnly, c)
            }
        }
    }
    if (editing && isDate) {
        val initial = raw.takeIf { it.isNotEmpty() }?.let { LocalDate.parse(it).atStartOfDay(ZoneOffset.UTC).toInstant().toEpochMilli() }
        val state = rememberDatePickerState(initialSelectedDateMillis = initial)
        DatePickerDialog(
            onDismissRequest = { editing = false },
            confirmButton = {
                TextButton({
                    editing = false
                    val iso = state.selectedDateMillis?.let { Instant.ofEpochMilli(it).atZone(ZoneOffset.UTC).toLocalDate().toString() }.orEmpty()
                    set(rowId, col.name, iso)
                }) { Text("Übernehmen") }
            },
            dismissButton = {
                TextButton({ editing = false; if (raw.isNotEmpty()) set(rowId, col.name, "") }) { Text(if (raw.isNotEmpty()) "Leeren" else "Abbrechen") }
            },
        ) { DatePicker(state) }
    }
}

/** Anzeige eines Werts: Pills, deutsches Datum oder Text; leer „–“ (`showHtml`). */
@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun DbShow(kind: String, raw: String, readOnly: Boolean, c: ImpalaColors) {
    when {
        raw.isEmpty() -> Text("–", color = c.text2.copy(alpha = 0.45f), fontSize = 14.sp)
        kind in PILL -> FlowRow(horizontalArrangement = Arrangement.spacedBy(4.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
            pillValues(kind, raw).forEach { v ->
                val tc = inlineColor(if (kind == "multi_select") "gray" else tone(v), c.isDark)
                Text(
                    v, color = tc, fontSize = 12.sp, fontWeight = FontWeight.SemiBold, maxLines = 1, overflow = TextOverflow.Ellipsis,
                    modifier = Modifier.clip(RoundedCornerShape(Radius.xs)).background(tc.copy(alpha = 0.16f)).padding(horizontal = 6.dp, vertical = 1.dp),
                )
            }
        }
        kind == "date" && ISO_DATE.matches(raw) -> Text(runCatching { LocalDate.parse(raw).format(DE_DATE) }.getOrDefault(raw), color = c.text, fontSize = 14.sp)
        else -> Text(raw, color = if (readOnly) c.text2 else c.text, fontSize = 14.sp)
    }
}

/** Eingabe eines Werts; fertig mit Enter oder Fokusverlust. Auswahl-Spalten bieten benutzte Werte an. */
@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun DbInput(raw: String, kind: String, suggestions: List<String>, done: (String?) -> Unit) {
    val c = Impala.colors
    var text by remember { mutableStateOf(raw) }
    var finished by remember { mutableStateOf(false) }
    val focus = remember { FocusRequester() }
    var hadFocus by remember { mutableStateOf(false) }
    fun finish(v: String?) { if (!finished) { finished = true; done(v?.takeIf { it != raw }) } }
    LaunchedEffect(Unit) { focus.requestFocus() }
    BasicTextField(
        text, { text = it },
        Modifier.fillMaxWidth().focusRequester(focus).onFocusChanged { if (it.isFocused) hadFocus = true else if (hadFocus) finish(text) },
        textStyle = TextStyle(color = c.text, fontSize = 14.sp),
        cursorBrush = SolidColor(c.accent),
        singleLine = true,
        keyboardOptions = KeyboardOptions(
            keyboardType = when (kind) { "number" -> KeyboardType.Decimal; "url" -> KeyboardType.Uri; "email" -> KeyboardType.Email; else -> KeyboardType.Text },
            imeAction = ImeAction.Done,
        ),
        keyboardActions = KeyboardActions(onDone = { finish(text) }),
    )
    val offer = suggestions.filter { it != text && it.contains(text.trim(), ignoreCase = true) }.take(8)
    if (offer.isNotEmpty()) {
        FlowRow(Modifier.padding(top = 6.dp), horizontalArrangement = Arrangement.spacedBy(4.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
            offer.forEach { v ->
                val tc = inlineColor(tone(v), c.isDark)
                Text(
                    v, color = tc, fontSize = 12.sp, fontWeight = FontWeight.SemiBold,
                    modifier = Modifier.clip(RoundedCornerShape(Radius.xs)).background(tc.copy(alpha = 0.16f)).clickable { finish(v) }
                        .padding(horizontal = 6.dp, vertical = 2.dp),
                )
            }
        }
    }
}
