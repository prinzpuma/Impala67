package org.impala67.app.settings

import android.content.Context
import androidx.datastore.core.DataStore
import androidx.datastore.preferences.core.Preferences
import androidx.datastore.preferences.core.booleanPreferencesKey
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.intPreferencesKey
import androidx.datastore.preferences.core.stringPreferencesKey
import androidx.datastore.preferences.preferencesDataStore
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.map

private val Context.dataStore by preferencesDataStore("device")

/** Erscheinungsbild: Systemvorgabe oder manuell (PWA: `impala67FollowSystemTheme` / `impala67Theme`). */
enum class ThemeMode { SYSTEM, LIGHT, DARK }

/** Akzentfarben der PWA (`ACCENT_THEMES`); [swatch] ist die dunkle Variante für Auswahlpunkte. */
enum class AccentColor(val swatch: Long) {
    BLUE(0xFF6B8CAE), VIOLET(0xFF8F82A9), GREEN(0xFF6E8C75), ORANGE(0xFFB07F59),
}

/** Darstellungsdichte (`impala67Density`). */
enum class Density { COMPACT, COMFORTABLE }

/** Schriftgröße (`impala67FontSize`: s / m / l). */
enum class FontScale { SMALL, NORMAL, LARGE }

/**
 * Einstellungen nur für dieses Gerät (in der PWA: localStorage, damit sie nicht über den Sync
 * überschrieben werden). Was auf allen Geräten gelten soll, liegt in den Kern-Einstellungen
 * (`settingsJson` / `updateSettings`).
 */
class DevicePrefs(private val context: Context) {
    private val store: DataStore<Preferences> get() = context.dataStore

    val themeMode: Flow<ThemeMode> = enumFlow(THEME, ThemeMode.SYSTEM)
    val accent: Flow<AccentColor> = enumFlow(ACCENT, AccentColor.BLUE)
    val density: Flow<Density> = enumFlow(DENSITY, Density.COMPACT)
    val fontScale: Flow<FontScale> = enumFlow(FONT_SCALE, FontScale.NORMAL)
    /** Performance-Modus: ohne Animationen (PWA `impala67Motion` = reduced). */
    val reduceMotion: Flow<Boolean> = boolFlow(REDUCE_MOTION, false)
    val nativeHaptics: Flow<Boolean> = boolFlow(HAPTICS, true)
    val betaUi: Flow<Boolean> = boolFlow(BETA_UI, true)

    /** Lernverhalten (`impala67Overlearn`, `impala67Confidence`, `impala67Telemetry`, `impala67BreakReminder`). */
    val overlearn: Flow<Boolean> = boolFlow(OVERLEARN, true)
    val confidence: Flow<Boolean> = boolFlow(CONFIDENCE, false)
    val telemetry: Flow<Boolean> = boolFlow(TELEMETRY, true)
    val breakReminder: Flow<Boolean> = boolFlow(BREAK_REMINDER, true)

    /** Wochenziel in Minuten (lernzeit.js `weekGoalMinutes`), mindestens 30, sonst 300. */
    val weekGoalMinutes: Flow<Int> = store.data.map { (it[WEEK_GOAL] ?: 300).coerceAtLeast(30) }

    /**
     * Schlüssel des aktiven Cloudflare-Syncs (PWA: `LS_KEY` in sync-cloudflare.js). Leer = getrennt;
     * nur dann verbindet die App beim Start nicht von selbst.
     */
    val cfSyncKey: Flow<String> = store.data.map { it[CF_SYNC_KEY].orEmpty() }

    suspend fun setThemeMode(mode: ThemeMode) = put(THEME, mode.name)
    suspend fun setCfSyncKey(key: String) = put(CF_SYNC_KEY, key)

    /** Google Drive auf diesem Gerät angemeldet (PWA: `impala67_drive_session`) und mit welchem Konto. */
    val driveConnected: Flow<Boolean> = boolFlow(DRIVE_CONNECTED, false)
    val driveEmail: Flow<String> = store.data.map { it[DRIVE_EMAIL].orEmpty() }
    suspend fun setDriveConnected(on: Boolean) = put(DRIVE_CONNECTED, on)
    suspend fun setDriveEmail(email: String) = put(DRIVE_EMAIL, email)
    suspend fun setAccent(accent: AccentColor) = put(ACCENT, accent.name)
    suspend fun setDensity(density: Density) = put(DENSITY, density.name)
    suspend fun setFontScale(scale: FontScale) = put(FONT_SCALE, scale.name)
    suspend fun setReduceMotion(on: Boolean) = put(REDUCE_MOTION, on)
    suspend fun setNativeHaptics(on: Boolean) = put(HAPTICS, on)
    suspend fun setBetaUi(on: Boolean) = put(BETA_UI, on)
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
        val OVERLEARN = booleanPreferencesKey("overlearn")
        val CONFIDENCE = booleanPreferencesKey("confidence")
        val TELEMETRY = booleanPreferencesKey("telemetry")
        val BREAK_REMINDER = booleanPreferencesKey("breakReminder")
        val WEEK_GOAL = intPreferencesKey("weekGoalMinutes")
        val CF_SYNC_KEY = stringPreferencesKey("cfSyncKey")
        val DRIVE_CONNECTED = booleanPreferencesKey("driveConnected")
        val DRIVE_EMAIL = stringPreferencesKey("driveEmail")
        val GOAL_PRESETS = listOf(120, 300, 480, 720)
    }
}
