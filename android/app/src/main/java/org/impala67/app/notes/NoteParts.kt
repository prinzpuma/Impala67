package org.impala67.app.notes

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import org.impala67.app.ui.theme.Impala
import org.impala67.app.ui.theme.Radius
import org.impala67.app.ui.theme.Space
import uniffi.impala_ffi.PageSummary

/** Symbol oder eigenes Emoji einer Seite in einer 34-dp-Kachel (`.m-note-ico`). */
@Composable
fun PageGlyph(page: PageSummary, modifier: Modifier = Modifier) {
    val c = Impala.colors
    Box(
        modifier.size(34.dp).clip(RoundedCornerShape(Radius.sm)).background(c.surfaceHover),
        contentAlignment = Alignment.Center,
    ) {
        val emoji = ownEmoji(page)
        if (emoji != null) {
            Text(emoji, fontSize = 22.sp, lineHeight = 22.sp)
        } else {
            Icon(painterResource(pageIconRes(page)), null, Modifier.size(18.dp), tint = c.text2)
        }
    }
}

/** Abschnittsüberschrift wie `.m-section-label`: Großbuchstaben, 13 sp, halbfett. */
@Composable
fun SectionLabel(text: String, modifier: Modifier = Modifier) {
    Text(
        text.uppercase(),
        modifier.padding(start = Space.s1, top = 22.dp, bottom = Space.s2),
        color = Impala.colors.text2,
        fontSize = 13.sp,
        fontWeight = FontWeight.SemiBold,
        letterSpacing = 0.5.sp,
    )
}

/** Gruppe mit Hintergrund `--surface` und 16 dp Ecken (`.m-group`); Zeilen trennt [RowDivider]. */
@Composable
fun RowGroup(content: @Composable ColumnScope.() -> Unit) {
    Column(
        Modifier.fillMaxWidth().clip(RoundedCornerShape(Radius.lg)).background(Impala.colors.surface),
        content = content,
    )
}

/** Trennlinie zwischen zwei Zeilen einer Gruppe, eingerückt ab [inset]. */
@Composable
fun RowDivider(inset: Dp) {
    HorizontalDivider(Modifier.padding(start = inset), thickness = 1.dp, color = Impala.colors.edgeSoft)
}

/** Leerer Zustand (`.m-empty`): fetter Satz, darunter ein Hinweis und optional ein Knopf. */
@Composable
fun EmptyState(title: String, body: String? = null, action: (@Composable () -> Unit)? = null) {
    val c = Impala.colors
    Column(
        Modifier.fillMaxWidth().padding(horizontal = Space.s6, vertical = 48.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(Space.s2),
    ) {
        Text(title, color = c.text, fontWeight = FontWeight.SemiBold, fontSize = 16.sp)
        if (body != null) Text(body, color = c.text2, fontSize = 14.sp)
        action?.invoke()
    }
}

/** Bestätigung vor endgültigem Löschen (`U.confirm` der PWA). */
@Composable
fun ConfirmDialog(
    title: String,
    text: String,
    confirmLabel: String,
    onConfirm: () -> Unit,
    onDismiss: () -> Unit,
) {
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(title) },
        text = { Text(text) },
        confirmButton = {
            TextButton(onClick = onConfirm) { Text(confirmLabel, color = Impala.colors.danger) }
        },
        dismissButton = { TextButton(onClick = onDismiss) { Text("Abbrechen") } },
    )
}

/** Kleiner Text unter einem Titel (Datum, Art der Seite). */
@Composable
fun MetaText(text: String, modifier: Modifier = Modifier) {
    Text(text, modifier, color = Impala.colors.text2, fontSize = 12.5.sp, maxLines = 1)
}
