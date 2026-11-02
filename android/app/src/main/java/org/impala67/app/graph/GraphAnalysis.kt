package org.impala67.app.graph

import org.impala67.app.ai.aiComplete
import org.impala67.app.ai.jsonIn
import org.impala67.app.core.ImpalaStore
import org.impala67.app.settings.DevicePrefs
import org.impala67.app.study.stats.SCard
import org.json.JSONArray
import org.json.JSONObject
import java.time.Instant

/** Kennung der nativen Analyse im gespeicherten Graphen (`model`). */
const val ANDROID_MODEL = "android-ai"

/**
 * Themenlandkarte neu ordnen (graph.js `analyse`), ohne Embeddings: Die KI ordnet die Stapel in Fächer
 * und Themen und gruppiert je Thema die Karten zu benannten Unterthemen samt Voraussetzungen und bis zu zwei
 * Lücken. Eigene Namen und manuelle Verbindungen aus dem alten Graphen bleiben erhalten.
 */
class GraphAnalysis(private val store: ImpalaStore, private val prefs: DevicePrefs, private val onStatus: (String, String) -> Unit) {
    private data class Tax(val subject: String, val topic: String)

    suspend fun run(cards: List<SCard>, old: JSONObject?, fingerprint: String): JSONObject {
        val tax = taxonomy(cards)
        val groups = cards.groupBy { tax[it.deck] ?: fallback(it.deck) }
        val skills = ArrayList<JSONObject>()
        val used = HashSet<String>()
        for ((t, list) in groups) {
            list.chunked(80).forEach { chunk -> skills += nameGroup(t, chunk, old, used) }
        }
        val unique = skills.associateBy { it.optString("id") }.values.toMutableList()
        removeCycles(unique)
        val subjects = groups.keys.map { it.subject }.distinct().map { JSONObject().put("id", subjectId(it)).put("name", it) }
        val topics = unique.map { it.optString("topicId") to it }.distinctBy { it.first }.map { (id, s) ->
            JSONObject().put("id", id).put("subjectId", s.optString("subjectId")).put("name", s.optString("topicName", "Grundlagen"))
        }
        unique.forEach { it.remove("topicName") }
        return JSONObject()
            .put("v", GRAPH_VERSION).put("updated", Instant.now().toString()).put("model", ANDROID_MODEL).put("sourceFingerprint", fingerprint)
            .put("subjects", JSONArray(subjects)).put("topics", JSONArray(topics)).put("skills", JSONArray(unique)).put("bridges", JSONArray(bridges(unique, old)))
    }

    private suspend fun taxonomy(cards: List<SCard>): Map<String, Tax> {
        val byDeck = cards.groupBy { it.deck }.mapValues { (_, l) -> l.take(3).map { it.front.replace(Regex("\\s+"), " ").take(140) } }
        val decks = byDeck.keys.toList()
        onStatus("Erkenne Fächer und Themen", "Stapel sind nur Hinweise – die KI baut eine allgemeine Taxonomie.")
        return runCatching {
            val input = decks.mapIndexed { i, d -> "D$i [$d]:\n" + byDeck[d]!!.joinToString("\n") { "- $it" } }.joinToString("\n\n")
            val raw = aiComplete(
                store, prefs,
                "Ordne die folgenden Karteikarten-Stapel in eine allgemeine, fachlich sinnvolle Wissenshierarchie ein. " +
                    "Das Fach ist breit und standardisiert (z. B. Mathematik, Biologie, Geschichte). Das Thema ist ein Teilgebiet " +
                    "(z. B. Analysis, Geometrie, Stochastik). Stapelnamen sind nur Hinweise: nicht jeden Stapel zu einem eigenen Fach machen, " +
                    "Abkürzungen normalisieren und verwandte Stapel zusammenführen.\n\n" + input +
                    "\n\nAntworte nur als JSON: {\"decks\":[{\"index\":0,\"subject\":\"Mathematik\",\"topic\":\"Analysis\"}]}",
                "Du bist ein präziser Lern-Bibliothekar. Verwende kurze deutsche Standardbezeichnungen und antworte nur mit gültigem JSON.",
            )
            val mapped = HashMap<String, Tax>()
            JSONObject(jsonIn(raw)!!).optJSONArray("decks").objects().forEach {
                val deck = decks.getOrNull(it.optInt("index", -1)) ?: return@forEach
                val subject = it.optString("subject").trim().take(50)
                val topic = it.optString("topic").trim().take(60)
                if (subject.isNotEmpty() && topic.isNotEmpty()) mapped[deck] = Tax(subject, if (topic == subject) "Grundlagen" else topic)
            }
            decks.associateWith { mapped[it] ?: fallback(it) }
        }.getOrElse { decks.associateWith(::fallback) }
    }

