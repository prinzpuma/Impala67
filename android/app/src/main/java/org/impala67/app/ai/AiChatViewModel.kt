package org.impala67.app.ai

import android.util.Log
import androidx.compose.ui.graphics.Color
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withContext
import org.impala67.app.core.ImpalaStore
import org.impala67.app.core.Touches
import org.impala67.app.heft.HeftLastPage
import org.impala67.app.settings.DevicePrefs
import org.json.JSONArray
import org.json.JSONObject
import uniffi.impala_ffi.AiAssistant
import uniffi.impala_ffi.AiFile
import uniffi.impala_ffi.AiListener
import uniffi.impala_ffi.AiOptions
import uniffi.impala_ffi.AiOutcome
import uniffi.impala_ffi.AiPlatform
import uniffi.impala_ffi.AiRunRequest
import uniffi.impala_ffi.ChatInfo
import uniffi.impala_ffi.ChatMessage
import uniffi.impala_ffi.PageSummary
import java.util.TimeZone

/** Fehler eines Laufs; `aborted` = vom Nutzer gestoppt; [partial] = Teilantwort bis zum Abbruch. */
data class AiError(val message: String, val aborted: Boolean, val partial: String = "", val withImage: Boolean = false)

/** Wie viel vom Seitentext zuletzt mitging (`Kontext: x von y Zeichen`). */
data class ContextSent(val pageId: String, val sent: Int, val total: Int)

/** Umformulieren einer Antwort (chat-fullscreen.js `REFINE_PROMPTS`). */
enum class Refine(val label: String, val prompt: String) {
    LONGER("Länger", "Bitte formuliere deine letzte Antwort ausführlicher und länger, mit mehr Details."),
    SAME("Gleich", "Bitte formuliere deine letzte Antwort in etwa gleicher Länge neu — anderer Wortlaut, gleicher Inhalt und Umfang."),
    SHORTER("Kürzer", "Bitte formuliere deine letzte Antwort kürzer und knapper, auf das Wesentliche reduziert."),
}

/**
 * KI-Chat der Tablet-Ansicht. Der Rust-Assistent ([AiAssistant.runAsync]) läuft im Kern; hier landen
 * seine Rückrufe im Zustand (Entwurf, Denkaufwand, Werkzeug, Nachrichten). Rückrufe kommen aus
 * Fremd-Threads, deshalb nur über [MutableStateFlow.update]. Ein Lauf zur Zeit (wie `Busy` im Kern).
 */
