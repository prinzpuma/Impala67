package org.impala67.app.study

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.defaultMinSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonColors
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.ButtonGroup
import androidx.compose.material3.ButtonGroupDefaults
import androidx.compose.material3.ExperimentalMaterial3ExpressiveApi
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.IconButtonDefaults
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.compositeOver
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.em
import org.impala67.app.R
import org.impala67.app.ui.components.PanelCard
import org.impala67.app.ui.components.TintButton
import org.impala67.app.ui.components.TintLabel
import org.impala67.app.ui.theme.Impala
import org.impala67.app.ui.theme.Radius
import org.impala67.app.ui.theme.Space
import org.impala67.app.ui.theme.TextSize
import uniffi.impala_ffi.CardInfo
import uniffi.impala_ffi.CardStage
import uniffi.impala_ffi.StudyQueue

/** Kopf des Lernmodus (`.study-head`): zurück zu den Stapeln, Stapelname, Rückgängig. */
@OptIn(ExperimentalMaterial3ExpressiveApi::class)
@Composable
fun ReviewHeader(deck: String?, mix: Boolean, canUndo: Boolean, onExit: () -> Unit, onUndo: () -> Unit) {
    val c = Impala.colors
    Row(Modifier.fillMaxWidth().padding(horizontal = Space.s1, vertical = Space.s1), verticalAlignment = Alignment.CenterVertically) {
        TextButton(onExit) {
            Icon(painterResource(R.drawable.ic_i_chevron_left), null, Modifier.size(18.dp), tint = c.text2)
            Text("Stapel", color = c.text2, fontSize = TextSize.base)
        }
        Text(
            (deck?.let { deckLabel(it) } ?: "Alle Stapel") + if (mix) " · gemischt" else "",
            Modifier.weight(1f), fontSize = TextSize.sm, fontWeight = FontWeight.SemiBold, textAlign = TextAlign.Center,
            maxLines = 1, overflow = TextOverflow.Ellipsis,
        )
        IconButton(onUndo, modifier = Modifier.size(44.dp), enabled = canUndo, shapes = IconButtonDefaults.shapes()) {
            Icon(painterResource(R.drawable.ic_i_undo), "Letzte Bewertung rückgängig", Modifier.size(18.dp), tint = if (canUndo) c.text2 else c.text2.copy(alpha = 0.35f))
        }
    }
}

/** Stapel links, Stufe rechts als Pille (`.study-meta-bar`). */
@Composable
fun CardMeta(card: CardInfo) {
    val c = Impala.colors
    val stage = when (card.stage) {
        CardStage.NEW -> "Neu"
        CardStage.LEARNING -> "Lernen"
        CardStage.RELEARNING -> "Neu lernen"
        CardStage.REVIEW -> "Wiederholen"
    }
    Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Space.s2)) {
        Text(
            deckLabel(card.deck).uppercase(), Modifier.weight(1f), fontSize = TextSize.xs2, fontWeight = FontWeight.SemiBold,
            color = c.text2, letterSpacing = 0.06.em, maxLines = 1, overflow = TextOverflow.Ellipsis,
        )
        if (card.leech) Pill("Leech", c.danger)
        Pill(stage, c.accent)
    }
}

@Composable
private fun Pill(text: String, color: Color) = Text(
    text, fontSize = TextSize.xs2, fontWeight = FontWeight.SemiBold, color = color,
)

/** Eine Seite der Karte (`.card-face`); die Rückseite trägt den Akzentrand. */
@Composable
fun CardFace(label: String, markdown: String, back: Boolean) {
    val c = Impala.colors
    Column(verticalArrangement = Arrangement.spacedBy(Space.s2)) {
        Text(label.uppercase(), fontSize = TextSize.xs2, color = c.text2)
        PanelCard(Modifier.fillMaxWidth(), color = c.surface, border = if (back) c.accentBorder else c.edge, padding = PaddingValues(18.dp)) {
            CardContent(markdown)
        }
    }
}

/** Trennlinie mit „Antwort“ (`.study-divider`). */
@Composable
fun AnswerDivider() {
    Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Space.s3)) {
        HorizontalDivider(Modifier.weight(1f), color = Impala.colors.edge)
        Text("Antwort", fontSize = TextSize.xs, color = Impala.colors.text2)
        HorizontalDivider(Modifier.weight(1f), color = Impala.colors.edge)
    }
}

/** „N neu · N lernen · N wdh.“ (wie Anki) über den Knöpfen. */
@Composable
fun QueueCounts(q: StudyQueue) {
    val c = Impala.colors
    Text(
        buildAnnotatedString {
            withStyle(SpanStyle(color = c.success, fontWeight = FontWeight.Bold)) { append("${q.new}") }
            append(" neu · ")
            withStyle(SpanStyle(color = c.accent, fontWeight = FontWeight.Bold)) { append("${q.learn}") }
            append(" lernen · ")
            withStyle(SpanStyle(color = c.accent, fontWeight = FontWeight.Bold)) { append("${q.review}") }
            append(" wdh.")
        },
        fontSize = TextSize.sm, color = c.text2, textAlign = TextAlign.Center, modifier = Modifier.fillMaxWidth(),
    )
}

