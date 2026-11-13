package org.impala67.app.settings

import android.content.Context
import androidx.datastore.core.DataStore
import androidx.datastore.preferences.core.Preferences
import androidx.datastore.preferences.core.booleanPreferencesKey
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.intPreferencesKey
import androidx.datastore.preferences.core.longPreferencesKey
import androidx.datastore.preferences.core.stringPreferencesKey
import androidx.datastore.preferences.core.stringSetPreferencesKey
import androidx.datastore.preferences.preferencesDataStore
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.map

private val Context.dataStore by preferencesDataStore("device")

/** Erscheinungsbild: Systemvorgabe oder manuell (PWA: `impala67FollowSystemTheme` / `impala67Theme`). */
enum class ThemeMode { SYSTEM, LIGHT, DARK }

/**
 * Akzentfarben der PWA (`ACCENT_THEMES`, dunkel/hell). [WALLPAPER] nimmt die Farbe aus dem
 * Android-Hintergrundbild (Material You, ab Android 12) und ist dort Standard.
 */
enum class AccentColor(val dark: Long, val light: Long) {
    WALLPAPER(0xFF6B8CAE, 0xFF2478C7),
    BLUE(0xFF6B8CAE, 0xFF2478C7), VIOLET(0xFF8F82A9, 0xFF7C7193),
    GREEN(0xFF6E8C75, 0xFF627D69), ORANGE(0xFFB07F59, 0xFF976D4D),
}

/** Darstellungsdichte (`impala67Density`). */
enum class Density { COMPACT, COMFORTABLE }

/** Schriftgröße (`impala67FontSize`: s / m / l → `--font-base` 15 / 16 / 18 px). */
enum class FontScale(val factor: Float) { SMALL(15f / 16f), NORMAL(1f), LARGE(18f / 16f) }

/**
 * Einstellungen nur für dieses Gerät (in der PWA: localStorage, damit sie nicht über den Sync
 * überschrieben werden). Was auf allen Geräten gelten soll, liegt in den Kern-Einstellungen
 * (`settingsJson` / `updateSettings`).
 */
class DevicePrefs(private val context: Context) {
    private val store: DataStore<Preferences> get() = context.dataStore

    val themeMode: Flow<ThemeMode> = enumFlow(THEME, ThemeMode.SYSTEM)
    val accent: Flow<AccentColor> = enumFlow(ACCENT, AccentColor.WALLPAPER)
    val density: Flow<Density> = enumFlow(DENSITY, Density.COMPACT)
    val fontScale: Flow<FontScale> = enumFlow(FONT_SCALE, FontScale.NORMAL)
    /** Performance-Modus: ohne Animationen (PWA `impala67Motion` = reduced). */
    val reduceMotion: Flow<Boolean> = boolFlow(REDUCE_MOTION, false)
    val nativeHaptics: Flow<Boolean> = boolFlow(HAPTICS, true)
    val betaUi: Flow<Boolean> = boolFlow(BETA_UI, true)
    /** Vollbild: Status- und Navigationsleiste ausblenden, Wischen vom Rand holt sie kurz zurück. */
    val hideSystemBars: Flow<Boolean> = boolFlow(HIDE_SYSTEM_BARS, true)

    /** Lernverhalten (`impala67Overlearn`, `impala67Confidence`, `impala67Telemetry`, `impala67BreakReminder`). */
    val overlearn: Flow<Boolean> = boolFlow(OVERLEARN, false)
    val confidence: Flow<Boolean> = boolFlow(CONFIDENCE, false)
    val telemetry: Flow<Boolean> = boolFlow(TELEMETRY, true)
    val breakReminder: Flow<Boolean> = boolFlow(BREAK_REMINDER, false)

    /** Wochenziel in Minuten (lernzeit.js `weekGoalMinutes`), mindestens 30, sonst 300. */
    val weekGoalMinutes: Flow<Int> = store.data.map { (it[WEEK_GOAL] ?: 300).coerceAtLeast(30) }

    /**
     * Schlüssel des aktiven Cloudflare-Syncs (PWA: `LS_KEY` in sync-cloudflare.js). Leer = getrennt;
     * nur dann verbindet die App beim Start nicht von selbst. Liegt verschlüsselt ([SecretBox]).
     */
    val cfSyncKey: Flow<String> = store.data.map { prefs -> prefs[CF_SYNC_KEY]?.let(SecretBox::open).orEmpty() }

    suspend fun setThemeMode(mode: ThemeMode) = put(THEME, mode.name)
    suspend fun setCfSyncKey(key: String) = put(CF_SYNC_KEY, SecretBox.seal(key))

