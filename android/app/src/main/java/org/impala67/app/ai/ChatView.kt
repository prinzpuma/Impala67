package org.impala67.app.ai

import android.widget.Toast
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.produceState
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.input.key.Key
import androidx.compose.ui.input.key.KeyEventType
import androidx.compose.ui.input.key.isAltPressed
import androidx.compose.ui.input.key.isShiftPressed
import androidx.compose.ui.input.key.key
import androidx.compose.ui.input.key.onPreviewKeyEvent
import androidx.compose.ui.input.key.type
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import kotlinx.coroutines.launch
import org.impala67.app.R
import org.impala67.app.ui.theme.Impala
import org.impala67.app.ui.theme.Radius
import org.impala67.app.ui.theme.Space
import org.impala67.app.ui.theme.TextSize
import uniffi.impala_ffi.PageKind
import java.time.LocalTime

/**
 * Chatverlauf und Eingabe des KI-Panels (`#chatView` der PWA): Nachrichten, Live-Antwort, Fehler,
 * Begrüßung mit Vorschlägen im leeren Chat, unten der Composer mit Anhang, Modell, Sprache, Senden und Stopp.
 */
@Composable
fun ChatView(
    ai: AiChatViewModel,
    activePageId: String?,
    onOpenSettings: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val messages by ai.messages.collectAsStateWithLifecycle()
    val running by ai.running.collectAsStateWithLifecycle()
    val draft by ai.draft.collectAsStateWithLifecycle()
    val thinking by ai.thinking.collectAsStateWithLifecycle()
    val tool by ai.tool.collectAsStateWithLifecycle()
    val error by ai.error.collectAsStateWithLifecycle()
    val refining by ai.refining.collectAsStateWithLifecycle()
    val attachment by ai.attachment.collectAsStateWithLifecycle()
    val contextOff by ai.contextOff.collectAsStateWithLifecycle()
    val contextSent by ai.contextSent.collectAsStateWithLifecycle()
    val page by produceState<uniffi.impala_ffi.PageSummary?>(null, activePageId) { value = activePageId?.let { ai.pageSummary(it) } }
    var input by rememberSaveable { mutableStateOf("") }
    val listState = rememberLazyListState()
    val lastIndex = messages.size + (if (running) 1 else 0) + (if (error != null) 1 else 0) - 1
    val empty = messages.isEmpty() && !running && error == null

    LaunchedEffect(ai) { ai.notices.collect { Toast.makeText(context, it, Toast.LENGTH_SHORT).show() } }
    LaunchedEffect(messages.size, draft.length, running, error) {
        if (lastIndex >= 0) listState.animateScrollToItem(lastIndex)
    }
    val pick = rememberLauncherForActivityResult(ActivityResultContracts.OpenDocument()) { uri ->
        if (uri != null) scope.launch {
            val a = readAttachment(context, uri)
            if (a == null) ai.notice("Datei konnte nicht gelesen werden.") else ai.attach(a)
        }
    }

    Column(modifier.fillMaxWidth()) {
        if (empty) {
            EmptyChat(Modifier.weight(1f)) { input = it }
        } else {
            LazyColumn(
                Modifier.weight(1f).fillMaxWidth(),
                state = listState,
                contentPadding = PaddingValues(horizontal = Space.s3, vertical = Space.s2),
                verticalArrangement = Arrangement.spacedBy(Space.s3),
            ) {
                itemsIndexed(messages) { _, m -> ChatMessageItem(m, ai, refining, running) { input = it } }
                if (running) item { LiveBlock(thinking, draft, tool) }
                error?.let { e -> item { ErrorBox(e, onOpenSettings) } }
            }
        }
        page?.let { p -> ContextChip(p.title, contextSent?.takeIf { it.pageId == p.id }, p.id in contextOff) { ai.setContextOff(p.id, p.id !in contextOff) } }
        attachment?.let { a -> AttachmentChip(a) { ai.attach(null) } }
        // voice.js: Teilergebnisse live im Feld, das Endergebnis wird gleich gesendet.
        var dictBase by remember { mutableStateOf("") }
        val join = { base: String, spoken: String -> if (base.isBlank()) spoken else base.trim() + " " + spoken }
        val dictation = rememberDictation(
            onPartial = { input = join(dictBase, it) },
            onFinal = { spoken ->
                input = dictBase
                if (spoken.isNotEmpty()) {
                    if (running) {
                        input = join(dictBase, spoken)
                    } else {
                        ai.send(join(dictBase, spoken), activePageId)
                        input = ""
                    }
                }
            },
        )
        val send = {
            ai.send(input, activePageId)
            input = ""
        }
        Composer(
            ai = ai,
            input = input,
            canSend = input.isNotBlank() || attachment != null,
            running = running,
            listening = dictation.listening,
            heftOpen = page?.kind == PageKind.HEFT,
            onMic = {
                if (!dictation.listening) dictBase = input
                dictation.toggle()
            },
            onInput = { next ->
                // Langer eingefügter Text wird Anhang „geklebter-text.txt“ (chat-fullscreen.js:480).
                val inserted = insertedText(input, next)
                if (inserted != null && isLongPaste(inserted)) ai.attach(pastedText(inserted)) else input = next
            },
            onSend = send,
            onStop = ai::stop,
            onFiles = { pick.launch(arrayOf("image/*", "application/pdf", "text/*")) },
            onHeft = { activePageId?.let(ai::attachHeftPage) },
        )
    }
}

