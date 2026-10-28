package org.impala67.app.data

import android.content.Context
import android.util.Log
import androidx.work.Constraints
import androidx.work.CoroutineWorker
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.ExistingWorkPolicy
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.util.concurrent.TimeUnit

/**
 * Hintergrund-Worker für automatische periodische und einmalige Synchronisation via WorkManager.
 */
class SyncWorker(
    appContext: Context,
    params: WorkerParameters
) : CoroutineWorker(appContext, params) {

    companion object {
        private const val TAG = "SyncWorker"
        private const val PERIODIC_WORK_NAME = "impala67_periodic_sync"
        private const val IMMEDIATE_WORK_NAME = "impala67_immediate_sync"

        /**
         * Plant den periodischen Hintergrund-Sync alle 15 Minuten bei bestehender Netzwerkverbindung.
         */
        fun enqueuePeriodic(context: Context) {
            val constraints = Constraints.Builder()
                .setRequiredNetworkType(NetworkType.CONNECTED)
                .build()

            val workRequest = PeriodicWorkRequestBuilder<SyncWorker>(15, TimeUnit.MINUTES)
                .setConstraints(constraints)
                .build()

            WorkManager.getInstance(context).enqueueUniquePeriodicWork(
                PERIODIC_WORK_NAME,
                ExistingPeriodicWorkPolicy.KEEP,
                workRequest
            )
            Log.d(TAG, "Periodischer Sync-WorkRequest eingereiht (15 Min Intervall)")
        }

        /**
         * Löst sofort einen Hintergrund-Sync-Durchgang aus.
         */
        fun enqueueImmediate(context: Context) {
            val constraints = Constraints.Builder()
                .setRequiredNetworkType(NetworkType.CONNECTED)
                .build()

            val workRequest = OneTimeWorkRequestBuilder<SyncWorker>()
                .setConstraints(constraints)
                .build()

            WorkManager.getInstance(context).enqueueUniqueWork(
                IMMEDIATE_WORK_NAME,
                ExistingWorkPolicy.REPLACE,
                workRequest
            )
            Log.d(TAG, "Einmaliger Sofort-Sync eingereiht")
        }
    }

    override suspend fun doWork(): Result = withContext(Dispatchers.IO) {
        Log.i(TAG, "Hintergrund-Sync Durchlauf gestartet...")
        try {
            val repo = ImpalaRepository.getInstance(applicationContext)
            val syncSuccess = repo.syncManager.runBackgroundSyncPass()

            // Nach dem Sync Checkpoint schreiben, um den DB-Zustand zu sichern
            try {
                repo.core.saveCheckpoint()
            } catch (e: Exception) {
                Log.w(TAG, "saveCheckpoint nach Hintergrund-Sync fehlgeschlagen", e)
            }

            if (syncSuccess) {
                Log.i(TAG, "Hintergrund-Sync erfolgreich abgeschlossen")
                Result.success()
            } else {
                Log.w(TAG, "Hintergrund-Sync hatte Teilausfälle, versuche erneut")
                Result.retry()
            }
        } catch (e: Exception) {
            Log.e(TAG, "Fehler im SyncWorker", e)
            Result.retry()
        }
    }
}
