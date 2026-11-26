package org.impala67.app.heft

import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import uniffi.impala_ffi.HeftEraseChange
import uniffi.impala_ffi.HeftEraseGesture
import uniffi.impala_ffi.HeftEraseResult
import uniffi.impala_ffi.HeftStroke

/**
 * Radierer einer Geste wie in GoodNotes (Kern: `HeftEraseGesture`, PWA: `eraseAt` in heft-input.js):
 * Die Punkte des Zugs wandern in eine Schlange, ein Hintergrund-Worker radiert im Kern über die Striche,
 * die die Seite beim Ansetzen zeigt ([strokes]), und meldet jeden Schritt sofort ([onStep]). Am Zugende
 * ([end]) kommt die Netto-Änderung in [onDone] – eine Geste, ein Event, ein Rückgängig-Schritt.
 * Schnell aufeinanderfolgende Gesten warten aufeinander, damit sich Snapshot und Commit nie überholen.
 */
// funktion: heft.radierer-praezise
class EraseTracker(
    private val scope: CoroutineScope,
    private val strokes: () -> List<HeftStroke>,
    private val radius: () -> Double,
    private val mode: () -> String,
    private val onStep: (List<HeftEraseChange>) -> Unit,
    private val onDone: (HeftEraseResult) -> Unit,
) {
    private var activeQueue: Channel<Pair<Double, Double>>? = null
    private var lastJob: Job? = null

    fun move(x: Float, y: Float) {
        val queue = activeQueue ?: start()
        queue.trySend(x.toDouble() to y.toDouble())
    }

    fun end() {
        activeQueue?.close()
        activeQueue = null
    }

    private fun start(): Channel<Pair<Double, Double>> {
        val queue = Channel<Pair<Double, Double>>(Channel.UNLIMITED).also { activeQueue = it }
        val prev = lastJob
        lastJob = scope.launch {
            prev?.join()
            val snapshot = strokes()
            val r = radius()
            val m = mode()
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
                        withContext(Dispatchers.Main) { onStep(changes) }
                    }
                    g.net()
                }
            }
            onDone(net ?: HeftEraseResult(emptyList(), emptyList()))
        }
        return queue
    }
}
