package org.impala67.app.library

import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
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
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import org.impala67.app.notes.pageTitle
import org.impala67.app.ui.theme.Impala
import org.impala67.app.ui.theme.Radius
import org.impala67.app.ui.theme.Space
import org.impala67.app.ui.theme.TextSize
import uniffi.impala_ffi.HeftFolder
import uniffi.impala_ffi.PageSummary

/** „Neu“ (`openShelfNewDialog`): Heft oder Ordner. */
@Composable
internal fun NewChoiceDialog(onDismiss: () -> Unit, onHeft: () -> Unit, onFolder: () -> Unit) {
    val c = Impala.colors
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("Neu") },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(Space.s2)) {
                Choice("Neues Heft", "Cover wählen und direkt losschreiben", onHeft)
                Choice("Neuer Ordner", "Hefte und weitere Ordner organisieren", onFolder)
            }
        },
        confirmButton = { TextButton(onDismiss) { Text("Abbrechen", color = c.text2) } },
    )
}

@Composable
private fun Choice(title: String, sub: String, onClick: () -> Unit) {
    val c = Impala.colors
    Column(Modifier.fillMaxWidth().clip(RoundedCornerShape(Radius.md)).background(c.surface).clickable(onClick = onClick).padding(Space.s3)) {
        Text(title, color = c.text, fontWeight = FontWeight.SemiBold)
        Text(sub, color = c.text2, fontSize = TextSize.xs)
    }
}

/** „Neuer Ordner“: Name, „Erstellen“, „Abbrechen“. */
@Composable
internal fun NewFolderDialog(onDismiss: () -> Unit, onCreate: (String) -> Unit) {
    var name by remember { mutableStateOf("") }
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("Neuer Ordner") },
        text = {
            Column {
                Text("Der Ordner erscheint nur in Dokumente, nie im Seitenbaum.", color = Impala.colors.text2, fontSize = TextSize.xs)
                OutlinedTextField(name, { name = it }, placeholder = { Text("Ordnername") }, singleLine = true)
            }
        },
        confirmButton = { TextButton({ onCreate(name) }, enabled = name.isNotBlank()) { Text("Erstellen") } },
        dismissButton = { TextButton(onDismiss) { Text("Abbrechen") } },
    )
}

/** „Neues Heft“: Heftname, Cover auswählen, „Heft erstellen“. */
@Composable
internal fun NewHeftDialog(onDismiss: () -> Unit, onCreate: (String, String) -> Unit) {
    var name by remember { mutableStateOf("Neues Heft") }
    var cover by remember { mutableStateOf(COVER_PRESETS[0].first) }
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("Neues Heft") },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(Space.s2)) {
                OutlinedTextField(name, { name = it }, label = { Text("Heftname") }, singleLine = true)
                Text("Cover", color = Impala.colors.text2, fontSize = TextSize.xs)
                Swatches(cover) { cover = it }
            }
        },
        confirmButton = { TextButton({ onCreate(name, cover) }) { Text("Heft erstellen") } },
        dismissButton = { TextButton(onDismiss) { Text("Abbrechen") } },
    )
}

@Composable
private fun Swatches(active: String?, onPick: (String) -> Unit) {
    Row(horizontalArrangement = Arrangement.spacedBy(Space.s2)) {
        COVER_PRESETS.forEach { (key, colors) ->
            Box(
                Modifier.size(36.dp).clip(CircleShape).background(Brush.linearGradient(listOf(Color(colors.first), Color(colors.second))))
                    .border(if (active == key) 3.dp else 0.dp, Impala.colors.accent, CircleShape).clickable { onPick(key) },
            )
        }
    }
}

/** Ordneroptionen: Löschen (Inhalt wandert eine Ebene nach oben). */
@Composable
internal fun FolderDialog(folder: HeftFolder, onDismiss: () -> Unit, onDelete: () -> Unit) {
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("„${folder.title}“") },
        text = { Text("Beim Löschen bleiben Hefte und Unterordner erhalten und wandern eine Ebene nach oben.") },
        confirmButton = { TextButton(onDelete) { Text("Ordner löschen", color = Impala.colors.danger) } },
        dismissButton = { TextButton(onDismiss) { Text("Abbrechen") } },
    )
}

/** Heftoptionen (`openLibCoverPicker`): Cover, eigenes Bild, Cover entfernen, Archivieren, Papierkorb. */
@Composable
internal fun HeftOptionsDialog(p: PageSummary, vm: LibraryViewModel, onDismiss: () -> Unit) {
    val context = LocalContext.current
    val pick = rememberLauncherForActivityResult(ActivityResultContracts.GetContent()) { uri ->
        if (uri != null) { vm.setCoverImage(context, p.id, uri); onDismiss() }
    }
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("Heftoptionen") },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(Space.s2)) {
                Text("„${pageTitle(p)}“", color = Impala.colors.text2, fontSize = TextSize.sm)
                Swatches(p.cover.ifEmpty { null }) { vm.setCover(p.id, it); onDismiss() }
                Text("Oder ein eigenes Bild als Deckblatt:", color = Impala.colors.text2, fontSize = TextSize.xs)
                OutlinedButton({ pick.launch("image/*") }) { Text("Eigenes Bild wählen") }
                Row(horizontalArrangement = Arrangement.spacedBy(Space.s2)) {
                    TextButton({ vm.setCover(p.id, null); onDismiss() }) { Text("Cover entfernen") }
                    TextButton({ vm.toggleFavorite(p); onDismiss() }) { Text(if (p.favorite) "Favorit entfernen" else "Favorit") }
                }
                Row(horizontalArrangement = Arrangement.spacedBy(Space.s2)) {
                    TextButton({ vm.archive(p.id, archived = false); onDismiss() }) { Text("Archivieren") }
                    TextButton({ vm.trash(p.id); onDismiss() }) { Text("In Papierkorb", color = Impala.colors.danger) }
                }
            }
        },
        confirmButton = { TextButton(onDismiss) { Text("Schließen") } },
    )
}
