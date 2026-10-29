package org.impala67.app.ui.desk

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.material3.HorizontalDivider
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
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import org.impala67.app.R
import org.impala67.app.ui.theme.Impala
import org.impala67.app.ui.theme.Radius
import org.impala67.app.ui.theme.Space
import org.impala67.app.ui.theme.TextSize

/** Breite des KI-Panels rechts (`#app`-Raster: 340 px). */
val AiPanelWidth = 340.dp

/**
 * Rechte Spalte „KI-Coach“ (`#panel` in index.html): Kopf mit Verlauf/Neu/Ausklappen/Schließen,
 * Chatverlauf, unten der Composer (Anhang, Modell, Sprache, Senden).
 * TODO(desk): an die Rust-KI anschließen (ai.js → `ai.rs`); bis dahin nur das Gerüst.
 */
@Composable
fun DeskAiPanel(onClose: () -> Unit, onLater: (String) -> Unit, modifier: Modifier = Modifier) {
    val c = Impala.colors
    var text by rememberSaveable { mutableStateOf("") }
    Column(modifier.fillMaxHeight().background(c.panel)) {
        Row(
            Modifier.fillMaxWidth().padding(start = Space.s3, end = 10.dp, top = Space.s2, bottom = Space.s2),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Box(Modifier.size(8.dp).clip(CircleShape).background(c.text2.copy(alpha = 0.5f)))
            Text("KI-Coach", Modifier.weight(1f).padding(start = Space.s2), color = c.text2, fontSize = TextSize.sm, fontWeight = FontWeight.SemiBold)
            HeadButton(R.drawable.ic_i_history, "Alte Chats öffnen (Verlauf)") { onLater("Chat-Verlauf") }
            HeadButton(R.drawable.ic_i_plus, "Neuen Chat starten") { onLater("Neuer Chat") }
            HeadButton(R.drawable.ic_i_external, "Chat in eigenem Tab öffnen") { onLater("Chat im Tab") }
            HeadButton(R.drawable.ic_i_x, "KI einklappen", onClose)
        }
        HorizontalDivider(color = c.edge)
        Box(Modifier.weight(1f).fillMaxWidth(), contentAlignment = Alignment.Center) {
            Text("Frag deinen KI-Coach…", color = c.text2.copy(alpha = 0.6f), fontSize = TextSize.sm)
        }
        Column(
            Modifier.padding(10.dp).fillMaxWidth().heightIn(min = 78.dp).clip(RoundedCornerShape(Radius.lg))
                .background(c.surface).border(1.dp, c.edge, RoundedCornerShape(Radius.lg)).padding(Space.s2),
        ) {
            BasicTextField(
                text, { text = it }, Modifier.fillMaxWidth().padding(Space.s1),
                textStyle = TextStyle(color = c.text, fontSize = TextSize.base),
                cursorBrush = SolidColor(c.accent),
                decorationBox = { inner ->
                    if (text.isEmpty()) Text("Frag deinen KI-Coach…", color = c.text2, fontSize = TextSize.base)
                    inner()
                },
            )
            Row(verticalAlignment = Alignment.CenterVertically) {
                HeadButton(R.drawable.ic_i_plus, "PDF oder Bild anhängen") { onLater("Anhang") }
                HeadButton(R.drawable.ic_i_model, "Modell wählen") { onLater("Modellwahl") }
                Spacer(Modifier.weight(1f))
                HeadButton(R.drawable.ic_i_mic, "Spracheingabe starten") { onLater("Spracheingabe") }
                Box(
                    Modifier.size(32.dp).clip(CircleShape)
                        .background(if (text.isBlank()) c.surfaceActive else c.accent)
                        .clickable(enabled = text.isNotBlank()) { onLater("Chat") },
                    contentAlignment = Alignment.Center,
                ) { Icon(painterResource(R.drawable.ic_i_arrow_up), "Senden", Modifier.size(16.dp), tint = if (text.isBlank()) c.text2 else c.onAccent) }
            }
        }
    }
}

@Composable
private fun HeadButton(icon: Int, label: String, onClick: () -> Unit) {
    Box(Modifier.size(32.dp).clip(RoundedCornerShape(Radius.sm)).clickable(onClick = onClick), contentAlignment = Alignment.Center) {
        Icon(painterResource(icon), label, Modifier.size(15.dp), tint = Impala.colors.text2)
    }
}
