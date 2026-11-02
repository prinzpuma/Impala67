package org.impala67.app.study.stats

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import org.impala67.app.core.ImpalaStore
import org.impala67.app.core.Touches
import org.impala67.app.ai.aiComplete
import org.impala67.app.ai.jsonIn
import org.impala67.app.settings.DevicePrefs
import org.json.JSONObject

/** Statistik-Tab: Kennzahlen, Lern-Analyse und die Titel der Problemzonen-Seiten. */
data class StatsView(val stats: StatsData, val patterns: PatternData, val titles: Map<String, String>)

class StatsViewModel(private val store: ImpalaStore, private val prefs: DevicePrefs) : ViewModel() {
    val view: StateFlow<StatsView?> = store.query(Touches.any(Touches.cards, Touches.pages)) { core ->
        val data = LearnData.parse(core.learningStatsJson())
        val live = core.recentPages(UInt.MAX_VALUE).associate { it.id to it.title }
        StatsView(data.stats(), data.patterns(live.keys), live)
    }

    private val _busy = MutableStateFlow<String?>(null)
    /** Seite, für die gerade eine Karte entsteht („＋ Karte“). */
    val busy: StateFlow<String?> = _busy.asStateFlow()

    /**
     * „＋ Karte“ (lernmuster.js `cardFromPage`): die KI schreibt eine Abruf-Karte zur schwierigsten Kernidee,
     * sonst eine Standardkarte; sie landet im Stapel „Problemzonen“.
     */
    fun cardFromPage(pageId: String, onDone: (String) -> Unit) {
        if (_busy.value != null) return
        _busy.value = pageId
        viewModelScope.launch {
            val page = runCatching { store.write { it.page(pageId) } }.getOrNull()
            if (page == null) { _busy.value = null; return@launch }
            var front = "Erkläre die Kernaussagen von „${page.summary.title}“ aus dem Gedächtnis."
            var back = "Selbst prüfen: Seite öffnen und mit der eigenen Erklärung vergleichen."
            runCatching {
                val raw = aiComplete(
                    store, prefs,
                    "Erstelle aus dieser Notiz GENAU EINE Karteikarte zur schwierigsten Kernidee. Antworte NUR als JSON {\"front\":\"…\",\"back\":\"…\"}.\n\n" +
                        page.summary.title + "\n\n" + page.content.take(6000),
                    "Du bist ein präziser Karteikarten-Autor. Antworte NUR mit gültigem JSON.",
                )
                val j = JSONObject(jsonIn(raw) ?: "{}")
                if (j.optString("front").isNotBlank() && j.optString("back").isNotBlank()) { front = j.getString("front"); back = j.getString("back") }
            }
            runCatching {
                store.dispatch("cardCreate", mapOf("id" to java.util.UUID.randomUUID().toString(), "front" to front, "back" to back, "pageId" to pageId, "deck" to "Problemzonen"))
            }.onSuccess { onDone("Karte in „Problemzonen“ angelegt.") }.onFailure { onDone("Karte konnte nicht angelegt werden.") }
            _busy.value = null
        }
    }
}
