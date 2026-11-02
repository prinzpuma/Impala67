package org.impala67.app.ai

import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import org.impala67.app.R
import org.impala67.app.notes.formatDate
import org.impala67.app.ui.desk.MenuEntry
import org.impala67.app.ui.desk.SmallButton
import org.impala67.app.ui.theme.Impala
import org.impala67.app.ui.theme.Radius
import org.impala67.app.ui.theme.Space
import org.impala67.app.ui.theme.TextSize
import uniffi.impala_ffi.ChatInfo

/**
 * Chat-Verlauf der Seitenleiste (`chatListHtml` in web/render.js): „+ Neuer Chat“, darunter die Chats
 * mit Datum. Antippen öffnet den Chat im KI-Panel; ⋯ (oder Halten) bietet „In eigenem Tab öffnen“,
 * „Umbenennen“, „Auswählen“ und „Löschen“. In der Auswahl ersetzt eine Leiste („N ausgewählt“, Alle, ✕,
 * Löschen) den Kopf; Antippen wählt dann aus statt zu öffnen.
 */
@Composable
fun ChatList(ai: AiChatViewModel, modifier: Modifier = Modifier, onOpenTab: ((String) -> Unit)? = null) {
    val c = Impala.colors
    val chats by ai.chats.collectAsStateWithLifecycle()
    val current by ai.chatId.collectAsStateWithLifecycle()
    val running by ai.running.collectAsStateWithLifecycle()
    var pendingDelete by remember { mutableStateOf<Set<String>?>(null) }
    var renaming by remember { mutableStateOf<ChatInfo?>(null) }
    var selection by rememberSaveable { mutableStateOf(emptySet<String>()) }
    val list = chats.orEmpty()
    // Gelöschte Chats (auch von anderen Geräten) fallen aus der Auswahl.
    if (chats != null) selection.filterTo(HashSet()) { id -> list.any { it.id == id } }.let { if (it != selection) selection = it }
    fun toggle(id: String) { selection = if (id in selection) selection - id else selection + id }
    LazyColumn(modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(2.dp)) {
        item {
            if (selection.isNotEmpty()) {
                SelectionBar(
                    count = selection.size,
                    onAll = { selection = list.mapTo(HashSet()) { it.id } },
                    onNone = { selection = emptySet() },
                    onDelete = { pendingDelete = selection },
                )
            } else {
                Box(
                    Modifier.fillMaxWidth().heightIn(min = 40.dp).clip(RoundedCornerShape(Radius.sm))
                        .clickable(enabled = !running) { ai.newChat() }.padding(horizontal = Space.s2),
                    contentAlignment = Alignment.CenterStart,
                ) {
                    Text("+ Neuer Chat", color = if (running) c.text2.copy(alpha = 0.5f) else c.text2, fontSize = TextSize.sm)
                }
            }
        }
        if (chats != null && list.isEmpty()) {
            item { Text("Noch keine gespeicherten Chats.", Modifier.padding(horizontal = Space.s2, vertical = Space.s1), color = c.text2, fontSize = TextSize.sm) }
        }
        items(list, key = { it.id }) { chat ->
            val busy = running && chat.id == current
            ChatRow(
                chat = chat,
                active = chat.id == current,
                enabled = !busy,
                selecting = selection.isNotEmpty(),
                selected = chat.id in selection,
                actions = ChatRowActions(
                    open = { if (selection.isNotEmpty()) toggle(chat.id) else ai.open(chat.id) },
                    openTab = onOpenTab?.let { f -> { f(chat.id) } },
                    rename = { renaming = chat },
                    select = { toggle(chat.id) },
                    delete = { pendingDelete = setOf(chat.id) },
                ),
            )
        }
    }
    pendingDelete?.let { ids ->
        val one = ids.singleOrNull()?.let { id -> list.firstOrNull { it.id == id } }
        AlertDialog(
            onDismissRequest = { pendingDelete = null },
            title = { Text(if (one != null) "Chat löschen" else "Chats löschen") },
            text = {
                Text(
                    if (one != null) "„${one.title.ifBlank { "Chat" }}“ wirklich löschen? Das kann nicht rückgängig gemacht werden."
                    else "${ids.size} Chats wirklich löschen? Das kann nicht rückgängig gemacht werden.",
                )
            },
            confirmButton = {
                TextButton(onClick = { ai.delete(ids); selection = selection - ids; pendingDelete = null }) { Text("Löschen", color = c.danger) }
            },
            dismissButton = { TextButton(onClick = { pendingDelete = null }) { Text("Abbrechen") } },
        )
    }
    renaming?.let { chat ->
        var text by rememberSaveable(chat.id) { mutableStateOf(chat.title) }
        AlertDialog(
            onDismissRequest = { renaming = null },
            title = { Text("Chat umbenennen") },
            text = { OutlinedTextField(text, { text = it }, Modifier.fillMaxWidth(), singleLine = true, label = { Text("Titel") }) },
            confirmButton = {
                TextButton({ ai.rename(chat.id, text); renaming = null }, enabled = text.isNotBlank()) { Text("Speichern") }
            },
            dismissButton = { TextButton({ renaming = null }) { Text("Abbrechen") } },
        )
    }
}

