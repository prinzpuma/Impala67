package org.impala67.app.ai

import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import org.impala67.app.core.ImpalaStore
import org.impala67.app.core.Touches
import org.impala67.app.settings.DevicePrefs
import org.json.JSONObject
import uniffi.impala_ffi.AiModel

/** Gewählte Quelle, Modell und Denkaufwand aus den Kern-Einstellungen (`aiProviderId`, `aiModel`, `thinkingEnabled`). */
data class AiChoice(
    val providers: List<Pair<String, String>>,
    val providerId: String,
    val model: String,
    val thinkingEnabled: Boolean,
) {
    /** Wie `currentModelLabel` in render.js. */
    val label: String
        get() {
            val name = providers.firstOrNull { it.first == providerId }?.second
            return when {
                model.isEmpty() -> "Kein Modell"
                model == "impala-ai" -> name ?: "Impala AI"
                else -> (name?.let { "$it · " } ?: "") + model
            }
        }

    /** Schlüssel, bei dessen Änderung der Assistent neu gebaut wird. */
    val key get() = "$providerId::$model::$thinkingEnabled"
}

/** Live-Modelle aller Quellen (`S.availableModels`), 30 s zwischengespeichert wie in ai.js. */
data class ModelMenuState(
    val loading: Boolean = false,
    val models: List<AiModel> = emptyList(),
    val checked: Boolean = false,
    val failed: Boolean = false,
)

/** KI-Status-Chip (render.js:159–197): erreichbar, wenn die gewählte Quelle Modelle liefert. */
enum class AiStatus(val label: String) { CHECKING("KI …"), ONLINE("KI online"), OFFLINE("KI offline") }

fun ModelMenuState.status(choice: AiChoice?): AiStatus = when {
    loading || !checked -> AiStatus.CHECKING
    choice != null && models.any { it.providerId == choice.providerId } -> AiStatus.ONLINE
    else -> AiStatus.OFFLINE
}

/**
 * Modellmenü des Composers (render.js `modelMenuInnerHtml`): Auswahl, ★-Favoriten (nur dieses Gerät) und
 * Denkaufwand. Gespeichert wird wie in der PWA über `settingsSet`.
 */
class AiModels(private val store: ImpalaStore, private val prefs: DevicePrefs, private val scope: CoroutineScope) {
    val choice: StateFlow<AiChoice?> = store.query(Touches.settings) { core ->
        val s = runCatching { JSONObject(core.settingsJson()) }.getOrDefault(JSONObject())
        val arr = s.optJSONArray("aiProviders")
        val providers = (0 until (arr?.length() ?: 0)).mapNotNull { i ->
            arr!!.optJSONObject(i)?.let { it.optString("id") to it.optString("name").ifEmpty { it.optString("id") } }
        }
        AiChoice(providers, s.optString("aiProviderId"), s.optString("aiModel"), s.optBoolean("thinkingEnabled", true))
    }

    val favorites: StateFlow<Set<String>> = prefs.favModels.stateIn(scope, SharingStarted.Eagerly, emptySet())

    private val _menu = MutableStateFlow(ModelMenuState())
    val menu: StateFlow<ModelMenuState> = _menu.asStateFlow()
    private var loadedAt = 0L

    /** Beim Öffnen des Menüs: Liste neu holen, wenn sie älter als 30 s ist. */
    fun refresh(force: Boolean = false) {
        if (_menu.value.loading || (!force && System.currentTimeMillis() - loadedAt < 30_000)) return
        _menu.update { it.copy(loading = true) }
        scope.launch {
            val list = runCatching { store.write { it.aiListModels() } }.getOrNull()
            if (list != null) loadedAt = System.currentTimeMillis()
            _menu.update { ModelMenuState(models = list ?: it.models, checked = true, failed = list == null) }
        }
    }

    fun select(providerId: String, model: String) = patch(JSONObject().put("aiProviderId", providerId).put("aiModel", model))

    fun setThinking(enabled: Boolean) = patch(JSONObject().put("thinkingEnabled", enabled))

    fun toggleFavorite(providerId: String, model: String) {
        scope.launch { prefs.toggleFavModel("$providerId::$model") }
    }

    private fun patch(json: JSONObject) {
        scope.launch { runCatching { store.write { it.updateSettings(json.toString()) } } }
    }
}
