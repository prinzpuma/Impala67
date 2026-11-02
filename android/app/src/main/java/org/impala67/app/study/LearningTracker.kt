package org.impala67.app.study

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.input.key.onPreviewKeyEvent
import androidx.compose.ui.input.pointer.PointerEventPass
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.navigation3.runtime.NavKey
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import org.impala67.app.core.ImpalaStore
import org.impala67.app.settings.DevicePrefs
import org.impala67.app.ui.shell.AiRoute
import org.impala67.app.ui.shell.ChatRoute
import org.impala67.app.ui.shell.PageRoute
import org.impala67.app.ui.shell.ReviewRoute
import org.impala67.app.ui.theme.Impala
import org.impala67.app.ui.theme.Radius
import org.impala67.app.ui.theme.Space
import org.impala67.app.ui.theme.TextSize
import uniffi.impala_ffi.PageKind
import java.time.Instant
import java.util.UUID

/** Wo gerade gelernt wird (lernzeit.js `categoryNow`): Kategorie und Quelle (Seite, Stapel, Chat). */
data class LearnContext(val category: String, val sourceId: String?)

/**
 * Lernzeit-Erfassung (lernzeit.js): Sitzungen aus aktiven Abschnitten, nur in Chat, Kartenlernen, Heft- und
 * Notizseiten. Nach 60 s ohne Eingabe pausiert sie und fragt „Lernst du noch?“; nach 15 min Pause beginnt
 * eine neue Sitzung. Gespeichert wird wie in der PWA über `learningSessionUpsert`.
 */
class LearningTracker(private val store: ImpalaStore) {
    private class Session(val id: String, val startedAt: String, val ctx: LearnContext) {
        val segments = ArrayList<Pair<String, String>>()
        var activeStart: Instant? = null
        var pausedAt = 0L
    }

    private var current: Session? = null
    var lastActivity = System.currentTimeMillis()
        private set
    /** Seit wann ohne Unterbrechung gelernt wird (für die Pausen-Erinnerung). */
    var continuousSince = 0L
        private set

    fun poke() { lastActivity = System.currentTimeMillis() }

    /** Abschnitt öffnen oder fortsetzen (`openSegment`). */
    suspend fun open(ctx: LearnContext?) {
        if (ctx == null) { pause(); return }
        val now = System.currentTimeMillis()
        val s = current
        if (s != null && s.ctx == ctx) {
            if (s.activeStart != null) return
            if (now - s.pausedAt <= SESSION_GAP_MS) { s.activeStart = Instant.now(); s.pausedAt = 0; if (continuousSince == 0L) continuousSince = now; return }
        }
        if (s != null) pause()
        current = Session(UUID.randomUUID().toString(), Instant.now().toString(), ctx).also { it.activeStart = Instant.now() }
        if (continuousSince == 0L) continuousSince = now
    }

    /** Abschnitt schließen und die Sitzung speichern (`pauseSegment` + `persistCurrent`). */
    suspend fun pause() {
        val s = current ?: return
        val start = s.activeStart ?: return
        s.segments += start.toString() to Instant.now().toString()
        s.activeStart = null
        s.pausedAt = System.currentTimeMillis()
        continuousSince = 0
        persist(s)
    }

    private suspend fun persist(s: Session) {
        val seconds = s.segments.sumOf { (a, b) -> (Instant.parse(b).toEpochMilli() - Instant.parse(a).toEpochMilli()).coerceAtLeast(0) } / 1000
        if (seconds < 1) return
        runCatching {
            store.dispatch(
                "learningSessionUpsert",
                mapOf(
                    "id" to s.id, "startedAt" to s.startedAt, "endedAt" to s.segments.last().second, "durationSeconds" to seconds,
                    "segments" to s.segments.map { (a, b) -> mapOf("startedAt" to a, "endedAt" to b) },
                    "category" to s.ctx.category, "sourceId" to s.ctx.sourceId, "subject" to null, "subjectSource" to null,
                    "updated" to Instant.now().toString(),
                ),
            )
        }
    }

    companion object {
        const val SESSION_GAP_MS = 15 * 60_000L
        const val IDLE_MS = 60_000L
        const val BREAK_MS = 40 * 60_000L
    }
}

/**
 * Hülle um die ganze App: meldet Eingaben an den [LearningTracker], folgt dem aktuellen Ziel, pausiert im
 * Hintergrund und in den Einstellungen ([paused]) und zeigt „Lernst du noch?“ sowie die Pausen-Erinnerung.
 */
