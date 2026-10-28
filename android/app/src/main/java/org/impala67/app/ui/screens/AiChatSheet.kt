package org.impala67.app.ui.screens

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.rounded.Send
import androidx.compose.material.icons.rounded.AutoAwesome
import androidx.compose.material.icons.rounded.Build
import androidx.compose.material.icons.rounded.Close
import androidx.compose.material.icons.rounded.ExpandLess
import androidx.compose.material.icons.rounded.ExpandMore
import androidx.compose.material.icons.rounded.Psychology
import androidx.compose.material.icons.rounded.Stop
import androidx.compose.material.icons.rounded.Undo
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.impala67.app.ui.theme.Accent
import org.impala67.app.ui.theme.AccentSoft
import org.impala67.app.ui.theme.BgBubble
import org.impala67.app.ui.theme.BgDeep
import org.impala67.app.ui.theme.BgPanel
import org.impala67.app.ui.theme.BgSidebar
import org.impala67.app.ui.theme.Danger
import org.impala67.app.ui.theme.DangerSoft
import org.impala67.app.ui.theme.Edge
import org.impala67.app.ui.theme.EdgeSoft
import org.impala67.app.ui.theme.ImpalaPillShape
import org.impala67.app.ui.theme.Success
import org.impala67.app.ui.theme.SurfaceActive
import org.impala67.app.ui.theme.SurfaceHover
import org.impala67.app.ui.theme.SurfaceSubtle
import org.impala67.app.ui.theme.TextMuted
import org.impala67.app.ui.theme.TextPrimary
import org.impala67.app.ui.theme.TextSecondary
import org.impala67.app.ui.theme.Warn
import org.impala67.app.ui.theme.WarnSoft
import uniffi.impala_ffi.AiAssistant
import uniffi.impala_ffi.AiListener
import uniffi.impala_ffi.AiOptions
import uniffi.impala_ffi.AiOutcome
import uniffi.impala_ffi.AiRunRequest
import uniffi.impala_ffi.ChatData
import uniffi.impala_ffi.ChatInfo
import uniffi.impala_ffi.ChatMessage
import uniffi.impala_ffi.ImpalaCore
import java.util.TimeZone

/**
 * KI-Assistent Chat Sheet / Panel mit Live-Streaming, Denkprozess-Anzeige und Rückgängig für Werkzeuge
 */
