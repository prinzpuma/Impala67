package org.impala67.app.ui.editor

import android.Manifest
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Bundle
import android.speech.RecognitionListener
import android.speech.RecognizerIntent
import android.speech.SpeechRecognizer
import android.util.Log
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.Stable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.platform.LocalContext
import androidx.core.content.ContextCompat
import java.util.Locale

/**
 * Zustand und Steuerung der nativen Android-Spracherkennung.
 */
@Stable
class NativeSpeechRecognizerState(
    private val context: Context,
    val onSpeechResult: (String) -> Unit,
    val onPartialResult: ((String) -> Unit)? = null
) {
    companion object {
        private const val TAG = "NativeSpeechRecognizer"
    }

    var isListening by mutableStateOf(false)
        private set

    var partialText by mutableStateOf("")
        private set

    var errorMessage by mutableStateOf<String?>(null)
        private set

    var isAvailable by mutableStateOf(SpeechRecognizer.isRecognitionAvailable(context))
        private set

    var hasPermission by mutableStateOf(
        ContextCompat.checkSelfPermission(
            context,
            Manifest.permission.RECORD_AUDIO
        ) == PackageManager.PERMISSION_GRANTED
    )
        internal set

    private var speechRecognizer: SpeechRecognizer? = null

    init {
        initRecognizer()
    }

    private fun initRecognizer() {
        if (!isAvailable) {
            Log.w(TAG, "Spracherkennung ist auf diesem Gerät nicht verfügbar.")
            return
        }
        try {
            speechRecognizer?.destroy()
            speechRecognizer = SpeechRecognizer.createSpeechRecognizer(context).apply {
                setRecognitionListener(createListener())
            }
        } catch (e: Exception) {
            Log.e(TAG, "Fehler beim Initialisieren des SpeechRecognizers", e)
            errorMessage = e.localizedMessage
        }
    }

    private fun createListener() = object : RecognitionListener {
        override fun onReadyForSpeech(params: Bundle?) {
            isListening = true
            errorMessage = null
            partialText = ""
        }

        override fun onBeginningOfSpeech() {
            isListening = true
        }

        override fun onRmsChanged(rmsdB: Float) {
            // Optionaler Audiopegel
        }

        override fun onBufferReceived(buffer: ByteArray?) {}

        override fun onEndOfSpeech() {
            isListening = false
        }

        override fun onError(error: Int) {
            isListening = false
            val message = when (error) {
                SpeechRecognizer.ERROR_AUDIO -> "Audio-Aufnahmefehler"
                SpeechRecognizer.ERROR_CLIENT -> "Client-Fehler"
                SpeechRecognizer.ERROR_INSUFFICIENT_PERMISSIONS -> "Mikrofon-Berechtigung fehlt"
                SpeechRecognizer.ERROR_NETWORK -> "Netzwerkfehler"
                SpeechRecognizer.ERROR_NETWORK_TIMEOUT -> "Netzwerk-Timeout"
                SpeechRecognizer.ERROR_NO_MATCH -> "Keine Sprache erkannt"
                SpeechRecognizer.ERROR_RECOGNIZER_BUSY -> "Spracherkennung beschäftigt"
                SpeechRecognizer.ERROR_SERVER -> "Serverfehler"
                SpeechRecognizer.ERROR_SPEECH_TIMEOUT -> "Keine Spracheingabe empfangen"
                else -> "Unbekannter Erkennungsfehler ($error)"
            }
            // Ignoriere unkritische No-Match/Timeout-Meldungen für UI-Rauschen
            if (error != SpeechRecognizer.ERROR_NO_MATCH && error != SpeechRecognizer.ERROR_SPEECH_TIMEOUT) {
                errorMessage = message
            }
            partialText = ""
            Log.w(TAG, "SpeechRecognizer Fehler: $message ($error)")
        }

        override fun onResults(results: Bundle?) {
            isListening = false
            val matches = results?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)
            val recognizedText = matches?.firstOrNull()?.trim()
            if (!recognizedText.isNullOrEmpty()) {
                onSpeechResult(recognizedText)
            }
            partialText = ""
        }

        override fun onPartialResults(partialResults: Bundle?) {
            val matches = partialResults?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)
            val partial = matches?.firstOrNull()?.trim() ?: ""
            partialText = partial
            if (partial.isNotEmpty()) {
                onPartialResult?.invoke(partial)
            }
        }

        override fun onEvent(eventType: Int, params: Bundle?) {}
    }

    /**
     * Startet das native Diktat mit Live-Zwischenergebnissen.
     */
    fun startListening() {
        if (!hasPermission) {
            errorMessage = "Mikrofon-Berechtigung erforderlich"
            return
        }
        if (!isAvailable) {
            errorMessage = "Spracherkennung nicht verfügbar"
            return
        }

        try {
            if (speechRecognizer == null) {
                initRecognizer()
            }
            val intent = Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH).apply {
                putExtra(
                    RecognizerIntent.EXTRA_LANGUAGE_MODEL,
                    RecognizerIntent.LANGUAGE_MODEL_FREE_FORM
                )
                putExtra(RecognizerIntent.EXTRA_LANGUAGE, Locale.getDefault())
                putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, true)
                putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 3)
            }
            speechRecognizer?.startListening(intent)
            isListening = true
            errorMessage = null
        } catch (e: Exception) {
            Log.e(TAG, "Fehler beim Starten der Spracherkennung", e)
            errorMessage = e.localizedMessage
            isListening = false
        }
    }

    /**
     * Beendet die aktive Aufnahme und wartet auf das Endergebnis.
     */
    fun stopListening() {
        try {
            speechRecognizer?.stopListening()
        } catch (e: Exception) {
            Log.e(TAG, "Fehler beim Stoppen der Spracherkennung", e)
        }
        isListening = false
    }

    /**
     * Bricht die Spracherkennung sofort ab.
     */
    fun cancel() {
        try {
            speechRecognizer?.cancel()
        } catch (e: Exception) {
            Log.e(TAG, "Fehler beim Abbrechen der Spracherkennung", e)
        }
        isListening = false
        partialText = ""
    }

    /**
     * Schaltet zwischen Start und Stop um.
     */
    fun toggleListening(onRequestPermission: () -> Unit) {
        if (!hasPermission) {
            onRequestPermission()
            return
        }
        if (isListening) {
            stopListening()
        } else {
            startListening()
        }
    }

    /**
     * Bereinigt Ressourcen.
     */
    fun destroy() {
        try {
            speechRecognizer?.destroy()
        } catch (e: Exception) {
            Log.e(TAG, "Fehler beim Zerstören des SpeechRecognizers", e)
        }
        speechRecognizer = null
        isListening = false
    }
}

/**
 * Remember-Funktion für das native Diktat inklusive automatischer Berechtigungs-Abfrage.
 */
@Composable
fun rememberNativeSpeechRecognizer(
    onSpeechResult: (String) -> Unit,
    onPartialResult: ((String) -> Unit)? = null
): Pair<NativeSpeechRecognizerState, () -> Unit> {
    val context = LocalContext.current
    val state = remember(context) {
        NativeSpeechRecognizerState(
            context = context,
            onSpeechResult = onSpeechResult,
            onPartialResult = onPartialResult
        )
    }

    val permissionLauncher = rememberLauncherForActivityResult(
        contract = ActivityResultContracts.RequestPermission()
    ) { isGranted ->
        state.hasPermission = isGranted
        if (isGranted) {
            state.startListening()
        }
    }

    DisposableEffect(state) {
        onDispose {
            state.destroy()
        }
    }

    val requestPermissionAndStart: () -> Unit = {
        if (state.hasPermission) {
            state.toggleListening { permissionLauncher.launch(Manifest.permission.RECORD_AUDIO) }
        } else {
            permissionLauncher.launch(Manifest.permission.RECORD_AUDIO)
        }
    }

    return Pair(state, requestPermissionAndStart)
}
