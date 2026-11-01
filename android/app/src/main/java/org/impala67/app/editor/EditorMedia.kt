package org.impala67.app.editor

import android.content.ActivityNotFoundException
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.provider.OpenableColumns
import android.webkit.MimeTypeMap
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.platform.LocalContext
import androidx.core.content.FileProvider
import java.io.File
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.impala67.app.core.ImpalaStore
import uniffi.impala_ffi.MdBlockKind

/** Slash „Bild“, „PDF“, „Datei / Medien“ mit dem `accept` der PWA. */
internal enum class MediaKind(val mime: Array<String>) {
    Image(arrayOf("image/*")), Pdf(arrayOf("application/pdf")), File(arrayOf("*/*")),
}

/**
 * Dateiauswahl für Medienblöcke: [pick] merkt sich den Block, hinter dem eingefügt wird; jede gewählte
 * Datei wird im Kern gespeichert (`addFile` → `img:…`/`file:…`) und ein Bild- bzw. Dateiblock.
 */
@Composable
internal fun rememberMediaPick(vm: EditorViewModel, onToast: (String) -> Unit): (String, MediaKind) -> Unit {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    var target by remember { mutableStateOf<String?>(null) }
    val launcher = rememberLauncherForActivityResult(ActivityResultContracts.OpenMultipleDocuments()) { uris ->
        var after = target
        target = null
        scope.launch {
            for (uri in uris) {
                val kind = runCatching { storeUri(context, vm.store, uri) }.getOrNull()
                if (kind == null) { onToast("Datei konnte nicht gelesen werden."); continue }
                after = vm.insertMediaBlock(after, kind)
            }
        }
    }
    return remember(launcher) { { id, kind -> target = id; launcher.launch(kind.mime) } }
}

/** Liest die Datei und legt sie im Kern ab; Bilder werden Bildblöcke, alles andere Dateiblöcke. */
private suspend fun storeUri(context: Context, store: ImpalaStore, uri: Uri): MdBlockKind {
    val resolver = context.contentResolver
    val (name, bytes) = withContext(Dispatchers.IO) {
        val name = resolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)?.use { c ->
            val col = c.getColumnIndex(OpenableColumns.DISPLAY_NAME)
            if (c.moveToFirst() && col >= 0) c.getString(col) else null
        } ?: uri.lastPathSegment ?: "Datei"
        name to (resolver.openInputStream(uri)?.use { it.readBytes() } ?: error("nicht lesbar"))
    }
    val mime = resolver.getType(uri)
        ?: MimeTypeMap.getSingleton().getMimeTypeFromExtension(name.substringAfterLast('.', "").lowercase())
        ?: "application/octet-stream"
    val id = store.write { it.addFile(bytes, mime, name) }
    return if (mime.startsWith("image/")) MdBlockKind.Image(name.replace(Regex("\\.[a-z0-9]+$", RegexOption.IGNORE_CASE), ""), id)
    else MdBlockKind.File(id, name)
}

/** Blob-ID eines Medienverweises: `img:…`, `file:…` oder das Altformat `blob:<uuid>` des Android-Teilens. */
internal fun blobId(src: String): String? = when {
    src.startsWith("img:") || src.startsWith("file:") -> src
    src.startsWith("blob:") -> src.removePrefix("blob:").takeIf { LEGACY_BLOB.matches(it) }
    else -> null
}

private val LEGACY_BLOB = Regex("[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}", RegexOption.IGNORE_CASE)

/**
 * Dateiblock antippen: Blob in den Cache schreiben und mit der passenden App des Geräts öffnen
 * (`hydrateFileBlock` zeigt Video/Audio/PDF in der Seite). Liefert eine Meldung, wenn es nicht geht.
 */
internal suspend fun openBlob(context: Context, store: ImpalaStore, src: String, name: String): String? {
    val id = blobId(src) ?: return "Datei nicht verfügbar"
    val data = store.write { it.file(id) } ?: return "Datei wird geladen…"
    val file = withContext(Dispatchers.IO) {
        val dir = File(context.cacheDir, "files").apply { mkdirs() }
        File(dir, name.replace(Regex("[\\\\/:*?\"<>|]"), "_").ifBlank { data.name.ifBlank { "Datei" } }).apply { writeBytes(data.bytes) }
    }
    val uri = FileProvider.getUriForFile(context, context.packageName + ".fileprovider", file)
    val intent = Intent(Intent.ACTION_VIEW).setDataAndType(uri, data.mime.ifBlank { "*/*" }).addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
    return try { context.startActivity(intent); null } catch (e: ActivityNotFoundException) { "Keine App zum Öffnen gefunden." }
}
