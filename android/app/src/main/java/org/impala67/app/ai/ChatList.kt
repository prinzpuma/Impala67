package org.impala67.app.ai

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
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
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
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
 * mit Datum. Antippen öffnet den Chat im KI-Panel; ⋯ bietet „Löschen“ mit Rückfrage.
 */
@Composable
fun ChatList(ai: AiChatViewModel, modifier: Modifier = Modifier) {
    val c = Impala.colors
    val chats by ai.chats.collectAsStateWithLifecycle()
    val current by ai.chatId.collectAsStateWithLifecycle()
    val running by ai.running.collectAsStateWithLifecycle()
    var pendingDelete by remember { mutableStateOf<ChatInfo?>(null) }
    LazyColumn(modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(2.dp)) {
        item {
            Box(
                Modifier.fillMaxWidth().heightIn(min = 40.dp).clip(RoundedCornerShape(Radius.sm))
                    .clickable(enabled = !running) { ai.newChat() }.padding(horizontal = Space.s2),
                contentAlignment = Alignment.CenterStart,
            ) {
                Text("+ Neuer Chat", color = if (running) c.text2.copy(alpha = 0.5f) else c.text2, fontSize = TextSize.sm)
            }
        }
        val list = chats.orEmpty()
        if (chats != null && list.isEmpty()) {
            item { Text("Noch keine gespeicherten Chats.", Modifier.padding(horizontal = Space.s2, vertical = Space.s1), color = c.text2, fontSize = TextSize.sm) }
        }
        items(list, key = { it.id }) { chat ->
            ChatRow(
                chat = chat,
                active = chat.id == current,
                enabled = !(running && chat.id == current),
                onOpen = { ai.open(chat.id) },
                onDelete = { pendingDelete = chat },
            )
        }
    }
    pendingDelete?.let { chat ->
        AlertDialog(
            onDismissRequest = { pendingDelete = null },
            title = { Text("Chat löschen") },
            text = { Text("„${chat.title.ifBlank { "Chat" }}“ wirklich löschen? Das kann nicht rückgängig gemacht werden.") },
            confirmButton = {
                TextButton(onClick = { ai.delete(chat.id); pendingDelete = null }) { Text("Löschen", color = c.danger) }
            },
            dismissButton = { TextButton(onClick = { pendingDelete = null }) { Text("Abbrechen") } },
        )
    }
}

@Composable
private fun ChatRow(chat: ChatInfo, active: Boolean, enabled: Boolean, onOpen: () -> Unit, onDelete: () -> Unit) {
    val c = Impala.colors
    var menuOpen by remember { mutableStateOf(false) }
    Row(
        Modifier.fillMaxWidth().heightIn(min = 40.dp).clip(RoundedCornerShape(Radius.sm))
            .background(if (active) c.accent.copy(alpha = 0.14f) else Color.Transparent)
            .clickable(enabled = enabled, onClick = onOpen).padding(start = Space.s2, end = 2.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Column(Modifier.weight(1f).padding(vertical = Space.s1)) {
            Text(
                chat.title.ifBlank { "Chat" }, color = if (enabled) c.text else c.text2, fontSize = TextSize.sm,
                maxLines = 1, overflow = TextOverflow.Ellipsis,
            )
            Text(formatDate(chat.updated), color = c.text2, fontSize = TextSize.xs3, maxLines = 1)
        }
        Box {
            SmallButton(R.drawable.ic_i_dots, "Chat-Optionen", enabled = enabled) { menuOpen = true }
            DropdownMenu(menuOpen, { menuOpen = false }, containerColor = c.menu) {
                MenuEntry(R.drawable.ic_i_trash, "Löschen", danger = true) { menuOpen = false; onDelete() }
            }
        }
    }
}
