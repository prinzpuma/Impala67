package org.impala67.app.settings

import android.content.Context
import android.content.Intent
import android.net.Uri
import android.provider.Settings
import androidx.core.content.FileProvider
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import okhttp3.OkHttpClient
import okhttp3.Request
import org.json.JSONObject
import java.io.File

/**
 * APK-Updates aus GitHub Releases (wie `web/updater.js` für die alte Capacitor-App):
 * nur auf Wunsch prüfen, APK in den Cache laden und den System-Installer öffnen.
 * Lebt app-weit, damit ein Download das Verlassen der Einstellungen übersteht.
 */
object AppUpdater {
    enum class Phase { IDLE, CHECKING, UP_TO_DATE, AVAILABLE, DOWNLOADING, READY, ERROR }

    data class Ui(
        val phase: Phase = Phase.IDLE,
        val latest: String = "",
        /** 0..1, negativ = unbekannte Größe. */
        val progress: Float = -1f,
        val message: String = "",
    )

    private const val LATEST_URL = "https://api.github.com/repos/prinzpuma/Impala67/releases/latest"
    private const val APK_NAME = "Impala67.apk"

    private val http = OkHttpClient()
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private val _ui = MutableStateFlow(Ui())
    val ui: StateFlow<Ui> = _ui
    private var apkUrl = ""
    private var apkSize = -1L
    private var job: Job? = null

    fun check(installed: String) {
        if (job?.isActive == true) return
        _ui.value = Ui(Phase.CHECKING)
        job = scope.launch {
            _ui.value = runCatching {
                val req = Request.Builder().url(LATEST_URL).header("Accept", "application/vnd.github+json").build()
                val json = http.newCall(req).execute().use { res ->
                    if (!res.isSuccessful) error("GitHub antwortet mit ${res.code}")
                    JSONObject(res.body!!.string())
                }
                val latest = json.optString("tag_name").removePrefix("v")
                val assets = json.optJSONArray("assets")
                val apk = (0 until (assets?.length() ?: 0)).map { assets!!.getJSONObject(it) }.firstOrNull { it.optString("name") == APK_NAME }
                when {
                    latest.isEmpty() -> error("Release ohne Versionsnummer")
                    compareVersions(latest, installed) <= 0 -> Ui(Phase.UP_TO_DATE, latest)
                    apk == null -> Ui(Phase.ERROR, latest, message = "v$latest hat noch keine APK – später erneut prüfen")
                    else -> {
                        apkUrl = apk.getString("browser_download_url")
                        apkSize = apk.optLong("size", -1L)
                        Ui(Phase.AVAILABLE, latest)
                    }
                }
            }.getOrElse { Ui(Phase.ERROR, message = "Prüfen fehlgeschlagen: ${it.message ?: it.javaClass.simpleName}") }
        }
    }

    fun download(context: Context) {
        val latest = _ui.value.latest
        if (job?.isActive == true || apkUrl.isEmpty()) return
        val target = apkFile(context)
        _ui.value = Ui(Phase.DOWNLOADING, latest, progress = 0f)
        job = scope.launch {
            _ui.value = runCatching {
                target.parentFile?.mkdirs()
                val part = File(target.path + ".part")
                http.newCall(Request.Builder().url(apkUrl).build()).execute().use { res ->
                    if (!res.isSuccessful) error("Download antwortet mit ${res.code}")
                    val body = res.body!!
                    val total = body.contentLength().takeIf { it > 0 } ?: apkSize
                    body.byteStream().use { input ->
                        part.outputStream().use { out ->
                            val buf = ByteArray(64 * 1024)
                            var done = 0L
                            while (isActive) {
                                val n = input.read(buf)
                                if (n < 0) break
                                out.write(buf, 0, n)
                                done += n
                                if (total > 0) _ui.update { it.copy(progress = done.toFloat() / total) }
                            }
                            ensureActive()
                            if (apkSize > 0 && done != apkSize) error("Download unvollständig")
                        }
                    }
                }
                if (!part.renameTo(target.also { it.delete() })) error("APK konnte nicht gespeichert werden")
                Ui(Phase.READY, latest)
            }.getOrElse {
                if (it is CancellationException) Ui(Phase.AVAILABLE, latest)
                else Ui(Phase.ERROR, latest, message = "Download fehlgeschlagen: ${it.message ?: it.javaClass.simpleName}")
            }
        }
    }

    /** Öffnet den System-Installer – oder zuerst die Freigabe „Unbekannte Apps installieren“. */
    fun install(context: Context) {
        val pm = context.packageManager
        if (!pm.canRequestPackageInstalls()) {
            _ui.update { it.copy(message = "Erlaube Impala67 das Installieren von Apps und tippe dann erneut auf „Installieren“.") }
            context.startActivity(
                Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:${context.packageName}"))
                    .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
            )
            return
        }
        _ui.update { it.copy(message = "") }
        val uri = FileProvider.getUriForFile(context, "${context.packageName}.fileprovider", apkFile(context))
        context.startActivity(
            Intent(Intent.ACTION_VIEW).setDataAndType(uri, "application/vnd.android.package-archive")
                .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_ACTIVITY_NEW_TASK),
        )
    }

    fun cancel() {
        job?.cancel()
    }

    private fun apkFile(context: Context) = File(context.cacheDir, "updates/$APK_NAME")

    /** Vergleicht „2.2.114“-artige Versionen zahlenweise; Anhänge wie „-dev.3“ zählen nicht. */
    internal fun compareVersions(a: String, b: String): Int {
        fun parts(v: String) = v.substringBefore('-').substringBefore('+').split('.').map { it.toIntOrNull() ?: 0 }
        val pa = parts(a)
        val pb = parts(b)
        for (i in 0 until maxOf(pa.size, pb.size)) {
            val d = (pa.getOrElse(i) { 0 }).compareTo(pb.getOrElse(i) { 0 })
            if (d != 0) return d
        }
        return 0
    }
}
