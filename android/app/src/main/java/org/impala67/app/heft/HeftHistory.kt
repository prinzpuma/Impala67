package org.impala67.app.heft

import java.io.File

/** Ein gesicherter Stand: Zeitpunkt und Datei mit dem Heft als `{ v: 2, pages }`. */
class HeftSnap(val file: File, val t: Long)

/**
 * Verlauf eines Hefts (heft-storage.js „Verlauf“): Stände liegen nur auf diesem Gerät (nicht im Sync),
 * entstehen beim Schreiben höchstens alle 10 Minuten und bleiben 24 Stunden, höchstens 20 Stück.
 * Dateiname = Zeitpunkt in ms.
 */
class HeftHistory(private val dir: File) {
    private var lastAt = -1L

    fun list(): List<HeftSnap> =
        dir.listFiles().orEmpty()
            .mapNotNull { f -> f.name.removeSuffix(".json").toLongOrNull()?.let { HeftSnap(f, it) } }
            .sortedByDescending { it.t }

    /** Abgelaufene und überzählige Stände löschen; liefert die übrigen, neueste zuerst. */
    fun prune(now: Long = System.currentTimeMillis()): List<HeftSnap> {
        val all = list()
        val keep = all.filterIndexed { i, s -> i < MAX && s.t >= now - TTL }
        (all - keep.toSet()).forEach { it.file.delete() }
        return keep
    }

    fun write(json: String, now: Long = System.currentTimeMillis()) {
        dir.mkdirs()
        File(dir, "$now.json").writeText(json)
        lastAt = now
    }

    /** Nach einer Änderung ein neuer Stand fällig? Nur, wenn der letzte mindestens 10 Minuten alt ist. */
    fun due(now: Long = System.currentTimeMillis()): Boolean {
        if (lastAt < 0) lastAt = list().firstOrNull()?.t ?: 0
        return now - lastAt >= GAP
    }

    private companion object {
        const val TTL = 24 * 60 * 60 * 1000L
        const val GAP = 10 * 60 * 1000L
        const val MAX = 20
    }
}
