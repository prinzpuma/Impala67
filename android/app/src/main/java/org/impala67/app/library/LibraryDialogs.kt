package org.impala67.app.library

import android.graphics.BitmapFactory
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.launch
import org.impala67.app.notes.pageTitle
import org.impala67.app.ui.theme.Impala
import org.impala67.app.ui.theme.Radius
import org.impala67.app.ui.theme.Space
import org.impala67.app.ui.theme.TextSize
import uniffi.impala_ffi.HeftFolder
import uniffi.impala_ffi.PageSummary

/** „Neuer Ordner“: Name, „Erstellen“, „Abbrechen“. */
@Composable
internal fun NewFolderDialog(onDismiss: () -> Unit, onCreate: (String) -> Unit) {
    var name by remember { mutableStateOf("") }
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("Neuer Ordner") },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(Space.s2)) {
                Text("Der Ordner erscheint nur in Dokumente, nie im Seitenbaum.", color = Impala.colors.text2, fontSize = TextSize.xs)
                OutlinedTextField(name, { name = it }, placeholder = { Text("Ordnername") }, singleLine = true)
            }
        },
        confirmButton = { TextButton({ onCreate(name) }, enabled = name.isNotBlank()) { Text("Erstellen") } },
        dismissButton = { TextButton(onDismiss) { Text("Abbrechen") } },
    )
}

/** „Neues Heft“: Name, eigenes Bild an erster Stelle, darunter Cover-Farbe. */
@Composable
internal fun NewHeftDialog(onDismiss: () -> Unit, onCreate: (String, String, ByteArray?) -> Unit) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    var name by remember { mutableStateOf("Neues Heft") }
    var cover by remember { mutableStateOf(LibraryViewModel.COVER_PRESETS[0].first) }
    var imageBytes by remember { mutableStateOf<ByteArray?>(null) }
    val previewBmp = remember(imageBytes) { imageBytes?.let { BitmapFactory.decodeByteArray(it, 0, it.size)?.asImageBitmap() } }
    val pick = rememberLauncherForActivityResult(ActivityResultContracts.GetContent()) { uri ->
        if (uri != null) scope.launch { imageBytes = encodeCoverJpeg(context, uri) }
    }
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("Neues Heft") },
        text = {
            Column(Modifier.verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(Space.s3)) {
                OutlinedTextField(name, { name = it }, label = { Text("Heftname") }, singleLine = true)
                Text("Eigenes Cover", color = Impala.colors.text2, fontSize = TextSize.xs, fontWeight = FontWeight.SemiBold)
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Space.s3)) {
                    previewBmp?.let {
                        Image(it, null, Modifier.size(54.dp, 74.dp).clip(RoundedCornerShape(6.dp)), contentScale = ContentScale.Crop)
                    }
                    OutlinedButton({ pick.launch("image/*") }) { Text(if (imageBytes == null) "Eigenes Bild wählen" else "Anderes Bild") }
                    if (imageBytes != null) TextButton({ imageBytes = null }) { Text("Entfernen", color = Impala.colors.danger) }
                }
                Text("Farbe", color = Impala.colors.text2, fontSize = TextSize.xs, fontWeight = FontWeight.SemiBold)
                Swatches(if (imageBytes == null) cover else null) { cover = it; imageBytes = null }
            }
        },
        confirmButton = { TextButton({ onCreate(name, cover, imageBytes) }) { Text("Heft erstellen") } },
        dismissButton = { TextButton(onDismiss) { Text("Abbrechen") } },
    )
}

@Composable
private fun Swatches(active: String?, onPick: (String) -> Unit) {
    Row(horizontalArrangement = Arrangement.spacedBy(Space.s2)) {
        LibraryViewModel.COVER_PRESETS.forEach { (key, colors) ->
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

/** Heftoptionen: große Vorschau, eigenes Bild, Farbe, Ordner-Auswahl, Archivieren, Papierkorb. */
@Composable
internal fun HeftOptionsDialog(p: PageSummary, vm: LibraryViewModel, rootFolders: List<HeftFolder>, onDismiss: () -> Unit) {
    val context = LocalContext.current
    var folderMenu by remember { mutableStateOf(false) }
    val pick = rememberLauncherForActivityResult(ActivityResultContracts.GetContent()) { uri ->
        if (uri != null) { vm.setCoverImage(context, p.id, uri); onDismiss() }
    }
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("Heftoptionen") },
        text = {
            Column(Modifier.verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(Space.s3)) {
                Text("„${pageTitle(p)}“", color = Impala.colors.text2, fontSize = TextSize.sm)
                Row(
                    Modifier.fillMaxWidth().clip(RoundedCornerShape(Radius.lg)).background(Impala.colors.surfaceSubtle).padding(12.dp),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(Space.s4),
                ) {
                    NotebookCover(vm.store, p, height = 148.dp, modifier = Modifier.width(108.dp))
                    Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(Space.s2)) {
                        Text(
                            if (p.coverImg == null) "Ein eigenes Bild füllt das ganze Cover – so erkennst du das Heft im Regal sofort."
                            else "Dein Bild ist das Cover dieses Hefts.",
                            color = Impala.colors.text2,
                            fontSize = TextSize.xs,
                        )
                        OutlinedButton({ pick.launch("image/*") }) { Text(if (p.coverImg == null) "Eigenes Bild wählen" else "Anderes Bild wählen") }
                        if (p.coverImg != null) {
                            TextButton({ vm.setCover(p.id, p.cover.ifEmpty { null }); onDismiss() }) { Text("Bild entfernen", color = Impala.colors.danger) }
                        }
                    }
                }
                Text(if (p.coverImg == null) "Farbe" else "Oder eine Farbe", color = Impala.colors.text2, fontSize = TextSize.xs, fontWeight = FontWeight.SemiBold)
                Swatches(if (p.coverImg == null) p.cover.ifEmpty { null } else null) { vm.setCover(p.id, it); onDismiss() }
                Row(horizontalArrangement = Arrangement.spacedBy(Space.s2)) {
                    TextButton({ vm.setCover(p.id, null); onDismiss() }, enabled = p.cover.isNotEmpty() || p.coverImg != null) { Text("Farbe zurücksetzen") }
                    TextButton({ vm.toggleFavorite(p); onDismiss() }) { Text(if (p.favorite) "Favorit entfernen" else "Favorit") }
                }
                Box {
                    OutlinedButton({ folderMenu = true }) { Text("In Ordner verschieben…") }
                    DropdownMenu(folderMenu, { folderMenu = false }) {
                        DropdownMenuItem(text = { Text("Hauptbereich (kein Ordner)") }, onClick = { folderMenu = false; vm.moveToFolder(p.id, null); onDismiss() })
                        rootFolders.forEach { f ->
                            DropdownMenuItem(text = { Text(f.title) }, onClick = { folderMenu = false; vm.moveToFolder(p.id, f.id); onDismiss() })
                        }
                    }
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
