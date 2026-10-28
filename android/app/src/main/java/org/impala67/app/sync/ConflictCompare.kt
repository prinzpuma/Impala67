package org.impala67.app.sync

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicText
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.launch
import org.impala67.app.ui.theme.Impala
import org.impala67.app.ui.theme.Radius
import org.impala67.app.ui.theme.Space
import org.impala67.app.ui.theme.TextSize
import uniffi.impala_ffi.ConflictInfo
import uniffi.impala_ffi.ConflictResolution
import uniffi.impala_ffi.ConflictType
import uniffi.impala_ffi.DiffRow
import uniffi.impala_ffi.conflictDiffRows

/** Feste Höhe des Vergleichs (web: `cf-compare`, 46dvh auf dem Telefon). */
private val COMPARE_HEIGHT = 360.dp
private val MONO = TextStyle(fontFamily = FontFamily.Monospace, fontSize = 12.5.sp, lineHeight = 19.sp)

/**
 * Gegenüberstellung des Konflikts (`compareHtml` in conflict-ui.js): zeilengenauer Vergleich bei
 * geänderten Seiten, eine Spalte bei gelöschten oder geretteten Kopien.
 */
@Composable
fun ConflictCompare(c: ConflictInfo, copyText: String) {
    when (c.kind) {
        ConflictType.LEGACY -> LegacyCompare(c, copyText)
        ConflictType.DELETE -> CompareShell(bar = { Note("Das Löschen gewinnt beim Zusammenführen. Der geänderte Stand ist hier gerettet.") }) {
            Pane("Geänderter Stand", c.changedAt, copyText, Modifier.fillMaxSize(), Impala.colors.danger)
        }
        ConflictType.BOTH -> BothCompare(c)
    }
}

@Composable
private fun LegacyCompare(c: ConflictInfo, copy: String) {
    val single: @Composable () -> Unit = { Pane(ConflictText.COPY_LABEL, c.time, copy, Modifier.fillMaxSize(), Impala.colors.success) }
    when {
        c.recommended == ConflictResolution.KEEP_WINNER -> CopyToggle(single)
        c.pageId == null -> CompareShell(bar = null, body = single)
        else -> {
            val rows = remember(c.key, c.remoteContent, copy) { conflictDiffRows(c.remoteContent.orEmpty(), copy) }
            if (rows == null) CompareShell(bar = null, body = single)
            else DiffCompare(
                rows = rows,
                leftLabel = ConflictText.CURRENT_LABEL, leftTime = c.remoteTime,
                rightLabel = ConflictText.COPY_LABEL, rightTime = c.time,
                legend = { Legend("− nur in der aktuellen Seite", Impala.colors.danger); Legend("+ nur in der Kopie", Impala.colors.success) },
            )
        }
    }
}

/** „Inhalt der Kopie ansehen“: bei sicher verwerfbaren Kopien eingeklappt (`details.cf-more`). */
@Composable
private fun CopyToggle(body: @Composable () -> Unit) {
    var open by rememberSaveable { mutableStateOf(false) }
    Column(verticalArrangement = Arrangement.spacedBy(Space.s2)) {
        TextButton({ open = !open }) { Text(if (open) "Inhalt der Kopie ausblenden" else "Inhalt der Kopie ansehen", fontSize = TextSize.sm) }
        if (open) CompareShell(bar = null, body = body)
    }
}

@Composable
private fun BothCompare(c: ConflictInfo) {
    val left = c.localContent.orEmpty()
    val right = c.remoteContent.orEmpty()
    if (left.isEmpty() && right.isEmpty()) {
        Box(Modifier.fillMaxWidth().padding(Space.s3)) { Note("Die Änderung betrifft nur den Seitenstatus, nicht den Text.") }
        return
    }
    val rows = remember(c.key, left, right) { conflictDiffRows(left, right) }
    if (rows == null) {
        CompareShell(bar = { Note("Sehr große Seite: Die Fassungen unterscheiden sich auf über 400 Zeilen. Beide Volltexte stehen nebeneinander.") }) {
            Row(Modifier.fillMaxSize().padding(Space.s2), horizontalArrangement = Arrangement.spacedBy(Space.s2)) {
                Pane(ConflictText.HERE, c.localTime, left, Modifier.weight(1f), Impala.colors.danger)
                Pane(ConflictText.OTHER, c.remoteTime, right, Modifier.weight(1f), Impala.colors.success)
            }
        }
        return
    }
    DiffCompare(
        rows = rows,
        leftLabel = ConflictText.HERE, leftTime = c.localTime,
        rightLabel = ConflictText.OTHER, rightTime = c.remoteTime,
        legend = { Legend("− nur auf diesem Gerät", Impala.colors.danger); Legend("+ nur auf Drive / anderem Gerät", Impala.colors.success) },
    )
}

