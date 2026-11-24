package org.impala67.app.heft

import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import uniffi.impala_ffi.HeftEraseGesture
import uniffi.impala_ffi.HeftEraseResult
import uniffi.impala_ffi.HeftStroke

/**
 * Radierer einer Geste wie in GoodNotes (Kern: `HeftEraseGesture`, PWA: `eraseAt` in heft-input.js):
 * Die Punkte des Zugs wandern in eine Schlange, ein Hintergrund-Worker radiert im Kern über die Striche,
 * die die Seite beim Ansetzen zeigt ([strokes]), und meldet jeden Schritt sofort ([onStep]: weggefallene
 * IDs und Reste des präzisen Radierers). Am Zugende ([end]) kommt die Netto-Änderung in [onDone] – eine
 * Geste, ein Event, ein Rückgängig-Schritt.
 */
// funktion: heft.radierer-praezise
class EraseTracker(
    private val scope: CoroutineScope,
    private val strokes: () -> List<HeftStroke>,
    private val radius: () -> Double,
    private val mode: () -> String,
    private val onStep: (removed: Set<String>, pieces: List<HeftStroke>) -> Unit,
    private val onDone: (HeftEraseResult) -> Unit,
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
        val snapshot = strokes()
        val r = radius()
        val m = mode()
        worker = scope.launch {
            val net = withContext(Dispatchers.Default) {
                val gesture = runCatching { HeftEraseGesture(snapshot, r, m) }.getOrNull()
                if (gesture == null) {
                    for (ignored in queue) Unit // Zug zu Ende laufen lassen, ohne zu radieren
                    return@withContext null
                }
                gesture.use { g ->
                    for ((x, y) in queue) {
                        val changes = g.eraseAt(x, y)
                        if (changes.isEmpty()) continue
                        val removed = changes.mapTo(HashSet()) { it.id }
                        val pieces = changes.flatMap { it.pieces }
                        withContext(Dispatchers.Main) { onStep(removed, pieces) }
                    }
                    g.net()
                }
            }
            onDone(net ?: HeftEraseResult(emptyList(), emptyList()))
        }
    }
}
