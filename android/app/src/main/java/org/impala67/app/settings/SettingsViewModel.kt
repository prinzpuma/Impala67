package org.impala67.app.settings

import android.content.ContentResolver
import android.net.Uri
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.impala67.app.core.ImpalaStore
import org.impala67.app.core.Touches
import org.json.JSONArray
import org.json.JSONObject
import uniffi.impala_ffi.AiModel
import uniffi.impala_ffi.AiPing

/** Gefundene Modelle aller Quellen (`S.availableModels`); [error] nur, wenn alle Quellen scheitern. */
data class ModelList(val loading: Boolean = false, val models: List<AiModel> = emptyList(), val error: String? = null)

/** Was die Gefahrenzone löschen würde (Beschriftung und Sperre der Schaltflächen). */
data class DataCounts(val chats: Int, val cards: Int, val decks: Int)

/**
 * Einstellungen (web/settings.js). Kern-Werte kommen über `settingsJson` und gehen über
 * `updateSettings` (wie `STATE.dispatch("settingsSet", …)`); Geräte-Werte schreibt [setPref] in DataStore.
 */
class SettingsViewModel(private val store: ImpalaStore, private val prefs: DevicePrefs) : ViewModel() {
    /** `null` bis zum ersten Lesen. */
    val values: StateFlow<SettingsValues?> = store.query(Touches.settings) { core ->
        val s = runCatching { JSONObject(core.settingsJson()) }.getOrDefault(JSONObject())
        SettingsValues(
            providers = providersOf(s.optJSONArray("aiProviders")),
            providerId = s.optString("aiProviderId"),
            model = s.optString("aiModel"),
            userName = s.optString("homeUserName"),
            homeArticle = s.optBoolean("homeArticle", true),
            homeTopics = s.optString("homeArticleTopics"),
            relatedPages = s.optBoolean("relatedPages", true),
            alwaysSendTools = s.optBoolean("alwaysSendTools", true),
            customInstructions = s.optString("customInstructions"),
            driveAutoSyncMinutes = s.optInt("driveAutoSyncMinutes", -1).takeIf { it > 0 },
            driveSyncAfterChange = s.optBoolean("driveSyncAfterChange", false),
        )
    }

    val counts: StateFlow<DataCounts?> = store.query(Touches.any(Touches.chats, Touches.cards)) { core ->
        val totals = core.cardTotals()
        DataCounts(core.chats().size, totals.cards.toInt(), totals.decks.toInt())
    }

    /** Rückmeldungen für die Snackbar der Shell (z. B. „Name gespeichert.“). */
    private val _messages = MutableSharedFlow<String>(extraBufferCapacity = 8)
    val messages: SharedFlow<String> = _messages

    private val _models = MutableStateFlow(ModelList())
    val models: StateFlow<ModelList> = _models

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
    fun setDriveMode(mode: String) = patch(mapOf("driveMode" to if (mode == "sync") "sync" else "backup"))

    // ---------- KI: Modelle und Quellen ----------

    /** „Neu laden“: Modelle aller abfragbaren Quellen (`aiListModels`). */
    fun loadModels() {
        if (_models.value.loading) return
        _models.update { it.copy(loading = true, error = null) }
        viewModelScope.launch {
            val result = runCatching { store.write { it.aiListModels() } }
            _models.value = result.fold(
                { ModelList(models = it) },
                { ModelList(models = _models.value.models, error = it.message ?: "Modelle konnten nicht geladen werden.") },
            )
        }
    }

    /** Modell aus der Liste oder „Manuelle Modell-ID“ übernehmen (`data-modelset`). */
    fun selectModel(providerId: String, model: String) {
        val id = model.trim()
        if (id.isEmpty()) return
        patch(mapOf("aiProviderId" to providerId, "aiModel" to id), "Modell: $id")
    }

    /** Eine Quelle speichern (`handleSaveSettings`); ein geleerter Schlüssel wird entfernt. */
    fun saveProvider(changed: AiProvider) = editProviders("Quelle gespeichert.") { list ->
        val clean = changed.copy(name = changed.name.trim().ifEmpty { changed.id }, base = cleanBase(changed.base))
        list.map { if (it.id == changed.id) clean else it }
    }

    fun removeProvider(id: String) = editProviders("Quelle entfernt.") { list -> list.filter { it.id != id } }

    /** „Quelle hinzufügen“ (`handleAddProvider`). */
    fun addProvider() = editProviders(null) { list ->
        list + AiProvider("p" + System.currentTimeMillis().toString(36), "Neue Quelle", "", "")
    }

