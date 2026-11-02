package org.impala67.app.home

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.PathEffect
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import org.impala67.app.study.stats.Goal
import org.impala67.app.study.stats.HomeAnalysis
import org.impala67.app.study.stats.Meter
import org.impala67.app.ui.components.PanelCard
import org.impala67.app.ui.theme.Impala
import org.impala67.app.ui.theme.Space
import org.impala67.app.ui.theme.TextSize
import kotlin.math.max
import kotlin.math.roundToInt

private val DAYS = listOf("Mo", "Di", "Mi", "Do", "Fr", "Sa", "So")

/**
 * Lernanalyse der Startseite (lernanalyse.js): zugeklappt die wichtigste Aussage mit Aktion, aufgeklappt
 * vier Fragen mit je einer Antwort und einer kleinen Grafik.
 */
@Composable
fun HomeAnalysisCard(a: HomeAnalysis, narrow: Boolean, onStudy: () -> Unit, onStudyDeck: (String) -> Unit, modifier: Modifier = Modifier) {
    val c = Impala.colors
    var open by rememberSaveable { mutableStateOf(false) }
    PanelCard(modifier.fillMaxWidth(), padding = androidx.compose.foundation.layout.PaddingValues(horizontal = 22.dp, vertical = 16.dp)) {
        Row(Modifier.fillMaxWidth().clickable { open = !open }, verticalAlignment = Alignment.CenterVertically) {
            Text(a.headline, Modifier.weight(1f), color = c.text, fontSize = TextSize.base)
            a.action?.let { label ->
                TextButton({ a.actionDeck?.let(onStudyDeck) ?: onStudy() }) { Text(label, color = c.accent, fontSize = TextSize.sm) }
            }
            Text(if (open) "Lernanalyse ▴" else "Lernanalyse ▾", color = c.text2, fontSize = TextSize.xs)
        }
        AnimatedVisibility(open) {
            val blocks: List<@Composable (Modifier) -> Unit> = listOf(
                { m -> Block("Schaffe ich das Wochenziel?", a.goal.text, a.goal.warn, m) { GoalChart(a.goal) } },
                { m ->
                    Block("Welche Fächer lassen nach?", a.subjects.text, a.subjects.worst != null, m) {
                        a.subjects.rows.forEach { r ->
                            Row(Modifier.fillMaxWidth().clickable { onStudyDeck(r.deck) }.padding(vertical = 3.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Space.s2)) {
                                Text(r.subject, Modifier.width(90.dp), color = c.text, fontSize = TextSize.xs, maxLines = 1)
                                Meter(r.now, Modifier.weight(1f), mark = r.before, color = if (r.delta <= -8) c.warn else c.accent)
                                Text("${(r.now * 100).roundToInt()} %", color = c.text, fontSize = TextSize.xs)
                                Text((if (r.delta > 0) "+" else "") + r.delta, color = c.text2, fontSize = TextSize.xs)
                            }
                        }
                    }
                },
                { m ->
                    Block("Wann lerne ich am besten?", a.time.text, false, m) {
                        a.time.slots.forEach { s ->
                            val ok = s.n >= 20
                            Row(Modifier.fillMaxWidth().padding(vertical = 3.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Space.s2)) {
                                Text(s.label, Modifier.width(70.dp), color = if (ok) c.text else c.text2, fontSize = TextSize.xs, fontWeight = if (a.time.best == s) FontWeight.SemiBold else FontWeight.Normal)
                                Meter(if (ok) s.rate ?: 0.0 else 0.0, Modifier.weight(1f), color = if (a.time.best == s) c.success else c.accent)
                                Text(if (ok) "${((s.rate ?: 0.0) * 100).roundToInt()} %" else "–", color = c.text, fontSize = TextSize.xs)
                                Text("${s.n}×", color = c.text2, fontSize = TextSize.xs)
                            }
                        }
                    }
                },
                { m ->
                    Block("Was kommt auf mich zu?", a.forecast.text, a.forecast.peak > 0, m) {
                        val mx = max(1, a.forecast.counts.max())
                        Row(Modifier.fillMaxWidth().height(90.dp), horizontalArrangement = Arrangement.spacedBy(4.dp), verticalAlignment = Alignment.Bottom) {
                            a.forecast.counts.forEachIndexed { i, n ->
                                Column(Modifier.weight(1f).fillMaxHeight(), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.Bottom) {
                                    Text(if (n > 0) "$n" else "", color = c.text, fontSize = TextSize.xs2)
                                    Box(Modifier.weight(1f).fillMaxWidth(), contentAlignment = Alignment.BottomCenter) {
                                        if (n > 0) Box(
                                            Modifier.fillMaxWidth().fillMaxHeight(max(0.04f, n / mx.toFloat())).clip(RoundedCornerShape(3.dp))
                                                .background(if (i == a.forecast.peak) c.warn else c.accent),
                                        )
                                    }
                                    Text(a.forecast.labels[i], color = c.text2, fontSize = TextSize.xs2)
                                }
                            }
                        }
                    }
                },
            )
            if (narrow) {
                Column(Modifier.padding(top = Space.s3), verticalArrangement = Arrangement.spacedBy(Space.s4)) { blocks.forEach { it(Modifier.fillMaxWidth()) } }
            } else {
                Column(Modifier.padding(top = Space.s3), verticalArrangement = Arrangement.spacedBy(Space.s4)) {
                    blocks.chunked(2).forEach { pair ->
                        Row(horizontalArrangement = Arrangement.spacedBy(Space.s5)) { pair.forEach { it(Modifier.weight(1f)) } }
                    }
                }
            }
        }
    }
}

