package org.impala67.app.ai

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import org.impala67.app.R
import org.impala67.app.editor.MarkdownView
import org.impala67.app.ui.theme.Impala
import org.impala67.app.ui.theme.Radius
import org.impala67.app.ui.theme.Space
import org.impala67.app.ui.theme.TextSize
import uniffi.impala_ffi.ChatMessage

/** Eine Nachricht des Chats je nach Art (`role`), wie `renderMessage` in der PWA. */
@Composable
fun ChatMessageItem(m: ChatMessage, ai: AiChatViewModel) {
    when (m.role) {
        "user" -> UserBubble(m.content.orEmpty())
        "assistant" -> MarkdownView(m.content.orEmpty(), Modifier.fillMaxWidth())
        "thought" -> ThinkBox(m.reasoning.orEmpty())
        "tool" -> ToolChip(m.name.orEmpty(), m.detail, m.error == true)
        "edit" -> EditCard(m.summary ?: "KI-Änderungen", undone = m.undone == true) { m.mid?.let(ai::undo) }
        "question" -> QuestionCard(m) { option -> m.mid?.let { ai.answer(it, option) } }
    }
}

@Composable
fun UserBubble(text: String) {
    val c = Impala.colors
    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.End) {
        Box(Modifier.clip(RoundedCornerShape(Radius.lg)).background(c.bubble).padding(horizontal = Space.s3, vertical = Space.s2)) {
            Text(text, color = c.text, fontSize = TextSize.base)
        }
    }
}

/** Gedankengang: eingeklappt bis zum Antippen (`thinkBoxHtml`). */
@Composable
fun ThinkBox(text: String) {
    val c = Impala.colors
    var expanded by rememberSaveable { mutableStateOf(false) }
    Column(
        Modifier.fillMaxWidth().clip(RoundedCornerShape(Radius.sm)).border(1.dp, c.edgeSoft, RoundedCornerShape(Radius.sm))
            .clickable { expanded = !expanded }.padding(Space.s2),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Space.s1)) {
            Icon(painterResource(R.drawable.ic_i_brain), null, Modifier.size(13.dp), tint = c.text2)
            Text("Gedankengang", color = c.text2, fontSize = TextSize.xs, fontWeight = FontWeight.SemiBold)
        }
        if (expanded) Text(text, Modifier.padding(top = Space.s1), color = c.text2, fontSize = TextSize.xs, fontStyle = FontStyle.Italic)
    }
}

/** Werkzeug-Chip („Hat … verwendet“). */
@Composable
fun ToolChip(name: String, detail: String?, error: Boolean) {
    val c = Impala.colors
    val tint = if (error) c.danger else c.text2
    Row(
        Modifier.clip(RoundedCornerShape(Radius.sm)).border(1.dp, c.edgeSoft, RoundedCornerShape(Radius.sm)).padding(horizontal = Space.s2, vertical = Space.s1),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(Space.s1),
    ) {
        Icon(painterResource(R.drawable.ic_i_gear), null, Modifier.size(12.dp), tint = tint)
        val label = TOOL_LABELS[name] ?: name
        val suffix = listOfNotNull(detail?.takeIf { it.isNotBlank() }?.let { "· $it" }, "— Fehler".takeIf { error }).joinToString(" ")
        Text(if (suffix.isEmpty()) label else "$label $suffix", color = tint, fontSize = TextSize.xs)
    }
}

/** Änderungs-Karte mit „Rückgängig“ (`editCardHtml`). */
@Composable
fun EditCard(summary: String, undone: Boolean, onUndo: () -> Unit) {
    val c = Impala.colors
    Column(
        Modifier.fillMaxWidth().clip(RoundedCornerShape(Radius.md)).background(c.surface)
            .border(1.dp, c.edge, RoundedCornerShape(Radius.md)).padding(Space.s3),
        verticalArrangement = Arrangement.spacedBy(Space.s1),
    ) {
        Text(summary, color = c.text, fontSize = TextSize.sm, fontWeight = FontWeight.SemiBold)
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(
                if (undone) "Rückgängig gemacht" else "Atomar gespeichert",
                Modifier.weight(1f), color = c.text2, fontSize = TextSize.xs,
            )
            Box(
                Modifier.clip(RoundedCornerShape(Radius.sm)).clickable(enabled = !undone, onClick = onUndo).padding(horizontal = Space.s2, vertical = Space.s1),
            ) {
                Text("↺ Rückgängig", color = if (undone) c.text2.copy(alpha = 0.4f) else c.accent, fontSize = TextSize.xs, fontWeight = FontWeight.Medium)
            }
        }
    }
}

