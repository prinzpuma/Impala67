package org.impala67.app.graph

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.launch
import org.impala67.app.ai.aiComplete
import org.impala67.app.ai.jsonIn
import org.impala67.app.core.ImpalaStore
import org.impala67.app.core.Touches
import org.impala67.app.settings.DevicePrefs
import org.impala67.app.study.stats.LearnData
import org.impala67.app.study.stats.SCard
import org.json.JSONArray
import org.json.JSONObject
import java.time.Instant
import java.util.UUID

/** Statuszeile über dem Graphen (`.graph-status`); [synth] = Frage/Antwort zum Speichern als Karte. */
data class GraphStatus(val title: String, val text: String = "", val busy: Boolean = false, val retry: Boolean = false, val synth: Pair<String, String>? = null)

data class GraphView(val graph: KnowledgeGraph?, val cards: Map<String, SCard>, val stale: Boolean)

enum class GraphMode(val label: String) { EXPLORE("Erkunden"), LEARN("Lernen"), EDIT("Bearbeiten") }

class GraphViewModel(private val store: ImpalaStore, private val prefs: DevicePrefs) : ViewModel() {
    val view: StateFlow<GraphView?> = store.query(Touches.any(Touches.settings, Touches.cards)) { core ->
        val cards = LearnData.parse(core.learningStatsJson()).cards.filter { it.front.isNotBlank() }
        val byId = cards.associateBy { it.id }
        val settings = runCatching { JSONObject(core.settingsJson()) }.getOrDefault(JSONObject())
        val g = KnowledgeGraph.of(settings, byId)
        // Nur eigene Analysen lassen sich vergleichen; der Fingerabdruck der PWA enthält auch die Rückseiten.
        GraphView(g, byId, g != null && g.raw.optString("model") == ANDROID_MODEL && g.raw.optString("sourceFingerprint") != fingerprint(cards))
    }

    var mode by mutableStateOf(GraphMode.EXPLORE)
    var query by mutableStateOf("")
    var selected by mutableStateOf<String?>(null)
    var status by mutableStateOf<GraphStatus?>(null)
    /** Wartende Verbindung: von [selected] aus, „prereq“ oder „bridge“; der nächste Tipp wählt das Ziel. */
    var pendingLink by mutableStateOf<Pair<String, String>?>(null)
    private var analysing = false

    fun tap(id: String) {
        val link = pendingLink
        if (link != null) { completeLink(link, id); return }
        selected = id
    }

    fun startLink(type: String) {
        val from = selected ?: return
        pendingLink = from to type
        status = GraphStatus("Ziel auswählen", "Tippe jetzt auf den Skill, den du verbinden möchtest.")
    }

    private fun completeLink(link: Pair<String, String>, target: String) {
        val (from, type) = link
        if (from == target) return
        pendingLink = null
        edit { g ->
            val skills = g.optJSONArray("skills").objects()
            val t = skills.firstOrNull { it.optString("id") == target } ?: return@edit
            if (type == "prereq") {
                t.put("prereqIds", JSONArray((t.optJSONArray("prereqIds").strings() + from).distinct()))
                t.put("manualPrereqIds", JSONArray((t.optJSONArray("manualPrereqIds").strings() + from).distinct()))
            } else {
                val key = listOf(from, target).sorted().joinToString("|")
                val bridges = g.optJSONArray("bridges") ?: JSONArray().also { g.put("bridges", it) }
                if (bridges.objects().none { listOf(it.optString("a"), it.optString("b")).sorted().joinToString("|") == key }) {
                    bridges.put(JSONObject().put("id", "bridge:" + graphHash(key)).put("a", from).put("b", target).put("manual", true).put("score", 1))
                }
            }
        }
        selected = target
        status = GraphStatus("Verbindung gespeichert")
    }