@Composable
fun LearningTimeHost(store: ImpalaStore, prefs: DevicePrefs, current: NavKey, paused: Boolean, content: @Composable () -> Unit) {
    val tracker = remember(store) { LearningTracker(store) }
    val record by prefs.telemetry.collectAsStateWithLifecycle(true)
    val breakOn by prefs.breakReminder.collectAsStateWithLifecycle(true)
    var foreground by remember { mutableStateOf(true) }
    var idle by remember { mutableStateOf(false) }
    var breakAsk by remember { mutableStateOf(false) }
    var ctx by remember { mutableStateOf<LearnContext?>(null) }
    val lifecycle = LocalLifecycleOwner.current.lifecycle
    DisposableEffect(lifecycle) {
        val obs = LifecycleEventObserver { _, e ->
            if (e == Lifecycle.Event.ON_START) foreground = true
            if (e == Lifecycle.Event.ON_STOP) foreground = false
        }
        lifecycle.addObserver(obs)
        onDispose { lifecycle.removeObserver(obs) }
    }
    LaunchedEffect(current) {
        ctx = when (current) {
            is ReviewRoute -> LearnContext("cards", current.deck)
            is ChatRoute -> LearnContext("ai", current.id)
            AiRoute -> LearnContext("ai", null)
            is PageRoute -> {
                val kind = runCatching { store.write { it.page(current.id)?.summary?.kind } }.getOrNull()
                if (kind == null) null else LearnContext(if (kind == PageKind.HEFT) "notebook" else "notes", current.id)
            }
            else -> null
        }
    }
    val active = record && foreground && !paused && !idle
    LaunchedEffect(ctx, active) { tracker.open(if (active) ctx else null) }
    // Takt alle 5 s: Leerlauf erkennen, Pausen-Erinnerung nach 40 Minuten am Stück.
    LaunchedEffect(ctx, active, breakOn) {
        while (active && ctx != null) {
            delay(5_000)
            val now = System.currentTimeMillis()
            if (now - tracker.lastActivity > LearningTracker.IDLE_MS) idle = true
            if (breakOn && tracker.continuousSince > 0 && now - tracker.continuousSince > LearningTracker.BREAK_MS) breakAsk = true
        }
    }
    val scope = androidx.compose.runtime.rememberCoroutineScope()
    Box(
        Modifier.fillMaxSize()
            .pointerInput(Unit) {
                awaitPointerEventScope {
                    while (true) {
                        awaitPointerEvent(PointerEventPass.Initial)
                        tracker.poke()
                        if (idle) idle = false
                    }
                }
            }
            .onPreviewKeyEvent { tracker.poke(); if (idle) idle = false; false },
    ) {
        content()
        if (idle && ctx != null) IdleAnimal(Modifier.align(Alignment.BottomCenter)) { tracker.poke(); idle = false }
    }
    if (breakAsk) {
        AlertDialog(
            onDismissRequest = { breakAsk = false },
            title = { Text("Zeit für eine kurze Pause?") },
            text = { Text("Du lernst schon 40 Minuten am Stück. Eine 5-minütige Pause hilft deinem Gehirn, das Gelernte zu festigen.") },
            confirmButton = { TextButton({ breakAsk = false; scope.launch { tracker.pause() } }) { Text("5 Min Pause") } },
            dismissButton = { TextButton({ breakAsk = false; scope.launch { tracker.pause(); tracker.open(ctx) } }) { Text("Weiterlernen") } },
        )
    }
}

/** „Lernst du noch?“ (`#lzAnimal`): Antippen setzt die Lernzeit fort. */
@Composable
private fun IdleAnimal(modifier: Modifier, onResume: () -> Unit) {
    val c = Impala.colors
    Column(
        modifier.safeDrawingPadding().padding(bottom = 90.dp).widthIn(max = 320.dp)
            .background(c.menu, RoundedCornerShape(Radius.lg)).border(1.dp, c.edge, RoundedCornerShape(Radius.lg))
            .clickable(onClick = onResume).padding(Space.s4),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(Space.s1),
    ) {
        androidx.compose.material3.Icon(androidx.compose.ui.res.painterResource(org.impala67.app.R.drawable.ic_i_hand), null, tint = c.accent)
        Text("Lernst du noch?", color = c.text, fontSize = TextSize.base, fontWeight = FontWeight.SemiBold)
        Text("Berühre mich, um die Lernzeit fortzusetzen.", color = c.text2, fontSize = TextSize.xs)
    }
}
