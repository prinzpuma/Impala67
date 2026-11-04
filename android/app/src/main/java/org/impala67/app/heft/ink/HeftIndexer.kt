package org.impala67.app.heft.ink

import android.util.Log
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import org.impala67.app.core.ImpalaStore

/**
 * Macht Heftseiten durchsuchbar (Gegenstück zu `heft-indexer.js`, Quelle `"android"`):
 * - Nach Strich-Änderungen wird die Seite verzögert erkannt und über `heftRecordOcr` gespeichert.
 *   Der Kern hängt den Text vorhandener Scan-Bilder an und beachtet die Rangfolge (`apple > android > pwa`).
 * - [startBackgroundScan] wertet im Leerlauf Seiten auf, die noch keinen Text haben oder bisher nur
 *   von der PWA erkannt wurden (`heftOcrJobs("android")`).
 */
class HeftIndexer(
    private val store: ImpalaStore,
    private val scope: CoroutineScope,
    private val heftId: String,
) : AutoCloseable {
    private val recognizer = HandwritingRecognizer()
    private val jobs = HashMap<String, Job>()

    /** Seite nach einer Änderung erneut erkennen; eine laufende Erkennung derselben Seite wird verworfen. */
    fun schedule(heftPageId: String) {
        jobs.remove(heftPageId)?.cancel()
        jobs[heftPageId] = scope.launch {
            delay(DEBOUNCE_MS)
            try {
                indexOne(store, recognizer, heftId, heftPageId)
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                Log.w(TAG, "Heftseite konnte nicht erkannt werden", e)
            }
        }
    }

    override fun close() {
        recognizer.close()
    }

    companion object {
        private const val TAG = "HeftIndexer"
        private const val SRC = "android"
        // Akkuschonend: 15 s nach dem letzten Strich, 6 s Pause zwischen Hintergrund-Seiten.
        private const val DEBOUNCE_MS = 15_000L
        private const val BG_START_DELAY_MS = 8_000L
        private const val BG_PAUSE_MS = 6_000L

        @Volatile
        private var bgJob: Job? = null

        private suspend fun indexOne(
            store: ImpalaStore,
            recognizer: HandwritingRecognizer,
            heftId: String,
            heftPageId: String,
        ) {
            val page = store.write { it.heftPage(heftId, heftPageId) }
            val strokeText = if (page.strokes.isEmpty()) "" else recognizer.recognize(page.strokes) ?: ""
            store.write { it.heftRecordOcr(heftId, heftPageId, strokeText, SRC, page.contentKey) }
        }

        /**
         * Wertet im Leerlauf ungescannte oder nur von der PWA erkannte Heftseiten mit ML Kit auf.
         * Läuft höchstens einmal gleichzeitig und merkt sich in dieser Sitzung versuchte Seiten.
         */
        fun startBackgroundScan(store: ImpalaStore, scope: CoroutineScope) {
            if (bgJob?.isActive == true) return
            bgJob = scope.launch {
                delay(BG_START_DELAY_MS)
                val tried = HashSet<String>()
                HandwritingRecognizer().use { rec ->
                    while (true) {
                        val next = store.write { it.heftOcrJobs(SRC) }
                            .firstOrNull { tried.add("${it.pageId}:${it.heftPageId}:${it.contentKey}") }
                            ?: break
                        try {
                            indexOne(store, rec, next.pageId, next.heftPageId)
                        } catch (e: CancellationException) {
                            throw e
                        } catch (e: Exception) {
                            Log.w(TAG, "Hintergrund-Erkennung übersprungen", e)
                            break
                        }
                        delay(BG_PAUSE_MS)
                    }
                }
            }
        }

        fun stopBackgroundScan() {
            bgJob?.cancel()
            bgJob = null
        }
    }
}