    /**
     * Zuletzt gesehener Schlüssel aus den Einstellungen (`null`: noch nie). Nur ein neuer Schlüssel
     * (z. B. über Drive von einem anderen Gerät) verbindet von selbst – nach „Trennen“ nicht erneut.
     */
    val cfSeenKey: Flow<String?> = store.data.map { prefs -> prefs[CF_SEEN_KEY]?.let(SecretBox::open) }
    suspend fun setCfSeenKey(key: String) = put(CF_SEEN_KEY, SecretBox.seal(key))

    /** Google Drive auf diesem Gerät angemeldet (PWA: `impala67_drive_session`) und mit welchem Konto. */
    val driveConnected: Flow<Boolean> = boolFlow(DRIVE_CONNECTED, false)
    val driveEmail: Flow<String> = store.data.map { it[DRIVE_EMAIL].orEmpty() }
    suspend fun setDriveConnected(on: Boolean) = put(DRIVE_CONNECTED, on)

    /** Einmal nach der Erlaubnis für Benachrichtigungen gefragt (Lern-Erinnerung, ab Android 13). */
    val notificationsAsked: Flow<Boolean> = boolFlow(NOTIFICATIONS_ASKED, false)
    suspend fun setNotificationsAsked() = put(NOTIFICATIONS_ASKED, true)

    /** Tablet-Seitenleiste: eingeklappt (`impala67.sidebarCollapsed`) und Breite in dp (`--sidebar-w`; 0 = Standard). */
    val sidebarCollapsed: Flow<Boolean> = boolFlow(SIDEBAR_COLLAPSED, false)
    val sidebarWidth: Flow<Int> = store.data.map { it[SIDEBAR_WIDTH] ?: 0 }
    suspend fun setSidebarCollapsed(on: Boolean) = put(SIDEBAR_COLLAPSED, on)
    suspend fun setSidebarWidth(dp: Int) = put(SIDEBAR_WIDTH, dp)

    /** Tab-Anordnung (`impala67TabsPosition`): oben (Standard) oder in der Seitenleiste. */
    val tabsInSidebar: Flow<Boolean> = boolFlow(TABS_IN_SIDEBAR, false)
    suspend fun setTabsInSidebar(on: Boolean) = put(TABS_IN_SIDEBAR, on)

    /** Beim Start das GoodNotes-Regal öffnen (`impala67StartLibrary`), nur auf diesem Gerät. */
    val startLibrary: Flow<Boolean> = boolFlow(START_LIBRARY, false)
    suspend fun setStartLibrary(on: Boolean) = put(START_LIBRARY, on)

    /** Letztes lokales Backup in ms seit 1970 (`impala67LastBackup`); `null` = noch keines. */
    val lastBackup: Flow<Long?> = store.data.map { it[LAST_BACKUP] }
    suspend fun setLastBackup(ms: Long) = put(LAST_BACKUP, ms)

    /** Backup-Hinweis der Startseite ausgeblendet bis (ms seit 1970, `impala67_backup_snooze_until`). */
    val backupSnoozeUntil: Flow<Long> = store.data.map { it[BACKUP_SNOOZE] ?: 0L }
    suspend fun setBackupSnoozeUntil(ms: Long) = put(BACKUP_SNOOZE, ms)

    /** Heft-Werkzeuge als JSON wie `impala67HeftTools` der PWA (heft-tools.js); leer = Standard. */
    val heftTools: Flow<String> = store.data.map { it[HEFT_TOOLS].orEmpty() }
    suspend fun setHeftTools(json: String) = put(HEFT_TOOLS, json)
    /** ★ Modell-Favoriten als „quelle::modell“ (`impala67FavModels`), bewusst nur auf diesem Gerät. */
    val favModels: Flow<Set<String>> = store.data.map { it[FAV_MODELS].orEmpty() }
    suspend fun toggleFavModel(key: String) = store.edit {
        val now = it[FAV_MODELS].orEmpty()
        it[FAV_MODELS] = if (key in now) now - key else now + key
    }

    /** Dokumentenscanner im Heft: Google-Scanner (ML Kit, Standard) oder der eigene Impala-Scanner. */
    val impalaScanner: Flow<Boolean> = boolFlow(IMPALA_SCANNER, false)
    suspend fun setImpalaScanner(on: Boolean) = put(IMPALA_SCANNER, on)

