package org.impala67.app.heft

import android.content.ClipData
import android.content.Context
import android.content.Intent
import android.graphics.Bitmap
import android.net.Uri
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.RadioButton
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
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.asAndroidBitmap
import androidx.compose.ui.graphics.drawscope.CanvasDrawScope
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.unit.Density
import androidx.compose.ui.unit.LayoutDirection
import androidx.compose.ui.unit.dp
import androidx.core.content.FileProvider
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.impala67.app.core.ImpalaStore
import org.impala67.app.heft.scan.importPages
import org.impala67.app.heft.scan.insertScannedPages
import org.impala67.app.ui.theme.Impala
import org.impala67.app.ui.theme.TextSize
import uniffi.impala_ffi.HeftPageData
import uniffi.impala_ffi.HeftPdfPage
import uniffi.impala_ffi.heftBuildPdf
import uniffi.impala_ffi.heftExportFileName
import uniffi.impala_ffi.heftExportSize
import java.io.ByteArrayOutputStream
import java.io.File

// ---------- Export (heft-export.js) ----------

/** Eine Seite als Bild in [width] × [height] Pixeln: Papier, Bilder, Striche, Textfelder (`renderPageTo`). */
fun renderHeftPage(data: HeftPageData, images: Map<String, ImageBitmap>, width: Int, height: Int, ink: Color): Bitmap {
    val bmp = ImageBitmap(width, height)
    val k = width / HeftPage.WIDTH
    CanvasDrawScope().draw(Density(1f), LayoutDirection.Ltr, androidx.compose.ui.graphics.Canvas(bmp), Size(width.toFloat(), height.toFloat())) {
        drawPaper(Paper.of(data.paper), ink, k)
        drawHeftImages(data.images, images, k)
        drawInkStrokes(data.strokes.mapNotNull(HeftInk::stroke), k)
        drawHeftTexts(data.texts, k)
    }
    return bmp.asAndroidBitmap()
}

/** Dateiname ohne verbotene Zeichen, höchstens 80 Zeichen (heft-export.js `openExportDialog`). */
private fun cleanName(name: String, fallback: String) =
    name.replace(Regex("[\\\\/:*?\"<>|#]"), "_").trim().take(80).ifEmpty { fallback }

/**
 * Seiten [ids] (in Heft-Reihenfolge) mit 300 dpi rendern: als eine PDF (`pdfBlob`) oder als PNG je Seite
 * (`imageFiles`, Name `<name>-seite-<n>.png`). Die Dateien liegen in `cacheDir/heft-export`.
 */
suspend fun exportHeftPages(
    context: Context,
    store: ImpalaStore,
    pageId: String,
    ids: List<String>,
    name: String,
    pdf: Boolean,
    ink: Color,
    onStatus: (String) -> Unit,
): List<File> {
    val size = heftExportSize(null)
    val w = size.width.toInt()
    val h = size.height.toInt()
    val order = store.write { it.heftPageIds(pageId) }
    val dir = withContext(Dispatchers.IO) { File(context.cacheDir, "heft-export").apply { deleteRecursively(); mkdirs() } }
    val shots = ArrayList<HeftPdfPage>()
    val files = ArrayList<File>()
    ids.forEachIndexed { n, id ->
        onStatus((if (pdf) "Erzeuge Seite " else "Erzeuge Bild ") + "${n + 1} von ${ids.size} …")
        val data = store.write { it.heftPage(pageId, id) }
        val images = loadHeftImages(store, pageId, id, data.images, maxSide = w)
        withContext(Dispatchers.Default) {
            val bmp = renderHeftPage(data, images, w, h, ink)
            val out = ByteArrayOutputStream()
            if (pdf) {
                bmp.compress(Bitmap.CompressFormat.JPEG, 95, out)
                shots += HeftPdfPage(out.toByteArray(), size.width, size.height)
            } else {
                bmp.compress(Bitmap.CompressFormat.PNG, 100, out)
                files += File(dir, "$name-seite-${order.indexOf(id) + 1}.png").apply { writeBytes(out.toByteArray()) }
            }
            bmp.recycle()
        }
    }
    if (pdf) files += withContext(Dispatchers.Default) { File(dir, "$name.pdf").apply { writeBytes(heftBuildPdf(shots)) } }
    return files
}

/** Dateien über das Teilen-Menü des Systems weitergeben (Speichern, Drive, Mail …). */
fun shareFiles(context: Context, files: List<File>, mime: String) {
    val uris = ArrayList(files.map { FileProvider.getUriForFile(context, context.packageName + ".fileprovider", it) })
    val send = if (uris.size == 1) Intent(Intent.ACTION_SEND).putExtra(Intent.EXTRA_STREAM, uris[0])
    else Intent(Intent.ACTION_SEND_MULTIPLE).putParcelableArrayListExtra(Intent.EXTRA_STREAM, uris)
    send.type = mime
    send.clipData = ClipData.newRawUri(null, uris[0]).apply { uris.drop(1).forEach { addItem(ClipData.Item(it)) } }
    send.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
    context.startActivity(Intent.createChooser(send, "Heft exportieren"))
}

/**
 * „Heft exportieren“ (heft-export.js `openExportDialog`): Auswahl, Dateiname, Format PDF oder einzelne
 * Bilder; danach öffnet sich das Teilen-Menü.
 */
