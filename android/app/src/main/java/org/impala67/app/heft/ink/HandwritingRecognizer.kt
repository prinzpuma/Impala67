package org.impala67.app.heft.ink

import com.google.android.gms.tasks.Task
import com.google.mlkit.common.model.DownloadConditions
import com.google.mlkit.common.model.RemoteModelManager
import com.google.mlkit.vision.digitalink.recognition.DigitalInkRecognition
import com.google.mlkit.vision.digitalink.recognition.DigitalInkRecognitionModel
import com.google.mlkit.vision.digitalink.recognition.DigitalInkRecognitionModelIdentifier
import com.google.mlkit.vision.digitalink.recognition.DigitalInkRecognizer
import com.google.mlkit.vision.digitalink.recognition.DigitalInkRecognizerOptions
import com.google.mlkit.vision.digitalink.common.Ink
import kotlinx.coroutines.suspendCancellableCoroutine
import uniffi.impala_ffi.HeftStroke
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException

/**
 * Handschrift-Erkennung im Heft mit ML Kit Digital Ink (Deutsch). Ersetzt die ONNX-Erkennung der PWA
 * (`handschrift.js`). Das Modell wird beim ersten Aufruf heruntergeladen; ohne Netz schlägt das mit einer
 * Exception fehl, die der Aufrufer behandelt.
 */
class HandwritingRecognizer : AutoCloseable {
    private val model: DigitalInkRecognitionModel? =
        DigitalInkRecognitionModelIdentifier.fromLanguageTag(LANGUAGE)?.let { DigitalInkRecognitionModel.builder(it).build() }

    private val client: DigitalInkRecognizer? =
        model?.let { DigitalInkRecognition.getClient(DigitalInkRecognizerOptions.builder(it).build()) }

    /** Erkannter Text der Striche; `null`, wenn es nichts zu erkennen gibt. */
    suspend fun recognize(strokes: List<HeftStroke>): String? {
        val model = model ?: return null
        val client = client ?: return null
        val ink = buildInk(strokes) ?: return null
        ensureModel(model)
        val result = client.recognize(ink).awaitTask()
        return result.candidates.firstOrNull()?.text?.trim()?.takeIf { it.isNotEmpty() }
    }

    /** Lädt das Modell nur, wenn es fehlt; jede Verbindung (auch mobil) ist erlaubt. */
    private suspend fun ensureModel(model: DigitalInkRecognitionModel) {
        val manager = RemoteModelManager.getInstance()
        if (manager.isModelDownloaded(model).awaitTask()) return
        manager.download(model, DownloadConditions.Builder().build()).awaitTask()
    }

    /**
     * Ink aus den Kernpunkten `[x, y, druck, …]`. Der Kern speichert keine Zeitstempel, also läuft die Zeit
     * fortlaufend: je Punkt ein Schritt, zwischen den Strichen eine Pause.
     */
    private fun buildInk(strokes: List<HeftStroke>): Ink? {
        val ink = Ink.builder()
        var t = 0L
        var count = 0
        for (s in strokes) {
            val points = s.points.size / 3
            if (points < 2) continue
            val stroke = Ink.Stroke.builder()
            for (i in 0 until points) {
                stroke.addPoint(Ink.Point.create(s.points[i * 3], s.points[i * 3 + 1], t))
                t += POINT_STEP_MS
            }
            ink.addStroke(stroke.build())
            t += STROKE_GAP_MS
            count++
        }
        return if (count == 0) null else ink.build()
    }

    override fun close() {
        client?.close()
    }

    private companion object {
        const val LANGUAGE = "de-DE"
        const val POINT_STEP_MS = 10L
        const val STROKE_GAP_MS = 200L
    }
}

/** Wartet auf ein ML-Kit-Task, ohne die Coroutines-Play-Services-Abhängigkeit. */
private suspend fun <T> Task<T>.awaitTask(): T = suspendCancellableCoroutine { cont ->
    addOnSuccessListener { cont.resume(it) }
    addOnFailureListener { cont.resumeWithException(it) }
}
