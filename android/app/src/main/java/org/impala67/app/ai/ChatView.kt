package org.impala67.app.ai

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import org.impala67.app.R
import org.impala67.app.ui.theme.Impala
import org.impala67.app.ui.theme.Radius
import org.impala67.app.ui.theme.Space
import org.impala67.app.ui.theme.TextSize
import java.time.LocalTime

/**
 * Chatverlauf und Eingabe des KI-Panels (`#chatView` der PWA): Nachrichten, Live-Antwort, Fehler,
 * Begrüßung mit Vorschlägen im leeren Chat, unten der Composer mit Senden und Stopp.
 */
@Composable
fun ChatView(
    ai: AiChatViewModel,
    activePageId: String?,
    onOpenSettings: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val messages by ai.messages.collectAsStateWithLifecycle()
    val running by ai.running.collectAsStateWithLifecycle()
    val draft by ai.draft.collectAsStateWithLifecycle()
    val thinking by ai.thinking.collectAsStateWithLifecycle()
    val tool by ai.tool.collectAsStateWithLifecycle()
    val error by ai.error.collectAsStateWithLifecycle()
    var input by rememberSaveable { mutableStateOf("") }
    val listState = rememberLazyListState()
    val lastIndex = messages.size + (if (running) 1 else 0) + (if (error != null) 1 else 0) - 1
    val empty = messages.isEmpty() && !running && error == null

    LaunchedEffect(messages.size, draft.length, running, error) {
        if (lastIndex >= 0) listState.animateScrollToItem(lastIndex)
    }

    Column(modifier.fillMaxWidth()) {
        if (empty) {
            EmptyChat(Modifier.weight(1f)) { input = it }
        } else {
            LazyColumn(
                Modifier.weight(1f).fillMaxWidth(),
                state = listState,
                contentPadding = PaddingValues(horizontal = Space.s3, vertical = Space.s2),
                verticalArrangement = Arrangement.spacedBy(Space.s3),
            ) {
                itemsIndexed(messages) { _, m -> ChatMessageItem(m, ai) }
                if (running) item { LiveBlock(thinking, draft, tool) }
                error?.let { e -> item { ErrorBox(e, onOpenSettings) } }
            }
        }
        Composer(
            input = input,
            running = running,
            onInput = { input = it },
            onSend = {
                ai.send(input, activePageId)
                input = ""
            },
            onStop = ai::stop,
        )
    }
}

@Composable
private fun Composer(input: String, running: Boolean, onInput: (String) -> Unit, onSend: () -> Unit, onStop: () -> Unit) {
    val c = Impala.colors
    Row(
        Modifier.padding(10.dp).fillMaxWidth().clip(RoundedCornerShape(Radius.lg))
            .background(c.surface).border(1.dp, c.edge, RoundedCornerShape(Radius.lg)).padding(Space.s2),
        verticalAlignment = Alignment.Bottom,
    ) {
        BasicTextField(
            input, onInput, Modifier.weight(1f).padding(Space.s1),
            textStyle = TextStyle(color = c.text, fontSize = TextSize.base),
            cursorBrush = SolidColor(c.accent),
            decorationBox = { inner ->
                if (input.isEmpty()) Text("Frag deinen KI-Coach…", color = c.text2, fontSize = TextSize.base)
                inner()
            },
        )
        Spacer(Modifier.size(Space.s2))
        if (running) {
            RoundButton(R.drawable.ic_i_stop, "Antwort abbrechen", c.surfaceActive, c.text, onStop)
        } else {
            RoundButton(R.drawable.ic_i_arrow_up, "Senden", if (input.isBlank()) c.surfaceActive else c.accent, if (input.isBlank()) c.text2 else c.onAccent, onSend, enabled = input.isNotBlank())
        }
    }
}

@Composable
private fun RoundButton(icon: Int, label: String, background: Color, tint: Color, onClick: () -> Unit, enabled: Boolean = true) {
    Box(
        Modifier.size(32.dp).clip(CircleShape).background(background).clickable(enabled = enabled, onClick = onClick),
        contentAlignment = Alignment.Center,
    ) { Icon(painterResource(icon), label, Modifier.size(16.dp), tint = tint) }
}

/** Leerzustand (`chatStartHtml` + `chatSuggestsHtml`): Begrüßung und Vorschläge, die nur den Anfang ins Eingabefeld setzen. */
@Composable
private fun EmptyChat(modifier: Modifier, onSuggest: (String) -> Unit) {
    val c = Impala.colors
    val hour = LocalTime.now().hour
    val greeting = if (hour < 5) "Gute Nacht" else if (hour < 11) "Guten Morgen" else if (hour < 18) "Guten Tag" else "Guten Abend"
    Column(modifier.fillMaxWidth().padding(horizontal = Space.s4, vertical = Space.s5), verticalArrangement = Arrangement.spacedBy(Space.s3)) {
        Text("$greeting.", color = c.text, fontSize = TextSize.lg, fontWeight = FontWeight.SemiBold)
        Text("Was möchtest du heute verstehen?", color = c.text, fontSize = TextSize.lg)
        Text(
            "Frag nach deinen Notizen, lass dir etwas erklären oder dich abfragen. Formeln und Code erscheinen sauber gesetzt.",
            color = c.text2, fontSize = TextSize.sm,
        )
        Spacer(Modifier.size(Space.s2))
        SUGGESTS.forEach { (icon, title, sub, prompt) ->
            Row(
                Modifier.fillMaxWidth().clip(RoundedCornerShape(Radius.md)).border(1.dp, c.edge, RoundedCornerShape(Radius.md))
                    .clickable { onSuggest(prompt) }.padding(Space.s3),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(Space.s3),
            ) {
                Icon(painterResource(icon), null, Modifier.size(16.dp), tint = c.accent)
                Column {
                    Text(title, color = c.text, fontSize = TextSize.sm, fontWeight = FontWeight.SemiBold)
                    Text(sub, color = c.text2, fontSize = TextSize.xs)
                }
            }
        }
    }
}

private data class Suggest(val icon: Int, val title: String, val sub: String, val prompt: String)

private val SUGGESTS = listOf(
    Suggest(R.drawable.ic_i_bulb, "Erklär's mir", "Schritt für Schritt, bis es klickt", "Erkläre mir Schritt für Schritt: "),
    Suggest(R.drawable.ic_i_cards, "Karteikarten", "Aus einem Thema oder deinen Notizen", "Erstelle Karteikarten zu: "),
    Suggest(R.drawable.ic_i_file, "Zusammenfassen", "Das Wichtigste kompakt auf einen Blick", "Fasse kompakt zusammen: "),
    Suggest(R.drawable.ic_i_target, "Quiz mich", "5 Prüfungsfragen mit Auflösung", "Stell mir 5 Prüfungsfragen zu: "),
)
