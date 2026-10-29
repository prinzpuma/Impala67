package org.impala67.app.settings

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.launch
import org.impala67.app.core.ImpalaStore
import org.impala67.app.core.Touches
import org.json.JSONObject

/**
 * Einstellungen (web/settings.js). Kern-Werte kommen über `settingsJson` und gehen über
 * `updateSettings` (wie `STATE.dispatch("settingsSet", …)`); Geräte-Werte schreibt [setPref] in DataStore.
 */
class SettingsViewModel(private val store: ImpalaStore, private val prefs: DevicePrefs) : ViewModel() {
    /** `null` bis zum ersten Lesen. Liest nur die benötigten Felder, keine Geheimnisse. */
    val values: StateFlow<SettingsValues?> = store.query(Touches.settings) { core ->
        val s = runCatching { JSONObject(core.settingsJson()) }.getOrDefault(JSONObject())
        SettingsValues(
            userName = s.optString("homeUserName"),
            homeArticle = s.optBoolean("homeArticle", true),
            homeTopics = s.optString("homeArticleTopics"),
            relatedPages = s.optBoolean("relatedPages", true),
            alwaysSendTools = s.optBoolean("alwaysSendTools", true),
            customInstructions = s.optString("customInstructions"),
            driveAutoSyncMinutes = s.optInt("driveAutoSyncMinutes", -1).takeIf { it > 0 },
            driveSyncAfterChange = s.optBoolean("driveSyncAfterChange", false),        )
    }

    /** Rückmeldungen für die Snackbar der Shell (z. B. „Name gespeichert.“). */
    private val _messages = MutableSharedFlow<String>(extraBufferCapacity = 8)
    val messages: SharedFlow<String> = _messages

    /** Begrüßungsname; Speichern beim Verlassen des Feldes wie in der PWA. */
    fun saveUserName(name: String) = patch(mapOf("homeUserName" to name.trim()), "Name gespeichert.")

    fun setHomeArticle(on: Boolean) = patch(mapOf("homeArticle" to on))

    fun saveHomeTopics(topics: String) = patch(mapOf("homeArticleTopics" to topics.trim()), "Themen gespeichert.")

    fun setRelatedPages(on: Boolean) = patch(mapOf("relatedPages" to on))

    fun setAlwaysSendTools(on: Boolean) = patch(mapOf("alwaysSendTools" to on))

    fun saveCustomInstructions(text: String) = patch(mapOf("customInstructions" to text), "Anweisungen gespeichert.")

    /** Auto-Sync-Intervall (Minuten); Meldung wie in der PWA (`handleDriveAutoSyncMinutes`). */
    fun setDriveAutoSyncMinutes(min: Int) =
        patch(mapOf("driveAutoSyncMinutes" to min), "Automatischer Sync: alle $min Minuten.")

    fun setDriveSyncAfterChange(on: Boolean) = patch(mapOf("driveSyncAfterChange" to on))

    /** Geräteeinstellung schreiben, z. B. `setPref { setThemeMode(ThemeMode.DARK) }`. */
    fun setPref(block: suspend DevicePrefs.() -> Unit) {
        viewModelScope.launch {
            runCatching { prefs.block() }.onFailure { _messages.emit("Speichern fehlgeschlagen.") }
        }
    }

    /** Ein Patch für `settingsSet`: nur die übergebenen Schlüssel ändern sich. */
    private fun patch(fields: Map<String, Any>, done: String? = null) {
        viewModelScope.launch {
            runCatching { store.write { it.updateSettings(JSONObject(fields).toString()) } }
                .onSuccess { done?.let { _messages.emit(it) } }
                .onFailure { _messages.emit("Speichern fehlgeschlagen.") }
        }
    }
}
