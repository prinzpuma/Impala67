package org.impala67.app.heft.ink

import android.util.Log
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import org.impala67.app.core.ImpalaStore

/**
 * Macht Heftseiten durchsuchbar (Gegenstück zu `heft-indexer.js`): Nach Strich-Änderungen wird die Seite
 * verzögert erkannt und der Text über `heftSetPageText` gespeichert. Eine Seite mit Scan-Text
 * (`images[].ocr`) wird übersprungen, weil der Zusammenbau „Striche + Scan-Text“ bisher nur im Rust-Kern
 * (`compose_page_text`) liegt und dort nicht über die FFI erreichbar ist. Sonst ginge der Scan-Text verloren.
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
                indexPage(heftPageId)
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                Log.w(TAG, "Heftseite konnte nicht erkannt werden", e)
            }
        }
    }

    private suspend fun indexPage(heftPageId: String) {
        val page = store.write { it.heftPage(heftId, heftPageId) }
        if (page.images.any { !it.ocr.isNullOrEmpty() }) return
        // Ein leeres Ergebnis ersetzt keinen vorhandenen Text; „keine Striche“ leert ihn dagegen.
        val text = if (page.strokes.isEmpty()) "" else recognizer.recognize(page.strokes) ?: return
        if (text == page.ocrText) return
        store.write { it.heftSetPageText(heftId, heftPageId, text) }
    }

    override fun close() {
        recognizer.close()
    }

    private companion object {
        const val TAG = "HeftIndexer"
        // Wie in der PWA: 3,5 s nach dem letzten Strich.
        const val DEBOUNCE_MS = 3500L
    }
}
