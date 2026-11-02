package org.impala67.app.study.stats

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import org.impala67.app.ui.theme.Impala
import org.impala67.app.ui.theme.Space
import org.impala67.app.ui.theme.TextSize
import java.time.LocalDate

/** Säulendiagramm (`.bar-chart`): Höhe relativ zum größten Wert, Beschriftung darunter. [top] steht über der Säule. */
@Composable
fun BarChart(values: List<Float>, labels: List<String>, modifier: Modifier = Modifier, top: List<String>? = null, highlight: Int = -1, height: Int = 110) {
    val c = Impala.colors
    val max = (values.maxOrNull() ?: 0f).coerceAtLeast(1f)
    Row(modifier.fillMaxWidth().height(height.dp), horizontalArrangement = Arrangement.spacedBy(2.dp), verticalAlignment = Alignment.Bottom) {
        values.forEachIndexed { i, v ->
            Column(Modifier.weight(1f).fillMaxHeight(), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.Bottom) {
                top?.getOrNull(i)?.let { Text(it, color = c.text, fontSize = TextSize.xs2, fontWeight = FontWeight.SemiBold) }
                Box(
                    Modifier.fillMaxWidth().weight(1f, fill = true),
                    contentAlignment = Alignment.BottomCenter,
                ) {
                    Box(
                        Modifier.fillMaxWidth().fillMaxHeight(v / max).clip(RoundedCornerShape(topStart = 3.dp, topEnd = 3.dp))
                            .background(if (i == highlight) c.warn else c.accent.copy(alpha = if (v > 0) 0.85f else 0f)),
                    )
                }
                Text(labels.getOrElse(i) { "" }, color = c.text2, fontSize = TextSize.xs2, maxLines = 1)
            }
        }
    }
}

/** Gestapelter Balken mit Legende (`.anki-stack` + `.anki-legend`). */
@Composable
fun StackBar(parts: List<Triple<String, Int, Color>>) {
    val c = Impala.colors
    val total = parts.sumOf { it.second }.coerceAtLeast(1)
    Row(Modifier.fillMaxWidth().height(14.dp).clip(RoundedCornerShape(7.dp))) {
        parts.filter { it.second > 0 }.forEach { (_, n, color) -> Box(Modifier.weight(n.toFloat() / total).fillMaxHeight().background(color)) }
    }
    Row(Modifier.padding(top = Space.s2), horizontalArrangement = Arrangement.spacedBy(Space.s3)) {
        parts.forEach { (label, n, color) ->
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                Box(Modifier.size(9.dp).clip(RoundedCornerShape(2.dp)).background(color))
                Text("$label ", color = c.text2, fontSize = TextSize.xs)
                Text("$n", color = c.text, fontSize = TextSize.xs, fontWeight = FontWeight.SemiBold)
            }
        }
    }
}

/** Füllbalken mit optionaler Vorher-Marke (`.anki-meter`, `.la-meter`). */
@Composable
fun Meter(value: Double, modifier: Modifier = Modifier, mark: Double? = null, color: Color = Impala.colors.accent) {
    val track = Impala.colors.text.copy(alpha = 0.08f)
    val markColor = Impala.colors.text2
    Canvas(modifier.height(8.dp)) {
        val r = CornerRadius(size.height / 2)
        drawRoundRect(track, cornerRadius = r)
        drawRoundRect(color, size = Size(size.width * value.toFloat().coerceIn(0f, 1f), size.height), cornerRadius = r)
        mark?.let { m -> val x = size.width * m.toFloat().coerceIn(0f, 1f); drawLine(markColor, Offset(x, -2f), Offset(x, size.height + 2f), 2f) }
    }
}

/** Aktivitäts-Heatmap: 53 Wochen × 7 Tage, fünf Stufen (anki-stats.js `heatmapHtml`). */
@Composable
fun Heatmap(perDay: Map<LocalDate, Int>, today: LocalDate) {
    val accent = Impala.colors.accent
    val empty = Impala.colors.text.copy(alpha = 0.07f)
    val start = heatmapStart(today)
    val weeks = ((today.toEpochDay() - start.toEpochDay()) / 7 + 1).toInt()
    Box(Modifier.fillMaxWidth().horizontalScroll(rememberScrollState(Int.MAX_VALUE))) {
        Canvas(Modifier.width((weeks * 13).dp).height((7 * 13).dp)) {
            val cell = 13.dp.toPx()
            val gap = 2.dp.toPx()
            var d = start
            while (!d.isAfter(today)) {
                val w = ((d.toEpochDay() - start.toEpochDay()) / 7).toInt()
                val row = d.dayOfWeek.value - 1
                val lvl = heatLevel(perDay[d] ?: 0)
                drawRoundRect(
                    if (lvl == 0) empty else accent.copy(alpha = 0.25f + 0.1875f * lvl),
                    topLeft = Offset(w * cell, row * cell), size = Size(cell - gap, cell - gap), cornerRadius = CornerRadius(2.dp.toPx()),
                )
                d = d.plusDays(1)
            }
        }
    }
}

/** Abschnittstitel mit Hinweis (`ankiSec`). */
@Composable
fun Section(title: String, note: String = "") {
    val c = Impala.colors
    Column(Modifier.padding(top = Space.s5, bottom = Space.s2)) {
        Text(title, color = c.text, fontSize = TextSize.md, fontWeight = FontWeight.SemiBold)
        if (note.isNotEmpty()) Text(note, color = c.text2, fontSize = TextSize.xs)
    }
}

/** Einfache Tabelle (`.lib-table`): erste Spalte breit, Rest gleich breit. */
@Composable
fun SimpleTable(head: List<String>, rows: List<List<String>>, cell: (@Composable (row: Int, col: Int) -> Unit)? = null) {
    val c = Impala.colors
    Column(Modifier.fillMaxWidth()) {
        Row(Modifier.fillMaxWidth().padding(vertical = Space.s1)) {
            head.forEachIndexed { i, h -> Text(h, Modifier.weight(if (i == 0) 2f else 1f), color = c.text2, fontSize = TextSize.xs, fontWeight = FontWeight.SemiBold) }
        }
        rows.forEachIndexed { r, row ->
            Row(Modifier.fillMaxWidth().background(c.text.copy(alpha = if (r % 2 == 0) 0.03f else 0f)).padding(vertical = 6.dp), verticalAlignment = Alignment.CenterVertically) {
                row.forEachIndexed { i, v ->
                    Box(Modifier.weight(if (i == 0) 2f else 1f)) {
                        if (cell != null && i == row.lastIndex) cell(r, i) else Text(v, color = c.text, fontSize = TextSize.sm, maxLines = 1)
                    }
                }
            }
        }
    }
}
