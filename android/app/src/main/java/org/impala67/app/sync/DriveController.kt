package org.impala67.app.sync

import android.accounts.Account
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import com.google.android.gms.auth.api.identity.AuthorizationClient
import com.google.android.gms.auth.api.identity.AuthorizationRequest
import com.google.android.gms.auth.api.identity.AuthorizationResult
import com.google.android.gms.auth.api.identity.ClearTokenRequest
import com.google.android.gms.auth.api.identity.Identity
import com.google.android.gms.common.api.Scope
import com.google.android.gms.tasks.Tasks
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Deferred
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
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
import org.impala67.app.core.ImpalaStore
import org.impala67.app.settings.DevicePrefs
import org.json.JSONObject
import uniffi.impala_ffi.DriveFailure
import uniffi.impala_ffi.DriveProgress
import uniffi.impala_ffi.DriveSync
import uniffi.impala_ffi.DriveTokens
import uniffi.impala_ffi.driveSyncIntervalMs
import java.util.concurrent.TimeUnit

/** Was die Einstellungen über Google Drive zeigen (driveContent in settings-renderer.js). */
data class DriveUi(
    val connected: Boolean = false,
    /** Angemeldet gewesen, Google verlangt aber eine neue Zustimmung. */
    val needsLogin: Boolean = false,
    val running: Boolean = false,
    val progress: String = "",
    val email: String = "",
    /** ISO-Zeit des letzten erfolgreichen Syncs. */
    val lastOk: String? = null,
    /** Letzte Meldung (Fehler oder Ergebnis), sonst leer. */
    val message: String = "",
    /** App-Ordner und Konto in Bytes, sobald bekannt. */
    val appBytes: Double? = null,
    val usedBytes: Double? = null,
    val limitBytes: Double? = null,
)

/** Ergebnis von [DriveController.connect]: verbunden, Fehlermeldung oder Google-Zustimmung nötig. */
sealed interface DriveConnect {
    data object Done : DriveConnect
    data class Error(val message: String) : DriveConnect
    /** Zustimmungsfenster starten und das Ergebnis an [DriveController.completeConsent] geben. */
    data class NeedsConsent(val intent: PendingIntent) : DriveConnect
}

/**
 * Google-Drive-Backup (web/drive.js): Ablauf, Formate und Konflikte im Rust-Kern ([DriveSync]);
 * hier nur Anmeldung (Play-Services-Autorisierung, Bereich `drive.appdata`) und Timer. Anders als im
 * Web erneuert Android das Token still, solange die Zustimmung besteht.
 *
 * Voraussetzung: Ein OAuth-Client „Android“ (Paket `org.impala67.app` + SHA-1 des Signaturschlüssels)
 * im **selben** Google-Cloud-Projekt wie die Web-Client-ID der PWA – nur dann sehen beide denselben
 * App-Ordner in Drive.
 */
