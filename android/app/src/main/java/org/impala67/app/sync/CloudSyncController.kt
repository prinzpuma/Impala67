package org.impala67.app.sync

import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Deferred
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import org.impala67.app.core.ImpalaStore
import org.impala67.app.settings.DevicePrefs
import org.json.JSONObject
import uniffi.impala_ffi.CloudSync
import uniffi.impala_ffi.ServerAction
import uniffi.impala_ffi.SyncFailure
import uniffi.impala_ffi.SyncListener
import uniffi.impala_ffi.formatSyncUsage
import uniffi.impala_ffi.generateSyncKey
import uniffi.impala_ffi.syncReconnectDelayMs
import uniffi.impala_ffi.syncRetryDelayMs
import uniffi.impala_ffi.wsPingIntervalMs
import uniffi.impala_ffi.wsPingMessage
import java.util.concurrent.atomic.AtomicBoolean

/** Verbindungszustand wie `status` in web/sync-cloudflare.js. */
enum class CloudSyncState { DISCONNECTED, CONNECTING, CONNECTED, SYNCING, ERROR }

/** Fortschritt eines Durchgangs (Etappe, z. B. Abrufen/Senden/Dateien). */
data class SyncProgress(val label: String, val current: Long, val total: Long) {
    val percent: Int get() = if (total > 0) (current * 100 / total).toInt().coerceIn(0, 100) else 0
}

/** Alles, was die Einstellungen über den Cloudflare-Sync zeigen. */
data class CloudSyncUi(
    val state: CloudSyncState = CloudSyncState.DISCONNECTED,
    val label: String = "Nicht verbunden",
    val detail: String = "Echtzeit-Synchronisierung über WebSockets mit Ende-zu-Ende-Verschlüsselung",
    val progress: SyncProgress? = null,
    /** Leer bis zum ersten Lesen (der Kern lädt im Hintergrund, nicht im Hauptthread). */
    val usage: String = "",
    /** Worker-URL und Schlüssel aus den Kern-Einstellungen (`cfUrl`, `cfSyncKey`). */
    val url: String = "",
    val syncKey: String = "",
) {
    val configured: Boolean get() = syncKey.isNotBlank()
    val active: Boolean get() = state != CloudSyncState.DISCONNECTED && state != CloudSyncState.ERROR
}

/**
 * Cloudflare Live-Sync (web/sync-cloudflare.js): Der ganze Ablauf läuft im Rust-Kern ([CloudSync]);
 * hier liegen nur WebSocket, Ping, Neuaufbau und Wiederholversuche. Läuft, solange die App sichtbar
 * ist ([onForeground]/[onBackground]); beim Zurückkehren holt ein Durchgang alles nach.
 */
