package org.impala67.app.settings

import androidx.annotation.DrawableRes
import org.impala67.app.R

/**
 * Bereiche der Einstellungen (web/settings-schema.js `SETTINGS_SECTIONS`). Die IDs sind dieselben wie
 * in der PWA, damit Verweise („settings/sync“ …) übereinstimmen.
 */
enum class SettingsSectionInfo(
    val id: String,
    val label: String,
    val description: String,
    @DrawableRes val icon: Int,
    /** Überschrift und Untertitel der Detailseite (settings-renderer.js). */
    val pageTitle: String,
    val pageSubtitle: String,
) {
    OVERVIEW(
        "overview", "Übersicht", "KI, Sync, Backup, Speicher und Version auf einen Blick", R.drawable.ic_i_home,
        "Übersicht", "Alles Wichtige auf einen Blick – ohne technische Details.",
    ),
    APPEARANCE(
        "appearance", "Darstellung", "Design, Lesbarkeit und Oberfläche", R.drawable.ic_i_palette,
        "Darstellung", "Ein ruhiges Erscheinungsbild, das zu deinem Gerät und deinem Lernstil passt.",
    ),
    AI(
        "ai", "KI", "Modelle, Quellen und lokale KI", R.drawable.ic_i_sparkles,
        "KI", "Modelle, Zugänge und lokale KI – alles auf einer Seite.",
    ),
    LEARNING(
        "learning", "Lernen", "Lernverhalten, Pausen und Controller", R.drawable.ic_i_graduation,
        "Lernen", "Wie Karteikarten abgefragt werden und welche Lernhilfen dich unterstützen.",
    ),
    SYNC(
        "sync", "Sync & Backup", "Live-Sync, Google Drive und Backups", R.drawable.ic_i_sync,
        "Sync & Backup", "Halte deine Geräte synchron und sichere deine Daten.",
    ),
    APP(
        "app", "App & Speicher", "Speicher, Updates und Experimente", R.drawable.ic_i_gear,
        "App & Speicher", "Speicher im Blick behalten, die App aktuell halten und Neues ausprobieren.",
    );

    companion object {
        /** Wie `resolveSettingsSection`: unbekannte Namen landen in der Übersicht. */
        fun resolve(id: String?): SettingsSectionInfo {
            val key = id.orEmpty().lowercase().replace(" ", "")
            return ALIASES[key]?.let { entries.firstOrNull { s -> s.id == it } }
                ?: entries.firstOrNull { it.id == key } ?: OVERVIEW
        }

        private val ALIASES = mapOf(
            "ki" to "ai", "look" to "appearance", "home" to "appearance", "general" to "appearance",
            "notion" to "sync", "cloudflare" to "sync", "drive" to "sync", "backup" to "sync",
            "data" to "app", "update" to "app", "storage" to "app",
            "devices" to "learning", "controller" to "learning", "experimente" to "learning",
            "pause" to "learning", "lernzeit" to "learning",
        )
    }
}

/** Die Felder, die über `settingsJson` kommen (nur diese; Geheimnisse werden hier nicht gelesen). */
data class SettingsValues(
    val userName: String = "",
    val homeArticle: Boolean = true,
    val homeTopics: String = "",
    val relatedPages: Boolean = true,
    val alwaysSendTools: Boolean = true,
    val customInstructions: String = "",
    /** Auto-Sync-Intervall in Minuten; `null`, solange nichts gespeichert ist. */
    val driveAutoSyncMinutes: Int? = null,
    val driveSyncAfterChange: Boolean = false,
)
