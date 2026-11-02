package org.impala67.app.diag

import android.app.ActivityManager
import android.content.Context
import android.os.Build
import android.os.SystemClock
import android.view.Choreographer
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import org.json.JSONArray
import org.json.JSONObject
import java.time.Instant
import java.util.ArrayDeque

/** Ein Messpunkt (performance-profiler.js): Art, Dauer, Zeitpunkt und kurzer Hinweis. */
data class ProfileEntry(val type: String, val ms: Long, val at: Long, val detail: String, val anomaly: Boolean)

/**
 * Performance-Profiler (web/performance-profiler.js): standardmäßig aus. Gemessen werden Hänger des
 * Hauptthreads (Bildwechsel über 100 ms), der Start bis zum ersten Bild, Aufrufe des Kerns und Fehler.
 * Im Modus „Auffälligkeiten“ bleiben nur Messpunkte über den Schwellen der PWA.
 */
object Profiler {
    private const val MAX = 500
    private const val PREFS = "profiler"
    private val buffer = ArrayDeque<ProfileEntry>()
    @Volatile var enabled = false
        private set
    /** „Alle Messpunkte“ statt nur Auffälligkeiten (Snapshot-Zustand, damit die Einstellung neu zeichnet). */
    var allPoints by mutableStateOf(false)
    private var processStart = SystemClock.elapsedRealtime()
    private var bootDone = false
    private var lastFrame = 0L
    private var app: Context? = null

    private val _count = MutableStateFlow(0 to 0)
    /** (Auffälligkeiten, Messpunkte) für die Zähler-Zeile. */
    val count: StateFlow<Pair<Int, Int>> = _count.asStateFlow()

    private val frame = object : Choreographer.FrameCallback {
        override fun doFrame(nanos: Long) {
            if (!enabled) { lastFrame = 0; return }
            val now = nanos / 1_000_000
            if (lastFrame > 0 && now - lastFrame > LAG_MS) record("main-thread-stall", now - lastFrame, "Bildwechsel")
            lastFrame = now
            Choreographer.getInstance().postFrameCallback(this)
        }
    }

    /** Beim Start der App: Absturzerkennung (`noteUncleanExit`) und Fehler-Haken. */
    fun init(context: Context) {
        app = context.applicationContext
        processStart = SystemClock.elapsedRealtime()
        val sp = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        if (sp.getBoolean("running", false)) record("unclean-exit", 0, "Die App wurde zuletzt nicht sauber beendet.", force = true)
        val previous = Thread.getDefaultUncaughtExceptionHandler()
        Thread.setDefaultUncaughtExceptionHandler { t, e ->
            record("error", 0, (e.javaClass.simpleName + ": " + e.message).take(300), force = true)
            persist()
            previous?.uncaughtException(t, e)
        }
    }

    /** Sichtbar (onStart) bzw. sauber im Hintergrund (onStop). */
    fun setRunning(running: Boolean) {
        app?.getSharedPreferences(PREFS, Context.MODE_PRIVATE)?.edit()?.putBoolean("running", running)?.apply()
        if (!running) persist()
    }

    fun setEnabled(on: Boolean) {
        if (on == enabled) return
        enabled = on
        if (on) Choreographer.getInstance().postFrameCallback(frame)
    }

    /** Erstes Bild der Oberfläche: Startdauer (`boot-ready`). */
    fun bootReady() {
        if (bootDone) return
        bootDone = true
        record("boot-ready", SystemClock.elapsedRealtime() - processStart, "Start bis zum ersten Bild")
    }

    /** Dauer eines Blocks messen, z. B. eines Kern-Aufrufs. */
    inline fun <T> measure(type: String, detail: String = "", block: () -> T): T {
        if (!enabled) return block()
        val t0 = SystemClock.elapsedRealtime()
        try {
            return block()
        } finally {
            record(type, SystemClock.elapsedRealtime() - t0, detail)
        }
    }

