package org.impala67.app.ai

import android.util.Log
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.coroutines.runBlocking
import org.impala67.app.core.ImpalaStore
import org.impala67.app.core.Touches
import org.impala67.app.settings.DevicePrefs
import uniffi.impala_ffi.AiAssistant
import uniffi.impala_ffi.AiListener
import uniffi.impala_ffi.AiOptions
import uniffi.impala_ffi.AiOutcome
import uniffi.impala_ffi.AiPlatform
import uniffi.impala_ffi.AiRunRequest
import uniffi.impala_ffi.ChatInfo
import uniffi.impala_ffi.ChatMessage
import java.util.TimeZone

/** Fehler eines Laufs; `aborted` = vom Nutzer gestoppt. */
data class AiError(val message: String, val aborted: Boolean)

/**
 * KI-Chat der Tablet-Ansicht. Der Rust-Assistent ([AiAssistant.runAsync]) läuft im Kern; hier landen
 * seine Rückrufe im Zustand (Entwurf, Denkaufwand, Werkzeug, Nachrichten). Rückrufe kommen aus
 * Fremd-Threads, deshalb nur über [MutableStateFlow.update]. Ein Lauf zur Zeit (wie `Busy` im Kern).
 */
class AiChatViewModel(private val store: ImpalaStore, private val prefs: DevicePrefs) : ViewModel() {
    /** Chat-Liste der Seitenleiste, zuletzt geänderte zuerst. */
    val chats: StateFlow<List<ChatInfo>?> = store.query(Touches.chats) { it.chats() }

    private val _chatId = MutableStateFlow("")
    /** Offener Chat; leer = neuer Chat (seine ID kommt mit dem Ende des ersten Laufs). */
    val chatId: StateFlow<String> = _chatId.asStateFlow()

    private val _messages = MutableStateFlow<List<ChatMessage>>(emptyList())
    val messages: StateFlow<List<ChatMessage>> = _messages.asStateFlow()

    /** Antwortentwurf des laufenden Laufs (ganzer bisheriger Text). */
    private val _draft = MutableStateFlow("")
    val draft: StateFlow<String> = _draft.asStateFlow()

    private val _thinking = MutableStateFlow("")
    val thinking: StateFlow<String> = _thinking.asStateFlow()

    private val _tool = MutableStateFlow<String?>(null)
    val tool: StateFlow<String?> = _tool.asStateFlow()

    private val _running = MutableStateFlow(false)
    val running: StateFlow<Boolean> = _running.asStateFlow()

    private val _error = MutableStateFlow<AiError?>(null)
    val error: StateFlow<AiError?> = _error.asStateFlow()

    /** Zählt hoch, wenn ein Chat geöffnet oder begonnen wird; die Desk-Shell klappt dann das KI-Panel auf. */
    private val _openRequests = MutableStateFlow(0)
    val openRequests: StateFlow<Int> = _openRequests.asStateFlow()

    /** Wartet auf die Antwort einer Rückfrage (`ask`), die den Lauf-Thread blockiert. */
    @Volatile private var pendingAnswer: CompletableDeferred<String?>? = null
    private var assistant: AiAssistant? = null
    private var assistantKey = ""

    private val platform = object : AiPlatform {
        override fun ask(question: String, options: List<String>): String? {
            val answer = CompletableDeferred<String?>()
            pendingAnswer = answer
            return try {
                runBlocking { answer.await() }
            } finally {
                pendingAnswer = null
            }
        }

        override fun heftPageImage(pageId: String, pageIndex: UInt): String? = null
        override fun supportedTools(): List<String> = emptyList()
        override fun runTool(name: String, argsJson: String): String? = null
    }

    private val listener = object : AiListener {
        override fun onDraft(text: String) = _draft.update { text }

        override fun onThinking(text: String) = _thinking.update { text }

        override fun onToolStarted(name: String) = _tool.update { name }

        override fun onMessage(message: ChatMessage) {
            when (message.role) {
                "assistant" -> { _draft.update { "" }; _thinking.update { "" } }
                "thought" -> _thinking.update { "" }
                "tool" -> _tool.update { null }
            }
            _messages.update { it + message }
        }

        override fun onFinished(outcome: AiOutcome) {
            _chatId.update { outcome.chatId }
            finishRun()
            viewModelScope.launch { reload(outcome.chatId) }
        }

        override fun onFailed(message: String, aborted: Boolean) {
            _error.update { AiError(message, aborted) }
            finishRun()
            viewModelScope.launch { reload(_chatId.value) }
        }
    }

    override fun onCleared() {
        pendingAnswer?.complete(null)
        assistant?.cancel()
        assistant?.close()
        assistant = null
    }