class CloudSyncController(
    private val storeAsync: Deferred<ImpalaStore>,
    private val prefs: DevicePrefs,
    private val scope: CoroutineScope,
) {
    private val _ui = MutableStateFlow(CloudSyncUi())
    val ui: StateFlow<CloudSyncUi> = _ui

    private val http = OkHttpClient()
    private val lock = Mutex()
    private var sync: CloudSync? = null
    private var socket: WebSocket? = null
    private var pingJob: Job? = null
    private var reconnectJob: Job? = null
    private var debounceJob: Job? = null
    private var reconnectAttempt = 0
    private var foreground = false

    /** Ein Durchgang zur Zeit; Anfragen währenddessen werden zu einem weiteren zusammengefasst. */
    private val requests = Channel<Unit>(Channel.CONFLATED)
    private val forceAll = AtomicBoolean(false)

    init {
        scope.launch { runPasses() }
        scope.launch {
            val store = storeAsync.await()
            _ui.update { if (it.usage.isEmpty()) it.copy(usage = formatSyncUsage(0.0)) else it }
            refreshSettings(store)
            store.changes.collect { if (it.everything || it.settings) refreshSettings(store) }
        }
    }

    /** App sichtbar: verbinden, falls dieses Gerät gekoppelt ist (Schlüssel in [DevicePrefs]). */
    fun onForeground() {
        foreground = true
        scope.launch {
            val key = prefs.cfSyncKey.first()
            if (key.isNotBlank()) lock.withLock { connectLocked(key, _ui.value.url) }
        }
    }

    /** App im Hintergrund: WebSocket schließen (Akku); der Kern bleibt verbunden. */
    fun onBackground() {
        foreground = false
        scope.launch { lock.withLock { closeSocket() } }
    }

    /**
     * „Verbinden“: prüft den Schlüssel, speichert URL und Schlüssel wie die PWA in den Einstellungen
     * und auf dem Gerät, dann erster Durchgang. Liefert eine Fehlermeldung oder `null`.
     */
    suspend fun configure(url: String, key: String): String? {
        val trimmed = key.trim()
        if (trimmed.isEmpty()) return "Bitte gib einen Sync-Schlüssel ein oder generiere einen neuen."
        return lock.withLock {
            disconnectLocked()
            val error = connectLocked(trimmed, url.trim())
            if (error == null) {
                prefs.setCfSyncKey(trimmed)
                storeAsync.await().write {
                    it.updateSettings(JSONObject(mapOf("cfUrl" to url.trim(), "cfSyncKey" to trimmed)).toString())
                }
            }
            error
        }
    }

    /** „Trennen“: Der Schlüssel bleibt in den Einstellungen, das Gerät verbindet aber nicht mehr von selbst. */
    suspend fun disconnect() {
        lock.withLock { disconnectLocked() }
        prefs.setCfSyncKey("")
        _ui.update { it.copy(state = CloudSyncState.DISCONNECTED, label = "Getrennt", progress = null) }
    }

    /** Durchgang jetzt (z. B. „Jetzt synchronisieren“ oder nach einer Server-Nachricht). */
    fun syncNow(all: Boolean = false) {
        if (all) forceAll.set(true)
        requests.trySend(Unit)
    }

    /** „Cloud-Stand leeren“: alle Pakete und Dateien auf dem Server löschen, dann alles neu senden. */
    suspend fun resetCloud(): String? {
        val current = sync ?: return "Bitte zuerst verbinden."
        return try {
            withContext(Dispatchers.IO) { current.resetCloud() }
            syncNow(all = true)
            null
        } catch (e: SyncFailure) {
            e.message ?: "Löschen fehlgeschlagen."
        }
    }

    fun newKey(): String = generateSyncKey()

    // --- intern ---

    private fun refreshSettings(store: ImpalaStore) {
        val s = runCatching { JSONObject(store.core.settingsJson()) }.getOrDefault(JSONObject())
        _ui.update { it.copy(url = s.optString("cfUrl"), syncKey = s.optString("cfSyncKey")) }
        autoConnect(s.optString("cfUrl"), s.optString("cfSyncKey"))
    }

    /**
     * Neuer Schlüssel in den Einstellungen (z. B. über Drive von einem anderen Gerät), dieses Gerät
     * ist aber nicht gekoppelt: gleich verbinden. Ein schon bekannter Schlüssel (nach „Trennen“ oder
     * beim ersten Start nach dem Update) verbindet nicht von selbst.
     */
    private fun autoConnect(url: String, key: String) {
        scope.launch {
            val seen = prefs.cfSeenKey.first()
            if (seen == key) return@launch
            prefs.setCfSeenKey(key)
            if (seen == null || key.isBlank() || prefs.cfSyncKey.first().isNotBlank()) return@launch
            configure(url, key)
        }
    }

    /** Leitet den Schlüssel ab (PBKDF2, bis ~1 s), erster Durchgang, dann WebSocket. */
    private suspend fun connectLocked(key: String, url: String): String? {
        if (sync != null) {
            if (foreground && socket == null) openSocket()
            return null
        }
        _ui.update { it.copy(state = CloudSyncState.CONNECTING, label = "Verbinde …", progress = null) }
        val store = storeAsync.await()
        val created = try {
            withContext(Dispatchers.IO) { CloudSync(store.core, key, url.ifBlank { null }, listener) }
        } catch (e: SyncFailure) {
            val message = e.message ?: "Ungültiger Sync-Schlüssel."
            _ui.update { it.copy(state = CloudSyncState.ERROR, label = "Fehler", detail = message) }
            return message
        }
        sync = created
        _ui.update { it.copy(usage = created.status().usageText) }
        syncNow()
        if (foreground) openSocket()
        return null
    }

    private fun disconnectLocked() {
        closeSocket()
        reconnectJob?.cancel()
        debounceJob?.cancel()
        sync?.let { it.stop(); it.close() }
        sync = null
    }

    private val listener = object : SyncListener {
        override fun onProgress(label: String, current: ULong, total: ULong) {
            _ui.update { it.copy(progress = SyncProgress(label, current.toLong(), total.toLong())) }
        }

        // Lokale Änderung: kurz bündeln, damit Tippen nicht jeden Buchstaben einzeln sendet.
        override fun onSyncNeeded() {
            debounceJob?.cancel()
            debounceJob = scope.launch { delay(CHANGE_DEBOUNCE_MS); syncNow() }
        }
    }

    private suspend fun runPasses() {
        for (ignored in requests) {
            val current = sync ?: continue
            _ui.update { it.copy(state = CloudSyncState.SYNCING, label = "Synchronisiere …") }
            var attempt = 0u
            while (scope.isActive) {
                try {
                    val report = withContext(Dispatchers.IO) { current.sync(forceAll.getAndSet(false)) }
                    val detail = if (report.conflicts > 0uL) "${report.conflicts} Konflikt(e) – siehe Konflikte" else "Alle Geräte auf demselben Stand"
                    _ui.update {
                        it.copy(
                            state = if (socket != null) CloudSyncState.CONNECTED else CloudSyncState.CONNECTING,
                            label = if (socket != null) "Verbunden" else "Synchronisiert",
                            detail = detail, progress = null, usage = current.status().usageText,
                        )
                    }
                    break
                } catch (_: SyncFailure.Stopped) {
                    break
                } catch (e: SyncFailure.Failed) {
                    if (e.retryable && attempt < MAX_RETRIES && sync === current) {
                        attempt++
                        delay(syncRetryDelayMs(attempt).toLong())
                        continue
                    }
                    val detail = if (e.quota) "Cloud-Speicher voll – Cloud-Stand leeren oder verdichten" else e.reason
                    _ui.update { it.copy(state = CloudSyncState.ERROR, label = "Fehler", detail = detail, progress = null) }
                    break
                } catch (e: SyncFailure) {
                    _ui.update { it.copy(state = CloudSyncState.ERROR, label = "Fehler", detail = e.message.orEmpty(), progress = null) }
                    break
                }
            }
        }
    }

    private fun openSocket() {
        val current = sync ?: return
        val request = Request.Builder().url(current.wsUrl()).build()
        socket = http.newWebSocket(request, object : WebSocketListener() {
            override fun onOpen(webSocket: WebSocket, response: Response) {
                webSocket.send(current.wsAuthMessage())
                reconnectAttempt = 0
                _ui.update { if (it.state == CloudSyncState.SYNCING) it else it.copy(state = CloudSyncState.CONNECTED, label = "Verbunden") }
                pingJob?.cancel()
                pingJob = scope.launch {
                    while (isActive) { delay(wsPingIntervalMs().toLong()); webSocket.send(wsPingMessage()) }
                }
            }

            override fun onMessage(webSocket: WebSocket, text: String) {
                scope.launch(Dispatchers.IO) {
                    when (val action = runCatching { current.handleServerMessage(text) }.getOrNull()) {
                        is ServerAction.Sync -> syncNow(action.forceAll)
                        is ServerAction.Rejected -> {
                            _ui.update { it.copy(state = CloudSyncState.ERROR, label = "Abgewiesen", detail = action.message) }
                            lock.withLock { if (socket === webSocket) closeSocket() }
                        }
                        else -> Unit
                    }
                }
            }

            override fun onClosed(webSocket: WebSocket, code: Int, reason: String) = lost(webSocket)

            override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) = lost(webSocket)
        })
    }

    /** Verbindung weg (Netz, Server): mit wachsender Pause neu aufbauen, solange die App sichtbar ist. */
    private fun lost(webSocket: WebSocket) {
        scope.launch {
            lock.withLock {
                if (socket !== webSocket) return@launch
                closeSocket()
                if (!foreground || sync == null) return@launch
                _ui.update { if (it.state == CloudSyncState.ERROR) it else it.copy(state = CloudSyncState.CONNECTING, label = "Verbinde …") }
                reconnectJob?.cancel()
                reconnectJob = scope.launch {
                    delay(syncReconnectDelayMs((++reconnectAttempt).toUInt()).toLong())
                    lock.withLock { if (foreground && sync != null && socket == null) { openSocket(); syncNow() } }
                }
            }
        }
    }

    private fun closeSocket() {
        pingJob?.cancel()
        socket?.close(1000, null)
        socket = null
    }

    private companion object {
        const val CHANGE_DEBOUNCE_MS = 1_500L
        const val MAX_RETRIES = 5u
    }
}
