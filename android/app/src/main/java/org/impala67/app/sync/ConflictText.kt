package org.impala67.app.sync

import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.util.Locale
import uniffi.impala_ffi.ConflictInfo
import uniffi.impala_ffi.ConflictResolution
import uniffi.impala_ffi.ConflictSide
import uniffi.impala_ffi.ConflictType

/** Eine angebotene Entscheidung mit Text (`cf-action` in conflict-ui.js). */
data class ConflictAction(
    val resolution: ConflictResolution,
    val title: String,
    val sub: String,
    val badge: String?,
    val recommended: Boolean,
)

/**
 * Texte des Konflikt-Dialogs (wörtlich aus web/conflict-ui.js). Art, Empfehlung und Entscheidungen
 * kommen aus dem Rust-Kern (`ConflictInfo`); hier steht nur die Darstellung.
 */
object ConflictText {
    const val TITLE = "Synchronisation braucht eine Entscheidung"
    const val HERE = "Dieses Gerät"
    const val OTHER = "Anderes Gerät / Drive"
    const val NO_TEXT = "(Kein Text vorhanden.)"
    const val BULK_BUTTON_PREFIX = "Alle "
    const val BULK_BUTTON_SUFFIX = " Konflikte mit Empfehlung lösen"
    const val COPY_LABEL = "Gerettete Kopie"
    const val CURRENT_LABEL = "Aktuelle Seite"
    const val FAILED = "Die Entscheidung konnte nicht angewendet werden. Es wurde nichts geändert."
    const val BULK_FAILED = "Nicht alle Konflikte konnten gelöst werden."

    private val timeFormat = DateTimeFormatter.ofPattern("dd.MM.yy, HH:mm", Locale.GERMANY)
        .withZone(ZoneId.systemDefault())

    /** Zeitpunkt wie `fmtConflictTime` (de-DE, zweistelliges Jahr); ohne Angabe „unbekannt“. */
    fun time(iso: String?): String = when {
        iso.isNullOrBlank() -> "unbekannt"
        else -> runCatching { timeFormat.format(Instant.parse(iso)) }.getOrDefault(iso)
    }

    fun kindLabel(c: ConflictInfo): String = when (c.kind) {
        ConflictType.BOTH -> "Beide geändert"
        ConflictType.DELETE -> "Gelöscht vs. geändert"
        ConflictType.LEGACY -> when (c.pageId) {
            null -> "Original fehlt"
            else -> lines(c.extraLines)?.let { "$it neu" } ?: "Nichts Neues"
        }
    }

    fun explain(c: ConflictInfo): String = when (c.kind) {
        ConflictType.BOTH -> "Auf diesem Gerät und auf Drive wurde die Seite unterschiedlich geändert."
        ConflictType.DELETE -> "Auf einem Gerät wurde die Seite gelöscht, auf dem anderen geändert oder verschoben."
        ConflictType.LEGACY -> legacyExplain(c)
    }

    /** Entscheidungen des Kerns mit Texten; `recommended` markiert die Empfehlung. */
    fun actions(c: ConflictInfo): List<ConflictAction> = c.choices.map { choice ->
        val t = when (c.kind) {
            ConflictType.BOTH -> both(choice.resolution, localWins = c.winner != ConflictSide.REMOTE)
            ConflictType.DELETE -> delete(choice.resolution)
            ConflictType.LEGACY -> legacy(choice.resolution)
        }
        ConflictAction(choice.resolution, t.title, t.sub, t.badge, choice.recommended)
    }

    private class Txt(val title: String, val sub: String, val badge: String? = null)

    private fun lines(n: UInt?): String? = n?.takeIf { it > 0u }?.let { "$it ${if (it == 1u) "Zeile" else "Zeilen"}" }

    private fun legacyExplain(c: ConflictInfo): String {
        val page = "„${c.originalTitle?.takeIf { it.isNotBlank() } ?: "Seite"}“"
        val extra = lines(c.extraLines)
        return when {
            c.pageId == null -> "Die ursprüngliche Seite gibt es nicht mehr (umbenannt oder gelöscht). Schau kurz rein, ob du den Text noch brauchst."
            extra == null -> "Alles aus dieser Kopie steht schon in $page. Du verlierst nichts, wenn du sie verwirfst."
            else -> "Die Kopie enthält $extra, die in $page fehlen (unten grün markiert). Brauchst du sie, behalte die Kopie als eigene Seite."
        }
    }

    private fun both(r: ConflictResolution, localWins: Boolean): Txt {
        val keepHere = if (localWins) ConflictResolution.KEEP_WINNER else ConflictResolution.USE_LOSER
        return when {
            r == ConflictResolution.KEEP_BOTH -> Txt("Beide behalten", "Die Konfliktkopie bleibt als eigene Seite. Nichts wird gelöscht.")
            r == keepHere -> Txt(
                "Dieses Gerät behalten",
                if (localWins) "Die Fassung von Drive kommt in den Papierkorb." else "Die Seite bekommt diesen Stand. Der Drive-Stand bleibt im Verlauf.",
                "Empfohlen · neuer",
            )
            else -> Txt(
                "Anderen Stand behalten",
                if (localWins) "Die Seite bekommt den Drive-Stand. Der Stand von diesem Gerät bleibt im Verlauf." else "Die Fassung von diesem Gerät kommt in den Papierkorb.",
                "Empfohlen · neuer",
            )
        }
    }

    private fun delete(r: ConflictResolution): Txt = when (r) {
        ConflictResolution.USE_LOSER -> Txt("Seite behalten (wiederherstellen)", "Die Seite kommt mit dem geänderten Stand zurück.")
        ConflictResolution.KEEP_WINNER -> Txt(
            "Gelöscht lassen", "Die Seite bleibt gelöscht. Der geänderte Stand landet im Papierkorb.", "Empfohlen · Löschen gewinnt",
        )
        ConflictResolution.KEEP_BOTH -> Txt("Beide behalten", "Die Konfliktkopie bleibt als eigene Seite. Nichts wird gelöscht.")
    }

    private fun legacy(r: ConflictResolution): Txt = when (r) {
        ConflictResolution.KEEP_WINNER -> Txt(
            "Kopie verwerfen", "Die Kopie landet im Papierkorb. Die Seite bleibt unverändert.", "Empfohlen · nichts geht verloren",
        )
        ConflictResolution.KEEP_BOTH -> Txt(
            "Als eigene Seite behalten", "Die Kopie wird eine normale Seite mit dem Zusatz „(Kopie)“. Nichts wird gelöscht.",
        )
        ConflictResolution.USE_LOSER -> Txt("Kopie übernehmen", "Der Stand der Kopie wird übernommen.")
    }
}