    /** Schickt eine Nachricht in den offenen (oder einen neuen) Chat. `activePageId`: geöffnete Seite als Kontext. */
    fun send(text: String, activePageId: String?) {
        val prompt = text.trim()
        if (prompt.isEmpty() || _running.value) return
        _error.update { null }
        _messages.update { it + message(role = "user", content = prompt) }
        _draft.update { "" }
        _thinking.update { "" }
        _tool.update { null }
        _running.update { true }
        _openRequests.update { it + 1 }
        val request = AiRunRequest(
            chatId = _chatId.value,
            text = prompt,
            image = null,
            textFile = null,
            pdfFile = null,
            activePageId = activePageId,
            heftPageIndex = null,
            sendPageContext = activePageId != null,
            anki = null,
            useRag = false,
            utcOffsetMinutes = TimeZone.getDefault().getOffset(System.currentTimeMillis()) / 60_000,
        )
        viewModelScope.launch {
            val syncKey = prefs.cfSyncKey.first()
            runCatching { assistantFor(syncKey).runAsync(request, listener) }
                .onFailure { listener.onFailed(it.message ?: "KI konnte nicht gestartet werden.", false) }
        }
    }

    /** Antwort auf eine Rückfrage. Ohne offene Rückfrage passiert nichts. */
    fun answer(mid: String, option: String) {
        if (pendingAnswer?.complete(option) != true) return
        _messages.update { list -> list.map { if (it.mid == mid) it.copy(answered = true, answer = option) else it } }
    }

    /** Stopp-Knopf: bricht den Lauf ab; eine offene Rückfrage endet ohne Antwort. */
    fun stop() {
        assistant?.cancel()
        pendingAnswer?.complete(null)
    }

    /** Eine KI-Änderung (Karte `edit`) zurücknehmen. */
    fun undo(mid: String) {
        val id = _chatId.value
        if (_running.value || id.isEmpty()) return
        viewModelScope.launch {
            runCatching { store.write { it.undoAiChange(id, mid) } }
                .onFailure { Log.w(TAG, "KI-Änderung konnte nicht rückgängig gemacht werden", it) }
            reload(id)
        }
    }

    /** Vorhandenen Chat öffnen (nicht während eines Laufs). */
    fun open(id: String) {
        if (_running.value) return
        viewModelScope.launch {
            val list = readMessages(id).orEmpty()
            _messages.update { list }
            _chatId.update { id }
            _error.update { null }
            _openRequests.update { it + 1 }
        }
    }

    /** Leeren Chat beginnen (nicht während eines Laufs). */
    fun newChat() {
        if (_running.value) return
        _chatId.update { "" }
        _messages.update { emptyList() }
        _error.update { null }
        _openRequests.update { it + 1 }
    }

    /** Chat löschen; den laufenden Chat selbst nicht während seiner Antwort. */
    fun delete(id: String) {
        if (_running.value && id == _chatId.value) return
        viewModelScope.launch {
            runCatching { store.write { it.deleteChat(id) } }
                .onFailure { Log.w(TAG, "Chat konnte nicht gelöscht werden", it) }
            if (_chatId.value == id) {
                _chatId.update { "" }
                _messages.update { emptyList() }
                _error.update { null }
            }
        }
    }

    private fun finishRun() {
        _draft.update { "" }
        _thinking.update { "" }
        _tool.update { null }
        _running.update { false }
    }

    private suspend fun reload(id: String) {
        if (id.isEmpty() || _chatId.value != id) return
        readMessages(id)?.let { list -> _messages.update { list } }
    }

    private suspend fun readMessages(id: String): List<ChatMessage>? =
        runCatching { store.write { it.chat(id) } }
            .onFailure { Log.w(TAG, "Chat konnte nicht gelesen werden", it) }
            .getOrNull()?.messages

    /** Der Assistent hält Zustand je Chat (Zusammenfassung, Werkzeuge); er wird nur bei geändertem Sync-Schlüssel neu gebaut. */
    private fun assistantFor(syncKey: String): AiAssistant {
        assistant?.takeIf { syncKey == assistantKey }?.let { return it }
        assistant?.close()
        val options = AiOptions(
            providersJson = null,
            providerId = null,
            model = null,
            thinkingEnabled = null,
            customInstructions = null,
            alwaysSendTools = null,
            syncKey = syncKey.takeIf { it.isNotBlank() },
            workerUrl = null,
        )
        return AiAssistant(store.core, options, platform, null).also {
            assistant = it
            assistantKey = syncKey
        }
    }

    private fun message(role: String, content: String?) = ChatMessage(
        mid = null, role = role, content = content, model = null, reasoning = null, name = null, detail = null,
        error = null, summary = null, undone = null, question = null, options = null, answered = null,
        answer = null, image = null, extraJson = "{}",
    )

    private companion object {
        const val TAG = "AiChatViewModel"
    }
}
