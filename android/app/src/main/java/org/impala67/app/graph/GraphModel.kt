package org.impala67.app.graph

import org.impala67.app.study.stats.SCard
import org.json.JSONArray
import org.json.JSONObject
import java.time.Instant
import kotlin.math.pow

/** Version des gespeicherten Graphen wie `VERSION` in graph.js. */
const val GRAPH_VERSION = 5

data class Subject(val id: String, val name: String)
data class Topic(val id: String, val subjectId: String, val name: String)
data class Skill(
    val id: String,
    val subjectId: String,
    val topicId: String,
    val title: String,
    val description: String,
    val cardIds: List<String>,
    val prereqIds: List<String>,
    val gap: Boolean,
)
data class Bridge(val a: String, val b: String, val gap: Boolean)

/** Lernstand eines Unterthemas (graph.js `mastery`). */
data class Mastery(val cards: Int, val rated: Int, val due: Int, val value: Double, val state: String) {
    val label get() = when (state) { "gap" -> "Lernlücke"; "discover" -> "Noch nicht gelernt"; "building" -> "Im Aufbau"; "fragile" -> "Auffrischen"; else -> "Gelernt" }
}

/**
 * Wissensgraph aus `settings.knowledgeGraph` (synchronisiert wie in der PWA). [raw] bleibt das gespeicherte
 * JSON, damit Bearbeiten nur die geänderten Felder anfasst. Die Ansicht blendet archivierte Karten und
 * dadurch leere Unterthemen aus (`visibleGraph`).
 */
class KnowledgeGraph(val raw: JSONObject, cards: Map<String, SCard>) {
    val subjects: List<Subject>
    val topics: List<Topic>
    val skills: List<Skill>
    val bridges: List<Bridge>

    init {
        val all = raw.optJSONArray("skills").objects().map { s ->
            Skill(
                s.optString("id"), s.optString("subjectId"), s.optString("topicId"), s.optString("title"), s.optString("description"),
                s.optJSONArray("cardIds").strings().filter { it in cards }, s.optJSONArray("prereqIds").strings(), s.optBoolean("gap"),
            )
        }.filter { it.gap || it.cardIds.isNotEmpty() }
        val ids = all.map { it.id }.toSet()
        skills = all.map { it.copy(prereqIds = it.prereqIds.filter { p -> p in ids }) }
        val topicIds = skills.map { it.topicId }.toSet()
        val subjectIds = skills.map { it.subjectId }.toSet()
        topics = raw.optJSONArray("topics").objects().map { Topic(it.optString("id"), it.optString("subjectId"), it.optString("name")) }.filter { it.id in topicIds }
        subjects = raw.optJSONArray("subjects").objects().map { Subject(it.optString("id"), it.optString("name")) }.filter { it.id in subjectIds }
        bridges = raw.optJSONArray("bridges").objects().map { Bridge(it.optString("a"), it.optString("b"), it.optBoolean("gap")) }.filter { it.a in ids && it.b in ids }
    }

    fun skill(id: String?) = skills.firstOrNull { it.id == id }

    /** Ebene im Voraussetzungsbaum (0 = ohne Voraussetzung). */
    fun level(s: Skill, seen: Set<String> = emptySet()): Int {
        if (s.id in seen) return 0
        val parents = s.prereqIds.mapNotNull(::skill)
        return if (parents.isEmpty()) 0 else 1 + parents.maxOf { level(it, seen + s.id) }
    }

    companion object {
        /** `null`, wenn kein (aktueller) Graph gespeichert ist. */
        fun of(settings: JSONObject, cards: Map<String, SCard>): KnowledgeGraph? {
            val g = settings.optJSONObject("knowledgeGraph") ?: return null
            if (g.optInt("v") != GRAPH_VERSION) return null
            return KnowledgeGraph(g, cards)
        }
    }
}

/** Erinnerungswahrscheinlichkeit jetzt (FSRS); `null` bei neuen Karten. */
fun retrievability(c: SCard, now: Instant = Instant.now()): Double? {
    if (c.state == "new" || c.due == null || c.stability <= 0) return null
    val last = c.due.toEpochMilli() - (c.stability * 86_400_000).toLong()
    val t = ((now.toEpochMilli() - last) / 86_400_000.0).coerceAtLeast(0.0)
    return (1 + 19.0 / 81 * t / c.stability).pow(-0.5)
}

fun mastery(s: Skill, cards: Map<String, SCard>, now: Instant = Instant.now()): Mastery {
    if (s.gap) return Mastery(0, 0, 0, 0.0, "gap")
    val list = s.cardIds.mapNotNull(cards::get)
    val rated = list.mapNotNull { c -> retrievability(c, now)?.let { c to it } }
    val due = rated.count { (c, _) -> c.due != null && !c.due.isAfter(now) }
    val value = if (rated.isEmpty()) 0.0 else rated.sumOf { it.second } / rated.size
    var state = "discover"
    if (rated.isNotEmpty()) state = if (due > 0 || value < .7) "fragile" else "building"
    if (rated.size >= 3 && due == 0 && value >= .85) state = "mastered"
    return Mastery(list.size, rated.size, due, value, state)
}

/** FNV-1a wie `hash` in graph.js (gleiche IDs auf allen Geräten). */
fun graphHash(text: String): String {
    var h = 2166136261L.toInt()
    for (ch in text) { h = h xor ch.code; h *= 16777619 }
    return (h.toLong() and 0xFFFFFFFFL).toString(36)
}

internal fun JSONArray?.objects(): List<JSONObject> = (0 until (this?.length() ?: 0)).mapNotNull { this!!.optJSONObject(it) }
internal fun JSONArray?.strings(): List<String> = (0 until (this?.length() ?: 0)).mapNotNull { this!!.optString(it).takeIf { s -> s.isNotEmpty() } }