class DriveController(
    context: Context,
    private val storeAsync: Deferred<ImpalaStore>,
    private val prefs: DevicePrefs,
    private val scope: CoroutineScope,
) {
    private val auth: AuthorizationClient = Identity.getAuthorizationClient(context.applicationContext)

    /**
     * Mit bekanntem Konto fragt Google nicht erneut nach: Ohne `setAccount` verlangt `authorize()`
     * bei mehreren Google-Konten auf dem Gerät jedes Mal die Kontowahl – die stille Erneuerung
     * scheiterte dann nach jedem App-Neustart, und man musste sich neu anmelden.
     */
    @Volatile private var accountEmail = ""
    private fun request(email: String = accountEmail): AuthorizationRequest = AuthorizationRequest.builder()
        .setRequestedScopes(listOf(Scope(DRIVE_SCOPE)))
        .apply { if (email.isNotEmpty()) setAccount(Account(email, ACCOUNT_TYPE)) }
        .build()

    private val _ui = MutableStateFlow(DriveUi())
    val ui: StateFlow<DriveUi> = _ui

    private val lock = Mutex()
    private var drive: DriveSync? = null
    private var intervalJob: Job? = null
    private var foreground = false

    @Volatile private var token: String? = null
    @Volatile private var tokenAt = 0L

    init {
        scope.launch {
            accountEmail = prefs.driveEmail.first()
            if (prefs.driveConnected.first()) {
                _ui.update { it.copy(email = accountEmail) }
                lock.withLock { ensureDrive() }
                refreshStatus()
            }
        }
    }

    /** App sichtbar: einmal syncen und den Intervall-Timer starten. */
    fun onForeground() {
        foreground = true
        scope.launch {
            if (!prefs.driveConnected.first()) return@launch
            sync()
            startInterval()
        }
    }

    /** Hintergrund: Timer anhalten, eigenes Änderungspaket noch hochladen (Kurzweg). */
    fun onBackground() {
        foreground = false
        intervalJob?.cancel()
        val current = drive ?: return
        scope.launch(Dispatchers.IO) { runCatching { current.flushUpload() } }
    }

    /**
     * „Verbinden“ / „Anmelden“ (bewusster Klick): Zustimmung holen. Braucht Google ein Fenster,
     * kommt [DriveConnect.NeedsConsent] zurück; sonst wird gleich synchronisiert.
     */
    suspend fun connect(): DriveConnect = try {
        // Bewusste Anmeldung: Kontowahl zulassen (anderes Konto möglich).
        val result = withContext(Dispatchers.IO) { Tasks.await(auth.authorize(request(email = "")), AUTH_TIMEOUT_S, TimeUnit.SECONDS) }
        if (result.hasResolution()) DriveConnect.NeedsConsent(result.pendingIntent!!) else finishLogin(result)
    } catch (e: Exception) {
        DriveConnect.Error(e.localizedMessage ?: "Google-Anmeldung fehlgeschlagen.")
    }

    /** Ergebnis des Zustimmungsfensters (`null`: abgebrochen). */
    suspend fun completeConsent(data: Intent?): DriveConnect {
        if (data == null) return DriveConnect.Error("Anmeldung abgebrochen.")
        return try {
            finishLogin(auth.getAuthorizationResultFromIntent(data))
        } catch (e: Exception) {
            DriveConnect.Error(e.localizedMessage ?: "Google-Anmeldung fehlgeschlagen.")
        }
    }

    /** „Abmelden“: Token verwerfen; die Daten auf dem Gerät und in Drive bleiben. */
    suspend fun logout() {
        lock.withLock {
            intervalJob?.cancel()
            drive?.let { it.stop(); it.close() }
            drive = null
            token?.let { t -> withContext(Dispatchers.IO) { runCatching { Tasks.await(auth.clearToken(ClearTokenRequest.builder().setToken(t).build())) } } }
            token = null
        }
        prefs.setDriveConnected(false)
        _ui.value = DriveUi()
    }

    /** „Jetzt synchronisieren“ bzw. ein Timer-Durchgang. Läuft schon einer, passiert nichts. */
    suspend fun sync() {
        val current = lock.withLock { ensureDrive() } ?: return
        if (_ui.value.running) return
        _ui.update { it.copy(running = true, progress = "", message = "") }
        try {
            val report = withContext(Dispatchers.IO) { current.sync(progress) }
            val clock = report.clockWarningMinutes?.let { " · Geräteuhr weicht $it Minuten ab" }.orEmpty()
            val conflicts = if (report.conflicts > 0uL) " · ${report.conflicts} Konflikt(e)" else ""
            _ui.update { it.copy(needsLogin = false, message = report.label + conflicts + clock) }
        } catch (_: DriveFailure.SessionExpired) {
            _ui.update { it.copy(needsLogin = true, message = "Pausiert – zum Weitersichern neu anmelden") }
        } catch (_: DriveFailure.Stopped) {
        } catch (e: DriveFailure.Failed) {
            _ui.update { it.copy(message = if (e.offline) "Offline · wartet" else e.reason) }
        } finally {
            _ui.update { it.copy(running = false, progress = "") }
            refreshStatus()
        }
    }

    // --- intern ---

    private suspend fun finishLogin(result: AuthorizationResult): DriveConnect {
        val t = result.accessToken ?: return DriveConnect.Error("Google hat kein Zugriffstoken geliefert.")
        remember(t)
        val current = lock.withLock { ensureDrive(force = true) }!!
        val email = withContext(Dispatchers.IO) { runCatching { current.accountEmail() }.getOrNull() }.orEmpty()
        // Anderes Konto: sonst gälte alles als schon hochgeladen (siehe `reset_state`).
        val previous = prefs.driveEmail.first()
        if (email.isNotEmpty() && previous.isNotEmpty() && email != previous) withContext(Dispatchers.IO) { current.resetState() }
        prefs.setDriveEmail(email)
        accountEmail = email
        prefs.setDriveConnected(true)
        _ui.update { it.copy(connected = true, needsLogin = false, email = email) }
        scope.launch { sync(); if (foreground) startInterval() }
        return DriveConnect.Done
    }

    private suspend fun ensureDrive(force: Boolean = false): DriveSync? {
        drive?.let { return it }
        if (!force && !prefs.driveConnected.first()) return null
        val store = storeAsync.await()
        return DriveSync(store.core, tokens).also {
            drive = it
            _ui.update { ui -> ui.copy(connected = true) }
        }
    }

    private fun startInterval() {
        intervalJob?.cancel()
        intervalJob = scope.launch {
            while (isActive) {
                delay(intervalMs())
                if (foreground) sync()
            }
        }
    }

    private suspend fun intervalMs(): Long {
        val settings = runCatching { JSONObject(storeAsync.await().write { it.settingsJson() }) }.getOrDefault(JSONObject())
        return driveSyncIntervalMs(settings.opt("driveAutoSyncMinutes")?.toString()).toLong()
    }

    private suspend fun refreshStatus() {
        val current = drive ?: return
        val status = withContext(Dispatchers.IO) { current.status() }
        val storage = withContext(Dispatchers.IO) { runCatching { current.storageInfo() }.getOrNull() }
        _ui.update {
            it.copy(
                lastOk = status.lastOk, running = status.running || it.running,
                appBytes = storage?.appBytes ?: it.appBytes, usedBytes = storage?.usedBytes ?: it.usedBytes,
                limitBytes = storage?.limitBytes ?: it.limitBytes,
            )
        }
    }

    private fun remember(t: String) {
        token = t
        tokenAt = System.currentTimeMillis()
    }

    /** Still (ohne Fenster): gibt es keine bestehende Zustimmung, `null`. Läuft auf dem Drive-Thread. */
    private fun silentToken(): String? = runCatching {
        val result = Tasks.await(auth.authorize(request()), AUTH_TIMEOUT_S, TimeUnit.SECONDS)
        if (result.hasResolution()) null else result.accessToken?.also(::remember)
    }.getOrNull()

    private val tokens = object : DriveTokens {
        override fun accessToken(): String? {
            val t = token
            return if (t != null && System.currentTimeMillis() - tokenAt < TOKEN_MAX_AGE_MS) t else silentToken()
        }

        override fun renewToken(rejected: String): String? {
            runCatching { Tasks.await(auth.clearToken(ClearTokenRequest.builder().setToken(rejected).build()), AUTH_TIMEOUT_S, TimeUnit.SECONDS) }
            token = null
            return silentToken()
        }

        override fun tokenExpired() {
            token = null
            _ui.update { it.copy(needsLogin = true) }
        }
    }

    private val progress = object : DriveProgress {
        override fun onProgress(label: String) {
            _ui.update { it.copy(progress = label) }
        }
    }

    private companion object {
        const val DRIVE_SCOPE = "https://www.googleapis.com/auth/drive.appdata"
        const val ACCOUNT_TYPE = "com.google"
        const val AUTH_TIMEOUT_S = 30L
        /** Google-Tokens gelten eine Stunde; etwas früher still erneuern. */
        const val TOKEN_MAX_AGE_MS = 50 * 60 * 1000L
    }
}
