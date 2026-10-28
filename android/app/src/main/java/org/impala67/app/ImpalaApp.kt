package org.impala67.app

import android.app.Application
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Deferred
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.async
import org.impala67.app.core.ImpalaStore
import org.impala67.app.settings.DevicePrefs
import uniffi.impala_ffi.ImpalaCore
import java.io.File

/** Hält den einen Kern der App. Das Öffnen (Checkpoint + Log abspielen) läuft im Hintergrund. */
class ImpalaApp : Application() {
    val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)

    lateinit var store: Deferred<ImpalaStore>
        private set

    val prefs by lazy { DevicePrefs(this) }

    override fun onCreate() {
        super.onCreate()
        store = scope.async(Dispatchers.IO) {
            val db = File(filesDir, "impala67.sqlite")
            ImpalaStore(ImpalaCore.open(db.absolutePath), scope)
        }
    }
}
