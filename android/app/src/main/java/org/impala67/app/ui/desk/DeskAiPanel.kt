package org.impala67.app.ui.desk

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.layout.Spacer
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import org.impala67.app.ai.AiStatus
import org.impala67.app.ai.status
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import org.impala67.app.R
import org.impala67.app.ai.AiChatViewModel
import org.impala67.app.ai.ChatView
import org.impala67.app.ui.theme.Impala
import org.impala67.app.ui.theme.Radius
import org.impala67.app.ui.theme.Space
import org.impala67.app.ui.theme.TextSize

/** Breite des KI-Panels rechts (`#app`-Raster bei kompakter Dichte: 320 px). */
val AiPanelWidth = 320.dp

/**
 * Rechte Spalte „KI-Coach“ (`#panel` in index.html): Kopf mit Neuer Chat, In eigenem Tab öffnen und Einklappen, darunter der
 * Chatverlauf mit Eingabe ([ChatView]). Die Chat-Liste steht in der Seitenleiste ([org.impala67.app.ai.ChatList]).
 */
@Composable
fun DeskAiPanel(
    ai: AiChatViewModel,
    activePageId: String?,
    onOpenSettings: () -> Unit,
    onClose: () -> Unit,
    onExpand: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val c = Impala.colors
    val running by ai.running.collectAsStateWithLifecycle()
    val menu by ai.models.menu.collectAsStateWithLifecycle()
    val choice by ai.models.choice.collectAsStateWithLifecycle()
    val chats by ai.chats.collectAsStateWithLifecycle()
    var history by remember { mutableStateOf(false) }
    val status = menu.status(choice)
    LaunchedEffect(Unit) { ai.models.refresh() }
    Column(modifier.fillMaxHeight().background(c.panel)) {
        Row(
            Modifier.fillMaxWidth().padding(start = Space.s3, end = 10.dp, top = Space.s2, bottom = Space.s2),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text("KI-Coach", Modifier.padding(end = Space.s2), color = c.text2, fontSize = TextSize.sm, fontWeight = FontWeight.SemiBold)
            // Status-Chip: Klick prüft erneut, bei „offline“ geht es in die KI-Einstellungen.
            Row(
                Modifier.clip(CircleShape).background(c.surface)
                    .clickable { if (status == AiStatus.OFFLINE) onOpenSettings() else ai.models.refresh(force = true) }
                    .padding(horizontal = Space.s2, vertical = 2.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                val dot = when (status) { AiStatus.ONLINE -> c.success; AiStatus.OFFLINE -> c.danger; AiStatus.CHECKING -> c.text2.copy(alpha = 0.5f) }
                Box(Modifier.size(7.dp).clip(CircleShape).background(dot))
                Text(status.label, Modifier.padding(start = Space.s1), color = c.text2, fontSize = TextSize.xs)
            }
            Spacer(Modifier.weight(1f))
            Box {
                HeadButton(R.drawable.ic_i_history, "Alte Chats öffnen (Verlauf)", enabled = !running) { history = true }
                DropdownMenu(history, { history = false }) {
                    val list = chats.orEmpty()
                    if (list.isEmpty()) DropdownMenuItem(text = { Text("Noch keine gespeicherten Chats.", color = c.text2) }, onClick = { history = false }, enabled = false)
                    list.take(40).forEach { chat ->
                        DropdownMenuItem(text = { Text(chat.title.ifBlank { "Chat" }, maxLines = 1) }, onClick = { history = false; ai.open(chat.id) })
                    }
                }
            }
            HeadButton(R.drawable.ic_i_plus, "Neuen Chat starten", enabled = !running) { ai.newChat() }
            HeadButton(R.drawable.ic_i_expand, "Chat in eigenem Tab öffnen", enabled = !running, onExpand)
            HeadButton(R.drawable.ic_i_x, "KI einklappen", enabled = true, onClose)
        }
        HorizontalDivider(color = c.edge)
        ChatView(ai, activePageId, onOpenSettings, Modifier.weight(1f).fillMaxWidth())
    }
}

@Composable
private fun HeadButton(icon: Int, label: String, enabled: Boolean, onClick: () -> Unit) {
    val tint = if (enabled) Impala.colors.text2 else Impala.colors.text2.copy(alpha = 0.3f)
    Box(
        Modifier.size(32.dp).clip(RoundedCornerShape(Radius.sm)).clickable(enabled = enabled, onClick = onClick),
        contentAlignment = Alignment.Center,
    ) {
        Icon(painterResource(icon), label, Modifier.size(15.dp), tint = tint)
    }
}
