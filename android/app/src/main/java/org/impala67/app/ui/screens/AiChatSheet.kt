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
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.rounded.Send
import androidx.compose.material.icons.rounded.Add
import androidx.compose.material.icons.rounded.AutoAwesome
import androidx.compose.material.icons.rounded.Build
import androidx.compose.material.icons.rounded.Close
import androidx.compose.material.icons.rounded.Delete
import androidx.compose.material.icons.rounded.ExpandLess
import androidx.compose.material.icons.rounded.ExpandMore
import androidx.compose.material.icons.rounded.History
import androidx.compose.material.icons.rounded.OpenInNew
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
import org.impala67.app.ui.theme.AccentBlue
import org.impala67.app.ui.theme.AccentBlueSoft
import org.impala67.app.ui.theme.AccentSoft
import org.impala67.app.ui.theme.BgBubble
import org.impala67.app.ui.theme.BgCard
import org.impala67.app.ui.theme.BgDeep
import org.impala67.app.ui.theme.BgElevated
import org.impala67.app.ui.theme.BgPanel
import org.impala67.app.ui.theme.BgSidebar
import org.impala67.app.ui.theme.BorderHairline
import org.impala67.app.ui.theme.BorderStrong
import org.impala67.app.ui.theme.Danger
import org.impala67.app.ui.theme.DangerRed
import org.impala67.app.ui.theme.DangerSoft
import org.impala67.app.ui.theme.Edge
import org.impala67.app.ui.theme.EdgeSoft
import org.impala67.app.ui.theme.ImpalaPillShape
import org.impala67.app.ui.theme.Success
import org.impala67.app.ui.theme.SuccessGreen
import org.impala67.app.ui.theme.SurfaceActive
import org.impala67.app.ui.theme.SurfaceHover
import org.impala67.app.ui.theme.SurfaceSubtle
import org.impala67.app.ui.theme.TextLight
import org.impala67.app.ui.theme.TextMain
import org.impala67.app.ui.theme.TextMuted
import org.impala67.app.ui.theme.TextPrimary
import org.impala67.app.ui.theme.TextSecondary
import org.impala67.app.ui.theme.Warn
import org.impala67.app.ui.theme.WarnSoft
import org.impala67.app.ui.theme.WarningAmber
import uniffi.impala_ffi.AiAssistant
import uniffi.impala_ffi.AiListener
import uniffi.impala_ffi.AiOptions
import uniffi.impala_ffi.AiOutcome
import uniffi.impala_ffi.AiRunRequest
import uniffi.impala_ffi.ChatData
import uniffi.impala_ffi.ChatInfo
import uniffi.impala_ffi.ChatMessage
import uniffi.impala_ffi.ChatSummary
import uniffi.impala_ffi.ImpalaCore
import java.util.TimeZone

/**
 * KI-Assistent & Coach Panel/Sheet (nach PWA `#panel` in `web/index.html` & `web/ai.js`)
 * mit Live-Streaming, Verlauf-Umschalter, Seiten-Kontext-Pill, Denkprozess-Box und Tool-Rückgängig.
 */