@Composable
fun AiChatSheet(
    core: ImpalaCore,
    activePageId: String?,
    onClose: () -> Unit,
    modifier: Modifier = Modifier
) {
    val coroutineScope = rememberCoroutineScope()
    var currentChatId by remember { mutableStateOf("") }
    val messages = remember { mutableStateListOf<ChatMessage>() }
    var inputText by remember { mutableStateOf("") }
    var isRunning by remember { mutableStateOf(false) }
    var currentDraft by remember { mutableStateOf("") }
    var currentThinking by remember { mutableStateOf("") }
    var currentTool by remember { mutableStateOf<String?>(null) }
    var activeModel by remember { mutableStateOf("Impala AI") }
    var isModelMenuOpen by remember { mutableStateOf(false) }

    val listState = rememberLazyListState()

    val utcOffsetMinutes = remember {
        val tz = TimeZone.getDefault()
        tz.getOffset(System.currentTimeMillis()) / (1000 * 60)
    }

    // Lädt aktuellen Chat
    fun loadChat(chatId: String) {
        coroutineScope.launch(Dispatchers.IO) {
            try {
                val data = core.chat(chatId)
                withContext(Dispatchers.Main) {
                    messages.clear()
                    if (data != null) {
                        messages.addAll(data.messages)
                    }
                    currentDraft = ""
                    currentThinking = ""
                    currentTool = null
                }
            } catch (e: Exception) {
                // Fehler abfangen
            }
        }
    }

    // Assistent initialisieren
    val assistant = remember {
        val options = AiOptions(
            providersJson = null,
            providerId = null,
            model = null,
            thinkingEnabled = true,
            customInstructions = null,
            alwaysSendTools = true,
            syncKey = null,
            workerUrl = null
        )
        AiAssistant(core, options, null, null)
    }

    DisposableEffect(assistant) {
        onDispose {
            try {
                if (assistant.isRunning()) {
                    assistant.cancel()
                }
                assistant.destroy()
            } catch (e: Exception) {
                // Ignorieren
            }
        }
    }

    fun sendMessage() {
        val text = inputText.trim()
        if (text.isEmpty() || isRunning) return

        inputText = ""
        isRunning = true
        currentDraft = ""
        currentThinking = ""
        currentTool = null

        // Lokale Nutzernachricht einfügen
        val userMsg = ChatMessage(
            mid = null,
            role = "user",
            content = text,
            model = null,
            reasoning = null,
            name = null,
            detail = null,
            error = null,
            summary = null,
            undone = null,
            question = null,
            options = null,
            answered = null,
            answer = null,
            image = null,
            extraJson = "{}"
        )
        messages.add(userMsg)

        val request = AiRunRequest(
            chatId = currentChatId,
            text = text,
            image = null,
            textFile = null,
            pdfFile = null,
            activePageId = activePageId,
            heftPageIndex = null,
            sendPageContext = !activePageId.isNullOrEmpty(),
            anki = null,
            useRag = false,
            utcOffsetMinutes = utcOffsetMinutes
        )

        val listener = object : AiListener {
            override fun onDraft(text: String) {
                coroutineScope.launch(Dispatchers.Main) {
                    currentDraft = text
                }
            }

            override fun onThinking(text: String) {
                coroutineScope.launch(Dispatchers.Main) {
                    currentThinking = text
                }
            }

            override fun onToolStarted(name: String) {
                coroutineScope.launch(Dispatchers.Main) {
                    currentTool = name
                }
            }

            override fun onMessage(message: ChatMessage) {
                coroutineScope.launch(Dispatchers.Main) {
                    messages.add(message)
                }
            }

            override fun onFinished(outcome: AiOutcome) {
                coroutineScope.launch(Dispatchers.Main) {
                    currentChatId = outcome.chatId
                    isRunning = false
                    currentDraft = ""
                    currentThinking = ""
                    currentTool = null
                    loadChat(outcome.chatId)
                }
            }

            override fun onFailed(message: String, aborted: Boolean) {
                coroutineScope.launch(Dispatchers.Main) {
                    isRunning = false
                    currentDraft = ""
                    currentThinking = ""
                    currentTool = null
                    val errorMsg = ChatMessage(
                        mid = null,
                        role = "assistant",
                        content = if (aborted) "Lauf abgebrochen." else "Fehler: $message",
                        model = null,
                        reasoning = null,
                        name = null,
                        detail = null,
                        error = true,
                        summary = null,
                        undone = null,
                        question = null,
                        options = null,
                        answered = null,
                        answer = null,
                        image = null,
                        extraJson = "{}"
                    )
                    messages.add(errorMsg)
                }
            }
        }

        coroutineScope.launch(Dispatchers.IO) {
            try {
                assistant.runAsync(request, listener)
            } catch (e: Exception) {
                withContext(Dispatchers.Main) {
                    isRunning = false
                }
            }
        }
    }

    LaunchedEffect(messages.size, currentDraft, currentThinking) {
        if (messages.isNotEmpty()) {
            listState.animateScrollToItem(messages.size - 1)
        }
    }

    Column(
        modifier = modifier
            .fillMaxSize()
            .background(BgSidebar)
            .imePadding()
            .navigationBarsPadding()
    ) {
        // Kopfzeile: KI-Logo, Modellwahl, Schließen
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 16.dp, vertical = 12.dp),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically
        ) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Icon(
                    imageVector = Icons.Rounded.AutoAwesome,
                    contentDescription = null,
                    tint = Accent,
                    modifier = Modifier.size(20.dp)
                )
                Spacer(modifier = Modifier.width(8.dp))
                Text(
                    text = "Impala KI-Assistent",
                    color = TextPrimary,
                    fontSize = 15.sp,
                    fontWeight = FontWeight.SemiBold
                )
            }

            Row(verticalAlignment = Alignment.CenterVertically) {
                // Modell-Dropdown
                Box {
                    Surface(
                        shape = RoundedCornerShape(8.dp),
                        color = BgBubble,
                        modifier = Modifier
                            .clip(RoundedCornerShape(8.dp))
                            .clickable { isModelMenuOpen = true }
                    ) {
                        Row(
                            modifier = Modifier.padding(horizontal = 8.dp, vertical = 4.dp),
                            verticalAlignment = Alignment.CenterVertically
                        ) {
                            Text(text = activeModel, color = TextSecondary, fontSize = 12.sp)
                            Icon(
                                imageVector = Icons.Rounded.ExpandMore,
                                contentDescription = null,
                                tint = TextMuted,
                                modifier = Modifier.size(14.dp)
                            )
                        }
                    }

                    DropdownMenu(
                        expanded = isModelMenuOpen,
                        onDismissRequest = { isModelMenuOpen = false },
                        modifier = Modifier.background(BgSidebar)
                    ) {
                        val models = listOf("Impala AI", "GPT-4o", "Claude 3.5 Sonnet", "Gemini 1.5 Pro")
                        for (m in models) {
                            DropdownMenuItem(
                                text = { Text(m, color = if (activeModel == m) Accent else TextPrimary) },
                                onClick = {
                                    activeModel = m
                                    isModelMenuOpen = false
                                }
                            )
                        }
                    }
                }

                Spacer(modifier = Modifier.width(8.dp))
                IconButton(onClick = onClose, modifier = Modifier.size(28.dp)) {
                    Icon(
                        imageVector = Icons.Rounded.Close,
                        contentDescription = "Schließen",
                        tint = TextSecondary,
                        modifier = Modifier.size(18.dp)
                    )
                }
            }
        }

        HorizontalDivider(color = EdgeSoft)

        // Chat-Nachrichten
        LazyColumn(
            state = listState,
            modifier = Modifier
                .weight(1f)
                .fillMaxWidth(),
            contentPadding = PaddingValues(16.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp)
        ) {
            if (messages.isEmpty() && currentDraft.isEmpty()) {
                item {
                    Box(
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(top = 40.dp),
                        contentAlignment = Alignment.Center
                    ) {
                        Column(horizontalAlignment = Alignment.CenterHorizontally) {
                            Icon(
                                imageVector = Icons.Rounded.AutoAwesome,
                                contentDescription = null,
                                tint = Accent.copy(alpha = 0.5f),
                                modifier = Modifier.size(48.dp)
                            )
                            Spacer(modifier = Modifier.height(12.dp))
                            Text(
                                text = "Wie kann ich dir bei deinen Notizen helfen?",
                                color = TextSecondary,
                                fontSize = 14.sp
                            )
                            Text(
                                text = "Frage stellen, zusammenfassen oder Karteikarten generieren",
                                color = TextMuted,
                                fontSize = 12.sp
                            )
                        }
                    }
                }
            }

            items(messages) { msg ->
                MessageBubble(
                    message = msg,
                    onUndoEdit = {
                        val mid = msg.mid ?: return@MessageBubble
                        coroutineScope.launch(Dispatchers.IO) {
                            try {
                                core.undoAiChange(currentChatId, mid)
                                loadChat(currentChatId)
                            } catch (e: Exception) {
                                // Ignorieren
                            }
                        }
                    }
                )
            }

            // Live-Denkprozess
            if (currentThinking.isNotEmpty()) {
                item {
                    ThinkingBox(thinkingText = currentThinking)
                }
            }

            // Live-Werkzeugstatus
            if (currentTool != null) {
                item {
                    Surface(
                        shape = ImpalaPillShape,
                        color = BgBubble,
                        border = androidx.compose.foundation.BorderStroke(1.dp, EdgeSoft)
                    ) {
                        Row(
                            modifier = Modifier.padding(horizontal = 10.dp, vertical = 4.dp),
                            verticalAlignment = Alignment.CenterVertically
                        ) {
                            CircularProgressIndicator(
                                modifier = Modifier.size(12.dp),
                                color = Accent,
                                strokeWidth = 1.5.dp
                            )
                            Spacer(modifier = Modifier.width(6.dp))
                            Text(
                                text = "Werkzeug läuft: $currentTool",
                                color = TextSecondary,
                                fontSize = 11.sp
                            )
                        }
                    }
                }
            }

            // Live-Antwortentwurf
            if (currentDraft.isNotEmpty()) {
                item {
                    DraftBubble(draft = currentDraft)
                }
            }
        }

        // Eingabeleiste unten
        HorizontalDivider(color = EdgeSoft)
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(12.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            BasicTextField(
                value = inputText,
                onValueChange = { inputText = it },
                textStyle = TextStyle(color = TextPrimary, fontSize = 14.sp),
                cursorBrush = SolidColor(Accent),
                modifier = Modifier
                    .weight(1f)
                    .background(BgBubble, RoundedCornerShape(12.dp))
                    .padding(horizontal = 14.dp, vertical = 10.dp),
                decorationBox = { innerTextField ->
                    if (inputText.isEmpty()) {
                        Text(
                            text = if (activePageId != null) "Frage zu dieser Seite stellen…" else "Nachricht eingeben…",
                            color = TextMuted,
                            fontSize = 14.sp
                        )
                    }
                    innerTextField()
                }
            )

            Spacer(modifier = Modifier.width(8.dp))

            if (isRunning) {
                IconButton(
                    onClick = {
                        try {
                            assistant.cancel()
                        } catch (e: Exception) {
                            // Ignorieren
                        }
                    },
                    modifier = Modifier
                        .size(40.dp)
                        .clip(CircleShape)
                        .background(DangerSoft)
                ) {
                    Icon(
                        imageVector = Icons.Rounded.Stop,
                        contentDescription = "Abbrechen",
                        tint = Danger,
                        modifier = Modifier.size(20.dp)
                    )
                }
            } else {
                IconButton(
                    onClick = { sendMessage() },
                    modifier = Modifier
                        .size(40.dp)
                        .clip(CircleShape)
                        .background(if (inputText.isNotBlank()) Accent else SurfaceSubtle)
                ) {
                    Icon(
                        imageVector = Icons.AutoMirrored.Rounded.Send,
                        contentDescription = "Senden",
                        tint = if (inputText.isNotBlank()) Color(0xFF081018) else TextMuted,
                        modifier = Modifier.size(18.dp)
                    )
                }
            }
        }
    }
}

