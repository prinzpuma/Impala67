package org.impala67.app.home

import androidx.compose.animation.core.Animatable
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.Icon
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import org.impala67.app.R
import org.impala67.app.ui.components.PanelCard
import org.impala67.app.ui.theme.Impala
import org.impala67.app.ui.theme.Space
import org.impala67.app.ui.theme.TextSize
import java.time.LocalDate
import kotlin.math.roundToInt

private val StatPadding = PaddingValues(horizontal = 22.dp, vertical = 20.dp)

/** „Heute fällig“ (`.hv-cards`): fällig (Akzent), alles gelernt (Grün) oder noch keine Karten. */
@Composable
fun CardsStat(s: HomeState, modifier: Modifier, onStudy: () -> Unit) {
    val c = Impala.colors
    val big = MaterialTheme.typography.displaySmall
    when {
        s.open > 0 -> PanelCard(modifier, color = c.tint2, border = c.accentBorder, padding = StatPadding, onClick = onStudy) {
            Small("Heute fällig")
            Text(HomeText.cards(s.open), style = big, color = c.accent)
            Text("etwa ${s.estMin} Min · Lernen starten", fontSize = TextSize.sm, color = c.text2)
        }
        s.hasCards -> PanelCard(modifier, color = c.successPanel, padding = StatPadding, onClick = onStudy) {
            Small("Heute fällig")
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Space.s2)) {
                Icon(painterResource(R.drawable.ic_i_check), null, Modifier.size(18.dp), tint = c.success)
                Text("Alles gelernt", style = big, color = c.success)
            }
            Text("Morgen geht's weiter", fontSize = TextSize.sm, color = c.text2)
        }
        else -> PanelCard(modifier, padding = StatPadding, onClick = onStudy) {
            Small("Heute fällig")
            Text("Keine Karten", fontSize = TextSize.md, fontWeight = FontWeight.SemiBold)
            Text("Karten anlegen →", fontSize = TextSize.sm, fontWeight = FontWeight.SemiBold, color = c.accent)
        }
    }
}

/** „Diese Woche gelernt“ (`.hv-week`): Summe, Zielbalken, Tagesbalken Mo–So, Streak, Ziel ändern. */
@Composable
fun WeekStat(s: HomeState, modifier: Modifier, onCycleGoal: () -> Unit) {
    val c = Impala.colors
    val reached = s.goalPct >= 100
    PanelCard(modifier, padding = StatPadding) {
        Small("Diese Woche gelernt")
        Spacer(Modifier.height(Space.s1))
        Text(
            buildAnnotatedString {
                append(HomeText.dur(s.weekMin) + " ")
                withStyle(SpanStyle(fontSize = TextSize.md, fontWeight = FontWeight.Normal, letterSpacing = 0.sp, color = if (reached) c.success else c.text2)) {
                    append(if (reached) "· Ziel geschafft" else "von " + HomeText.dur(s.goalMin.toDouble()))
                }
            },
            style = MaterialTheme.typography.displaySmall,
        )
        val goal = grow(s.goalPct / 100f, delay = 150)
        LinearProgressIndicator(
            progress = { goal.value },
            modifier = Modifier.fillMaxWidth().padding(top = Space.s2, bottom = Space.s1).height(8.dp),
            color = if (reached) c.success else c.accent,
            trackColor = c.text.copy(alpha = 0.08f),
            strokeCap = StrokeCap.Round,
            gapSize = 0.dp,
            drawStopIndicator = {},
        )
        DayBars(s)
        Row(
            Modifier.fillMaxWidth().padding(top = Space.s2),
            horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically,
        ) {
            Text(
                if (s.streak > 0) HomeText.dayCount(s.streak, "Tag", "Tage") + " am Stück" else "Heute lernen startet einen Streak",
                fontSize = TextSize.xs, color = c.text2, modifier = Modifier.weight(1f, fill = false),
            )
            Text(
                "Ziel ändern", fontSize = TextSize.xs, color = c.text2, textDecoration = TextDecoration.Underline,
                modifier = Modifier.clip(CircleShape).clickable(onClick = onCycleGoal).padding(horizontal = Space.s1, vertical = Space.s3),
            )
        }
    }
}

/** Tagesbalken (`.hv-bars`): heute Akzent, spätere Tage blass, Höhe relativ zu Tagesziel/Maximum. */
@Composable
private fun DayBars(s: HomeState) {
    val c = Impala.colors
    val todayIdx = LocalDate.now().dayOfWeek.value - 1
    val scale = maxOf(s.goalMin / 7.0, s.week.maxOf { it / 60.0 }, 1.0)
    Row(Modifier.fillMaxWidth().height(48.dp).padding(top = Space.s2), horizontalArrangement = Arrangement.spacedBy(Space.s1)) {
        s.week.forEachIndexed { i, sec ->
            val min = sec / 60.0
            val target = if (min >= 1) maxOf(12, (min / scale * 100).roundToInt()) / 100f else 0f
            val h = grow(target, delay = 100 + 40 * i)
            val today = i == todayIdx
            Column(
                Modifier.weight(1f).fillMaxHeight().graphicsLayer { alpha = if (i > todayIdx) 0.45f else 1f },
                horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(Space.s1),
            ) {
                Box(Modifier.weight(1f).width(10.dp).clip(CircleShape).background(c.text.copy(alpha = 0.07f)), contentAlignment = Alignment.BottomCenter) {
                    Box(Modifier.fillMaxWidth().fillMaxHeight(h.value).clip(CircleShape).background(if (today) c.accent else c.tint3))
                }
                Text(
                    HomeText.days[i], fontSize = TextSize.xs3, lineHeight = TextSize.xs3,
                    color = if (today) c.text else c.text2, fontWeight = if (today) FontWeight.SemiBold else FontWeight.Normal,
                )
            }
        }
    }
}

/** Balken wachsen beim ersten Zeigen mit der Expressive-Feder (`hv-grow-*`), danach folgen sie dem Wert. */
@Composable
private fun grow(target: Float, delay: Int): Animatable<Float, *> {
    val anim = remember { Animatable(0f) }
    val spec = MaterialTheme.motionScheme.slowSpatialSpec<Float>()
    LaunchedEffect(target) {
        if (anim.value == 0f && target > 0f) kotlinx.coroutines.delay(delay.toLong())
        anim.animateTo(target.coerceIn(0f, 1f), spec)
    }
    return anim
}

@Composable
private fun Small(text: String) = Text(text, fontSize = TextSize.xs, color = Impala.colors.text2)