/** Rückfrage (`ask_choice`): Optionen als Knöpfe, nach der Antwort nur noch die gewählte Option. */
@Composable
fun QuestionCard(m: ChatMessage, onAnswer: (String) -> Unit) {
    val c = Impala.colors
    Column(
        Modifier.fillMaxWidth().clip(RoundedCornerShape(Radius.md)).background(c.surface)
            .border(1.dp, c.edge, RoundedCornerShape(Radius.md)).padding(Space.s3),
        verticalArrangement = Arrangement.spacedBy(Space.s2),
    ) {
        Text("Rückfrage", color = c.text2, fontSize = TextSize.xs, fontWeight = FontWeight.SemiBold)
        Text(m.question.orEmpty(), color = c.text, fontSize = TextSize.base)
        if (m.answered == true) {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Space.s1)) {
                Icon(painterResource(R.drawable.ic_i_check), null, Modifier.size(14.dp), tint = c.success)
                Text(m.answer.orEmpty(), color = c.text, fontSize = TextSize.sm, fontWeight = FontWeight.SemiBold)
            }
        } else {
            m.options.orEmpty().forEach { option ->
                Box(
                    Modifier.fillMaxWidth().clip(RoundedCornerShape(Radius.sm)).border(1.dp, c.edge, RoundedCornerShape(Radius.sm))
                        .clickable { onAnswer(option) }.padding(horizontal = Space.s3, vertical = Space.s2),
                ) {
                    Text(option, color = c.text, fontSize = TextSize.sm)
                }
            }
        }
    }
}

/** Antwort in Arbeit: Gedankengang, Entwurf oder Statuszeile (`busy`-Zeile der PWA). */
@Composable
fun LiveBlock(thinking: String, draft: String, tool: String?) {
    val c = Impala.colors
    Column(verticalArrangement = Arrangement.spacedBy(Space.s2)) {
        if (thinking.isNotEmpty()) ThinkBox(thinking)
        if (draft.isNotEmpty()) {
            MarkdownView(draft, Modifier.fillMaxWidth())
        } else {
            Text(tool?.let { "${TOOL_LABELS[it] ?: it} …" } ?: "Denkt nach…", color = c.text2, fontSize = TextSize.sm, fontStyle = FontStyle.Italic)
        }
    }
}

/** Abbruch oder Fehler des Laufs; bei Fehlern der Weg zu den KI-Einstellungen. */
@Composable
fun ErrorBox(error: AiError, onOpenSettings: () -> Unit) {
    val c = Impala.colors
    Column(
        Modifier.fillMaxWidth().clip(RoundedCornerShape(Radius.md)).background(c.alertBg).padding(Space.s3),
        verticalArrangement = Arrangement.spacedBy(Space.s2),
    ) {
        if (error.aborted) {
            Text("Abgebrochen.", color = c.text2, fontSize = TextSize.sm, fontStyle = FontStyle.Italic)
        } else {
            Text(error.message, color = c.alertText, fontSize = TextSize.sm)
            Box(Modifier.clip(RoundedCornerShape(Radius.sm)).clickable(onClick = onOpenSettings).padding(vertical = Space.s1)) {
                Text("KI-Einstellungen öffnen", color = c.accent, fontSize = TextSize.sm, fontWeight = FontWeight.Medium)
            }
        }
    }
}

/** Werkzeugnamen wie `TOOL_LABELS` in web/render.js. */
val TOOL_LABELS: Map<String, String> = mapOf(
    "inspect" to "App-Daten gelesen", "change" to "Änderungen ausgeführt", "view_heft_page" to "Heftseite angesehen",
    "read_page" to "Seite gelesen", "search_notes" to "Notizen durchsucht", "semantic_search" to "Semantische Suche",
    "create_page" to "Seite erstellt", "append_to_page" to "Seite ergänzt", "replace_page_content" to "Seite überschrieben",
    "create_flashcard" to "Karteikarte erstellt", "create_cloze_card" to "Cloze-Karten erstellt", "move_page" to "Seite verschoben",
    "list_pages" to "Seiten aufgelistet", "list_due_cards" to "Fällige Karten", "send_to_notebooklm" to "An NotebookLM",
    "ask_choice" to "Rückfrage gestellt", "delete_page" to "Seite gelöscht", "delete_flashcard" to "Karte gelöscht",
    "delete_deck" to "Stapel gelöscht", "create_flashcards" to "Karteikarten erstellt", "delete_flashcards" to "Karten gelöscht",
    "list_flashcards" to "Karten durchgesehen", "list_decks" to "Stapel aufgelistet", "create_deck" to "Stapel angelegt",
    "rename_deck" to "Stapel umbenannt", "move_deck" to "Stapel verschoben", "move_flashcards" to "Karten verschoben",
    "update_flashcard" to "Karte überarbeitet", "suspend_flashcards" to "Karten pausiert",
    "reset_card_progress" to "Lernfortschritt zurückgesetzt", "get_context" to "Kontext geholt",
    "write_to_heft" to "Ins Heft geschrieben", "get_heft_page_image" to "Heftseite angesehen",
    "search_chat_history" to "Frühere Chats durchsucht", "calculate" to "Gerechnet", "request_tools" to "Werkzeuge freigeschaltet",
)
