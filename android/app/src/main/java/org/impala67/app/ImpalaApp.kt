package org.impala67.app

import android.app.Application
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Deferred
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.async
import org.impala67.app.core.ImpalaStore
import org.impala67.app.settings.DevicePrefs
import org.impala67.app.sync.CloudSyncController
import org.impala67.app.sync.DriveController
import uniffi.impala_ffi.ImpalaCore
import java.io.File

/** Hält den einen Kern der App. Das Öffnen (Checkpoint + Log abspielen) läuft im Hintergrund. */
class ImpalaApp : Application() {
    val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)

    lateinit var store: Deferred<ImpalaStore>
        private set

    val prefs by lazy { DevicePrefs(this) }

    /** Cloudflare Live-Sync; verbindet erst mit [MainActivity] im Vordergrund. */
    val cloudSync by lazy { CloudSyncController(store, prefs, scope) }

    /** Google-Drive-Backup; Timer laufen nur, solange die App sichtbar ist. */
    val drive by lazy { DriveController(this, store, prefs, scope) }

    override fun onCreate() {
        super.onCreate()
        store = scope.async(Dispatchers.IO) {
            // Derselbe Dateiname wie in der vorigen App-Version, damit vorhandene Daten erhalten bleiben.
            val db = File(filesDir, "impala67.db")
            ImpalaStore(ImpalaCore.open(db.absolutePath), scope)
        }
    }
}
