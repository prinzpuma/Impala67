package org.impala67.app.data

import android.util.Log
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
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
import uniffi.impala_ffi.CloudSync
import uniffi.impala_ffi.DriveProgress
import uniffi.impala_ffi.DriveStatus
import uniffi.impala_ffi.DriveSync
import uniffi.impala_ffi.ImpalaCore
import uniffi.impala_ffi.ServerAction
import uniffi.impala_ffi.SyncListener
import uniffi.impala_ffi.SyncStatus
import uniffi.impala_ffi.wsPingIntervalMs
import uniffi.impala_ffi.wsPingMessage
import java.util.concurrent.TimeUnit

/**
 * UI-Zustand für Cloudflare Live-Sync.
 */
sealed class SyncUiModel {
    object Disconnected : SyncUiModel()
    object Idle : SyncUiModel()
    data class Syncing(val label: String, val current: Long, val total: Long) : SyncUiModel()
    data class Synced(val status: SyncStatus) : SyncUiModel()
    data class Error(val message: String) : SyncUiModel()
}

/**
 * Kapselt CloudSync (Cloudflare WebSocket + REST) und DriveSync (Google Drive Backup).
 * Hält reaktive Flows für die UI und kümmert sich um Verbindung, Ping-Timer und Debounce.
 */