class AiChatViewModel(
    private val store: ImpalaStore,
    private val prefs: DevicePrefs,
    private val semantic: SemanticIndex,
) : ViewModel() {
    /** Chat-Liste der Seitenleiste, zuletzt geänderte zuerst. */
    val chats: StateFlow<List<ChatInfo>?> = store.query(Touches.chats) { it.chats() }

    /** Modellwahl und Denkaufwand (Composer-Menü). */
    val models = AiModels(store, prefs, viewModelScope)

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

    /** Antwort, die gerade umformuliert wird (sie verschwindet bis zum neuen Text). */
    private val _refining = MutableStateFlow<String?>(null)
    val refining: StateFlow<String?> = _refining.asStateFlow()

    private val _error = MutableStateFlow<AiError?>(null)
    val error: StateFlow<AiError?> = _error.asStateFlow()

    /** Anhang der nächsten Nachricht (höchstens einer). */
    private val _attachment = MutableStateFlow<ChatAttachment?>(null)
    val attachment: StateFlow<ChatAttachment?> = _attachment.asStateFlow()

    /** Seiten, deren Inhalt nicht mitgeht (✕ am Seitenkontext-Chip, `S.contextOff`). */
    private val _contextOff = MutableStateFlow<Set<String>>(emptySet())
    val contextOff: StateFlow<Set<String>> = _contextOff.asStateFlow()

    private val _contextSent = MutableStateFlow<ContextSent?>(null)
    val contextSent: StateFlow<ContextSent?> = _contextSent.asStateFlow()

    /** Kurze Hinweise für einen Toast („Kopiert.“ …). */
    private val _notices = MutableSharedFlow<String>(extraBufferCapacity = 4)
    val notices: SharedFlow<String> = _notices

    /** Zählt hoch, wenn ein Chat geöffnet oder begonnen wird; die Desk-Shell klappt dann das KI-Panel auf. */
    private val _openRequests = MutableStateFlow(0)
    val openRequests: StateFlow<Int> = _openRequests.asStateFlow()

    /** Wartet auf die Antwort einer Rückfrage (`ask`), die den Lauf-Thread blockiert. */
    @Volatile private var pendingAnswer: CompletableDeferred<String?>? = null
    private var assistant: AiAssistant? = null
    private var assistantKey = ""
    private var runPageId: String? = null
    private var runHadImage = false

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

        override fun heftPageImage(pageId: String, pageIndex: UInt): String? = runBlocking {
            runCatching { heftPageAttachment(store, pageId, pageIndex.toInt(), HEFT_INK)?.dataUrl }.getOrNull()
        }

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
            val page = runPageId
            if (page != null && outcome.contextTotal != null) {
                _contextSent.update { ContextSent(page, outcome.contextSent?.toInt() ?: 0, outcome.contextTotal!!.toInt()) }
            }
            finishRun()
            viewModelScope.launch { reload(outcome.chatId) }
        }

        override fun onFailed(message: String, aborted: Boolean) {
            _error.update { AiError(message, aborted, if (aborted) _draft.value else "", runHadImage) }
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

    fun attach(a: ChatAttachment?) = _attachment.update { a }

    /** Aktuelle Heftseite als Bild anhängen (`attachHeft`). */
    fun attachHeftPage(pageId: String) {
        viewModelScope.launch {
            val a = runCatching { heftPageAttachment(store, pageId, HeftLastPage[pageId], HEFT_INK) }.getOrNull()
            if (a == null) _notices.emit("Heftseite konnte nicht angehängt werden.") else _attachment.update { a }
        }
    }

    /** ✕ am Seitenkontext-Chip: Inhalt dieser Seite nicht mehr mitsenden (bis zum Wieder-Einschalten). */
    fun setContextOff(pageId: String, off: Boolean) = _contextOff.update { if (off) it + pageId else it - pageId }

    /** Schickt eine Nachricht in den offenen (oder einen neuen) Chat. `activePageId`: geöffnete Seite als Kontext. */
    fun send(text: String, activePageId: String?) {
        val prompt = text.trim()
        val att = _attachment.value
        if ((prompt.isEmpty() && att == null) || _running.value) return
        _error.update { null }
        _messages.update { it + message(role = "user", content = prompt, image = (att as? ChatAttachment.Image)?.dataUrl) }
        _attachment.update { null }
        _draft.update { "" }
        _thinking.update { "" }
        _tool.update { null }
        _running.update { true }
        _openRequests.update { it + 1 }
        runPageId = activePageId
        runHadImage = att is ChatAttachment.Image
        val request = AiRunRequest(
            chatId = _chatId.value,
            text = prompt,
            image = (att as? ChatAttachment.Image)?.dataUrl,
            textFile = (att as? ChatAttachment.TextFile)?.let { AiFile(it.name, it.content) },
            pdfFile = (att as? ChatAttachment.Pdf)?.let { AiFile(it.name, it.content) },
            activePageId = activePageId,
            heftPageIndex = activePageId?.let { HeftLastPage[it].toUInt() },
            sendPageContext = activePageId != null && activePageId !in _contextOff.value,
            anki = null,
            useRag = semantic.search != null,
            utcOffsetMinutes = utcOffset(),
        )
        viewModelScope.launch {
            runCatching { assistant().runAsync(request, listener) }
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

    /**
     * Stift an einer Nutzernachricht: ihr Text kommt zurück ins Feld, sie und alles danach fällt weg.
     * Gesperrt, solange spätere KI-Änderungen nicht rückgängig gemacht sind. Liefert den Text oder `null`.
     */
    fun editFrom(mid: String): String? {
        val list = _messages.value
        val idx = list.indexOfFirst { it.mid == mid }
        if (_running.value || idx < 0) return null
        if (list.drop(idx).any { it.role == "edit" && it.undone != true }) {
            _notices.tryEmit("Erst die späteren Seitenänderungen rückgängig machen, dann bearbeiten.")
            return null
        }
        val kept = list.take(idx)
        _messages.update { kept }
        _error.update { null }
        val id = _chatId.value
        if (id.isNotEmpty()) viewModelScope.launch {
            runCatching { store.write { core -> core.chat(id)?.let { core.saveChat(it.copy(messages = kept)) } } }
            assistant?.forgetChatState(id)
        }
        return list[idx].content.orEmpty()
    }

    /** „Anpassen“ einer Antwort (Länger / Gleich / Kürzer): ersetzt sie an ihrer Stelle. */
    fun refine(mid: String, mode: Refine) {
        val list = _messages.value
        val idx = list.indexOfFirst { it.mid == mid && it.role == "assistant" }
        if (_running.value || idx < 0) return
        val history = JSONArray()
        list.take(idx + 1).filter { it.role == "user" || it.role == "assistant" }.forEach {
            history.put(JSONObject().put("role", it.role).put("content", it.content.orEmpty()))
        }
        _running.update { true }
        _refining.update { mid }
        _draft.update { "" }
        viewModelScope.launch {
            val result = withContext(Dispatchers.IO) {
                runCatching { assistant().refine(history.toString(), mode.prompt, utcOffset(), listener) }
            }
            result.onSuccess { text ->
                val updated = _messages.value.map { if (it.mid == mid) it.copy(content = text, reasoning = null) else it }
                _messages.update { updated }
                val id = _chatId.value
                if (id.isNotEmpty()) runCatching { store.write { core -> core.chat(id)?.let { core.saveChat(it.copy(messages = updated)) } } }
            }.onFailure { e ->
                if (e !is uniffi.impala_ffi.AiFailure.Aborted) _notices.emit("Anpassen fehlgeschlagen: ${e.message}")
            }
            _refining.update { null }
            finishRun()
        }
    }

    fun notice(text: String) = _notices.tryEmit(text)

    /** Titel und Art der geöffneten Seite für den Seitenkontext-Chip. */
    suspend fun pageSummary(id: String): PageSummary? = runCatching { store.write { it.page(id)?.summary } }.getOrNull()

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

    /** Leeren Chat beginnen (nicht während eines Laufs). [reveal]: das KI-Panel dafür aufklappen. */
    fun newChat(reveal: Boolean = true) {
        if (_running.value) return
        _chatId.update { "" }
        _messages.update { emptyList() }
        _error.update { null }
        if (reveal) _openRequests.update { it + 1 }
    }

    /** Chat löschen; den laufenden Chat selbst nicht während seiner Antwort. */
    fun delete(id: String) = delete(setOf(id))

    /** Mehrere Chats löschen (Auswahl in der Seitenleiste, `chatdelsel`). */
    fun delete(ids: Set<String>) {
        val running = _chatId.value.takeIf { _running.value }
        val gone = ids - setOfNotNull(running)
        if (gone.isEmpty()) return
        viewModelScope.launch {
            runCatching { store.write { core -> gone.forEach(core::deleteChat) } }
                .onFailure { Log.w(TAG, "Chat konnte nicht gelöscht werden", it) }
            if (_chatId.value in gone) {
                _chatId.update { "" }
                _messages.update { emptyList() }
                _error.update { null }
            }
        }
    }

    /** Chat umbenennen (`data-chatrename`); leerer Titel bleibt beim alten. */
    fun rename(id: String, title: String) {
        val t = title.trim()
        if (t.isEmpty()) return
        viewModelScope.launch {
            runCatching { store.write { core -> core.chat(id)?.let { core.saveChat(it.copy(title = t)) } } }
                .onFailure { Log.w(TAG, "Chat konnte nicht umbenannt werden", it) }
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

    /**
     * Der Assistent hält Zustand je Chat (Zusammenfassung, Werkzeuge); er wird nur neu gebaut, wenn sich
     * Sync-Schlüssel, Modell, Denkaufwand oder die semantische Suche ändern.
     */
    private suspend fun assistant(): AiAssistant {
        val syncKey = prefs.cfSyncKey.first()
        val search = semantic.search
        val key = syncKey + "|" + (models.choice.value?.key ?: "") + "|" + System.identityHashCode(search)
        assistant?.takeIf { key == assistantKey }?.let { return it }
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
        return AiAssistant(store.core, options, platform, search).also {
            assistant = it
            assistantKey = key
        }
    }

    private fun message(role: String, content: String?, image: String? = null) = ChatMessage(
        mid = null, role = role, content = content, model = null, reasoning = null, name = null, detail = null,
        error = null, summary = null, undone = null, question = null, options = null, answered = null,
        answer = null, image = image, extraJson = "{}",
    )

    private companion object {
        const val TAG = "AiChatViewModel"
        /** Linienfarbe des Papiers im Heftbild für die KI. */
        val HEFT_INK = Color(0xFF6B8CAE)

        fun utcOffset() = TimeZone.getDefault().getOffset(System.currentTimeMillis()) / 60_000
    }
}