    private suspend fun nameGroup(t: Tax, cards: List<SCard>, old: JSONObject?, used: MutableSet<String>): List<JSONObject> {
        onStatus("Strukturiere „${t.subject} › ${t.topic}“", "Die KI ordnet ${cards.size} Karten zu Unterthemen.")
        val body = cards.mapIndexed { i, c -> "$i: " + c.front.replace(Regex("\\s+"), " ").take(160) }.joinToString("\n")
        val raw = aiComplete(
            store, prefs,
            "Gruppiere die folgenden Karteikarten aus „${t.subject} › ${t.topic}“ in fachliche Unterthemen (je Unterthema mindestens zwei Karten, wenn möglich). " +
                "Der Titel ist eine kurze deutsche Nominalbezeichnung ohne Lernverb, zum Beispiel „Kurvendiskussion“ oder „Binomialverteilung“. " +
                "Ordne nur zwingende Voraussetzungen zu (Indizes anderer Unterthemen). Nenne außerdem höchstens zwei fachlich sichere, direkt angrenzende " +
                "Unterthemen, zu denen noch keine Karten existieren.\n\n" + body +
                "\n\nAntworte nur als JSON: {\"skills\":[{\"title\":\"Kurvendiskussion\",\"description\":\"ein kurzer Satz\",\"cards\":[0,3],\"prerequisites\":[1]}],\"gaps\":[{\"title\":\"Grenzwerte\",\"description\":\"Warum dieses Unterthema hier fehlt\",\"connectTo\":[0]}]}",
            "Du erstellst eine klare Themenlandkarte aus vorhandenem Lernstoff. Verwende kurze deutsche Fachbegriffe und antworte nur mit gültigem JSON.",
        )
        val parsed = JSONObject(jsonIn(raw) ?: error("Die KI lieferte kein JSON."))
        val specs = parsed.optJSONArray("skills").objects()
        val assigned = HashSet<Int>()
        val groups = specs.map { s ->
            val ids = (0 until (s.optJSONArray("cards")?.length() ?: 0)).map { s.getJSONArray("cards").optInt(it, -1) }
                .filter { it in cards.indices && assigned.add(it) }.map { cards[it].id }
            s to ids
        }.filter { it.second.isNotEmpty() }.toMutableList()
        val rest = cards.indices.filter { it !in assigned }.map { cards[it].id }
        if (rest.isNotEmpty()) groups += JSONObject().put("title", t.topic + " – Grundlagen") to rest
        val sid = subjectId(t.subject)
        val tid = topicId(t.subject, t.topic)
        val idAt = groups.map { (_, ids) -> bestOld(old, ids, used)?.optString("id") ?: ("skill:" + graphHash(t.subject + "|" + t.topic + "|" + ids.sorted().joinToString("|"))) }
        val out = groups.mapIndexed { i, (spec, ids) ->
            val prev = old?.optJSONArray("skills").objects().firstOrNull { it.optString("id") == idAt[i] }
            val custom = prev?.optBoolean("customTitle") == true
            val title = if (custom) prev!!.optString("title") else spec.optString("title").trim().take(60).ifEmpty { t.topic }
            val manual = prev?.optJSONArray("manualPrereqIds").strings()
            val prereq = ((0 until (spec.optJSONArray("prerequisites")?.length() ?: 0)).mapNotNull { idAt.getOrNull(spec.getJSONArray("prerequisites").optInt(it, -1)) } + manual)
                .distinct().filter { it != idAt[i] }
            JSONObject().put("id", idAt[i]).put("subjectId", sid).put("topicId", tid).put("topicName", t.topic).put("title", title)
                .put("description", spec.optString("description", prev?.optString("description").orEmpty()).take(240))
                .put("cardIds", JSONArray(ids)).put("pageIds", JSONArray(ids.mapNotNull { id -> cards.firstOrNull { it.id == id }?.pageId }.distinct()))
                .put("prereqIds", JSONArray(prereq)).put("manualPrereqIds", JSONArray(manual))
                .put("customTitle", custom).put("customSubject", false).put("customTopic", false)
        }
        val gaps = parsed.optJSONArray("gaps").objects().take(2).mapNotNull { g ->
            val title = g.optString("title").trim().take(60).ifEmpty { return@mapNotNull null }
            JSONObject().put("id", "gap:" + graphHash(t.subject + "|" + t.topic + "|" + title.lowercase())).put("subjectId", sid).put("topicId", tid)
                .put("topicName", t.topic).put("title", title)
                .put("description", g.optString("description", "Für dieses angrenzende Unterthema wurden keine Karten gefunden.").take(240))
                .put("cardIds", JSONArray()).put("pageIds", JSONArray()).put("prereqIds", JSONArray()).put("manualPrereqIds", JSONArray())
                .put("relatedIds", JSONArray((0 until (g.optJSONArray("connectTo")?.length() ?: 0)).mapNotNull { idAt.getOrNull(g.getJSONArray("connectTo").optInt(it, -1)) }))
                .put("gap", true).put("customTitle", false).put("customSubject", false).put("customTopic", false)
        }
        return out + gaps
    }