class SyncManager(
    private val core: ImpalaCore
) : SyncListener {

    companion object {
        private const val TAG = "SyncManager"
        private const val DEBOUNCE_MS = 1500L
    }

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
    private val syncMutex = Mutex()

    private val _syncState = MutableStateFlow<SyncUiModel>(SyncUiModel.Disconnected)
    val syncState: StateFlow<SyncUiModel> = _syncState.asStateFlow()

    private val _driveState = MutableStateFlow<DriveStatus?>(null)
    val driveState: StateFlow<DriveStatus?> = _driveState.asStateFlow()

    @Volatile
    private var cloudSync: CloudSync? = null

    @Volatile
    private var driveSync: DriveSync? = null

    private var currentWebSocket: WebSocket? = null
    private var pingJob: Job? = null
    private var syncNeededJob: Job? = null
    private var reconnectJob: Job? = null

    private val okHttpClient: OkHttpClient = OkHttpClient.Builder()
        .readTimeout(0, TimeUnit.MILLISECONDS) // Für langlebige WebSocket-Verbindungen
        .retryOnConnectionFailure(true)
        .build()

    // --- SyncListener Implementierung ---

    override fun onProgress(label: String, current: ULong, total: ULong) {
        _syncState.value = SyncUiModel.Syncing(label, current.toLong(), total.toLong())
    }

    override fun onSyncNeeded() {
        // Lokale Änderung eingetroffen: nach 1,5s Debounce Sync starten
        syncNeededJob?.cancel()
        syncNeededJob = scope.launch {
            delay(DEBOUNCE_MS)
            triggerSyncNow(forceAll = false)
        }
    }

    // --- Cloudflare Sync ---

    /**
     * Konfiguriert den Cloudflare Live-Sync mit dem angegebenen Schlüssel und startet WebSocket + initialen Sync.
     */
    fun configureCloudSync(syncKey: String, workerUrl: String?) {
        scope.launch(Dispatchers.IO) {
            disconnectCloudSyncInternal()
            _syncState.value = SyncUiModel.Syncing("Schlüssel ableiten...", 0L, 0L)
            try {
                // PBKDF2 Schlüsselableitung läuft im Rust-Kern
                val cs = CloudSync(core, syncKey, workerUrl, this@SyncManager)
                cloudSync = cs
                _syncState.value = SyncUiModel.Idle
                connectWebSocket(cs)
                triggerSyncNow(forceAll = false)
            } catch (e: Exception) {
                Log.e(TAG, "Fehler beim Erstellen von CloudSync", e)
                _syncState.value = SyncUiModel.Error(e.message ?: "Schlüsselableitung fehlgeschlagen")
            }
        }
    }

    /**
     * Trennt die Live-Sync-Verbindung und stoppt Timer.
     */
    fun disconnectCloudSync() {
        scope.launch(Dispatchers.IO) {
            disconnectCloudSyncInternal()
        }
    }

    private fun disconnectCloudSyncInternal() {
        reconnectJob?.cancel()
        reconnectJob = null
        stopPingJob()
        closeWebSocket()
        cloudSync?.stop()
        cloudSync?.close()
        cloudSync = null
        _syncState.value = SyncUiModel.Disconnected
    }

    /**
     * Stößt sofort einen Cloudflare-Sync-Durchgang an.
     */
    fun triggerSyncNow(forceAll: Boolean = false) {
        val cs = cloudSync ?: return
        scope.launch(Dispatchers.IO) {
            if (!syncMutex.tryLock()) {
                // Durchgang läuft bereits
                return@launch
            }
            try {
                _syncState.value = SyncUiModel.Syncing("Synchronisiere...", 0L, 0L)
                cs.sync(forceAll)
                val status = cs.status()
                _syncState.value = SyncUiModel.Synced(status)
            } catch (e: Exception) {
                Log.e(TAG, "Fehler beim Cloud-Sync", e)
                _syncState.value = SyncUiModel.Error(e.message ?: "Sync fehlgeschlagen")
            } finally {
                syncMutex.unlock()
            }
        }
    }

    // --- WebSocket-Verbindung ---

    private fun connectWebSocket(cs: CloudSync) {
        val wsUrl = try {
            cs.wsUrl()
        } catch (e: Exception) {
            Log.e(TAG, "wsUrl() fehlgeschlagen", e)
            return
        }

        val request = Request.Builder().url(wsUrl).build()
        currentWebSocket = okHttpClient.newWebSocket(request, object : WebSocketListener() {
            override fun onOpen(webSocket: WebSocket, response: Response) {
                Log.i(TAG, "WebSocket verbunden: $wsUrl")
                try {
                    val authMsg = cs.wsAuthMessage()
                    webSocket.send(authMsg)
                    startPingJob(webSocket)
                } catch (e: Exception) {
                    Log.e(TAG, "Fehler beim Senden der wsAuthMessage", e)
                }
            }

            override fun onMessage(webSocket: WebSocket, text: String) {
                scope.launch(Dispatchers.IO) {
                    val currentCs = cloudSync ?: return@launch
                    try {
                        when (val action = currentCs.handleServerMessage(text)) {
                            is ServerAction.Sync -> {
                                triggerSyncNow(action.forceAll)
                            }
                            is ServerAction.Rejected -> {
                                Log.w(TAG, "Server wies Verbindung ab: ${action.message}")
                                _syncState.value = SyncUiModel.Error(action.message)
                                closeWebSocket()
                            }
                            is ServerAction.Nothing -> {
                                // Kein weiterer Schritt notwendig
                            }
                        }
                    } catch (e: Exception) {
                        Log.e(TAG, "Fehler bei handleServerMessage", e)
                    }
                }
            }

            override fun onClosing(webSocket: WebSocket, code: Int, reason: String) {
                webSocket.close(1000, null)
                stopPingJob()
            }

            override fun onClosed(webSocket: WebSocket, code: Int, reason: String) {
                stopPingJob()
            }

            override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) {
                Log.w(TAG, "WebSocket-Verbindungsfehler: ${t.message}")
                stopPingJob()
                scheduleReconnect()
            }
        })
    }

    private fun startPingJob(webSocket: WebSocket) {
        stopPingJob()
        pingJob = scope.launch(Dispatchers.IO) {
            val intervalMs = try {
                wsPingIntervalMs().toLong().coerceAtLeast(5000L)
            } catch (e: Exception) {
                25000L
            }
            while (isActive) {
                delay(intervalMs)
                try {
                    val ping = wsPingMessage()
                    webSocket.send(ping)
                } catch (e: Exception) {
                    Log.w(TAG, "Ping senden fehlgeschlagen", e)
                    break
                }
            }
        }
    }

    private fun stopPingJob() {
        pingJob?.cancel()
        pingJob = null
    }

    private fun closeWebSocket() {
        try {
            currentWebSocket?.close(1000, "Normal closure")
        } catch (e: Exception) {
            // Ignorieren
        }
        currentWebSocket = null
    }

    private fun scheduleReconnect() {
        val cs = cloudSync ?: return
        reconnectJob?.cancel()
        reconnectJob = scope.launch {
            delay(5000L)
            if (isActive && cloudSync === cs) {
                Log.i(TAG, "Versuche erneute WebSocket-Verbindung...")
                connectWebSocket(cs)
            }
        }
    }

    /**
     * Kompaktiert die Cloud-Pakete (Cloudflare R2/D1).
     */
    fun compactCloud(bypassCooldown: Boolean = false) {
        val cs = cloudSync ?: return
        scope.launch(Dispatchers.IO) {
            syncMutex.withLock {
                try {
                    _syncState.value = SyncUiModel.Syncing("Cloud kompaktieren...", 0L, 0L)
                    cs.compactCloud(bypassCooldown)
                    _syncState.value = SyncUiModel.Synced(cs.status())
                } catch (e: Exception) {
                    Log.e(TAG, "Fehler bei compactCloud", e)
                    _syncState.value = SyncUiModel.Error(e.message ?: "Kompaktierung fehlgeschlagen")
                }
            }
        }
    }

    // --- Google Drive Backup ---

    /**
     * Konfiguriert Google Drive Backup über den bereitgestellten DriveAuthManager.
     */
    fun configureDriveSync(driveAuthManager: DriveAuthManager) {
        scope.launch(Dispatchers.IO) {
            try {
                driveSync?.stop()
                driveSync?.close()
                val ds = DriveSync(core, driveAuthManager)
                driveSync = ds
                _driveState.value = ds.status()
            } catch (e: Exception) {
                Log.e(TAG, "Fehler beim Erstellen von DriveSync", e)
            }
        }
    }

    /**
     * Stößt sofort ein Google Drive Backup an.
     */
    fun triggerDriveSyncNow() {
        val ds = driveSync ?: return
        scope.launch(Dispatchers.IO) {
            try {
                val progressListener = object : DriveProgress {
                    override fun onProgress(label: String) {
                        val current = ds.status()
                        _driveState.value = current.copy(progress = label, running = true)
                    }
                }
                ds.sync(progressListener)
                _driveState.value = ds.status()
            } catch (e: Exception) {
                Log.e(TAG, "Drive-Sync fehlgeschlagen", e)
                val current = ds.status()
                _driveState.value = current.copy(progress = e.message ?: "Fehler", running = false)
            }
        }
    }

    /**
     * Alias-Methoden zur einheitlichen Bedienung.
     */
    fun triggerLiveSync() = triggerSyncNow()
    fun triggerDriveBackup() = triggerDriveSyncNow()
    fun setSyncKey(key: String, workerUrl: String? = null) = configureCloudSync(key, workerUrl)

    /**
     * Beendet und trennt die aktive Google Drive Sync-Instanz (z. B. nach Abmeldung).
     */
    fun disconnectDriveSync() {
        scope.launch(Dispatchers.IO) {
            try {
                driveSync?.stop()
                driveSync?.close()
                driveSync = null
                _driveState.value = null
            } catch (e: Exception) {
                Log.e(TAG, "Fehler beim Beenden von DriveSync", e)
            }
        }
    }

    // --- Hintergrund-Pass (WorkManager) ---

    /**
     * Führt einen vollständigen Hintergrund-Sync-Durchlauf aus (für WorkManager).
     */
    suspend fun runBackgroundSyncPass(): Boolean = withContext(Dispatchers.IO) {
        var success = true
        cloudSync?.let { cs ->
            syncMutex.withLock {
                try {
                    cs.sync(false)
                    _syncState.value = SyncUiModel.Synced(cs.status())
                } catch (e: Exception) {
                    Log.e(TAG, "Hintergrund-Cloudflare-Sync fehlgeschlagen", e)
                    success = false
                }
            }
        }
        driveSync?.let { ds ->
            try {
                ds.sync(null)
                _driveState.value = ds.status()
            } catch (e: Exception) {
                Log.e(TAG, "Hintergrund-Drive-Sync fehlgeschlagen", e)
            }
        }
        success
    }
}