/** Zeilenvergleich mit fester Kopfzeile, Legende und „Nächste Änderung“ (`cf-table`). */
@Composable
private fun DiffCompare(
    rows: List<DiffRow>,
    leftLabel: String,
    leftTime: String?,
    rightLabel: String,
    rightTime: String?,
    legend: @Composable RowScope.() -> Unit,
) {
    val state = rememberLazyListState()
    val scope = rememberCoroutineScope()
    val starts = remember(rows) {
        rows.indices.filter { i -> (rows[i] as? DiffRow.Line)?.let { it.changed && it.start } == true }
    }
    CompareShell(bar = {
        legend()
        if (starts.isNotEmpty()) {
            TextButton(
                onClick = {
                    scope.launch {
                        val next = starts.firstOrNull { it > state.firstVisibleItemIndex } ?: starts.first()
                        state.animateScrollToItem(next)
                    }
                },
                modifier = Modifier.heightIn(min = 44.dp),
            ) { Text("Nächste Änderung (${starts.size})", fontSize = TextSize.xs, maxLines = 1) }
        }
    }) {
        Column(Modifier.fillMaxSize()) {
            Row(Modifier.fillMaxWidth().background(Impala.colors.panel).padding(horizontal = Space.s2, vertical = Space.s2)) {
                Header(leftLabel, leftTime, Modifier.weight(1f))
                Header(rightLabel, rightTime, Modifier.weight(1f))
            }
            LazyColumn(Modifier.fillMaxWidth().weight(1f), state = state) {
                items(rows) { row -> DiffLine(row) }
            }
        }
    }
}

@Composable
private fun DiffLine(row: DiffRow) {
    val c = Impala.colors
    when (row) {
        is DiffRow.Gap -> Text(
            "··· ${row.count} unveränderte Zeilen ···", fontSize = TextSize.xs, color = c.text2,
            textAlign = TextAlign.Center, modifier = Modifier.fillMaxWidth().padding(vertical = 6.dp),
        )
        is DiffRow.Line -> Row(Modifier.fillMaxWidth()) {
            val del = if (row.changed) c.danger.copy(alpha = 0.16f) else null
            val add = if (row.changed) c.success.copy(alpha = 0.16f) else null
            DiffCell(row.left, if (row.changed) "−" else "", del)
            DiffCell(row.right, if (row.changed) "+" else "", add)
        }
    }
}

/** Eine Hälfte einer Zeile; fehlt sie (`null`), bleibt sie leer und blass. */
@Composable
private fun RowScope.DiffCell(text: String?, mark: String, background: Color?) {
    val c = Impala.colors
    Row(
        Modifier.weight(1f).then(if (background != null && text != null) Modifier.background(background) else Modifier)
            .alpha(if (text == null) 0.3f else 1f).padding(horizontal = Space.s1_5),
    ) {
        Text(mark, modifier = Modifier.width(16.dp), textAlign = TextAlign.Center, color = c.text2, fontWeight = FontWeight.Bold, style = MONO)
        BasicText(text ?: " ", modifier = Modifier.weight(1f), style = MONO.copy(color = c.text))
    }
}

/** Einzelne Textfläche mit Überschrift, Zeit und Scroll (`cf-pane`). */
@Composable
private fun Pane(label: String, time: String?, text: String, modifier: Modifier, accent: Color) {
    val c = Impala.colors
    Column(
        modifier.clip(RoundedCornerShape(Radius.md)).background(c.surface),
    ) {
        Row(Modifier.fillMaxWidth().background(c.panel).padding(horizontal = Space.s3, vertical = Space.s2)) {
            Box(Modifier.width(3.dp).height(18.dp).background(accent))
            Column(Modifier.padding(start = Space.s2)) {
                Text(label, fontSize = TextSize.sm, fontWeight = FontWeight.SemiBold, maxLines = 1)
                Text(ConflictText.time(time), fontSize = TextSize.xs3, color = c.text2)
            }
        }
        Column(Modifier.fillMaxWidth().weight(1f).verticalScroll(rememberScrollState()).padding(Space.s3)) {
            BasicText(text.ifEmpty { ConflictText.NO_TEXT }, style = MONO.copy(color = c.text))
        }
    }
}

@Composable
private fun RowScope.Header(label: String, time: String?, modifier: Modifier) {
    Column(modifier.padding(horizontal = Space.s2)) {
        Text(label, fontSize = TextSize.sm, fontWeight = FontWeight.SemiBold, maxLines = 1)
        Text(ConflictText.time(time), fontSize = TextSize.xs3, color = Impala.colors.text2)
    }
}

@Composable
private fun Note(text: String) {
    Text(text, fontSize = TextSize.xs, color = Impala.colors.text2, lineHeight = 17.sp)
}

@Composable
private fun RowScope.Legend(text: String, color: Color) {
    Text(
        text, fontSize = TextSize.xs, color = Impala.colors.text2,
        modifier = Modifier.clip(CircleShape).background(color.copy(alpha = 0.18f)).padding(horizontal = Space.s2, vertical = 2.dp),
    )
}

/** Rahmen eines Vergleichs: optionale Leiste oben, Inhalt füllt den Rest. */
@Composable
private fun CompareShell(bar: (@Composable RowScope.() -> Unit)?, body: @Composable () -> Unit) {
    val c = Impala.colors
    Column(
        Modifier.fillMaxWidth().height(COMPARE_HEIGHT).clip(RoundedCornerShape(Radius.lg))
            .background(c.surfaceSubtle),
    ) {
        if (bar != null) {
            Row(
                Modifier.fillMaxWidth().padding(horizontal = Space.s3, vertical = Space.s2),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(Space.s2, Alignment.End),
            ) { bar() }
        }
        Box(Modifier.fillMaxWidth().weight(1f)) { body() }
    }
}