@Composable
private fun MessageBubble(
    message: ChatMessage,
    onUndoEdit: () -> Unit
) {
    val isUser = message.role == "user"
    val isEdit = message.role == "edit"
    val isTool = message.role == "tool"

    if (isEdit) {
        // Änderungs-Karte mit Rückgängig
        Surface(
            shape = RoundedCornerShape(12.dp),
            color = BgBubble,
            border = androidx.compose.foundation.BorderStroke(1.dp, Edge),
            modifier = Modifier.fillMaxWidth()
        ) {
            Row(
                modifier = Modifier.padding(12.dp),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically
            ) {
                Column(modifier = Modifier.weight(1f)) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Icon(
                            imageVector = Icons.Rounded.Build,
                            contentDescription = null,
                            tint = Accent,
                            modifier = Modifier.size(14.dp)
                        )
                        Spacer(modifier = Modifier.width(6.dp))
                        Text(
                            text = "KI-Änderung",
                            color = Accent,
                            fontSize = 11.sp,
                            fontWeight = FontWeight.SemiBold
                        )
                    }
                    Spacer(modifier = Modifier.height(4.dp))
                    Text(
                        text = message.summary ?: message.content ?: "Inhalt geändert",
                        color = TextPrimary,
                        fontSize = 13.sp
                    )
                }

                if (message.undone == true) {
                    Text(
                        text = "Rückgängig gemacht",
                        color = TextMuted,
                        fontSize = 11.sp,
                        fontWeight = FontWeight.Medium
                    )
                } else {
                    Surface(
                        shape = RoundedCornerShape(8.dp),
                        color = BgSidebar,
                        border = androidx.compose.foundation.BorderStroke(1.dp, EdgeSoft),
                        modifier = Modifier
                            .clip(RoundedCornerShape(8.dp))
                            .clickable(onClick = onUndoEdit)
                    ) {
                        Row(
                            modifier = Modifier.padding(horizontal = 8.dp, vertical = 4.dp),
                            verticalAlignment = Alignment.CenterVertically
                        ) {
                            Icon(
                                imageVector = Icons.Rounded.Undo,
                                contentDescription = null,
                                tint = Accent,
                                modifier = Modifier.size(14.dp)
                            )
                            Spacer(modifier = Modifier.width(4.dp))
                            Text("Rückgängig", color = Accent, fontSize = 11.sp)
                        }
                    }
                }
            }
        }
    } else {
        // Normale Chat-Bubble
        Box(
            modifier = Modifier.fillMaxWidth(),
            contentAlignment = if (isUser) Alignment.CenterEnd else Alignment.CenterStart
        ) {
            Surface(
                shape = RoundedCornerShape(
                    topStart = 14.dp,
                    topEnd = 14.dp,
                    bottomStart = if (isUser) 14.dp else 4.dp,
                    bottomEnd = if (isUser) 4.dp else 14.dp
                ),
                color = if (isUser) AccentSoft else BgBubble,
                border = androidx.compose.foundation.BorderStroke(1.dp, if (isUser) Accent.copy(alpha = 0.3f) else EdgeSoft),
                modifier = Modifier.widthIn(max = 300.dp)
            ) {
                Column(modifier = Modifier.padding(12.dp)) {
                    Text(
                        text = message.content ?: "",
                        color = TextPrimary,
                        fontSize = 14.sp,
                        lineHeight = 20.sp
                    )
                }
            }
        }
    }
}