    /** Alter Skill mit mindestens 55 % gleichen Karten (graph.js `bestOldSkill`). */
    private fun bestOld(old: JSONObject?, ids: List<String>, used: MutableSet<String>): JSONObject? {
        val set = ids.toSet()
        var best: JSONObject? = null
        var score = 0.0
        for (s in old?.optJSONArray("skills").objects()) {
            if (s.optString("id") in used) continue
            val cards = s.optJSONArray("cardIds").strings()
            val overlap = cards.count { it in set }
            val union = (cards + ids).toSet().size.coerceAtLeast(1)
            if (overlap.toDouble() / union > score) { score = overlap.toDouble() / union; best = s }
        }
        return best?.takeIf { score >= .55 }?.also { used += it.optString("id") }
    }

    private fun removeCycles(skills: List<JSONObject>) {
        val byId = skills.associateBy { it.optString("id") }
        fun reaches(from: String, target: String, seen: MutableSet<String> = HashSet()): Boolean {
            if (from == target) return true
            if (!seen.add(from)) return false
            return byId[from]?.optJSONArray("prereqIds").strings().any { reaches(it, target, seen) }
        }
        for (s in skills) {
            val id = s.optString("id")
            s.put("prereqIds", JSONArray(s.optJSONArray("prereqIds").strings().filter { p -> p in byId && p != id && !reaches(p, id) }))
        }
    }

    private fun bridges(skills: List<JSONObject>, old: JSONObject?): List<JSONObject> {
        val ids = skills.map { it.optString("id") }.toSet()
        val manual = old?.optJSONArray("bridges").objects().filter { it.optBoolean("manual") && it.optString("a") in ids && it.optString("b") in ids }
        val gaps = skills.filter { it.optBoolean("gap") }.flatMap { s ->
            s.optJSONArray("relatedIds").strings().map { r ->
                JSONObject().put("id", "bridge:" + graphHash(listOf(s.optString("id"), r).sorted().joinToString("|"))).put("a", s.optString("id")).put("b", r)
                    .put("score", 1).put("gap", true).put("manual", false)
            }
        }
        val seen = HashSet<String>()
        return (manual + gaps).filter { seen.add(listOf(it.optString("a"), it.optString("b")).sorted().joinToString("|")) }
    }

    private fun fallback(deck: String): Tax {
        val leaf = deck.split("::").last().trim().ifEmpty { "Grundlagen" }
        val v = deck.lowercase()
        val rules = listOf(
            Regex("mathe|analysis|algebra|geometr|\\bgeo\\b|stochast|statistik|wahrscheinlich|trigonom|integral|differential") to "Mathematik",
            Regex("biolog|zell|genetik|ökolog|evolution|anatom") to "Biologie",
            Regex("physik|mechanik|elektr|optik|thermodynam") to "Physik",
            Regex("chemie|organik|anorganik|reaktion|atom") to "Chemie",
            Regex("geschicht|antike|mittelalter|neuzeit|krieg") to "Geschichte",
            Regex("informatik|programm|algorithm|datenbank|netzwerk") to "Informatik",
            Regex("deutsch|literatur|grammatik|sprache") to "Deutsch",
            Regex("englisch|english") to "Englisch",
        )
        val subject = rules.firstOrNull { it.first.containsMatchIn(v) }?.second ?: deck.split("::").first().trim().ifEmpty { "Allgemeines Wissen" }
        return Tax(subject, if (leaf == subject) "Grundlagen" else leaf)
    }

    private fun subjectId(name: String) = "sub:" + graphHash(name.lowercase())
    private fun topicId(subject: String, name: String) = "topic:" + graphHash(subject.lowercase() + "|" + name.lowercase())
}