@Composable
private fun Block(question: String, answer: String, warn: Boolean, modifier: Modifier, visual: @Composable () -> Unit) {
    val c = Impala.colors
    Column(modifier, verticalArrangement = Arrangement.spacedBy(Space.s1)) {
        Text(question, color = c.text2, fontSize = TextSize.xs, fontWeight = FontWeight.SemiBold)
        Text(answer, color = if (warn) c.warn else c.text, fontSize = TextSize.sm)
        visual()
    }
}

/** Kumulierte Lernzeit der Woche, Ziellinie und gestrichelte Prognose (lernanalyse.js `goalChart`). */
@Composable
private fun GoalChart(g: Goal) {
    val c = Impala.colors
    Column {
        Canvas(Modifier.fillMaxWidth().height(80.dp)) {
            val pad = 4.dp.toPx()
            val top = max(g.goalMin.toDouble(), g.done + g.pace * g.left) * 1.08
            val mx = if (top <= 0) 1.0 else top
            val x = { i: Int -> pad + i * (size.width - 2 * pad) / 6 }
            val y = { v: Double -> (size.height - pad - v / mx * (size.height - 2 * pad)).toFloat() }
            drawLine(c.text2.copy(alpha = 0.5f), Offset(pad, y(g.goalMin.toDouble())), Offset(size.width - pad, y(g.goalMin.toDouble())), 1.dp.toPx(), pathEffect = PathEffect.dashPathEffect(floatArrayOf(6f, 6f)))
            var cum = 0.0
            val line = Path()
            g.days.take(g.today + 1).forEachIndexed { i, m ->
                cum += m
                if (i == 0) line.moveTo(x(i), y(cum)) else line.lineTo(x(i), y(cum))
            }
            if (g.need > 0 && g.today < 6) {
                val proj = Path().apply { moveTo(x(g.today), y(cum)) }
                var p = cum
                for (k in 1..(6 - g.today)) { p += g.pace; proj.lineTo(x(g.today + k), y(p)) }
                drawPath(proj, c.accent.copy(alpha = 0.5f), style = Stroke(2.dp.toPx(), pathEffect = PathEffect.dashPathEffect(floatArrayOf(5f, 5f))))
            }
            drawPath(line, c.accent, style = Stroke(2.5f.dp.toPx()))
            drawCircle(c.accent, 3.5f.dp.toPx(), Offset(x(g.today), y(cum)))
        }
        Row(Modifier.fillMaxWidth()) {
            DAYS.forEachIndexed { i, d ->
                Text(d, Modifier.weight(1f), color = if (i == g.today) c.text else c.text2, fontSize = TextSize.xs2, fontWeight = if (i == g.today) FontWeight.SemiBold else FontWeight.Normal)
            }
        }
    }
}
