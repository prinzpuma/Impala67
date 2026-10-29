package org.impala67.app.notes

import android.content.Context
import android.net.Uri
import android.print.PrintAttributes
import android.print.PrintManager
import android.webkit.WebView
import android.webkit.WebViewClient
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.impala67.app.core.ImpalaStore
import uniffi.impala_ffi.ImpalaCore
import uniffi.impala_ffi.PageKind
import java.util.UUID

/** Ein Ziel im Verschieben-Dialog: Arbeitsbereich (`pageId` null) oder Seite. */
data class MoveTarget(val label: String, val depth: Int, val workspaceId: String, val pageId: String?)

/**
 * Seite samt Unterseiten duplizieren wie `duplicatePage` in web/app-dialogs.js. Ohne [newParentId]
 * entsteht das Duplikat neben dem Original („(Kopie)“ am Titel); Unterseiten bekommen die neue Seite
 * als Eltern. Leeres Cover wird wie in der PWA `null`; Tags und PDF-Verweis gehen mit.
 *
 * Kandidat für den Rust-Kern (Logik nur in JS, `duplicatePage`).
 */
suspend fun duplicatePage(store: ImpalaStore, pageId: String, newParentId: String? = null, newWsId: String? = null): String? {
    val detail = store.write { it.page(pageId) } ?: return null
    val pg = detail.summary
    val id = UUID.randomUUID().toString()
    val wsId = newWsId ?: pg.workspaceId
    val title = if (newParentId == null) pg.title + " (Kopie)" else pg.title
    store.dispatch(
        "pageCreate",
        mapOf(
            "id" to id,
            "title" to title,
            "parentId" to (newParentId ?: pg.parentId),
            "content" to detail.content,
            "workspaceId" to wsId,
            "icon" to pg.icon.ifEmpty { null },
            "cover" to pg.cover.ifEmpty { null },
            "tags" to pg.tags,
            "pdfId" to pg.pdfId,
            "kind" to if (pg.kind == PageKind.HEFT) "heft" else "notion",
        ),
    )
    val kids = store.write { it.childrenOf(pg.id, pg.workspaceId) }
    for (kid in kids) duplicatePage(store, kid.id, id, wsId)
    return id
}

/** Dateiname wie `exportPageMd` in web/extras.js. */
fun markdownFileName(title: String): String =
    title.replace(Regex("[\\\\/:*?\"<>|#]"), "_").trim().take(80).ifEmpty { "Seite" } + ".md"

/** Inhalt der Markdown-Datei: Titel als Überschrift, dann der Text (wie web/extras.js). */
fun markdownText(title: String, content: String): String = "# $title\n\n$content"

/** Interner Link auf eine Seite; wie in der PWA `#<id>`. */
fun internalLink(pageId: String): String = "#$pageId"

/** Alle Ziele für „Verschieben nach…“ (Arbeitsbereich oder Seite, ohne die Seite und ihren Unterbaum). */
fun moveTargets(core: ImpalaCore, pageId: String): List<MoveTarget> {
    val excluded = core.pageSubtree(pageId).toSet()
    val out = mutableListOf<MoveTarget>()
    fun walk(parentId: String?, wsId: String, depth: Int) {
        for (p in core.childrenOf(parentId, wsId)) {
            if (p.id in excluded) continue
            out += MoveTarget(pageTitle(p), depth, wsId, p.id)
            walk(p.id, wsId, depth + 1)
        }
    }
    for (ws in core.workspaces()) {
        out += MoveTarget(ws.name, 0, ws.id, null)
        walk(null, ws.id, 1)
    }
    return out
}

/** Druckbares HTML mit Absätzen (Leerzeilen trennen, Zeilenumbrüche bleiben). Kein Markdown-Rendering. */
fun printableHtml(heading: String, content: String): String {
    fun esc(s: String) = s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
    val paragraphs = content.split(Regex("\n\\s*\n")).filter { it.isNotBlank() }
        .joinToString("") { "<p>${esc(it.trim()).replace("\n", "<br>")}</p>" }
    return "<!DOCTYPE html><html><head><meta charset=\"utf-8\"><style>" +
        "body{font:15px/1.6 sans-serif;color:#111;margin:24px}p{margin:0 0 12px}" +
        "</style></head><body><h1>${esc(heading)}</h1>$paragraphs</body></html>"
}

/** Druckdialog des Systems für [html]; die unsichtbare WebView lädt es und druckt, sobald sie fertig ist. */
fun printPage(context: Context, jobName: String, html: String) {
    val web = WebView(context)
    web.webViewClient = object : WebViewClient() {
        override fun onPageFinished(view: WebView, url: String?) {
            val manager = context.getSystemService(Context.PRINT_SERVICE) as PrintManager
            manager.print(jobName, view.createPrintDocumentAdapter(jobName), PrintAttributes.Builder().build())
        }
    }
    web.loadDataWithBaseURL(null, html, "text/html", "utf-8", null)
}

/** Schreibt [text] (UTF-8) in eine vom Nutzer gewählte Datei (Storage Access Framework). */
suspend fun writeText(context: Context, uri: Uri, text: String) = withContext(Dispatchers.IO) {
    context.contentResolver.openOutputStream(uri)?.use { it.write(text.toByteArray()) }
}
