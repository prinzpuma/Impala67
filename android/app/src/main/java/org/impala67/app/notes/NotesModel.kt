package org.impala67.app.notes

import org.impala67.app.R
import uniffi.impala_ffi.ImpalaCore
import uniffi.impala_ffi.PageKind
import uniffi.impala_ffi.PageSummary
import uniffi.impala_ffi.WorkspaceInfo
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.util.Locale

/** Eine Zeile der Notizen-Liste; [childCount] bestimmt, ob der Unterseiten-Knopf erscheint. */
data class NoteRow(val page: PageSummary, val childCount: Int)

/**
 * Zustand der Notizen-Ebene (in der PWA: `mobile-notes.js`). Wird vollständig aus dem Kern gelesen;
 * die Suche selbst liegt im Text-Feld des [NotesViewModel], damit Eingaben sofort erscheinen.
 */
data class NotesState(
    val workspaces: List<WorkspaceInfo>,
    val workspaceId: String,
    /** Aktuelle Ebene; `null` = Wurzel. Fehlt die Seite (gelöscht, archiviert), gilt wieder die Wurzel. */
    val parent: PageSummary?,
    /** Zuletzt bearbeitete Seiten des Arbeitsbereichs (höchstens 5). */
    val recent: List<NoteRow>,
    /** Angeheftete Seiten (höchstens 20). */
    val favorites: List<NoteRow>,
    /** Wurzel: alle Notizen des Arbeitsbereichs, sonst die Unterseiten der Ebene (Reihenfolge des Kerns). */
    val level: List<NoteRow>,
    /** Suchtreffer (höchstens 50); leer ohne Suchtext. */
    val hits: List<NoteRow>,
    val hasPages: Boolean,
)

/** Titel wie in der PWA: leer heißt „Ohne Titel“. */
fun pageTitle(page: PageSummary): String = page.title.ifBlank { "Ohne Titel" }

/** Platzhalter-Emojis aus `DEFAULT_PAGE_EMOJI` (icons.js): sie zeigen ein Symbol statt Text. */
private val DEFAULT_ICON_NAME = mapOf("📓" to "notebook", "📄" to "file", "📝" to "note", "📅" to "calendar")

/** Eigenes Emoji der Seite als Text; `null`, wenn die Seite ein Symbol zeigt. */
fun ownEmoji(page: PageSummary): String? = page.icon.takeIf { it.isNotBlank() && it !in DEFAULT_ICON_NAME }

/** Symbol einer Seite ohne eigenes Emoji: Heft-Symbol für Hefte, sonst Notiz-Symbol. */
fun pageIconRes(page: PageSummary): Int =
    when (DEFAULT_ICON_NAME[page.icon] ?: if (page.kind == PageKind.HEFT) "notebook" else "note") {
        "notebook" -> R.drawable.ic_i_notebook
        "file" -> R.drawable.ic_i_file
        "calendar" -> R.drawable.ic_i_calendar
        else -> R.drawable.ic_i_note
    }

private val DATE_FORMAT = DateTimeFormatter.ofPattern("d. MMM yyyy, HH:mm", Locale.GERMAN)

/** Datum in Ortszeit (wie `U.fmtDate`); unlesbare Werte ergeben einen leeren Text. */
fun formatDate(iso: String): String =
    runCatching { DATE_FORMAT.format(Instant.parse(iso).atZone(ZoneId.systemDefault())) }.getOrDefault("")

/**
 * Liest die Notizen-Ebene aus dem Kern. Aktive Seiten kommen neueste zuerst aus `recentPages`; die
 * Reihenfolge innerhalb einer Ebene liefert `childrenOf` (Benutzer-Reihenfolge), wie `STATE.childrenOf`.
 */
internal fun readNotes(core: ImpalaCore, workspaceId: String?, parentId: String?, query: String): NotesState {
    val workspaces = core.workspaces()
    val ws = workspaceId?.takeIf { id -> workspaces.any { it.id == id } } ?: workspaces.firstOrNull()?.id ?: "default"
    val active = core.recentPages(UInt.MAX_VALUE)
    val childCounts = active.groupingBy { it.parentId }.eachCount()
    fun row(page: PageSummary) = NoteRow(page, childCounts[page.id] ?: 0)

    val inWs = active.filter { it.workspaceId == ws }
    val parent = parentId?.let { id -> active.firstOrNull { it.id == id } }
    val q = query.trim()
    return NotesState(
        workspaces = workspaces,
        workspaceId = ws,
        parent = parent,
        recent = inWs.take(5).map(::row),
        favorites = inWs.filter { it.favorite }.take(20).map(::row),
        level = core.childrenOf(parent?.id, ws).map(::row),
        hits = if (q.isEmpty()) emptyList() else inWs.filter { it.title.contains(q, ignoreCase = true) }.take(50).map(::row),
        hasPages = inWs.isNotEmpty(),
    )
}
