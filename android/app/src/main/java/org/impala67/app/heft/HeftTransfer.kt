package org.impala67.app.heft

import android.content.ClipData
import android.content.Context
import android.content.Intent
import android.graphics.Bitmap
import android.net.Uri
import android.provider.OpenableColumns
import android.text.format.Formatter
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.ExposedDropdownMenu
import androidx.compose.material3.ExposedDropdownMenuAnchorType
import androidx.compose.material3.ExposedDropdownMenuBox
import androidx.compose.material3.ExposedDropdownMenuDefaults
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.RadioButton
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.produceState
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.asAndroidBitmap
import androidx.compose.ui.graphics.drawscope.CanvasDrawScope
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.style.TextOverflow
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
import org.impala67.app.library.importPdfPage
import org.impala67.app.library.readPickedPdf
import org.impala67.app.ui.theme.Impala
import org.impala67.app.ui.theme.Radius
import org.impala67.app.ui.theme.TextSize
import uniffi.impala_ffi.HeftPageData
import uniffi.impala_ffi.HeftPdfPage
import uniffi.impala_ffi.PageKind
import uniffi.impala_ffi.PageSummary
import uniffi.impala_ffi.heftBuildPdf
import uniffi.impala_ffi.heftExportFileName
import uniffi.impala_ffi.heftExportSize
import java.io.ByteArrayOutputStream
import java.io.File
import kotlin.math.max

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

/** Gewählte Datei für die Liste im Import-Dialog (`.heft-transfer-file`). */
private class ImportFile(val uri: Uri, val name: String, val size: Long, val pdf: Boolean)

private fun importFile(context: Context, uri: Uri): ImportFile {
    var name: String? = null
    var size = 0L
    runCatching {
        context.contentResolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME, OpenableColumns.SIZE), null, null, null)?.use { c ->
            if (c.moveToFirst()) {
                c.getColumnIndex(OpenableColumns.DISPLAY_NAME).takeIf { it >= 0 }?.let { name = c.getString(it) }
                c.getColumnIndex(OpenableColumns.SIZE).takeIf { it >= 0 && !c.isNull(it) }?.let { size = c.getLong(it) }
            }
        }
    }
    val label = name ?: uri.lastPathSegment ?: "Datei"
    val pdf = context.contentResolver.getType(uri) == "application/pdf" || label.endsWith(".pdf", ignoreCase = true)
    return ImportFile(uri, label, size, pdf)
}

/** Ziel „Als neue Notiz-Seite(n)“ (`value="notes"`); sonst steht die Heft-ID im Ziel. */
private const val TO_NOTES = "notes"