/** „Antwort zeigen“ (`[data-ankishowback]`): Akzentfläche, mindestens 220 dp breit. */
@Composable
fun RevealButton(onClick: () -> Unit) {
    val c = Impala.colors
    Button(
        onClick, Modifier.defaultMinSize(minWidth = 220.dp, minHeight = 52.dp), shape = RoundedCornerShape(Radius.lg),
        colors = ButtonDefaults.buttonColors(containerColor = c.accent, contentColor = c.onAccent),
    ) { Text("Antwort zeigen", fontSize = TextSize.md, fontWeight = FontWeight.SemiBold) }
}

/** Die vier Bewertungen als Expressive-`ButtonGroup`; unter dem Namen steht das nächste Intervall. */
@OptIn(ExperimentalMaterial3ExpressiveApi::class)
@Composable
fun GradeButtons(preview: List<String>, onGrade: (Int) -> Unit) {
    val c = Impala.colors
    val labels = listOf("Nochmal", "Schwer", "Gut", "Einfach")
    val tones = listOf(c.danger, c.warn, c.accent, c.success)
    ButtonGroup(
        overflowIndicator = { state -> ButtonGroupDefaults.OverflowIndicator(state) },
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.spacedBy(Space.s1, Alignment.CenterHorizontally),
    ) {
        labels.forEachIndexed { i, label ->
            customItem(
                buttonGroupContent = {
                    val interaction = remember { MutableInteractionSource() }
                    val colors: ButtonColors = ButtonDefaults.buttonColors(
                        containerColor = tones[i].copy(alpha = if (i == 2) 0.28f else 0.16f).compositeOver(c.panel), contentColor = c.text,
                    )
                    Button(
                        { onGrade(i + 1) }, modifier = Modifier.animateWidth(interaction).defaultMinSize(minHeight = 60.dp),
                        shapes = ButtonDefaults.shapes(), colors = colors, interactionSource = interaction,
                        border = BorderStroke(1.dp, tones[i].copy(alpha = 0.35f)), contentPadding = PaddingValues(horizontal = 10.dp, vertical = 6.dp),
                    ) {
                        Column(horizontalAlignment = Alignment.CenterHorizontally) {
                            Text(label, fontSize = TextSize.base, fontWeight = FontWeight.SemiBold, maxLines = 1)
                            Text(preview.getOrElse(i) { "" }, fontSize = TextSize.xs, color = c.text2, maxLines = 1)
                        }
                    }
                },
                menuContent = {},
            )
        }
    }
}

/** Fußleiste (`.study-footer`): Bearbeiten, Aussetzen, Optionen. */
@Composable
fun StudyFooter(onEdit: () -> Unit, onSuspend: () -> Unit, onOptions: () -> Unit) {
    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
        FooterButton("Bearbeiten", R.drawable.ic_i_pen, onEdit)
        FooterButton("Aussetzen", R.drawable.ic_i_pause, onSuspend)
        FooterButton("Optionen", R.drawable.ic_i_gear, onOptions)
    }
}

@Composable
private fun FooterButton(text: String, icon: Int, onClick: () -> Unit) = TextButton(onClick) {
    Icon(painterResource(icon), null, Modifier.size(15.dp), tint = Impala.colors.text2)
    Text("  $text", fontSize = TextSize.sm, color = Impala.colors.text2)
}

/** Ende der Sitzung: „Gratulation!“, „Geschafft!“ (später heute noch Lernschritte) oder nichts fällig. */
@Composable
fun ReviewDone(queue: StudyQueue, onRecheck: () -> Unit, onExit: () -> Unit) {
    val c = Impala.colors
    val (title, lines) = when {
        queue.done -> "Gratulation!" to listOf("Du hast diesen Stapel für heute fertig — keine fälligen Karten und keine offenen Lernschritte mehr.")
        queue.finishedForNow -> "Geschafft!" to listOfNotNull(
            "Du hast diesen Stapel für den Moment fertig gelernt.",
            queue.nextLearnAt?.let { formatTime(it) }?.takeIf { it.isNotEmpty() }?.let { "Die nächste Lernkarte ist ab $it Uhr wieder dran." }
                ?: "Lernkarten sind später heute wieder dran.",
        )
        else -> "Keine Karten fällig" to listOf("Für diesen Stapel gibt es gerade keine weiteren fälligen Karten zum Lernen.")
    }
    Column(
        Modifier.fillMaxWidth().padding(Space.s6), horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(Space.s3, Alignment.CenterVertically),
    ) {
        Icon(painterResource(R.drawable.ic_i_party), null, Modifier.size(40.dp), tint = if (queue.done) c.success else c.accent)
        Text(title, style = androidx.compose.material3.MaterialTheme.typography.headlineMedium)
        lines.forEach { Text(it, fontSize = TextSize.base, color = c.text2, textAlign = TextAlign.Center) }
        Row(horizontalArrangement = Arrangement.spacedBy(Space.s2), modifier = Modifier.padding(top = Space.s2)) {
            if (queue.finishedForNow && !queue.done) TintButton(onRecheck) { TintLabel("Erneut prüfen") }
            TintButton(onExit, strong = !(queue.finishedForNow && !queue.done)) { TintLabel("Zur Stapelübersicht", strong = false) }
        }
    }
}