    fun record(type: String, ms: Long, detail: String, force: Boolean = false) {
        if (!enabled && !force) return
        val anomaly = force || ms >= threshold(type)
        if (!anomaly && !allPoints) return
        synchronized(buffer) {
            buffer.addLast(ProfileEntry(type, ms, System.currentTimeMillis(), detail, anomaly))
            while (buffer.size > MAX) buffer.removeFirst()
            _count.value = buffer.count { it.anomaly } to buffer.size
        }
    }

    /** Schwellen wie `isNotable` in performance-profiler.js. */
    private fun threshold(type: String): Long = when {
        type == "main-thread-stall" -> 100
        type == "boot-ready" -> 1500
        type == "error" || type == "unclean-exit" -> 0
        type.startsWith("cloudflare") || type.startsWith("drive") || type.startsWith("db") || type.startsWith("core") -> 1200
        type.startsWith("heft") || type.startsWith("editor") || type.startsWith("ui") || type.startsWith("search") || type.startsWith("anki") -> 120
        else -> 200
    }

    fun clear() {
        synchronized(buffer) { buffer.clear(); _count.value = 0 to 0 }
        app?.getSharedPreferences(PREFS, Context.MODE_PRIVATE)?.edit()?.remove("log")?.apply()
    }

    /** Diagnose-Bericht (formatVersion 2) mit Geräte- und Speicherwerten. */
    fun report(version: String): String {
        val ctx = app
        val mem = ActivityManager.MemoryInfo()
        (ctx?.getSystemService(Context.ACTIVITY_SERVICE) as? ActivityManager)?.getMemoryInfo(mem)
        val rt = Runtime.getRuntime()
        val entries = JSONArray()
        synchronized(buffer) {
            buffer.forEach {
                entries.put(JSONObject().put("type", it.type).put("ms", it.ms).put("at", Instant.ofEpochMilli(it.at).toString()).put("detail", it.detail).put("notable", it.anomaly))
            }
        }
        return JSONObject()
            .put("formatVersion", 2)
            .put("createdAt", Instant.now().toString())
            .put("mode", if (allPoints) "all" else "notable")
            .put("app", JSONObject().put("version", version).put("platform", "android"))
            .put(
                "device",
                JSONObject().put("model", Build.MANUFACTURER + " " + Build.MODEL).put("sdk", Build.VERSION.SDK_INT)
                    .put("memoryTotalMb", mem.totalMem / 1_048_576).put("memoryAvailMb", mem.availMem / 1_048_576)
                    .put("heapUsedMb", (rt.totalMemory() - rt.freeMemory()) / 1_048_576).put("heapMaxMb", rt.maxMemory() / 1_048_576),
            )
            .put("entries", entries)
            .toString(2)
    }

    private fun persist() {
        val sp = app?.getSharedPreferences(PREFS, Context.MODE_PRIVATE) ?: return
        val arr = JSONArray()
        synchronized(buffer) { buffer.toList().takeLast(100).forEach { arr.put(JSONObject().put("type", it.type).put("ms", it.ms).put("at", it.at).put("detail", it.detail).put("n", it.anomaly)) } }
        sp.edit().putString("log", arr.toString()).apply()
    }

    /** Gespeicherte Messpunkte der letzten Sitzung zurückholen (überdauern Neustart und Absturz). */
    fun restore() {
        val raw = app?.getSharedPreferences(PREFS, Context.MODE_PRIVATE)?.getString("log", null) ?: return
        runCatching {
            val arr = JSONArray(raw)
            synchronized(buffer) {
                for (i in arr.length() - 1 downTo 0) {
                    val o = arr.getJSONObject(i)
                    buffer.addFirst(ProfileEntry(o.optString("type"), o.optLong("ms"), o.optLong("at"), o.optString("detail"), o.optBoolean("n")))
                }
                _count.value = buffer.count { it.anomaly } to buffer.size
            }
        }
    }

    private const val LAG_MS = 100L
}