@Composable
fun AiChatSheet(
    core: ImpalaCore,
    currentPageId: String? = null,
    onDismiss: () -> Unit = {},
    onMutation: () -> Unit = {},
    isSidePanel: Boolean = false,
    initialChatId: String? = null,
    initialPrompt: String? = null,
    onExpandToFullTab: (() -> Unit)? = null,
    modifier: Modifier = Modifier
) {
    val coroutineScope = rememberCoroutineScope()
    var currentChatId by remember { mutableStateOf(initialChatId ?: "") }
    val messages = remember { mutableStateListOf<ChatMessage>() }
    var inputText by remember { mutableStateOf(initialPrompt ?: "") }
    var isRunning by remember { mutableStateOf(false) }
    var currentDraft by remember { mutableStateOf("") }
    var currentThinking by remember { mutableStateOf("") }
    var currentTool by remember { mutableStateOf<String?>(null) }
    var activeModel by remember { mutableStateOf("Gemini 2.5 Flash") }
    var isModelMenuOpen by remember { mutableStateOf(false) }
    var isHistoryMenuOpen by remember { mutableStateOf(false) }
    var savedChats by remember { mutableStateOf<List<ChatSummary>>(emptyList()) }

    var attachedPageId by remember { mutableStateOf<String?>(currentPageId) }
    var attachedPageTitle by remember { mutableStateOf<String?>(null) }

    val listState = rememberLazyListState()

    val utcOffsetMinutes = remember {
        val tz = TimeZone.getDefault()
        tz.getOffset(System.currentTimeMillis()) / (1000 * 60)
    }

    // Lädt Seitentitel für den Kontext
    LaunchedEffect(attachedPageId) {
        val pId = attachedPageId
        if (pId != null) {
            withContext(Dispatchers.IO) {
                val detail = try { core.page(pId) } catch (_: Exception) { null }
                withContext(Dispatchers.Main) {
                    attachedPageTitle = detail?.summary?.title?.ifBlank { "Aktuelle Seite" } ?: "Notiz"
                }
            }
        } else {
            attachedPageTitle = null
        }
    }

    // Lädt Chats-Historie
    fun loadChatList() {
        coroutineScope.launch(Dispatchers.IO) {
            val list = try { core.chats() } catch (_: Exception) { emptyList() }
            withContext(Dispatchers.Main) {
                savedChats = list
                if (currentChatId.isBlank() && list.isNotEmpty()) {
                    currentChatId = list.first().id
                }
            }
        }
    }

    // Lädt gewählten Chat
    fun loadChat(chatId: String) {
        if (chatId.isBlank()) return
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
            } catch (_: Exception) {}
        }
    }

    LaunchedEffect(Unit) {
        loadChatList()
        if (currentChatId.isNotBlank()) {
            loadChat(currentChatId)
        }
    }

    LaunchedEffect(currentChatId) {
        if (currentChatId.isNotBlank()) {
            loadChat(currentChatId)
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
            } catch (_: Exception) {}
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

        coroutineScope.launch(Dispatchers.IO) {
            if (currentChatId.isBlank()) {
                val firstWord = text.take(24)
                val newId = try { core.createChat(firstWord) } catch (_: Exception) { "" }
                withContext(Dispatchers.Main) {
                    currentChatId = newId
                    loadChatList()
                }
            }

            val request = AiRunRequest(
                chatId = currentChatId,
                userPrompt = text,
                pageId = attachedPageId,
                clientUtcOffsetMinutes = utcOffsetMinutes,
                imageUrls = emptyList(),
                imageFiles = emptyList()
            )

            assistant.runAsync(request, object : AiListener {
                override fun onDelta(text: String) {
                    coroutineScope.launch(Dispatchers.Main) {
                        currentDraft += text
                    }
                }

                override fun onThought(text: String) {
                    coroutineScope.launch(Dispatchers.Main) {
                        currentThinking += text
                    }
                }

                override fun onToolCall(name: String, argsJson: String) {
                    coroutineScope.launch(Dispatchers.Main) {
                        currentTool = "Führe aus: $name..."
                    }
                }

                override fun onToolResult(name: String, resultJson: String) {
                    coroutineScope.launch(Dispatchers.Main) {
                        currentTool = "Fertig: $name"
                        onMutation()
                    }
                }

                override fun onDone(outcome: AiOutcome) {
                    coroutineScope.launch(Dispatchers.Main) {
                        isRunning = false
                        currentTool = null
                        currentDraft = ""
                        currentThinking = ""
                        loadChat(currentChatId)
                        onMutation()
                    }
                }

                override fun onError(error: String) {
                    coroutineScope.launch(Dispatchers.Main) {
                        isRunning = false
                        currentTool = null
                        currentDraft += "\n[Fehler: $error]"
                    }
                }
            })
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
            .background(if (isSidePanel) BgPanel else BgSidebar)
            .then(if (!isSidePanel) Modifier.statusBarsPadding() else Modifier)
            .border(
                width = if (isSidePanel) 1.dp else 0.dp,
                color = if (isSidePanel) BorderHairline else Color.Transparent
            )
            .imePadding()
            .navigationBarsPadding()
    ) {
        // ====================================================================
        // PWA `.panel-head` Kopfzeile
        // ====================================================================
        Surface(
            color = BgSidebar,
            modifier = Modifier.fillMaxWidth()
        ) {
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .height(48.dp)
                    .padding(horizontal = 14.dp),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically
            ) {
                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(8.dp)
                ) {
                    // Status-Dot
                    Box(
                        modifier = Modifier
                            .size(8.dp)
                            .clip(CircleShape)
                            .background(if (isRunning) AccentBlue else SuccessGreen)
                    )

                    Text(
                        text = "KI-Coach",
                        color = TextMain,
                        fontSize = 14.sp,
                        fontWeight = FontWeight.Bold
                    )

                    // Modell-Auswahl Chip
                    Box {
                        Surface(
                            shape = RoundedCornerShape(6.dp),
                            color = BgBubble,
                            modifier = Modifier.clickable { isModelMenuOpen = true }
                        ) {
                            Row(
                                modifier = Modifier.padding(horizontal = 6.dp, vertical = 3.dp),
                                verticalAlignment = Alignment.CenterVertically,
                                horizontalArrangement = Arrangement.spacedBy(2.dp)
                            ) {
                                Text(text = activeModel, color = TextSecondary, fontSize = 11.sp)
                                Icon(
                                    imageVector = Icons.Rounded.ExpandMore,
                                    contentDescription = null,
                                    tint = TextMuted,
                                    modifier = Modifier.size(12.dp)
                                )
                            }
                        }

                        DropdownMenu(
                            expanded = isModelMenuOpen,
                            onDismissRequest = { isModelMenuOpen = false }
                        ) {
                            listOf("Gemini 2.5 Flash", "Gemini 2.5 Pro", "Claude 3.5 Sonnet", "GPT-4o").forEach { m ->
                                DropdownMenuItem(
                                    text = { Text(m, color = if (activeModel == m) AccentBlue else TextMain) },
                                    onClick = {
                                        activeModel = m
                                        isModelMenuOpen = false
                                    }
                                )
                            }
                        }
                    }
                }

                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(4.dp)
                ) {
                    // Verlauf
                    Box {
                        IconButton(
                            onClick = {
                                loadChatList()
                                isHistoryMenuOpen = true
                            },
                            modifier = Modifier.size(30.dp)
                        ) {
                            Icon(
                                imageVector = Icons.Rounded.History,
                                contentDescription = "Verlauf",
                                tint = TextSecondary,
                                modifier = Modifier.size(17.dp)
                            )
                        }

                        DropdownMenu(
                            expanded = isHistoryMenuOpen,
                            onDismissRequest = { isHistoryMenuOpen = false }
                        ) {
                            if (savedChats.isEmpty()) {
                                DropdownMenuItem(
                                    text = { Text("Keine gespeicherten Chats", color = TextMuted) },
                                    onClick = {}
                                )
                            } else {
                                savedChats.take(10).forEach { chat ->
                                    DropdownMenuItem(
                                        text = {
                                            Text(
                                                text = chat.title.ifBlank { "Ohne Titel" },
                                                color = if (chat.id == currentChatId) AccentBlue else TextMain,
                                                maxLines = 1,
                                                overflow = TextOverflow.Ellipsis
                                            )
                                        },
                                        onClick = {
                                            isHistoryMenuOpen = false
                                            currentChatId = chat.id
                                            loadChat(chat.id)
                                        }
                                    )
                                }
                            }
                        }
                    }

                    // Neuer Chat
                    IconButton(
                        onClick = {
                            coroutineScope.launch(Dispatchers.IO) {
                                val newId = try { core.createChat("Neuer Chat") } catch (_: Exception) { "" }
                                withContext(Dispatchers.Main) {
                                    currentChatId = newId
                                    messages.clear()
                                    currentDraft = ""
                                    currentThinking = ""
                                    loadChatList()
                                }
                            }
                        },
                        modifier = Modifier.size(30.dp)
                    ) {
                        Icon(
                            imageVector = Icons.Rounded.Add,
                            contentDescription = "Neuer Chat",
                            tint = TextSecondary,
                            modifier = Modifier.size(17.dp)
                        )
                    }

                    // Expand to full tab (falls unterstützt)
                    if (onExpandToFullTab != null && isSidePanel) {
                        IconButton(
                            onClick = onExpandToFullTab,
                            modifier = Modifier.size(30.dp)
                        ) {
                            Icon(
                                imageVector = Icons.Rounded.OpenInNew,
                                contentDescription = "In großem Tab öffnen",
                                tint = TextSecondary,
                                modifier = Modifier.size(16.dp)
                            )
                        }
                    }

                    // Schließen / Einklappen
                    IconButton(onClick = onDismiss, modifier = Modifier.size(30.dp)) {
                        Icon(
                            imageVector = Icons.Rounded.Close,
                            contentDescription = "Schließen",
                            tint = TextSecondary,
                            modifier = Modifier.size(17.dp)
                        )
                    }
                }
            }
            HorizontalDivider(color = BorderHairline, thickness = 1.dp)
        }

        // ====================================================================
        // Chat-Log (#chatLog)
        // ====================================================================
        LazyColumn(
            state = listState,
            modifier = Modifier
                .weight(1f)
                .fillMaxWidth(),
            contentPadding = PaddingValues(14.dp),
            verticalArrangement = Arrangement.spacedBy(10.dp)
        ) {
            if (messages.isEmpty() && currentDraft.isEmpty()) {
                item {
                    Column(
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(vertical = 24.dp),
                        horizontalAlignment = Alignment.CenterHorizontally,
                        verticalArrangement = Arrangement.spacedBy(12.dp)
                    ) {
                        Icon(
                            imageVector = Icons.Rounded.AutoAwesome,
                            contentDescription = null,
                            tint = AccentBlue.copy(alpha = 0.6f),
                            modifier = Modifier.size(40.dp)
                        )
                        Text(
                            text = "Wie kann ich dir helfen?",
                            color = TextMain,
                            fontSize = 15.sp,
                            fontWeight = FontWeight.SemiBold
                        )

                        // Schnelle Aktions-Chips
                        listOf(
                            "✨ Diese Seite zusammenfassen",
                            "🃏 Karteikarten aus der Notiz erstellen",
                            "🧠 Erkläre mir das Thema nach Feynman",
                            "❓ Prüfungsfragen zu meinen Notizen"
                        ).forEach { prompt ->
                            Surface(
                                shape = RoundedCornerShape(10.dp),
                                color = BgBubble,
                                border = androidx.compose.foundation.BorderStroke(1.dp, BorderHairline),
                                modifier = Modifier
                                    .fillMaxWidth(0.9f)
                                    .clickable {
                                        inputText = prompt
                                        sendMessage()
                                    }
                            ) {
                                Text(
                                    text = prompt,
                                    color = TextSecondary,
                                    fontSize = 12.sp,
                                    modifier = Modifier.padding(horizontal = 12.dp, vertical = 8.dp)
                                )
                            }
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
                                onMutation()
                            } catch (_: Exception) {}
                        }
                    }
                )
            }

            // Live-Denkprozess Box
            if (currentThinking.isNotEmpty()) {
                item {
                    ThinkingBox(thinkingText = currentThinking)
                }
            }

            // Werkzeug-Ausführung
            if (currentTool != null) {
                item {
                    Surface(
                        shape = RoundedCornerShape(8.dp),
                        color = BgBubble,
                        border = androidx.compose.foundation.BorderStroke(1.dp, AccentBlueSoft),
                        modifier = Modifier.fillMaxWidth()
                    ) {
                        Row(
                            modifier = Modifier.padding(horizontal = 10.dp, vertical = 6.dp),
                            verticalAlignment = Alignment.CenterVertically,
                            horizontalArrangement = Arrangement.spacedBy(6.dp)
                        ) {
                            CircularProgressIndicator(
                                modifier = Modifier.size(14.dp),
                                strokeWidth = 2.dp,
                                color = AccentBlue
                            )
                            Text(
                                text = currentTool ?: "",
                                color = AccentBlue,
                                fontSize = 12.sp
                            )
                        }
                    }
                }
            }

            // Streaming-Antwort
            if (currentDraft.isNotEmpty()) {
                item {
                    DraftBubble(draft = currentDraft)
                }
            }
        }

        // ====================================================================
        // Unten: PWA Composer (#chatForm) mit Kontext-Pill
        // ====================================================================
        Surface(
            color = BgSidebar,
            modifier = Modifier.fillMaxWidth()
        ) {
            Column(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 12.dp, vertical = 10.dp),
                verticalArrangement = Arrangement.spacedBy(8.dp)
            ) {
                // Aktiver Notiz-Kontext Chip
                if (attachedPageTitle != null) {
                    Row(
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(6.dp),
                        modifier = Modifier
                            .clip(RoundedCornerShape(6.dp))
                            .background(AccentBlueSoft)
                            .padding(horizontal = 8.dp, vertical = 4.dp)
                    ) {
                        Text(
                            text = "📄 $attachedPageTitle",
                            color = AccentBlue,
                            fontSize = 11.sp,
                            fontWeight = FontWeight.Medium,
                            maxLines = 1,
                            overflow = TextOverflow.Ellipsis
                        )
                        Icon(
                            imageVector = Icons.Rounded.Close,
                            contentDescription = "Kontext entfernen",
                            tint = AccentBlue,
                            modifier = Modifier
                                .size(14.dp)
                                .clickable {
                                    attachedPageId = null
                                    attachedPageTitle = null
                                }
                        )
                    }
                }

                // Textfeld & Senden-Zeile
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    verticalAlignment = Alignment.Bottom,
                    horizontalArrangement = Arrangement.spacedBy(8.dp)
                ) {
                    BasicTextField(
                        value = inputText,
                        onValueChange = { inputText = it },
                        textStyle = TextStyle(color = TextMain, fontSize = 14.sp),
                        cursorBrush = SolidColor(AccentBlue),
                        decorationBox = { innerTextField ->
                            Box(
                                modifier = Modifier
                                    .weight(1f)
                                    .clip(RoundedCornerShape(12.dp))
                                    .background(BgBubble)
                                    .border(1.dp, BorderHairline, RoundedCornerShape(12.dp))
                                    .padding(horizontal = 12.dp, vertical = 10.dp)
                            ) {
                                if (inputText.isEmpty()) {
                                    Text(
                                        text = "Frag den KI-Coach…",
                                        color = TextMuted,
                                        fontSize = 13.sp
                                    )
                                }
                                innerTextField()
                            }
                        },
                        modifier = Modifier.weight(1f)
                    )

                    // Senden / Stop Button
                    Surface(
                        shape = CircleShape,
                        color = if (isRunning) DangerRed else AccentBlue,
                        modifier = Modifier
                            .size(42.dp)
                            .clickable {
                                if (isRunning) {
                                    assistant.cancel()
                                    isRunning = false
                                } else {
                                    sendMessage()
                                }
                            }
                    ) {
                        Box(contentAlignment = Alignment.Center) {
                            Icon(
                                imageVector = if (isRunning) Icons.Rounded.Stop else Icons.AutoMirrored.rounded.Send,
                                contentDescription = if (isRunning) "Stopp" else "Senden",
                                tint = Color(0xFF081018),
                                modifier = Modifier.size(18.dp)
                            )
                        }
                    }
                }
            }
        }
    }
}