/** Was zwischen [old] und [new] dazugekommen ist (gleicher Anfang und gleiches Ende); `null` bei Löschen. */
private fun insertedText(old: String, new: String): String? {
    if (new.length <= old.length) return null
    var start = 0
    while (start < old.length && old[start] == new[start]) start++
    var end = 0
    while (end < old.length - start && old[old.length - 1 - end] == new[new.length - 1 - end]) end++
    return new.substring(start, new.length - end)
}

@Composable
private fun Composer(
    ai: AiChatViewModel,
    input: String,
    canSend: Boolean,
    running: Boolean,
    listening: Boolean,
    heftOpen: Boolean,
    onMic: () -> Unit,
    onInput: (String) -> Unit,
    onSend: () -> Unit,
    onStop: () -> Unit,
    onFiles: () -> Unit,
    onHeft: () -> Unit,
) {
    val c = Impala.colors
    var attachMenu by remember { mutableStateOf(false) }
    var modelMenu by remember { mutableStateOf(false) }
    val choice by ai.models.choice.collectAsStateWithLifecycle()
    Column(
        Modifier.padding(10.dp).fillMaxWidth().clip(RoundedCornerShape(Radius.lg))
            .background(c.surface).border(1.dp, c.edge, RoundedCornerShape(Radius.lg)).padding(Space.s2),
    ) {
        BasicTextField(
            input, onInput,
            Modifier.fillMaxWidth().heightIn(min = 24.dp).padding(Space.s1).onPreviewKeyEvent { e ->
                if (e.type != KeyEventType.KeyDown) return@onPreviewKeyEvent false
                when {
                    // app.js:728: Enter sendet, Shift+Enter macht eine neue Zeile.
                    e.key == Key.Enter && !e.isShiftPressed -> { if (canSend && !running) onSend(); true }
                    // shortcuts.js: Alt+Leertaste startet/stoppt die Spracheingabe.
                    e.key == Key.Spacebar && e.isAltPressed -> { onMic(); true }
                    else -> false
                }
            },
            textStyle = TextStyle(color = c.text, fontSize = TextSize.base),
            cursorBrush = SolidColor(c.accent),
            decorationBox = { inner ->
                if (input.isEmpty()) Text("Frag deinen KI-Coach…", color = c.text2, fontSize = TextSize.base)
                inner()
            },
        )
        Row(Modifier.fillMaxWidth().padding(top = Space.s1), verticalAlignment = Alignment.CenterVertically) {
            Box {
                RoundButton(R.drawable.ic_i_plus, "PDF oder Bild anhängen", Color.Transparent, c.text2, { attachMenu = true })
                AttachMenu(attachMenu, heftOpen, { attachMenu = false }, onFiles, onHeft)
            }
            Spacer(Modifier.size(Space.s1))
            Box {
                Row(
                    Modifier.clip(CircleShape).clickable { modelMenu = true; ai.models.refresh() }
                        .padding(horizontal = Space.s2, vertical = Space.s1),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(Space.s1),
                ) {
                    Icon(painterResource(R.drawable.ic_i_model), "Modell: ${choice?.label.orEmpty()}", Modifier.size(14.dp), tint = c.text2)
                    Text(choice?.label.orEmpty(), color = c.text2, fontSize = TextSize.xs, fontWeight = FontWeight.Medium, maxLines = 1)
                }
                ModelMenu(ai.models, modelMenu) { modelMenu = false }
            }
            Spacer(Modifier.weight(1f))
            RoundButton(
                if (listening) R.drawable.ic_i_stop else R.drawable.ic_i_mic,
                if (listening) "Spracheingabe beenden" else "Spracheingabe starten (Alt+Leertaste)",
                if (listening) c.accent else Color.Transparent, if (listening) c.onAccent else c.text2, onMic,
            )
            Spacer(Modifier.size(Space.s1))
            if (running) {
                RoundButton(R.drawable.ic_i_stop, "Antwort abbrechen", c.surfaceActive, c.text, onStop)
            } else {
                RoundButton(R.drawable.ic_i_arrow_up, "Senden", if (!canSend) c.surfaceActive else c.accent, if (!canSend) c.text2 else c.onAccent, onSend, enabled = canSend)
            }
        }
    }
}