@Composable
private fun ThinkingBox(thinkingText: String) {
    var isExpanded by remember { mutableStateOf(false) }

    Surface(
        shape = RoundedCornerShape(10.dp),
        color = BgBubble.copy(alpha = 0.6f),
        border = androidx.compose.foundation.BorderStroke(1.dp, EdgeSoft),
        modifier = Modifier.fillMaxWidth()
    ) {
        Column(modifier = Modifier.padding(10.dp)) {
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .clickable { isExpanded = !isExpanded },
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically
            ) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Icon(
                        imageVector = Icons.Rounded.Psychology,
                        contentDescription = null,
                        tint = Accent,
                        modifier = Modifier.size(16.dp)
                    )
                    Spacer(modifier = Modifier.width(6.dp))
                    Text(
                        text = "Denkprozess…",
                        color = TextSecondary,
                        fontSize = 12.sp,
                        fontWeight = FontWeight.Medium
                    )
                }
                Icon(
                    imageVector = if (isExpanded) Icons.Rounded.ExpandLess else Icons.Rounded.ExpandMore,
                    contentDescription = null,
                    tint = TextMuted,
                    modifier = Modifier.size(16.dp)
                )
            }

            AnimatedVisibility(visible = isExpanded) {
                Column {
                    Spacer(modifier = Modifier.height(6.dp))
                    Text(
                        text = thinkingText,
                        color = TextMuted,
                        fontSize = 12.sp,
                        lineHeight = 16.sp
                    )
                }
            }
        }
    }
}

@Composable
private fun DraftBubble(draft: String) {
    Box(
        modifier = Modifier.fillMaxWidth(),
        contentAlignment = Alignment.CenterStart
    ) {
        Surface(
            shape = RoundedCornerShape(14.dp),
            color = BgBubble,
            border = androidx.compose.foundation.BorderStroke(1.dp, EdgeSoft),
            modifier = Modifier.widthIn(max = 300.dp)
        ) {
            Column(modifier = Modifier.padding(12.dp)) {
                Text(
                    text = draft,
                    color = TextPrimary,
                    fontSize = 14.sp,
                    lineHeight = 20.sp
                )
            }
        }
    }
}

private fun Modifier.widthIn(max: androidx.compose.ui.unit.Dp): Modifier {
    return this.fillMaxWidth(0.85f)
}