/**
 * Rückwärtskompatible Überladung für `AiChatSheet(core, activePageId, onClose, modifier)`
 */
@Composable
fun AiChatSheet(
    core: ImpalaCore,
    activePageId: String?,
    onClose: () -> Unit,
    modifier: Modifier = Modifier
) {
    AiChatSheet(
        core = core,
        currentPageId = activePageId,
        onDismiss = onClose,
        modifier = modifier
    )
}

// ============================================================================
// Message Bubbles & Thinking Box
// ============================================================================

@Composable
private fun MessageBubble(
    message: ChatMessage,
    onUndoEdit: () -> Unit
) {
    val isUser = message.role == "user"

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
            color = if (isUser) AccentBlueSoft else BgCard,
            border = androidx.compose.foundation.BorderStroke(
                1.dp,
                if (isUser) AccentBlue.copy(alpha = 0.3f) else BorderHairline
            ),
            modifier = Modifier.fillMaxWidth(0.85f)
        ) {
            Column(modifier = Modifier.padding(12.dp)) {
                Text(
                    text = message.content ?: "",
                    color = TextMain,
                    fontSize = 13.5.sp,
                    lineHeight = 19.sp
                )
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
        border = androidx.compose.foundation.BorderStroke(1.dp, BorderHairline),
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
                        tint = AccentBlue,
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
            color = BgCard,
            border = androidx.compose.foundation.BorderStroke(1.dp, BorderHairline),
            modifier = Modifier.fillMaxWidth(0.85f)
        ) {
            Column(modifier = Modifier.padding(12.dp)) {
                Text(
                    text = draft,
                    color = TextMain,
                    fontSize = 13.5.sp,
                    lineHeight = 19.sp
                )
            }
        }
    }
}