@Composable
fun HeftExportDialog(vm: HeftViewModel, ids: List<String>, title: String, onDismiss: () -> Unit) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val ink = Impala.colors.accent
    val fallback = remember(title) { heftExportFileName(title) }
    var name by remember { mutableStateOf(fallback) }
    var pdf by remember { mutableStateOf(true) }
    var status by remember { mutableStateOf<String?>(null) }
    AlertDialog(
        onDismissRequest = { if (status == null) onDismiss() },
        title = { Text("Heft exportieren") },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                Text(seitenZahl(ids.size) + " · " + title, color = Impala.colors.text2, fontSize = TextSize.sm)
                OutlinedTextField(
                    name, { name = it }, Modifier.fillMaxWidth(), label = { Text("Dateiname") }, singleLine = true,
                    keyboardOptions = KeyboardOptions(imeAction = ImeAction.Done),
                )
                Text("Format", fontWeight = FontWeight.SemiBold, fontSize = TextSize.sm)
                Choice("PDF-Dokument", "Alle ausgewählten Seiten in einer Datei", pdf) { pdf = true }
                Choice("Einzelne Bilder", "Eine PNG-Datei pro ausgewählter Seite", !pdf) { pdf = false }
            }
        },
        confirmButton = {
            TextButton(enabled = status == null, onClick = {
                status = "Wird erstellt …"
                scope.launch {
                    runCatching {
                        val files = exportHeftPages(context, vm.store, vm.pageId, ids, cleanName(name, fallback), pdf, ink) { status = it }
                        shareFiles(context, files, if (pdf) "application/pdf" else "image/png")
                    }.onSuccess { onDismiss() }
                        .onFailure { status = null; vm.message("Export fehlgeschlagen: " + (it.message ?: it)) }
                }
            }) { Text(status ?: "Exportieren") }
        },
        dismissButton = { TextButton(enabled = status == null, onClick = onDismiss) { Text("Abbrechen") } },
    )
}

@Composable
private fun Choice(label: String, hint: String?, selected: Boolean, onClick: () -> Unit) {
    Row(
        Modifier.fillMaxWidth().clickable(role = Role.RadioButton, onClick = onClick).padding(vertical = 2.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        RadioButton(selected, onClick)
        Column {
            Text(label, fontSize = TextSize.sm, fontWeight = FontWeight.Medium)
            hint?.let { Text(it, color = Impala.colors.text2, fontSize = TextSize.xs) }
        }
    }
}

// ---------- Import (heft-import.js) ----------

/** Wohin importierte Seiten kommen (heft-import.js `heftImportPosition`). */
enum class ImportPos(val label: String) {
    AFTER("Nach der aktuellen Seite"), BEFORE("Vor der aktuellen Seite"), START("Am Anfang"), END("Am Ende");

    /** Einfügeposition wie `insertAt` (heft-pages-core.js). */
    fun at(current: Int, count: Int) = when (this) {
        AFTER -> current + 1
        BEFORE -> current
        START -> 0
        END -> count
    }
}

/** „PDF oder Bild importieren“: Dateiauswahl (Bilder und PDFs, mehrere) öffnen; danach der Dialog. */
@Composable
fun rememberHeftFilePick(onFiles: (List<Uri>) -> Unit): () -> Unit {
    val launcher = rememberLauncherForActivityResult(ActivityResultContracts.OpenMultipleDocuments()) { uris -> if (uris.isNotEmpty()) onFiles(uris) }
    return remember(launcher) { { launcher.launch(arrayOf("image/*", "application/pdf")) } }
}

/**
 * „In Impala67 importieren“ (heft-import.js `openImportDialog`): Position im aktuellen Heft wählen;
 * jede PDF-Seite bzw. jedes Bild wird eine Heftseite. [onDone] bekommt die erste neue Seite.
 */
@Composable
fun HeftImportDialog(vm: HeftViewModel, uris: List<Uri>, current: Int, onDone: (String?) -> Unit, onDismiss: () -> Unit) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    var pos by remember { mutableStateOf(ImportPos.AFTER) }
    var status by remember { mutableStateOf<String?>(null) }
    AlertDialog(
        onDismissRequest = { if (status == null) onDismiss() },
        title = { Text("In Impala67 importieren") },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                Text((if (uris.size == 1) "1 Datei" else "${uris.size} Dateien") + " ausgewählt", color = Impala.colors.text2, fontSize = TextSize.sm)
                Text("Einfügen", fontWeight = FontWeight.SemiBold, fontSize = TextSize.sm)
                ImportPos.entries.forEach { p -> Choice(p.label, null, pos == p) { pos = p } }
                Text("PDF-Seiten werden als unveränderliche Heftseiten eingefügt.", color = Impala.colors.text2, fontSize = TextSize.xs)
            }
        },
        confirmButton = {
            TextButton(enabled = status == null, onClick = {
                status = "Importiere …"
                scope.launch {
                    runCatching {
                        var at = pos.at(current, vm.pageIds.value.orEmpty().size)
                        var first: String? = null
                        uris.forEachIndexed { i, uri ->
                            status = "Importiere Datei ${i + 1} von ${uris.size} …"
                            val scans = withContext(Dispatchers.IO) { importPages(context, uri) }
                            if (scans.isEmpty()) return@forEachIndexed
                            val id = vm.store.write { it.insertScannedPages(vm.pageId, at, scans) }
                            if (first == null) first = id
                            at += scans.size
                        }
                        first
                    }.onSuccess { first ->
                        vm.changed()
                        vm.message(if (first == null) "Keine lesbare Datei" else "Import abgeschlossen")
                        onDone(first)
                    }.onFailure { status = null; vm.message("Import fehlgeschlagen: " + (it.message ?: it)) }
                }
            }) { Text(status ?: "Importieren") }
        },
        dismissButton = { TextButton(enabled = status == null, onClick = onDismiss) { Text("Abbrechen") } },
    )
}