    /** Schnell-Schaltflächen „Impala AI“, „LM Studio“ … legen eine fehlende Standard-Quelle wieder an. */
    fun addPreset(preset: AiProvider) {
        val list = values.value?.providers.orEmpty()
        if (list.any { it.id == preset.id }) {
            _messages.tryEmit("Diese Quelle ist bereits eingerichtet: ${preset.name}")
            return
        }
        val extra = if (preset.id == "local") mapOf("aiProviderId" to "local") else emptyMap()
        patch(mapOf("aiProviders" to providersJson(list + preset, keepEmptyKeys = true)) + extra, "${preset.name} hinzugefügt.")
    }

    /** „Verbindung testen“ mit den noch ungespeicherten Feldwerten. */
    suspend fun ping(base: String, key: String): AiPing = store.write { it.aiPingProvider(cleanBase(base), key.trim()) }

    private fun editProviders(done: String?, change: (List<AiProvider>) -> List<AiProvider>) {
        val list = values.value?.providers ?: return
        patch(mapOf("aiProviders" to providersJson(change(list), keepEmptyKeys = false)), done)
    }

    // ---------- Backup und Gefahrenzone ----------

    /** „Backup erstellen“ (`handleBackupNow`): Event-Log samt Dateien als JSON in die gewählte Datei. */
    fun exportBackup(resolver: ContentResolver, uri: Uri) = viewModelScope.launch {
        runCatching {
            val json = store.write { it.exportJson(true) }
            withContext(Dispatchers.IO) {
                resolver.openOutputStream(uri, "wt")!!.use { it.write(json.toByteArray()) }
            }
            prefs.setLastBackup(System.currentTimeMillis())
        }.onSuccess { _messages.emit("Backup gespeichert.") }
            .onFailure { _messages.emit("Backup fehlgeschlagen: ${it.message}") }
    }

    /** „Importieren“ (`handleImportChange`): wird konfliktfrei mit dem Bestand zusammengeführt. */
    fun importBackup(resolver: ContentResolver, uri: Uri) = viewModelScope.launch {
        runCatching {
            val json = withContext(Dispatchers.IO) { resolver.openInputStream(uri)!!.use { it.readBytes().decodeToString() } }
            store.write { it.importJson(json) }
        }.onSuccess { _messages.emit("${it.added} Änderungen importiert.") }
            .onFailure { _messages.emit("Import fehlgeschlagen: ${it.message}") }
    }

    /** „Alle lokalen Seiten löschen“ (`handleResetAll`). */
    fun clearPages() = run("Alle Seiten wurden gelöscht.") { it.clearPages() }

    /** „Alle Chats löschen“ (`handleDeleteAllChats`); gilt per Sync auch auf den anderen Geräten. */
    fun deleteAllChats() = viewModelScope.launch {
        runCatching { store.write { core -> core.chats().onEach { core.deleteChat(it.id) }.size } }
            .onSuccess { n -> _messages.emit(if (n == 1) "1 Chat gelöscht." else "$n Chats gelöscht.") }
            .onFailure { _messages.emit("Löschen fehlgeschlagen: ${it.message}") }
    }

    /** „Alle Karteikarten löschen“ (`handleDeleteAllCards`). */
    fun deleteAllCards() = viewModelScope.launch {
        runCatching { store.write { it.deleteAllCards() } }
            .onSuccess { n -> _messages.emit(if (n == 1uL) "1 Karteikarte gelöscht." else "$n Karteikarten gelöscht.") }
            .onFailure { _messages.emit("Löschen fehlgeschlagen: ${it.message}") }
    }

    private fun run(done: String, block: (uniffi.impala_ffi.ImpalaCore) -> Unit) = viewModelScope.launch {
        runCatching { store.write(block) }
            .onSuccess { _messages.emit(done) }
            .onFailure { _messages.emit("Fehlgeschlagen: ${it.message}") }
    }

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

    private companion object {
        /** Wie `cleanBase` in settings.js: Nutzer kleben oft ganze Endpunkt-Pfade oder Slash-Enden ein. */
        val ENDPOINT = Regex("/(chat/completions|completions|responses|models|embeddings)$", RegexOption.IGNORE_CASE)

        fun cleanBase(raw: String) = raw.trim().trimEnd('/').replace(ENDPOINT, "")

        fun providersOf(arr: JSONArray?): List<AiProvider> = (0 until (arr?.length() ?: 0)).mapNotNull { i ->
            arr!!.optJSONObject(i)?.let {
                AiProvider(it.optString("id"), it.optString("name"), it.optString("base"), it.optString("key"))
            }
        }

        /**
         * Quellen als Patch. Ein leerer Schlüssel geht als `null` hinaus (der Kern entfernt ihn ausdrücklich);
         * nur neue Voreinstellungen schicken `""`, das einen vorhandenen Schlüssel nicht anrührt.
         */
        fun providersJson(list: List<AiProvider>, keepEmptyKeys: Boolean) = JSONArray(list.map {
            JSONObject().put("id", it.id).put("name", it.name).put("base", it.base)
                .put("key", if (it.key.isBlank() && !keepEmptyKeys) JSONObject.NULL else it.key.trim())
        })
    }
}
