package org.impala67.app.notebook

import android.content.Context
import android.content.Intent
import android.net.Uri
import android.provider.OpenableColumns
import androidx.core.content.FileProvider
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.withContext
import org.impala67.app.R
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.util.UUID

/** Art eines Gemini-Notebook-Ergebnisses (notebooklm.js `KINDS`): Emoji für Seiteninhalt, Symbol für die Oberfläche. */
enum class NlmKind(val key: String, val emoji: String, val icon: Int, val label: String) {
    AUDIO("audio", "🎧", R.drawable.ic_i_headphones, "Podcast"),
    VIDEO("video", "🎬", R.drawable.ic_i_film, "Video"),
    MINDMAP("mindmap", "🧠", R.drawable.ic_i_graph, "Mind Map"),
    SLIDES_PDF("slides-pdf", "📑", R.drawable.ic_i_slides, "Folien (PDF)"),
    SLIDES_PPTX("slides-pptx", "📑", R.drawable.ic_i_slides, "Folien (PPTX)"),
    TEXT("text", "📄", R.drawable.ic_i_file, "Text"),
    FILE("file", "📎", R.drawable.ic_i_paperclip, "Datei");

    companion object {
        fun of(key: String) = entries.firstOrNull { it.key == key } ?: FILE
    }
}

/** Eine Datei der Inbox (`{ id, name, ts, kind, mime, size, sourcePageIds, placedPageId }`). */
data class NlmFile(
    val id: String,
    val name: String,
    val ts: Long,
    val kind: NlmKind,
    val mime: String,
    val size: Long,
    val sourcePageIds: List<String>,
    val placedPageId: String?,
)

/**
 * Mediathek von Gemini Notebook (notebooklm.js, dort IndexedDB): Dateien bleiben nur auf diesem Gerät
 * (`files/nlm`), die Liste in `index.json`. Nie automatisch in Seiten schreiben (Inbox-Prinzip).
 */
class NotebookInbox(private val context: Context) {
    private val dir = File(context.filesDir, "nlm").apply { mkdirs() }
    private val indexFile = File(dir, "index.json")
    private val _files = MutableStateFlow(read())
    val files: StateFlow<List<NlmFile>> = _files.asStateFlow()

    fun file(f: NlmFile) = File(dir, f.id)