@Composable
private fun RoundButton(icon: Int, label: String, background: Color, tint: Color, onClick: () -> Unit, enabled: Boolean = true) {
    Box(
        Modifier.size(32.dp).clip(CircleShape).background(background).clickable(enabled = enabled, onClick = onClick),
        contentAlignment = Alignment.Center,
    ) { Icon(painterResource(icon), label, Modifier.size(16.dp), tint = tint) }
}

/** Leerzustand (`chatStartHtml` + `chatSuggestsHtml`): Begrüßung und Vorschläge, die nur den Anfang ins Eingabefeld setzen. */
@Composable
private fun EmptyChat(modifier: Modifier, onSuggest: (String) -> Unit) {
    val c = Impala.colors
    val hour = LocalTime.now().hour
    val greeting = if (hour < 5) "Gute Nacht" else if (hour < 11) "Guten Morgen" else if (hour < 18) "Guten Tag" else "Guten Abend"
    Column(modifier.fillMaxWidth().padding(horizontal = Space.s4, vertical = Space.s5), verticalArrangement = Arrangement.spacedBy(Space.s3)) {
        ChatOrb()
        Text("$greeting.", color = c.text, fontSize = TextSize.lg, fontWeight = FontWeight.SemiBold)
        Text("Was möchtest du heute verstehen?", color = c.text, fontSize = TextSize.lg)
        Text(
            "Frag nach deinen Notizen, lass dir etwas erklären oder dich abfragen. Formeln und Code erscheinen sauber gesetzt.",
            color = c.text2, fontSize = TextSize.sm,
        )
        Spacer(Modifier.size(Space.s2))
        SUGGESTS.chunked(2).forEach { pair ->
            Row(horizontalArrangement = Arrangement.spacedBy(Space.s2)) {
                pair.forEach { (icon, title, sub, prompt) ->
                    Column(
                        Modifier.weight(1f).clip(RoundedCornerShape(Radius.md)).border(1.dp, c.edge, RoundedCornerShape(Radius.md))
                            .clickable { onSuggest(prompt) }.padding(Space.s3),
                        verticalArrangement = Arrangement.spacedBy(Space.s1),
                    ) {
                        Icon(painterResource(icon), null, Modifier.size(16.dp), tint = c.accent)
                        Text(title, color = c.text, fontSize = TextSize.sm, fontWeight = FontWeight.SemiBold)
                        Text(sub, color = c.text2, fontSize = TextSize.xs)
                    }
                }
            }
        }
    }
}

private data class Suggest(val icon: Int, val title: String, val sub: String, val prompt: String)

private val SUGGESTS = listOf(
    Suggest(R.drawable.ic_i_bulb, "Erklär's mir", "Schritt für Schritt, bis es klickt", "Erkläre mir Schritt für Schritt: "),
    Suggest(R.drawable.ic_i_cards, "Karteikarten", "Aus einem Thema oder deinen Notizen", "Erstelle Karteikarten zu: "),
    Suggest(R.drawable.ic_i_file, "Zusammenfassen", "Das Wichtigste kompakt auf einen Blick", "Fasse kompakt zusammen: "),
    Suggest(R.drawable.ic_i_target, "Quiz mich", "5 Prüfungsfragen mit Auflösung", "Stell mir 5 Prüfungsfragen zu: "),
)
