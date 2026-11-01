package org.impala67.app.ai

import android.Manifest
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Bundle
import android.speech.RecognitionListener
import android.speech.RecognizerIntent
import android.speech.SpeechRecognizer
import android.widget.Toast
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.Stable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.setValue
import androidx.compose.ui.platform.LocalContext
import androidx.core.content.ContextCompat

/**
 * Spracheingabe wie `voice.js` mit der Android-Spracherkennung (`SpeechRecognizer`, Deutsch):
 * Teilergebnisse erscheinen live, das Endergebnis geht an [Dictation]-Aufrufer zum Senden.
 */
@Stable
class Dictation internal constructor(private val context: Context) {
    var listening by mutableStateOf(false)
        private set

    internal var onPartial: (String) -> Unit = {}
    internal var onFinal: (String) -> Unit = {}
    internal var requestPermission: () -> Unit = {}
    private var recognizer: SpeechRecognizer? = null

    /** Mikrofon-Knopf: startet bzw. beendet das Zuhören. */
    fun toggle() {
        if (listening) return stop()
        if (!SpeechRecognizer.isRecognitionAvailable(context)) return toast("Spracheingabe ist auf diesem Gerät nicht verfügbar.")
        if (ContextCompat.checkSelfPermission(context, Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
            return requestPermission()
        }
        start()
    }

    internal fun start() {
        val rec = recognizer ?: SpeechRecognizer.createSpeechRecognizer(context).also {
            it.setRecognitionListener(listener)
            recognizer = it
        }
        val intent = Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH)
            .putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
            .putExtra(RecognizerIntent.EXTRA_LANGUAGE, "de-DE")
            .putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, true)
            .putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 1)
        listening = true
        rec.startListening(intent)
    }

    fun stop() {
        recognizer?.stopListening()
    }

    internal fun release() {
        recognizer?.destroy()
        recognizer = null
        listening = false
    }

    internal fun toast(text: String) = Toast.makeText(context, text, Toast.LENGTH_SHORT).show()

    private fun Bundle?.firstResult() =
        this?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)?.firstOrNull()?.trim().orEmpty()

    private val listener = object : RecognitionListener {
        override fun onPartialResults(partialResults: Bundle?) {
            partialResults.firstResult().takeIf { it.isNotEmpty() }?.let(onPartial)
        }

        override fun onResults(results: Bundle?) {
            listening = false
            onFinal(results.firstResult())
        }

        override fun onError(error: Int) {
            listening = false
            onFinal("")
            when (error) {
                SpeechRecognizer.ERROR_NO_MATCH, SpeechRecognizer.ERROR_SPEECH_TIMEOUT, SpeechRecognizer.ERROR_CLIENT -> Unit
                SpeechRecognizer.ERROR_INSUFFICIENT_PERMISSIONS -> toast("Kein Zugriff auf das Mikrofon.")
                SpeechRecognizer.ERROR_NETWORK, SpeechRecognizer.ERROR_NETWORK_TIMEOUT ->
                    toast("Spracheingabe braucht Internet oder ein offline geladenes Sprachpaket.")
                else -> toast("Spracheingabe fehlgeschlagen (Fehler $error).")
            }
        }

        override fun onReadyForSpeech(params: Bundle?) = Unit
        override fun onBeginningOfSpeech() = Unit
        override fun onRmsChanged(rmsdB: Float) = Unit
        override fun onBufferReceived(buffer: ByteArray?) = Unit
        override fun onEndOfSpeech() = Unit
        override fun onEvent(eventType: Int, params: Bundle?) = Unit
    }
}

/**
 * Diktat für ein Eingabefeld: [onPartial] zeigt das bisher Gesprochene, [onFinal] bekommt das
 * Endergebnis (leer bei Abbruch oder Fehler).
 */
@Composable
fun rememberDictation(onPartial: (String) -> Unit, onFinal: (String) -> Unit): Dictation {
    val context = LocalContext.current
    val dictation = remember { Dictation(context) }
    val partial by rememberUpdatedState(onPartial)
    val final by rememberUpdatedState(onFinal)
    val permission = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
        if (granted) dictation.start() else dictation.toast("Ohne Mikrofon-Berechtigung keine Spracheingabe.")
    }
    dictation.onPartial = { partial(it) }
    dictation.onFinal = { final(it) }
    dictation.requestPermission = { permission.launch(Manifest.permission.RECORD_AUDIO) }
    DisposableEffect(dictation) { onDispose { dictation.release() } }
    return dictation
}