    /** „Änderungen speichern“ (graph.js `saveSkill`). */
    fun saveSkill(id: String, title: String, topicId: String?, onDone: (String) -> Unit) {
        edit { g ->
            val s = g.optJSONArray("skills").objects().firstOrNull { it.optString("id") == id } ?: return@edit
            if (title.isNotBlank()) s.put("title", title.trim().take(60)).put("customTitle", true)
            val topic = g.optJSONArray("topics").objects().firstOrNull { it.optString("id") == topicId }
            if (topic != null && (s.optString("topicId") != topic.optString("id") || s.optString("subjectId") != topic.optString("subjectId"))) {
                s.put("topicId", topic.optString("id")).put("subjectId", topic.optString("subjectId")).put("customTopic", true).put("customSubject", true)
            }
        }
        onDone("Skill gespeichert")
    }

    /** Stapel mit den meisten Karten des Unterthemas (graph.js `learnSkill`). */
    fun deckFor(skill: Skill, cards: Map<String, SCard>): String? =
        skill.cardIds.mapNotNull { cards[it]?.deck }.groupingBy { it }.eachCount().maxByOrNull { it.value }?.key

    /** „Verbindung als Synthese-Frage“ (graph.js `synthesize`). */
    fun synthesize(skill: Skill, other: Skill) {
        status = GraphStatus("Erzeuge Synthese-Frage", "„${skill.title}“ × „${other.title}“", busy = true)
        viewModelScope.launch {
            status = runCatching {
                val raw = aiComplete(
                    store, prefs,
                    "Formuliere eine anspruchsvolle Abruf- und Transferfrage zwischen „${skill.title}“ und „${other.title}“ samt knapper Musterantwort. Antworte nur als JSON {\"frage\":\"...\",\"antwort\":\"...\"}.",
                    "Du bist ein präziser Lerncoach.",
                )
                val j = JSONObject(jsonIn(raw) ?: error("Die KI lieferte kein JSON."))
                GraphStatus(j.optString("frage", "Synthese-Frage"), j.optString("antwort"), synth = j.optString("frage") to j.optString("antwort"))
            }.getOrElse { GraphStatus("Synthese fehlgeschlagen", it.message.orEmpty()) }
        }
    }

    fun saveSynth(front: String, back: String) {
        viewModelScope.launch {
            runCatching { store.dispatch("cardCreate", mapOf("id" to UUID.randomUUID().toString(), "front" to "🧩 $front", "back" to back, "deck" to "Synthese")) }
            status = GraphStatus("Synthese-Karte gespeichert")
        }
    }

    /** „Analyse aktualisieren“: Fächer und Unterthemen mit der KI neu ordnen ([GraphAnalysis]). */
    fun analyse() {
        if (analysing) return
        val v = view.value ?: return
        val cards = v.cards.values.toList()
        if (cards.size < 4) { status = GraphStatus("Noch zu wenig Lernstoff", "Mindestens vier Karteikarten werden benötigt."); return }
        analysing = true
        viewModelScope.launch {
            runCatching {
                val next = GraphAnalysis(store, prefs) { t, s -> status = GraphStatus(t, s, busy = true) }
                    .run(cards, v.graph?.raw, fingerprint(cards))
                store.write { it.updateSettings(JSONObject().put("knowledgeGraph", next).toString()) }
                val skills = next.optJSONArray("skills").objects()
                selected = null
                status = GraphStatus(
                    "Themenlandkarte aktualisiert",
                    "${skills.count { !it.optBoolean("gap") }} gelernte Unterthemen · ${skills.count { it.optBoolean("gap") }} mögliche Lücken · ${cards.size} Karten.",
                )
            }.onFailure { status = GraphStatus("Analyse fehlgeschlagen", it.message.orEmpty(), retry = true) }
            analysing = false
        }
    }

    private fun edit(change: (JSONObject) -> Unit) {
        val g = view.value?.graph?.raw ?: return
        val copy = JSONObject(g.toString())
        change(copy)
        copy.put("updated", Instant.now().toString())
        viewModelScope.launch { runCatching { store.write { it.updateSettings(JSONObject().put("knowledgeGraph", copy).toString()) } } }
    }

    private companion object {
        fun fingerprint(cards: List<SCard>) = graphHash(cards.map { it.id + "|" + it.deck + "|" + it.front.replace(Regex("\\s+"), " ").trim().take(600) }.sorted().joinToString("\n"))
    }
}
