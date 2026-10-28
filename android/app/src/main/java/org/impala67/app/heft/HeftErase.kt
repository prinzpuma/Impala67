package org.impala67.app.heft

import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.launch

/**
 * Strich-Radierer einer Geste: Die Punkte des Zugs wandern der Reihe nach in eine Schlange, ein
 * Hintergrund-Worker fragt den Kern ([find] = `heftStrokesAt`) und meldet getroffene Striche sofort
 * ([onHit], zum Ausblenden). Am Zugende ([end]) kommt alles zusammen in [onDone] – eine Geste, ein
 * Event, ein Rückgängig-Schritt (wie `eraseList` in heft-input.js).
 */
class EraseTracker(
    private val scope: CoroutineScope,
    private val find: suspend (x: Double, y: Double) -> List<String>,
    private val onHit: (Set<String>) -> Unit,
    private val onDone: (List<String>) -> Unit,
) {
    private var points = Channel<Pair<Double, Double>>(Channel.UNLIMITED)
    private var worker: Job? = null

    fun move(x: Float, y: Float) {
        if (worker == null) start()
        points.trySend(x.toDouble() to y.toDouble())
    }

    fun end() {
        points.close()
        worker = null
    }

    private fun start() {
        val queue = Channel<Pair<Double, Double>>(Channel.UNLIMITED).also { points = it }
        worker = scope.launch {
            val hit = LinkedHashSet<String>()
            for ((x, y) in queue) {
                if (hit.addAll(find(x, y))) onHit(hit.toSet())
            }
            onDone(hit.toList())
        }
    }
}
