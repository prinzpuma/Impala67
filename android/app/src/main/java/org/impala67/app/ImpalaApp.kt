package org.impala67.app

import android.app.Activity
import android.app.Application
import android.os.Bundle
import android.util.Log
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch
import org.impala67.app.data.ImpalaRepository
import org.impala67.app.data.SyncWorker

/**
 * Einstiegspunkt der nativen Android-App Impala67.
 * Initialisiert das Kern-Repository, startet den periodischen Hintergrund-Sync
 * und sichert den Datenbankzustand per Checkpoint beim Wechsel in den Hintergrund.
 */
class ImpalaApp : Application() {

    companion object {
        private const val TAG = "ImpalaApp"
    }

    private val appScope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private var startedActivities = 0

    lateinit var repository: ImpalaRepository
        private set

    override fun onCreate() {
        super.onCreate()
        Log.i(TAG, "Impala67 App startet...")

        // 1. Zentrales Repository mit Rust-Kern und Sync initialisieren
        repository = ImpalaRepository.getInstance(this)

        // 2. Periodischen Hintergrund-Sync über WorkManager registrieren
        SyncWorker.enqueuePeriodic(this)

        // 3. Lebenszyklus überwachen, um Checkpoints beim Verlassen der App zu schreiben
        setupLifecycleTracking()
    }

    override fun onTrimMemory(level: Int) {
        super.onTrimMemory(level)
        if (level >= TRIM_MEMORY_UI_HIDDEN) {
            Log.d(TAG, "onTrimMemory UI_HIDDEN: speichere Checkpoint")
            saveCheckpointAsync()
        }
    }

    private fun setupLifecycleTracking() {
        registerActivityLifecycleCallbacks(object : ActivityLifecycleCallbacks {
            override fun onActivityCreated(activity: Activity, savedInstanceState: Bundle?) {}

            override fun onActivityStarted(activity: Activity) {
                startedActivities++
            }

            override fun onActivityResumed(activity: Activity) {}

            override fun onActivityPaused(activity: Activity) {}

            override fun onActivityStopped(activity: Activity) {
                startedActivities--
                if (startedActivities <= 0) {
                    startedActivities = 0
                    Log.d(TAG, "App wechselt in den Hintergrund: speichere Checkpoint")
                    saveCheckpointAsync()
                }
            }

            override fun onActivitySaveInstanceState(activity: Activity, outState: Bundle) {}

            override fun onActivityDestroyed(activity: Activity) {}
        })
    }

    private fun saveCheckpointAsync() {
        appScope.launch {
            try {
                repository.core.saveCheckpoint()
            } catch (e: Exception) {
                Log.w(TAG, "saveCheckpoint im Hintergrund fehlgeschlagen", e)
            }
        }
    }
}
