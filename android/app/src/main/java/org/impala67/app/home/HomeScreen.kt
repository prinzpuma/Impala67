package org.impala67.app.home

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.IntrinsicSize
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.ExperimentalMaterial3ExpressiveApi
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.IconButtonDefaults
import androidx.compose.material3.LoadingIndicator
import androidx.compose.material3.MaterialTheme
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
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.LinkAnnotation
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.TextLinkStyles
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.text.withLink
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import org.impala67.app.R
import org.impala67.app.ui.components.TintButton
import org.impala67.app.ui.components.TintLabel
import org.impala67.app.ui.components.riseIn
import org.impala67.app.ui.theme.Impala
import org.impala67.app.ui.theme.Space
import org.impala67.app.ui.theme.TextSize

/** Was die Startseite auslöst; die Shell entscheidet, wohin es geht. */
data class HomeActions(
    val openPage: (String) -> Unit,
    val newPage: () -> Unit,
    val study: () -> Unit,
    val settings: () -> Unit,
    val conflicts: () -> Unit,
    val toast: (String) -> Unit,
)

/**
 * Startseite (web/home-view.js + home.css): Begrüßungssatz als Bedienung, darunter Weitermachen und
 * zwei Kennzahlen, darunter der Tagesartikel. Die Lernanalyse (lernanalyse.js) folgt mit dem Lern-Modul.
 */
@OptIn(ExperimentalMaterial3ExpressiveApi::class)
@Composable
fun HomeScreen(vm: HomeViewModel, actions: HomeActions, modifier: Modifier = Modifier) {
    val state by vm.state.collectAsStateWithLifecycle()
    val history by vm.history.collectAsStateWithLifecycle()
    var showHistory by rememberSaveable { mutableStateOf(false) }
    val s = state
    if (s == null) {
        Box(modifier.fillMaxSize(), contentAlignment = Alignment.Center) { LoadingIndicator() }
        return
    }
    BoxWithConstraints(modifier.fillMaxSize().background(Impala.colors.panel)) {
        val width = when {
            maxWidth < 520.dp -> HomeWidth.Narrow
            maxWidth < 760.dp -> HomeWidth.Medium
            else -> HomeWidth.Wide
        }
        val narrow = width == HomeWidth.Narrow
        Column(
            Modifier.fillMaxSize().verticalScroll(rememberScrollState())
                .padding(horizontal = if (narrow) Space.s5 else 40.dp)
                .padding(top = if (narrow) Space.s4 else 56.dp, bottom = if (narrow) 48.dp else 80.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            Column(Modifier.widthIn(max = 800.dp).fillMaxWidth()) {
                TopRow(s, actions, Modifier.riseIn(0))
                if (s.conflictCount > 0) ConflictAlert(s.conflictCount, actions.conflicts, Modifier.riseIn(1))
                Lead(s, narrow, actions.study, Modifier.padding(top = Space.s6).riseIn(1))
                Grid(s, width, actions, vm, Modifier.padding(top = 40.dp).riseIn(2))
                s.article?.let { ArticleCard(it, width, actions.openPage, { vm.markArticleRead(it.article.id) }, { showHistory = true }) }
            }
        }
    }
    if (showHistory) ArticleHistorySheet(history.orEmpty(), actions.openPage) { showHistory = false }
}

@OptIn(ExperimentalMaterial3ExpressiveApi::class)
@Composable
private fun TopRow(s: HomeState, actions: HomeActions, modifier: Modifier) {
    Row(modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Space.s4)) {
        Text(s.dateLine, fontSize = TextSize.sm, color = Impala.colors.text2, modifier = Modifier.weight(1f))
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Space.s1)) {
            TintButton(actions.newPage) { TintLabel("+ Neue Seite") }
            IconButton(actions.settings, shapes = IconButtonDefaults.shapes()) {
                Icon(painterResource(R.drawable.ic_i_gear), "Startseite anpassen", Modifier.size(17.dp), tint = Impala.colors.text2)
            }
        }
    }
}