/** Kopf in der Auswahl (`.chat-selbar`). */
@Composable
private fun SelectionBar(count: Int, onAll: () -> Unit, onNone: () -> Unit, onDelete: () -> Unit) {
    val c = Impala.colors
    Row(
        Modifier.fillMaxWidth().heightIn(min = 40.dp).padding(start = Space.s2),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text("$count ausgewählt", Modifier.weight(1f), color = c.text, fontSize = TextSize.sm)
        Box(
            Modifier.heightIn(min = 32.dp).clip(RoundedCornerShape(Radius.sm)).clickable(onClickLabel = "Alle Chats auswählen", onClick = onAll)
                .padding(horizontal = Space.s2),
            contentAlignment = Alignment.Center,
        ) { Text("Alle", color = c.text2, fontSize = TextSize.sm) }
        SmallButton(R.drawable.ic_i_x, "Auswahl aufheben", onClick = onNone)
        SmallButton(R.drawable.ic_i_trash, "Ausgewählte Chats löschen", danger = true, onClick = onDelete)
    }
}

private class ChatRowActions(
    val open: () -> Unit,
    val openTab: (() -> Unit)?,
    val rename: () -> Unit,
    val select: () -> Unit,
    val delete: () -> Unit,
)

@OptIn(ExperimentalFoundationApi::class)
@Composable
private fun ChatRow(chat: ChatInfo, active: Boolean, enabled: Boolean, selecting: Boolean, selected: Boolean, actions: ChatRowActions) {
    val c = Impala.colors
    var menuOpen by remember { mutableStateOf(false) }
    Row(
        Modifier.fillMaxWidth().heightIn(min = 40.dp).clip(RoundedCornerShape(Radius.sm))
            .background(if (active || selected) c.accent.copy(alpha = 0.14f) else Color.Transparent)
            .combinedClickable(
                enabled = enabled || selecting,
                onLongClickLabel = "Weitere Optionen",
                onLongClick = { if (selecting) actions.select() else menuOpen = true },
                onClick = actions.open,
            ).padding(start = Space.s2, end = 2.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        if (selecting) {
            SmallButton(if (selected) R.drawable.ic_i_check_square else R.drawable.ic_i_square, if (selected) "Abwählen" else "Auswählen", size = 28, active = selected, onClick = actions.select)
        }
        Column(Modifier.weight(1f).padding(vertical = Space.s1)) {
            Text(
                chat.title.ifBlank { "Chat" }, color = if (enabled) c.text else c.text2, fontSize = TextSize.sm,
                maxLines = 1, overflow = TextOverflow.Ellipsis,
            )
            Text(formatDate(chat.updated), color = c.text2, fontSize = TextSize.xs3, maxLines = 1)
        }
        if (!selecting) Box {
            SmallButton(R.drawable.ic_i_dots, "Chat-Optionen", enabled = enabled) { menuOpen = true }
            DropdownMenu(menuOpen, { menuOpen = false }, containerColor = c.menu) {
                actions.openTab?.let { open -> MenuEntry(R.drawable.ic_i_external, "In eigenem Tab öffnen") { menuOpen = false; open() } }
                MenuEntry(R.drawable.ic_i_pen, "Umbenennen") { menuOpen = false; actions.rename() }
                MenuEntry(R.drawable.ic_i_check_square, "Auswählen") { menuOpen = false; actions.select() }
                MenuEntry(R.drawable.ic_i_trash, "Löschen", danger = true) { menuOpen = false; actions.delete() }
            }
        }
    }
}
