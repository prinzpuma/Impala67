package org.impala67.app.diag

import android.content.Context
import android.net.Uri
import android.widget.Toast
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.platform.LocalContext
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.impala67.app.ImpalaApp
import org.impala67.app.settings.SettingsGroup
import org.impala67.app.settings.SettingsRow
import org.json.JSONArray
import org.json.JSONObject
import uniffi.impala_ffi.PageKind
import java.time.LocalDate
import java.util.zip.ZipEntry
import java.util.zip.ZipOutputStream

/** „Weitere Exporte“ (settings-renderer.js `data-export`): Lerndaten als JSON, Notizen als Markdown-ZIP. */
@Composable
fun MoreExportsGroup() {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val toast = { t: String -> Toast.makeText(context, t, Toast.LENGTH_SHORT).show() }
    val learn = rememberLauncherForActivityResult(ActivityResultContracts.CreateDocument("application/json")) { uri ->
        if (uri != null) scope.launch { write(context, uri) { learningJson(context).toByteArray() }.let { toast(if (it) "Lerndaten exportiert." else "Export fehlgeschlagen.") } }
    }
    val zip = rememberLauncherForActivityResult(ActivityResultContracts.CreateDocument("application/zip")) { uri ->
        if (uri != null) scope.launch { write(context, uri) { markdownZip(context) }.let { toast(if (it) "Notizen als Markdown exportiert." else "Export fehlgeschlagen.") } }
    }
    SettingsGroup("Weitere Exporte") {
        SettingsRow("Lerndaten", "Bewertungen, Lernzeiten und Lern-Telemetrie als JSON") {
            OutlinedButton({ learn.launch("impala67-lerndaten-${LocalDate.now()}.json") }) { Text("Exportieren") }
        }
        SettingsRow("Workspace", "Alle Notizen als Markdown-Dateien in einem ZIP") {
            OutlinedButton({ zip.launch("impala67-notizen-${LocalDate.now()}.zip") }) { Text("Exportieren") }
        }
    }
}

private suspend fun write(context: Context, uri: Uri, bytes: suspend () -> ByteArray): Boolean = runCatching {
    val data = bytes()
    withContext(Dispatchers.IO) { context.contentResolver.openOutputStream(uri, "wt")!!.use { it.write(data) } }
}.isSuccess

/** Lerndaten wie `TELE.exportDump`: Karten-Lernstand, Bewertungen, Telemetrie und Lernsitzungen. */
private suspend fun learningJson(context: Context): String {
    val store = (context.applicationContext as ImpalaApp).store.await()
    return store.write { core ->
        val base = JSONObject(core.learningStatsJson())
        val sessions = JSONArray()
        core.learningSessions().forEach { s ->
            sessions.put(
                JSONObject().put("id", s.id).put("startedAt", s.startedAt).put("endedAt", s.endedAt)
                    .put("durationSeconds", s.durationSeconds.toLong()).put("category", s.category).put("sourceId", s.sourceId),
            )
        }
        base.put("learningSessions", sessions).put("exportedAt", java.time.Instant.now().toString()).toString(2)
    }
}

/** Notizen (ohne Hefte) als `.md`, Ordner nach Seitenbaum; Dateinamen ohne verbotene Zeichen. */
private suspend fun markdownZip(context: Context): ByteArray {
    val store = (context.applicationContext as ImpalaApp).store.await()
    val pages = store.write { core -> core.recentPages(UInt.MAX_VALUE).filter { it.kind == PageKind.NOTE }.map { it to (core.page(it.id)?.content.orEmpty()) } }
    val byId = pages.associate { it.first.id to it.first }
    fun clean(s: String) = s.replace(Regex("[\\\\/:*?\"<>|#]"), "_").trim().take(80).ifEmpty { "Ohne Titel" }
    fun path(id: String, depth: Int = 0): String {
        val p = byId[id] ?: return ""
        val parent = p.parentId?.takeIf { depth < 20 }?.let { path(it, depth + 1) }.orEmpty()
        return (if (parent.isEmpty()) "" else "$parent/") + clean(p.title)
    }
    return withContext(Dispatchers.IO) {
        val out = java.io.ByteArrayOutputStream()
        val used = HashSet<String>()
        ZipOutputStream(out).use { z ->
            for ((page, content) in pages) {
                val base = path(page.id)
                var name = "$base.md"
                var n = 2
                while (!used.add(name)) {
                    name = "$base ($n).md"
                    n++
                }
                z.putNextEntry(ZipEntry(name))
                z.write(("# " + page.title + "\n\n" + content).toByteArray())
                z.closeEntry()
            }
        }
        out.toByteArray()
    }
}