/** `.hv-alert`: nur bei echtem Handlungsbedarf. */
@Composable
private fun ConflictAlert(count: Int, onSolve: () -> Unit, modifier: Modifier) {
    val c = Impala.colors
    Row(
        modifier.padding(top = Space.s4).fillMaxWidth().clip(CircleShape).background(c.alertBg).padding(start = Space.s4, end = Space.s1),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(
            (if (count == 1) "Ein Sync-Konflikt wartet" else "$count Sync-Konflikte warten") + " auf deine Entscheidung.",
            fontSize = TextSize.sm, color = c.alertText, modifier = Modifier.weight(1f).padding(vertical = Space.s2),
        )
        TextButton(onSolve) { Text("Lösen", fontSize = TextSize.sm, color = c.alertText, textDecoration = TextDecoration.Underline) }
    }
}

/** Begrüßung + ein Satz, was heute zählt; „N Karten“ ist selbst der Knopf zum Lernen. */
@Composable
private fun Lead(s: HomeState, narrow: Boolean, onStudy: () -> Unit, modifier: Modifier) {
    val c = Impala.colors
    val text = buildAnnotatedString {
        withStyle(SpanStyle(color = c.text)) { append(s.greeting + (if (s.name.isNotEmpty()) ", " + s.name else "") + ".") }
        append(" ")
        when {
            s.fresh -> append("Leg deine erste Seite an. Sobald du lernst, füllt sich diese Seite.")
            s.open > 0 -> {
                val link = LinkAnnotation.Clickable("cards", TextLinkStyles(SpanStyle(color = c.text, textDecoration = TextDecoration.Underline))) { onStudy() }
                withLink(link) { append(HomeText.cards(s.open)) }
                append(" ${if (s.open == 1) "wartet" else "warten"}, etwa ${s.estMin} ${if (s.estMin == 1) "Minute" else "Minuten"}.")
            }
            s.hasCards -> append("Für heute ist alles gelernt.")
            else -> append("Noch keine Karteikarten angelegt.")
        }
        if (!s.fresh) append(HomeText.nudge(s))
    }
    Text(
        text, modifier.widthIn(max = 720.dp), color = c.text2,
        style = MaterialTheme.typography.headlineMedium.copy(fontSize = if (narrow) 24.sp else 28.sp),
    )
}

/** `.hv-grid`: breit Weitermachen links, Kennzahlen rechts gestapelt; mittel Kennzahlen nebeneinander. */
@Composable
private fun Grid(s: HomeState, width: HomeWidth, actions: HomeActions, vm: HomeViewModel, modifier: Modifier) {
    val main: @Composable (Modifier) -> Unit = { m ->
        Column(m, verticalArrangement = Arrangement.spacedBy(Space.s4)) {
            ContinueCard(s.last, width, actions.openPage, actions.newPage)
            Pins(s.pins, actions.openPage)
            s.recall?.let { RecallCard(it) }
        }
    }
    val cycleGoal = { vm.cycleGoal { min -> actions.toast("Wochenziel: " + HomeText.dur(min.toDouble())) } }
    when (width) {
        HomeWidth.Wide -> Row(modifier, horizontalArrangement = Arrangement.spacedBy(40.dp)) {
            main(Modifier.weight(1.35f))
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(Space.s4)) {
                CardsStat(s, Modifier.fillMaxWidth(), actions.study)
                WeekStat(s, Modifier.fillMaxWidth()) { cycleGoal() }
            }
        }
        HomeWidth.Medium -> Column(modifier, verticalArrangement = Arrangement.spacedBy(Space.s6)) {
            main(Modifier.fillMaxWidth())
            Row(Modifier.height(IntrinsicSize.Max), horizontalArrangement = Arrangement.spacedBy(Space.s4)) {
                CardsStat(s, Modifier.weight(1f).fillMaxHeight(), actions.study)
                WeekStat(s, Modifier.weight(1f).fillMaxHeight()) { cycleGoal() }
            }
        }
        HomeWidth.Narrow -> Column(modifier, verticalArrangement = Arrangement.spacedBy(Space.s6)) {
            main(Modifier.fillMaxWidth())
            Column(verticalArrangement = Arrangement.spacedBy(Space.s4)) {
                CardsStat(s, Modifier.fillMaxWidth(), actions.study)
                WeekStat(s, Modifier.fillMaxWidth()) { cycleGoal() }
            }
        }
    }
}