    /** Datei übernehmen; die zuletzt als Quelle kopierten Seiten (6 h) gelten als Herkunft. */
    suspend fun add(uri: Uri): NlmFile = withContext(Dispatchers.IO) {
        val resolver = context.contentResolver
        val name = resolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)?.use { if (it.moveToFirst()) it.getString(0) else null } ?: "gemini-notebook-datei"
        val mime = resolver.getType(uri).orEmpty()
        val id = UUID.randomUUID().toString()
        val target = File(dir, id)
        resolver.openInputStream(uri)!!.use { input -> target.outputStream().use { input.copyTo(it) } }
        val head = target.inputStream().use { s -> ByteArray(12).also { s.read(it) } }
        val rec = NlmFile(id, name, System.currentTimeMillis(), sniff(name, head, mime), mime, target.length(), recentSources(), null)
        update { it + rec }
        rec
    }

    suspend fun delete(id: String) = withContext(Dispatchers.IO) {
        File(dir, id).delete()
        update { list -> list.filter { it.id != id } }
    }

    suspend fun setPlaced(id: String, pageId: String) = withContext(Dispatchers.IO) {
        update { list -> list.map { if (it.id == id) it.copy(placedPageId = pageId) else it } }
    }

    /** Öffnen bzw. Abspielen mit einer passenden App des Systems. */
    fun open(f: NlmFile): Boolean {
        val uri = FileProvider.getUriForFile(context, context.packageName + ".fileprovider", file(f))
        val mime = f.mime.ifEmpty { when (f.kind) { NlmKind.AUDIO -> "audio/*"; NlmKind.VIDEO -> "video/*"; NlmKind.MINDMAP -> "image/*"; NlmKind.SLIDES_PDF -> "application/pdf"; else -> "*/*" } }
        val intent = Intent(Intent.ACTION_VIEW).setDataAndType(uri, mime).addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_ACTIVITY_NEW_TASK)
        return runCatching { context.startActivity(intent) }.isSuccess
    }

    fun rememberSources(ids: List<String>) {
        context.getSharedPreferences("nlm", Context.MODE_PRIVATE).edit()
            .putString("sources", JSONArray(ids).toString()).putLong("sourcesAt", System.currentTimeMillis()).apply()
    }

    private fun recentSources(): List<String> {
        val sp = context.getSharedPreferences("nlm", Context.MODE_PRIVATE)
        if (System.currentTimeMillis() - sp.getLong("sourcesAt", 0) > 6 * 3_600_000L) return emptyList()
        val arr = runCatching { JSONArray(sp.getString("sources", "[]")) }.getOrDefault(JSONArray())
        return (0 until arr.length()).map { arr.optString(it) }
    }

    private fun update(change: (List<NlmFile>) -> List<NlmFile>) {
        val next = change(_files.value)
        _files.value = next
        indexFile.writeText(JSONArray(next.map { f ->
            JSONObject().put("id", f.id).put("name", f.name).put("ts", f.ts).put("kind", f.kind.key).put("mime", f.mime).put("size", f.size)
                .put("sourcePageIds", JSONArray(f.sourcePageIds)).put("placedPageId", f.placedPageId ?: JSONObject.NULL)
        }).toString())
    }

    private fun read(): List<NlmFile> = runCatching {
        val arr = JSONArray(indexFile.readText())
        (0 until arr.length()).map { i ->
            val o = arr.getJSONObject(i)
            val src = o.optJSONArray("sourcePageIds")
            NlmFile(
                o.optString("id"), o.optString("name"), o.optLong("ts"), NlmKind.of(o.optString("kind")), o.optString("mime"), o.optLong("size"),
                (0 until (src?.length() ?: 0)).map { src!!.optString(it) }, o.optString("placedPageId").takeIf { it.isNotEmpty() && it != "null" },
            )
        }
    }.getOrDefault(emptyList())

    companion object {
        const val PRODUCT_URL = "https://notebooklm.google.com/"

        private val EXT = mapOf(
            "mp3" to NlmKind.AUDIO, "m4a" to NlmKind.AUDIO, "aac" to NlmKind.AUDIO, "wav" to NlmKind.AUDIO, "ogg" to NlmKind.AUDIO, "opus" to NlmKind.AUDIO,
            "mp4" to NlmKind.VIDEO, "webm" to NlmKind.VIDEO, "mov" to NlmKind.VIDEO, "m4v" to NlmKind.VIDEO,
            "png" to NlmKind.MINDMAP, "jpg" to NlmKind.MINDMAP, "jpeg" to NlmKind.MINDMAP, "webp" to NlmKind.MINDMAP, "svg" to NlmKind.MINDMAP,
            "pdf" to NlmKind.SLIDES_PDF, "pptx" to NlmKind.SLIDES_PPTX, "txt" to NlmKind.TEXT, "md" to NlmKind.TEXT,
        )

        /** Endung → MIME → Magic Bytes (`sniffKind`). */
        fun sniff(name: String, b: ByteArray, mime: String): NlmKind {
            if ('.' in name) EXT[name.substringAfterLast('.').lowercase()]?.let { return it }
            val m = mime.lowercase()
            when {
                m.startsWith("audio/") -> return NlmKind.AUDIO
                m.startsWith("video/") -> return NlmKind.VIDEO
                m.startsWith("image/") -> return NlmKind.MINDMAP
                m == "application/pdf" -> return NlmKind.SLIDES_PDF
                "presentation" in m -> return NlmKind.SLIDES_PPTX
            }
            fun u(i: Int) = b.getOrNull(i)?.toInt()?.and(0xFF) ?: -1
            return when {
                u(0) == 0x25 && u(1) == 0x50 && u(2) == 0x44 && u(3) == 0x46 -> NlmKind.SLIDES_PDF
                u(0) == 0x50 && u(1) == 0x4b -> NlmKind.SLIDES_PPTX
                u(0) == 0x49 && u(1) == 0x44 && u(2) == 0x33 -> NlmKind.AUDIO
                u(0) == 0xff && (u(1) and 0xe0) == 0xe0 -> NlmKind.AUDIO
                u(0) == 0x89 && u(1) == 0x50 -> NlmKind.MINDMAP
                u(0) == 0xff && u(1) == 0xd8 -> NlmKind.MINDMAP
                u(0) == 0x1a && u(1) == 0x45 && u(2) == 0xdf && u(3) == 0xa3 -> NlmKind.VIDEO
                u(4) == 0x66 && u(5) == 0x74 && u(6) == 0x79 && u(7) == 0x70 -> NlmKind.VIDEO
                else -> NlmKind.FILE
            }
        }

        /** Einbettung als Markdown-Link `[🎧 …](#nlm:<id>)` (`embedMd`). */
        fun embedMd(f: NlmFile) = "\n\n" + f.kind.emoji + " [Gemini-Notebook-" + f.kind.label + ": " + f.name.replace(Regex("[\\[\\]]"), "") + "](#nlm:" + f.id + ")\n"
    }
}
