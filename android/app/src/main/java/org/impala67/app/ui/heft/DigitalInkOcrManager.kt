package org.impala67.app.ui.heft

import com.google.mlkit.common.model.DownloadConditions
import com.google.mlkit.common.model.RemoteModelManager
import com.google.mlkit.vision.digitalink.DigitalInkRecognition
import com.google.mlkit.vision.digitalink.DigitalInkRecognitionModel
import com.google.mlkit.vision.digitalink.DigitalInkRecognitionModelIdentifier
import com.google.mlkit.vision.digitalink.DigitalInkRecognizer
import com.google.mlkit.vision.digitalink.DigitalInkRecognizerOptions
import com.google.mlkit.vision.digitalink.Ink
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.withContext
import uniffi.impala_ffi.HeftChange
import uniffi.impala_ffi.HeftStroke
import uniffi.impala_ffi.ImpalaCore
import java.io.Closeable
import kotlin.coroutines.resume

/**
 * Verwaltet Google ML Kit Digital Ink Recognition für die on-device Handschrifterkennung.
 * Erkennt handschriftliche Notizen und speichert sie direkt im Rust-Kern für Volltextsuche und KI.
 */
class DigitalInkOcrManager : Closeable {

    private var recognizer: DigitalInkRecognizer? = null
    private var currentModelIdentifier: DigitalInkRecognitionModelIdentifier? = null
    private var isModelReady = false

    /**
     * Stellt sicher, dass das deutsche Modell (oder Fallback Englisch) heruntergeladen und initialisiert ist.
     */
    suspend fun ensureModelDownloaded(preferredLanguageTag: String = "de-DE"): Boolean = withContext(Dispatchers.IO) {
        if (isModelReady && recognizer != null) return@withContext true

        try {
            var identifier = DigitalInkRecognitionModelIdentifier.fromLanguageTag(preferredLanguageTag)
            if (identifier == null) {
                identifier = DigitalInkRecognitionModelIdentifier.fromLanguageTag("en-US")
            }
            if (identifier == null) return@withContext false

            val model = DigitalInkRecognitionModel.builder(identifier).build()
            val remoteModelManager = RemoteModelManager.getInstance()

            val alreadyDownloaded = suspendCancellableCoroutine<Boolean> { cont ->
                remoteModelManager.isModelDownloaded(model)
                    .addOnSuccessListener { cont.resume(it) }
                    .addOnFailureListener { cont.resume(false) }
            }

            if (!alreadyDownloaded) {
                val conditions = DownloadConditions.Builder().build()
                val downloadSuccess = suspendCancellableCoroutine<Boolean> { cont ->
                    remoteModelManager.download(model, conditions)
                        .addOnSuccessListener { cont.resume(true) }
                        .addOnFailureListener { cont.resume(false) }
                }
                if (!downloadSuccess) return@withContext false
            }

            val options = DigitalInkRecognizerOptions.builder(model).build()
            recognizer?.close()
            recognizer = DigitalInkRecognition.getClient(options)
            currentModelIdentifier = identifier
            isModelReady = true
            true
        } catch (_: Exception) {
            false
        }
    }

    /**
     * Konvertiert Striche aus dem Impala67-Format ([x, y, druck, ...]) in ein ML-Kit-Ink-Objekt.
     */
    fun strokesToInk(strokes: List<HeftStroke>): Ink {
        val inkBuilder = Ink.builder()
        var currentTimestamp = 0L

        for (stroke in strokes) {
            // Geometrische Formen (Rechtecke, Kreise, Pfeile) für Text-OCR auslassen
            if (stroke.shape != null) continue
            // Nur Stift- und Marker-Eingaben berücksichtigen
            if (stroke.tool != "pen" && stroke.tool != "marker") continue

            val pts = stroke.points
            if (pts.size < 3) continue

            val strokeBuilder = Ink.Stroke.builder()
            var idx = 0
            while (idx + 1 < pts.size) {
                val x = pts[idx]
                val y = pts[idx + 1]
                strokeBuilder.addPoint(Ink.Point.create(x, y, currentTimestamp))
                currentTimestamp += 15L
                idx += 3 // x, y, druck
            }

            val builtStroke = strokeBuilder.build()
            if (builtStroke.points.isNotEmpty()) {
                inkBuilder.addStroke(builtStroke)
            }
            currentTimestamp += 80L
        }

        return inkBuilder.build()
    }

    /**
     * Erkennt handschriftlichen Text auf der Heftseite und speichert das Ergebnis im Rust-Kern.
     */
    suspend fun recognizeAndSave(
        core: ImpalaCore,
        pageId: String,
        heftPageId: String,
        strokes: List<HeftStroke>
    ): String? = withContext(Dispatchers.Default) {
        val ready = ensureModelDownloaded()
        if (!ready) return@withContext null

        val currentRec = recognizer ?: return@withContext null
        val ink = strokesToInk(strokes)

        if (ink.strokes.isEmpty()) {
            try {
                core.heftApply(
                    pageId,
                    listOf(HeftChange.SetPageText(page = heftPageId, text = ""))
                )
            } catch (_: Exception) {}
            return@withContext ""
        }

        val recognizedText = suspendCancellableCoroutine<String?> { cont ->
            currentRec.recognize(ink)
                .addOnSuccessListener { result ->
                    val candidate = result.candidates.firstOrNull()?.text ?: ""
                    cont.resume(candidate)
                }
                .addOnFailureListener {
                    cont.resume(null)
                }
        } ?: return@withContext null

        try {
            core.heftApply(
                pageId,
                listOf(HeftChange.SetPageText(page = heftPageId, text = recognizedText))
            )
        } catch (_: Exception) {}

        recognizedText
    }

    override fun close() {
        recognizer?.close()
        recognizer = null
        isModelReady = false
    }
}