/**
 * „In Impala67 importieren“ (heft-import.js `openImportDialog`): Ort wählen – ein Heft (vorgewählt das
 * offene) oder, wenn nur PDFs gewählt sind, je PDF eine neue Notiz-Seite – und die Position im Heft.
 * Jede PDF-Seite bzw. jedes Bild wird eine Heftseite. [onDone] bekommt die erste neue Seite, wenn sie
 * im offenen Heft liegt.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun HeftImportDialog(vm: HeftViewModel, uris: List<Uri>, current: Int, onDone: (String?) -> Unit, onDismiss: () -> Unit) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val files = remember(uris) { uris.map { importFile(context, it) } }
    val onlyPdfs = files.all { it.pdf }
    val hefts by produceState<List<PageSummary>>(emptyList()) {
        value = vm.store.write { core -> core.recentPages(UInt.MAX_VALUE).filter { it.kind == PageKind.HEFT } }
    }
    var target by remember { mutableStateOf(vm.pageId) }
    var menu by remember { mutableStateOf(false) }
    var pos by remember { mutableStateOf(ImportPos.AFTER) }
    var status by remember { mutableStateOf<String?>(null) }
    val targetLabel = if (target == TO_NOTES) "Als neue Notiz-Seite(n)" else hefts.find { it.id == target }?.title?.ifEmpty { null } ?: "Heft"

    suspend fun intoHeft(heftId: String): String? {
        val count = vm.store.write { it.heftPageIds(heftId).size }
        // Im offenen Heft gilt die aktuelle Seite, in anderen die letzte (heft-import.js `importFilesIntoHeft`).
        var at = pos.at(if (heftId == vm.pageId) current else max(0, count - 1), count)
        var first: String? = null
        files.forEachIndexed { i, f ->
            status = "Importiere Datei ${i + 1} von ${files.size} …"
            val scans = withContext(Dispatchers.IO) { importPages(context, f.uri) }
            if (scans.isEmpty()) return@forEachIndexed
            val id = vm.store.write { it.insertScannedPages(heftId, at, scans) }
            if (first == null) first = id
            at += scans.size
        }
        return first
    }

    suspend fun intoNotes(): String? {
        var first: String? = null
        files.forEachIndexed { i, f ->
            status = "Importiere Datei ${i + 1} von ${files.size} …"
            val pdf = readPickedPdf(context, f.uri)
            val id = vm.store.importPdfPage(pdf.name, pdf.bytes)
            if (first == null) first = id
        }
        return first
    }

    AlertDialog(
        onDismissRequest = { if (status == null) onDismiss() },
        title = { Text("In Impala67 importieren") },
        text = {
            Column(Modifier.verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                Text((if (files.size == 1) "1 Datei" else "${files.size} Dateien") + " ausgewählt", color = Impala.colors.text2, fontSize = TextSize.sm)
                files.forEach { f -> FileRow(f) }
                ExposedDropdownMenuBox(menu, { menu = it }, Modifier.padding(top = 6.dp)) {
                    OutlinedTextField(
                        targetLabel, {}, Modifier.fillMaxWidth().menuAnchor(ExposedDropdownMenuAnchorType.PrimaryNotEditable),
                        readOnly = true, singleLine = true, label = { Text("Ort") },
                        trailingIcon = { ExposedDropdownMenuDefaults.TrailingIcon(menu) },
                    )
                    ExposedDropdownMenu(menu, { menu = false }) {
                        if (onlyPdfs) DropdownMenuItem({ Text("Als neue Notiz-Seite(n)") }, { target = TO_NOTES; menu = false })
                        hefts.forEach { h -> DropdownMenuItem({ Text(h.title.ifEmpty { "Heft" }) }, { target = h.id; menu = false }) }
                    }
                }
                if (target != TO_NOTES) {
                    Text("Einfügen", fontWeight = FontWeight.SemiBold, fontSize = TextSize.sm)
                    ImportPos.entries.forEach { p -> Choice(p.label, null, pos == p) { pos = p } }
                }
                Text(
                    "PDF-Seiten werden als unveränderliche Heftseiten eingefügt. Als Notiz entsteht pro PDF eine eigene Seite mit durchsuchbarem Inhalt.",
                    color = Impala.colors.text2, fontSize = TextSize.xs,
                )
            }
        },
        confirmButton = {
            TextButton(enabled = status == null, onClick = {
                status = "Importiere …"
                val to = target
                scope.launch {
                    runCatching { if (to == TO_NOTES) intoNotes() else intoHeft(to) }
                        .onSuccess { first ->
                            if (to == vm.pageId) vm.changed()
                            vm.message(if (first == null) "Keine lesbare Datei" else "Import abgeschlossen")
                            onDone(first.takeIf { to == vm.pageId })
                        }
                        .onFailure { status = null; vm.message("Import fehlgeschlagen: " + (it.message ?: it)) }
                }
            }) { Text(status ?: "Importieren") }
        },
        dismissButton = { TextButton(enabled = status == null, onClick = onDismiss) { Text("Abbrechen") } },
    )
}

/** Eine Zeile der Dateiliste: Typ-Kürzel, Name, Größe. */
@Composable
private fun FileRow(f: ImportFile) {
    val context = LocalContext.current
    Row(Modifier.fillMaxWidth(), Arrangement.spacedBy(10.dp), Alignment.CenterVertically) {
        Text(
            if (f.pdf) "PDF" else "IMG",
            Modifier.clip(RoundedCornerShape(Radius.sm)).background(Impala.colors.surface).padding(horizontal = 6.dp, vertical = 2.dp),
            color = Impala.colors.text2, fontSize = TextSize.xs, fontWeight = FontWeight.SemiBold,
        )
        Column(Modifier.weight(1f)) {
            Text(f.name, fontSize = TextSize.sm, fontWeight = FontWeight.Medium, maxLines = 1, overflow = TextOverflow.Ellipsis)
            if (f.size > 0) Text(Formatter.formatShortFileSize(context, f.size), color = Impala.colors.text2, fontSize = TextSize.xs)
        }
    }
}
