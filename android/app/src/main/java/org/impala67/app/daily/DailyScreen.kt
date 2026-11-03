package org.impala67.app.daily

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import org.impala67.app.R
import org.impala67.app.core.ImpalaStore
import org.impala67.app.core.Touches
import org.impala67.app.ui.theme.Impala
import org.impala67.app.ui.theme.Radius
import org.impala67.app.ui.theme.Space
import java.time.LocalDate
import java.time.YearMonth
import java.time.format.DateTimeFormatter
import java.util.Locale

private val GERMAN = Locale.GERMANY
private val MONTH = DateTimeFormatter.ofPattern("LLLL yyyy", GERMAN)
private val DAY_TITLE = DateTimeFormatter.ofPattern("EEEE, dd. MMMM yyyy", GERMAN)

/** Tag als `JJJJ-MM-TT` (`localDayKey` in render.js). */
fun dailyKey(day: LocalDate): String = day.toString()

/** Seitentitel einer Tagesseite wie `toLocaleDateString("de-DE", { weekday: "long", … })`. */
fun dailyTitle(day: LocalDate): String = day.format(DAY_TITLE)

/**
 * Daily Notes (render.js `renderDaily`): Monatskalender ab Montag, Tage mit Notiz zeigen die erste
 * Zeile. Tipp öffnet (oder erstellt) die Tagesseite über [onOpenDay].
 */
@Composable
fun DailyScreen(store: ImpalaStore, onOpenDay: (LocalDate) -> Unit, modifier: Modifier = Modifier) {
    val c = Impala.colors
    var monthText by rememberSaveable { mutableStateOf(YearMonth.now().toString()) }
    val month = YearMonth.parse(monthText)
    val notes by remember(store, monthText) {
        store.query(Touches.pages) { core -> core.dailyNotes(monthText).associateBy { it.key } }
    }.collectAsStateWithLifecycle()
    val today = LocalDate.now()

    Column(
        modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(Space.s4),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Column(Modifier.widthIn(max = 960.dp).fillMaxWidth()) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Icon(painterResource(R.drawable.ic_i_calendar), null, Modifier.size(24.dp), tint = c.text)
                Text("  Daily Notes", style = MaterialTheme.typography.headlineSmall, color = c.text)
            }
            Row(Modifier.padding(top = 8.dp), verticalAlignment = Alignment.CenterVertically) {
                TextButton(onClick = { monthText = month.minusMonths(1).toString() }) { Text("‹", fontSize = 18.sp) }
                TextButton(onClick = { monthText = YearMonth.now().toString(); onOpenDay(today) }) { Text("Heute") }
                TextButton(onClick = { monthText = month.plusMonths(1).toString() }) { Text("›", fontSize = 18.sp) }
            }
            Text(
                month.format(MONTH).replaceFirstChar { it.titlecase(GERMAN) } + " — Tag anklicken öffnet (oder erstellt) die Tagesseite",
                color = c.text2, fontSize = 13.sp, modifier = Modifier.padding(bottom = 12.dp),
            )
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                listOf("Mo", "Di", "Mi", "Do", "Fr", "Sa", "So").forEach {
                    Text(it, Modifier.weight(1f).padding(bottom = 4.dp), color = c.text2, fontSize = 12.sp, fontWeight = FontWeight.SemiBold)
                }
            }
            val offset = month.atDay(1).dayOfWeek.value - 1 // Montag = 0
            val cells = List(offset) { null } + (1..month.lengthOfMonth()).map { month.atDay(it) }
            cells.chunked(7).forEach { week ->
                Row(Modifier.fillMaxWidth().padding(bottom = 6.dp), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    (0 until 7).forEach { i ->
                        val day = week.getOrNull(i)
                        Box(Modifier.weight(1f).aspectRatio(1.1f)) {
                            if (day != null) DayCell(day, day == today, notes?.get(dailyKey(day))?.snippet) { onOpenDay(day) }
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun DayCell(day: LocalDate, today: Boolean, snippet: String?, onClick: () -> Unit) {
    val c = Impala.colors
    val shape = RoundedCornerShape(Radius.sm)
    Column(
        Modifier.fillMaxSize().clip(shape)
            .background(if (snippet != null) c.tint else c.surfaceSubtle)
            .border(if (today) 2.dp else 1.dp, if (today) c.accent else c.edgeSoft, shape)
            .clickable(onClick = onClick).padding(6.dp),
    ) {
        Text(day.dayOfMonth.toString(), color = if (today) c.accent else c.text, fontSize = 13.sp, fontWeight = FontWeight.SemiBold)
        if (snippet != null) {
            Text(snippet, color = c.text2, fontSize = 11.sp, lineHeight = 14.sp, maxLines = 3, overflow = TextOverflow.Ellipsis)
        }
    }
}