    /** Performance-Profiler (`impala67PerformanceProfiler`), Standard aus. */
    val profiler: Flow<Boolean> = boolFlow(PROFILER, false)
    suspend fun setProfiler(on: Boolean) = put(PROFILER, on)

    suspend fun setDriveEmail(email: String) = put(DRIVE_EMAIL, email)
    suspend fun setAccent(accent: AccentColor) = put(ACCENT, accent.name)
    suspend fun setDensity(density: Density) = put(DENSITY, density.name)
    suspend fun setFontScale(scale: FontScale) = put(FONT_SCALE, scale.name)
    suspend fun setReduceMotion(on: Boolean) = put(REDUCE_MOTION, on)
    suspend fun setNativeHaptics(on: Boolean) = put(HAPTICS, on)
    suspend fun setBetaUi(on: Boolean) = put(BETA_UI, on)
    suspend fun setHideSystemBars(on: Boolean) = put(HIDE_SYSTEM_BARS, on)
    suspend fun setOverlearn(on: Boolean) = put(OVERLEARN, on)
    suspend fun setConfidence(on: Boolean) = put(CONFIDENCE, on)
    suspend fun setTelemetry(on: Boolean) = put(TELEMETRY, on)
    suspend fun setBreakReminder(on: Boolean) = put(BREAK_REMINDER, on)

    /** Nächste Stufe wie `cycleGoal` in lernzeit.js. Liefert das neue Ziel. */
    suspend fun cycleWeekGoal(): Int {
        var next = 0
        store.edit {
            val now = (it[WEEK_GOAL] ?: 300).coerceAtLeast(30)
            next = GOAL_PRESETS[(GOAL_PRESETS.indexOf(now) + 1) % GOAL_PRESETS.size]
            it[WEEK_GOAL] = next
        }
        return next
    }

    private fun boolFlow(key: Preferences.Key<Boolean>, default: Boolean): Flow<Boolean> =
        store.data.map { it[key] ?: default }

    /** Unbekannte oder alte Werte fallen auf den Standard zurück. */
    private inline fun <reified T : Enum<T>> enumFlow(key: Preferences.Key<String>, default: T): Flow<T> =
        store.data.map { prefs -> prefs[key]?.let { runCatching { enumValueOf<T>(it) }.getOrNull() } ?: default }

    private suspend fun <T> put(key: Preferences.Key<T>, value: T) {
        store.edit { it[key] = value }
    }

    private companion object {
        val THEME = stringPreferencesKey("themeMode")
        val ACCENT = stringPreferencesKey("accent")
        val DENSITY = stringPreferencesKey("density")
        val FONT_SCALE = stringPreferencesKey("fontScale")
        val REDUCE_MOTION = booleanPreferencesKey("reduceMotion")
        val HAPTICS = booleanPreferencesKey("nativeHaptics")
        val BETA_UI = booleanPreferencesKey("betaUi")
        val HIDE_SYSTEM_BARS = booleanPreferencesKey("hideSystemBars")
        val OVERLEARN = booleanPreferencesKey("overlearn")
        val CONFIDENCE = booleanPreferencesKey("confidence")
        val TELEMETRY = booleanPreferencesKey("telemetry")
        val BREAK_REMINDER = booleanPreferencesKey("breakReminder")
        val WEEK_GOAL = intPreferencesKey("weekGoalMinutes")
        val CF_SYNC_KEY = stringPreferencesKey("cfSyncKey")
        val CF_SEEN_KEY = stringPreferencesKey("cfSeenKey")
        val DRIVE_CONNECTED = booleanPreferencesKey("driveConnected")
        val DRIVE_EMAIL = stringPreferencesKey("driveEmail")
        val HEFT_TOOLS = stringPreferencesKey("heftTools")
        val NOTIFICATIONS_ASKED = booleanPreferencesKey("notificationsAsked")
        val SIDEBAR_COLLAPSED = booleanPreferencesKey("sidebarCollapsed")
        val SIDEBAR_WIDTH = intPreferencesKey("sidebarWidth")
        val TABS_IN_SIDEBAR = booleanPreferencesKey("tabsInSidebar")
        val START_LIBRARY = booleanPreferencesKey("start_library")
        val LAST_BACKUP = longPreferencesKey("lastBackup")
        val BACKUP_SNOOZE = longPreferencesKey("backupSnoozeUntil")
        val FAV_MODELS = stringSetPreferencesKey("favModels")
        val IMPALA_SCANNER = booleanPreferencesKey("impalaScanner")
        val PROFILER = booleanPreferencesKey("profiler")
        val GOAL_PRESETS = listOf(120, 300, 480, 720)
    }
}
