package org.impala67.app.sync

import android.Manifest
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import androidx.work.Constraints
import androidx.work.CoroutineWorker
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.NetworkType
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import java.time.Duration
import java.time.LocalDateTime
import java.util.TimeZone
import java.util.concurrent.TimeUnit
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.impala67.app.ImpalaApp
import org.impala67.app.MainActivity
import org.impala67.app.R

/**
 * Arbeit, solange die App geschlossen ist (WorkManager): stündlich ein Cloudflare-Durchgang und
 * täglich um 18 Uhr die Erinnerung an fällige Karteikarten (wie `scheduleSRSReview` der alten App).
 */
object BackgroundWork {
    private const val SYNC = "impala67-sync"
    private const val REMINDER = "impala67-cards-reminder"
    private const val REMINDER_HOUR = 18

    fun schedule(context: Context) {
        val wm = WorkManager.getInstance(context)
        val online = Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build()
        wm.enqueueUniquePeriodicWork(
            SYNC, ExistingPeriodicWorkPolicy.KEEP,
            PeriodicWorkRequestBuilder<BackgroundSyncWorker>(1, TimeUnit.HOURS).setConstraints(online).build(),
        )
        wm.enqueueUniquePeriodicWork(
            REMINDER, ExistingPeriodicWorkPolicy.KEEP,
            PeriodicWorkRequestBuilder<CardsReminderWorker>(1, TimeUnit.DAYS)
                .setInitialDelay(untilNext(REMINDER_HOUR).toMinutes(), TimeUnit.MINUTES).build(),
        )
    }

    private fun untilNext(hour: Int): Duration {
        val now = LocalDateTime.now()
        var at = now.withHour(hour).withMinute(0).withSecond(0).withNano(0)
        if (!at.isAfter(now)) at = at.plusDays(1)
        return Duration.between(now, at)
    }
}

/** Ein Sync-Durchgang ohne offene App; danach Start-Schnappschuss wie in `MainActivity.onStop`. */
class BackgroundSyncWorker(context: Context, params: WorkerParameters) : CoroutineWorker(context, params) {
    override suspend fun doWork(): Result {
        val app = applicationContext as ImpalaApp
        val ok = app.cloudSync.backgroundPass()
        withContext(Dispatchers.IO) { runCatching { app.store.await().core.saveCheckpoint() } }
        return if (ok) Result.success() else Result.retry()
    }
}

/** Benachrichtigung „Karteikarten fällig“; ein Tipp öffnet das Lernen. */
class CardsReminderWorker(context: Context, params: WorkerParameters) : CoroutineWorker(context, params) {
    override suspend fun doWork(): Result {
        val app = applicationContext as ImpalaApp
        val due = app.store.await().write { core ->
            val q = core.studyQueue(null, TimeZone.getDefault().getOffset(System.currentTimeMillis()) / 60_000, false)
            (q.new + q.review + q.learn).toInt()
        }
        if (due > 0) notify(due)
        return Result.success()
    }

    private fun notify(due: Int) {
        val ctx = applicationContext
        if (Build.VERSION.SDK_INT >= 33 &&
            ContextCompat.checkSelfPermission(ctx, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED
        ) return
        val nm = ctx.getSystemService(NotificationManager::class.java)
        nm.createNotificationChannel(NotificationChannel(CHANNEL, "Lern-Erinnerung", NotificationManager.IMPORTANCE_DEFAULT))
        val open = PendingIntent.getActivity(
            ctx, 0,
            Intent(ctx, MainActivity::class.java).setAction("org.impala67.app.ACTION_STUDY_CARDS").addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
        )
        val note = NotificationCompat.Builder(ctx, CHANNEL)
            .setSmallIcon(R.drawable.ic_i_cards)
            .setContentTitle("Impala67 – Karteikarten fällig")
            .setContentText("Du hast $due Karteikarte${if (due == 1) "" else "n"} zur Wiederholung bereit.")
            .setContentIntent(open)
            // Zahl am App-Symbol (app-badge.js): Android zeigt sie über die Benachrichtigung an.
            .setNumber(due)
            .setBadgeIconType(NotificationCompat.BADGE_ICON_SMALL)
            .setAutoCancel(true)
            .build()
        runCatching { NotificationManagerCompat.from(ctx).notify(NOTIFICATION_ID, note) }
    }

    private companion object {
        const val CHANNEL = "cards-due"
        const val NOTIFICATION_ID = 1067
    }
}
