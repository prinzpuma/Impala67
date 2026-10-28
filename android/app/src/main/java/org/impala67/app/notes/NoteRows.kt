package org.impala67.app.notes

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MenuDefaults
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
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
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import org.impala67.app.R
import org.impala67.app.ui.theme.Impala
import org.impala67.app.ui.theme.Radius
import org.impala67.app.ui.theme.Space
import uniffi.impala_ffi.PageKind
import uniffi.impala_ffi.PageSummary

/** Was eine Notizzeile auslöst; die Ansicht entscheidet nichts selbst (Dialoge liegen im Bildschirm). */
data class NoteActions(
    val open: (String) -> Unit,
    val drill: (String) -> Unit,
    val addChild: (PageSummary) -> Unit,
    val rename: (PageSummary) -> Unit,
    val favorite: (PageSummary) -> Unit,
    val archive: (PageSummary) -> Unit,
    val trash: (PageSummary) -> Unit,
)

/**
 * Eine Notiz (`.m-row.m-note`): Antippen öffnet, der Unterseiten-Knopf geht eine Ebene tiefer, das
 * Optionen-Menü bietet Anheften, Unterseite, Umbenennen, Archivieren und Papierkorb.
 */
@Composable
fun NoteRowItem(row: NoteRow, actions: NoteActions, modifier: Modifier = Modifier) {
    val c = Impala.colors
    val page = row.page
    Row(
        modifier.fillMaxWidth().heightIn(min = 52.dp).padding(start = 14.dp, end = 6.dp, top = 6.dp, bottom = 6.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Row(
            Modifier.weight(1f).clip(RoundedCornerShape(Radius.sm)).clickable { actions.open(page.id) }
                .padding(vertical = 2.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(Space.s3),
        ) {
            PageGlyph(page)
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                Text(
                    pageTitle(page), color = c.text, fontSize = 15.sp, fontWeight = FontWeight.SemiBold,
                    maxLines = 1, overflow = TextOverflow.Ellipsis,
                )
                MetaText(formatDate(page.updated))
            }
        }
        if (row.childCount > 0) DrillButton(row.childCount) { actions.drill(page.id) }
        PageMenu(page, actions)
    }
}

/** Unterseiten-Zähler mit Pfeil (`.m-note-drill`). */
@Composable
private fun DrillButton(count: Int, onClick: () -> Unit) {
    val c = Impala.colors
    Surface(
        onClick = onClick,
        modifier = Modifier.padding(start = Space.s1).height(34.dp),
        shape = CircleShape,
        color = c.surfaceHover,
    ) {
        Row(Modifier.padding(start = 12.dp, end = 6.dp), verticalAlignment = Alignment.CenterVertically) {
            Text("$count", color = c.text2, fontSize = 13.sp, fontWeight = FontWeight.SemiBold)
            Icon(painterResource(R.drawable.ic_i_chevron_right), "Unterseiten öffnen", Modifier.size(16.dp), tint = c.text2)
        }
    }
}

/** Optionen-Menü einer Notiz (`openNoteMenu` in mobile.js), Punkte und Reihenfolge wie dort. */
@Composable
private fun PageMenu(page: PageSummary, actions: NoteActions) {
    val c = Impala.colors
    var open by remember(page.id) { mutableStateOf(false) }
    fun closeThen(action: () -> Unit) {
        open = false
        action()
    }
    Box(Modifier.padding(start = Space.s1)) {
        IconButton(onClick = { open = true }, modifier = Modifier.size(40.dp)) {
            Icon(painterResource(R.drawable.ic_i_dots), "Optionen", Modifier.size(20.dp), tint = c.text2)
        }
        DropdownMenu(expanded = open, onDismissRequest = { open = false }) {
            DropdownMenuItem(
                text = { Text(if (page.favorite) "Favorit entfernen" else "Favorit hinzufügen") },
                onClick = { closeThen { actions.favorite(page) } },
                leadingIcon = { Icon(painterResource(R.drawable.ic_i_star), null) },
            )
            DropdownMenuItem(
                text = { Text("Unterseite anlegen") },
                onClick = { closeThen { actions.addChild(page) } },
                leadingIcon = { Icon(painterResource(R.drawable.ic_i_plus), null) },
            )
            DropdownMenuItem(
                text = { Text("Umbenennen") },
                onClick = { closeThen { actions.rename(page) } },
                leadingIcon = { Icon(painterResource(R.drawable.ic_i_pen), null) },
            )
            DropdownMenuItem(
                text = { Text("Archivieren") },
                onClick = { closeThen { actions.archive(page) } },
                leadingIcon = { Icon(painterResource(R.drawable.ic_i_archive), null) },
            )
            HorizontalDivider()
            DropdownMenuItem(
                text = { Text("In den Papierkorb") },
                onClick = { closeThen { actions.trash(page) } },
                leadingIcon = { Icon(painterResource(R.drawable.ic_i_trash), null) },
                colors = MenuDefaults.itemColors(textColor = c.danger, leadingIconColor = c.danger),
            )
        }
    }
}

/** Umbenennen-Dialog (`openPromptDialog` der PWA: „Seite umbenennen“ / „Heft umbenennen“). */
@Composable
fun RenameDialog(page: PageSummary, onDismiss: () -> Unit, onConfirm: (String) -> Unit) {
    var text by remember(page.id) { mutableStateOf(page.title) }
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(if (page.kind == PageKind.HEFT) "Heft umbenennen" else "Seite umbenennen") },
        text = {
            OutlinedTextField(
                value = text,
                onValueChange = { text = it },
                singleLine = true,
                modifier = Modifier.fillMaxWidth(),
            )
        },
        confirmButton = {
            TextButton(onClick = {
                val title = text.trim()
                if (title.isNotEmpty() && title != page.title) onConfirm(title) else onDismiss()
            }) { Text("Speichern") }
        },
        dismissButton = { TextButton(onClick = onDismiss) { Text("Abbrechen") } },
    )
}
