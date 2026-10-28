package org.impala67.app.ui.screens

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.rounded.ArrowBack
import androidx.compose.material.icons.rounded.Add
import androidx.compose.material.icons.rounded.Archive
import androidx.compose.material.icons.rounded.AutoAwesome
import androidx.compose.material.icons.rounded.Check
import androidx.compose.material.icons.rounded.Close
import androidx.compose.material.icons.rounded.Delete
import androidx.compose.material.icons.rounded.Edit
import androidx.compose.material.icons.rounded.ExpandMore
import androidx.compose.material.icons.rounded.PlayArrow
import androidx.compose.material.icons.rounded.Refresh
import androidx.compose.material.icons.rounded.School
import androidx.compose.material.icons.rounded.Search
import androidx.compose.material.icons.rounded.Settings
import androidx.compose.material.icons.rounded.Undo
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.Surface
import androidx.compose.material3.Switch
import androidx.compose.material3.SwitchDefaults
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.impala67.app.ui.theme.Accent
import org.impala67.app.ui.theme.AccentBlue
import org.impala67.app.ui.theme.AccentBlueSoft
import org.impala67.app.ui.theme.AccentBorder
import org.impala67.app.ui.theme.AccentGreen
import org.impala67.app.ui.theme.AccentOrange
import org.impala67.app.ui.theme.AccentSoft
import org.impala67.app.ui.theme.AccentViolet
import org.impala67.app.ui.theme.BgBubble
import org.impala67.app.ui.theme.BgCard
import org.impala67.app.ui.theme.BgDeep
import org.impala67.app.ui.theme.BgElevated
import org.impala67.app.ui.theme.BgHover
import org.impala67.app.ui.theme.BgPanel
import org.impala67.app.ui.theme.BgSidebar
import org.impala67.app.ui.theme.BorderHairline
import org.impala67.app.ui.theme.BorderStrong
import org.impala67.app.ui.theme.Danger
import org.impala67.app.ui.theme.DangerRed
import org.impala67.app.ui.theme.DangerSoft
import org.impala67.app.ui.theme.Edge
import org.impala67.app.ui.theme.EdgeSoft
import org.impala67.app.ui.theme.ImpalaBouncySpringFloat
import org.impala67.app.ui.theme.ImpalaPillShape
import org.impala67.app.ui.theme.Success
import org.impala67.app.ui.theme.SuccessGreen
import org.impala67.app.ui.theme.SuccessSoft
import org.impala67.app.ui.theme.SurfaceSubtle
import org.impala67.app.ui.theme.TextLight
import org.impala67.app.ui.theme.TextMain
import org.impala67.app.ui.theme.TextMuted
import org.impala67.app.ui.theme.TextPrimary
import org.impala67.app.ui.theme.TextSecondary
import org.impala67.app.ui.theme.Warn
import org.impala67.app.ui.theme.WarnSoft
import org.impala67.app.ui.theme.WarningAmber
import uniffi.impala_ffi.CardInfo
import uniffi.impala_ffi.DeckConfig
import uniffi.impala_ffi.DeckInfo
import uniffi.impala_ffi.DeckOverview
import uniffi.impala_ffi.LeechAction
import uniffi.impala_ffi.ImpalaCore
import uniffi.impala_ffi.StudyQueue
import java.util.TimeZone

/**
 * PWA-getreue Karteikarten- & FSRS-5 Lernansicht nach `web/render-anki.js`
 * mit den 4 Modi: Stapel, Browser, Statistik, Archiv + Deck-Optionen & Lückentexten.
 */
@Composable
fun StudyScreen(
    core: ImpalaCore,
    decks: List<DeckOverview> = emptyList(),
    studyStats: Any? = null,
    onRefresh: () -> Unit = {},
    initialDeckId: String? = null,
    modifier: Modifier = Modifier
) {
    val coroutineScope = rememberCoroutineScope()

    var activeViewTab by remember { mutableStateOf("decks") } // "decks", "browser", "stats", "archive"
    var activeStudyDeck by remember { mutableStateOf<String?>(initialDeckId) }
    var isStudying by remember { mutableStateOf(initialDeckId != null) }

    var feynmanMode by remember { mutableStateOf(false) }
    var mixMode by remember { mutableStateOf(false) }

    // Dialoge
    var showNewCardDialog by remember { mutableStateOf(false) }
    var showClozeDialog by remember { mutableStateOf(false) }
    var showNewDeckDialog by remember { mutableStateOf(false) }
    var showDeckConfigDialog by remember { mutableStateOf(false) }
    var configDeckName by remember { mutableStateOf<String?>(null) }
    var showNewMenu by remember { mutableStateOf(false) }

    // Ladedaten
    var loadedDecks by remember { mutableStateOf<List<DeckOverview>>(decks) }
    var archivedDecksList by remember { mutableStateOf<List<DeckInfo>>(emptyList()) }
    var studyQueue by remember { mutableStateOf<StudyQueue?>(null) }
    var currentCardIndex by remember { mutableIntStateOf(0) }
    var isFlipped by remember { mutableStateOf(false) }
    var reviewIntervals by remember { mutableStateOf<List<String>>(emptyList()) }
    var feynmanExplanation by remember { mutableStateOf("") }
    var canUndo by remember { mutableStateOf(false) }

    val utcOffsetMinutes = remember {
        val tz = TimeZone.getDefault()
        tz.getOffset(System.currentTimeMillis()) / (1000 * 60)
    }

    fun reloadData() {
        coroutineScope.launch(Dispatchers.IO) {
            val d = try {
                core.deckOverview(utcOffsetMinutes, mixMode)
            } catch (_: Exception) {
                emptyList()
            }
            val a = try {
                core.archivedDecks()
            } catch (_: Exception) {
                emptyList()
            }
            withContext(Dispatchers.Main) {
                loadedDecks = d
                archivedDecksList = a
            }
        }
    }

    fun startStudy(deckName: String?) {
        activeStudyDeck = deckName
        isStudying = true
        isFlipped = false
        feynmanExplanation = ""
        coroutineScope.launch(Dispatchers.IO) {
            val q = try {
                core.studyQueue(deckName, utcOffsetMinutes, mixMode)
            } catch (_: Exception) {
                null
            }
            val cUndo = try {
                core.canUndoReview()
            } catch (_: Exception) {
                false
            }
            withContext(Dispatchers.Main) {
                studyQueue = q
                canUndo = cUndo
                val firstCard = q?.dueNow?.firstOrNull()
                if (firstCard != null) {
                    coroutineScope.launch(Dispatchers.IO) {
                        val intervals = try {
                            core.reviewPreview(firstCard.id)
                        } catch (_: Exception) {
                            emptyList()
                        }
                        withContext(Dispatchers.Main) {
                            reviewIntervals = intervals
                        }
                    }
                }
            }
        }
    }

    LaunchedEffect(Unit) {
        reloadData()
        if (initialDeckId != null) {
            startStudy(initialDeckId)
        }
    }

    LaunchedEffect(isStudying, activeStudyDeck) {
        if (isStudying) {
            startStudy(activeStudyDeck)
        }
    }

    val currentCard = studyQueue?.dueNow?.firstOrNull()

    Column(
        modifier = modifier
            .fillMaxSize()
            .background(BgPanel)
    ) {
        // ====================================================================
        // Top Header (#ankiHeader)
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
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.SpaceBetween
            ) {
                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(8.dp)
                ) {
                    if (isStudying) {
                        IconButton(
                            onClick = {
                                isStudying = false
                                reloadData()
                                onRefresh()
                            },
                            modifier = Modifier.size(32.dp)
                        ) {
                            Icon(
                                imageVector = Icons.AutoMirrored.Rounded.ArrowBack,
                                contentDescription = "Zurück",
                                tint = TextMain,
                                modifier = Modifier.size(18.dp)
                            )
                        }
                    }

                    Text(
                        text = if (isStudying) (activeStudyDeck ?: "Gemischt lernen") else "🃏 Karteikarten",
                        color = TextMain,
                        fontSize = 15.sp,
                        fontWeight = FontWeight.SemiBold
                    )
                }

                if (!isStudying) {
                    Row(
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(4.dp)
                    ) {
                        // 4 PWA Tabs: Stapel, Browser, Statistik, Archiv
                        listOf(
                            "decks" to "Stapel",
                            "browser" to "Browser",
                            "stats" to "Statistik",
                            "archive" to "Archiv"
                        ).forEach { (id, label) ->
                            val isSel = activeViewTab == id
                            Box(
                                modifier = Modifier
                                    .clip(RoundedCornerShape(8.dp))
                                    .background(if (isSel) AccentBlueSoft else Color.Transparent)
                                    .clickable { activeViewTab = id }
                                    .padding(horizontal = 10.dp, vertical = 6.dp)
                            ) {
                                Text(
                                    text = label,
                                    color = if (isSel) AccentBlue else TextSecondary,
                                    fontSize = 13.sp,
                                    fontWeight = if (isSel) FontWeight.Bold else FontWeight.Medium
                                )
                            }
                        }

                        Spacer(modifier = Modifier.width(6.dp))

                        // + Neu Dropdown
                        Box {
                            Surface(
                                shape = RoundedCornerShape(8.dp),
                                color = AccentBlue,
                                modifier = Modifier
                                    .clickable { showNewMenu = true }
                                    .height(30.dp)
                            ) {
                                Row(
                                    verticalAlignment = Alignment.CenterVertically,
                                    horizontalArrangement = Arrangement.spacedBy(4.dp),
                                    modifier = Modifier.padding(horizontal = 10.dp)
                                ) {
                                    Icon(
                                        imageVector = Icons.Rounded.Add,
                                        contentDescription = null,
                                        tint = Color(0xFF081018),
                                        modifier = Modifier.size(16.dp)
                                    )
                                    Text(
                                        text = "Neu ▾",
                                        color = Color(0xFF081018),
                                        fontSize = 12.sp,
                                        fontWeight = FontWeight.Bold
                                    )
                                }
                            }

                            DropdownMenu(
                                expanded = showNewMenu,
                                onDismissRequest = { showNewMenu = false }
                            ) {
                                DropdownMenuItem(
                                    text = { Text("🃏 Neue Karteikarte", color = TextMain) },
                                    onClick = {
                                        showNewMenu = false
                                        showNewCardDialog = true
                                    }
                                )
                                DropdownMenuItem(
                                    text = { Text("🧩 Lückentext-Karte (Cloze)", color = TextMain) },
                                    onClick = {
                                        showNewMenu = false
                                        showClozeDialog = true
                                    }
                                )
                                DropdownMenuItem(
                                    text = { Text("🗂️ Neuer Stapel", color = TextMain) },
                                    onClick = {
                                        showNewMenu = false
                                        showNewDeckDialog = true
                                    }
                                )
                            }
                        }
                    }
                } else {
                    // Study Mode Controls (Undo & Options)
                    Row(
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(6.dp)
                    ) {
                        if (canUndo) {
                            TextButton(
                                onClick = {
                                    coroutineScope.launch(Dispatchers.IO) {
                                        try {
                                            core.undoReview()
                                            startStudy(activeStudyDeck)
                                        } catch (_: Exception) {}
                                    }
                                },
                                contentPadding = PaddingValues(horizontal = 8.dp, vertical = 4.dp)
                            ) {
                                Icon(
                                    imageVector = Icons.Rounded.Undo,
                                    contentDescription = "Rückgängig",
                                    tint = WarningAmber,
                                    modifier = Modifier.size(16.dp)
                                )
                                Spacer(modifier = Modifier.width(4.dp))
                                Text("Rückgängig", color = WarningAmber, fontSize = 12.sp)
                            }
                        }

                        IconButton(
                            onClick = {
                                configDeckName = activeStudyDeck
                                showDeckConfigDialog = true
                            },
                            modifier = Modifier.size(32.dp)
                        ) {
                            Icon(
                                imageVector = Icons.Rounded.Settings,
                                contentDescription = "Deck-Optionen",
                                tint = TextSecondary,
                                modifier = Modifier.size(18.dp)
                            )
                        }
                    }
                }
            }
            HorizontalDivider(color = BorderHairline, thickness = 1.dp)
        }

        // ====================================================================
        // Body Content
        // ====================================================================
        if (isStudying) {
            // Aktiver Lern-Modus
            StudyActiveSession(
                queue = studyQueue,
                currentCard = currentCard,
                isFlipped = isFlipped,
                onFlip = { isFlipped = true },
                reviewIntervals = reviewIntervals,
                feynmanMode = feynmanMode,
                feynmanExplanation = feynmanExplanation,
                onFeynmanChange = { feynmanExplanation = it },
                onGrade = { rating ->
                    val cardId = currentCard?.id ?: return@StudyActiveSession
                    coroutineScope.launch(Dispatchers.IO) {
                        try {
                            core.reviewCard(cardId, rating.toUByte())
                        } catch (_: Exception) {}
                        withContext(Dispatchers.Main) {
                            isFlipped = false
                            feynmanExplanation = ""
                            startStudy(activeStudyDeck)
                        }
                    }
                },
                onFinished = {
                    isStudying = false
                    reloadData()
                    onRefresh()
                },
                modifier = Modifier.weight(1f)
            )
        } else {
            // Dashboard nach gewähltem Tab
            when (activeViewTab) {
                "decks" -> {
                    DecksOverviewTab(
                        decks = loadedDecks,
                        feynmanMode = feynmanMode,
                        onToggleFeynman = { feynmanMode = it },
                        mixMode = mixMode,
                        onToggleMix = {
                            mixMode = it
                            reloadData()
                        },
                        onStudyDeck = { deckName -> startStudy(deckName) },
                        onConfigureDeck = { deckName ->
                            configDeckName = deckName
                            showDeckConfigDialog = true
                        },
                        onArchiveDeck = { deckName ->
                            coroutineScope.launch(Dispatchers.IO) {
                                try {
                                    core.archiveDeck(deckName)
                                    reloadData()
                                    onRefresh()
                                } catch (_: Exception) {}
                            }
                        },
                        onDeleteDeck = { deckName ->
                            coroutineScope.launch(Dispatchers.IO) {
                                try {
                                    core.deleteDeck(deckName)
                                    reloadData()
                                    onRefresh()
                                } catch (_: Exception) {}
                            }
                        },
                        modifier = Modifier.weight(1f)
                    )
                }

                "browser" -> {
                    CardBrowserTab(
                        core = core,
                        decks = loadedDecks,
                        onMutation = {
                            reloadData()
                            onRefresh()
                        },
                        modifier = Modifier.weight(1f)
                    )
                }

                "stats" -> {
                    StudyStatsTab(
                        core = core,
                        decks = loadedDecks,
                        modifier = Modifier.weight(1f)
                    )
                }

                "archive" -> {
                    ArchivedDecksTab(
                        archivedDecks = archivedDecksList,
                        onRestore = { name ->
                            coroutineScope.launch(Dispatchers.IO) {
                                try {
                                    core.unarchiveDeck(name)
                                    reloadData()
                                    onRefresh()
                                } catch (_: Exception) {}
                            }
                        },
                        modifier = Modifier.weight(1f)
                    )
                }
            }
        }
    }

    // ========================================================================
    // Dialoge: Neue Karte, Lückentext, Neuer Stapel, Deck-Optionen
    // ========================================================================
    if (showNewCardDialog) {
        var front by remember { mutableStateOf("") }
        var back by remember { mutableStateOf("") }
        var targetDeck by remember { mutableStateOf(activeStudyDeck ?: loadedDecks.firstOrNull()?.name ?: "Standard") }

        AlertDialog(
            onDismissRequest = { showNewCardDialog = false },
            title = { Text("🃏 Neue Karteikarte", color = TextMain, fontWeight = FontWeight.Bold) },
            text = {
                Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                    Text("Stapel:", color = TextSecondary, fontSize = 12.sp)
                    BasicTextField(
                        value = targetDeck,
                        onValueChange = { targetDeck = it },
                        textStyle = TextStyle(color = TextMain, fontSize = 14.sp),
                        cursorBrush = SolidColor(AccentBlue),
                        modifier = Modifier
                            .fillMaxWidth()
                            .clip(RoundedCornerShape(8.dp))
                            .background(BgBubble)
                            .border(1.dp, BorderHairline, RoundedCornerShape(8.dp))
                            .padding(10.dp)
                    )

                    Text("Vorderseite (Frage):", color = TextSecondary, fontSize = 12.sp)
                    BasicTextField(
                        value = front,
                        onValueChange = { front = it },
                        textStyle = TextStyle(color = TextMain, fontSize = 14.sp),
                        cursorBrush = SolidColor(AccentBlue),
                        modifier = Modifier
                            .fillMaxWidth()
                            .heightIn(min = 60.dp)
                            .clip(RoundedCornerShape(8.dp))
                            .background(BgBubble)
                            .border(1.dp, BorderHairline, RoundedCornerShape(8.dp))
                            .padding(10.dp)
                    )

                    Text("Rückseite (Antwort):", color = TextSecondary, fontSize = 12.sp)
                    BasicTextField(
                        value = back,
                        onValueChange = { back = it },
                        textStyle = TextStyle(color = TextMain, fontSize = 14.sp),
                        cursorBrush = SolidColor(AccentBlue),
                        modifier = Modifier
                            .fillMaxWidth()
                            .heightIn(min = 60.dp)
                            .clip(RoundedCornerShape(8.dp))
                            .background(BgBubble)
                            .border(1.dp, BorderHairline, RoundedCornerShape(8.dp))
                            .padding(10.dp)
                    )
                }
            },
            confirmButton = {
                TextButton(
                    onClick = {
                        if (front.isNotBlank() && back.isNotBlank()) {
                            coroutineScope.launch(Dispatchers.IO) {
                                try {
                                    core.createCard(front.trim(), back.trim(), targetDeck.trim(), null)
                                    withContext(Dispatchers.Main) {
                                        showNewCardDialog = false
                                        reloadData()
                                        onRefresh()
                                    }
                                } catch (_: Exception) {}
                            }
                        }
                    }
                ) {
                    Text("Karte anlegen", color = AccentBlue, fontWeight = FontWeight.Bold)
                }
            },
            dismissButton = {
                TextButton(onClick = { showNewCardDialog = false }) {
                    Text("Abbrechen", color = TextMuted)
                }
            },
            containerColor = BgElevated
        )
    }

    if (showClozeDialog) {
        var clozeText by remember { mutableStateOf("Berlin ist die Hauptstadt von {{c1::Deutschland}}.") }
        var targetDeck by remember { mutableStateOf(activeStudyDeck ?: loadedDecks.firstOrNull()?.name ?: "Standard") }

        AlertDialog(
            onDismissRequest = { showClozeDialog = false },
            title = { Text("🧩 Lückentext-Karte (Cloze)", color = TextMain, fontWeight = FontWeight.Bold) },
            text = {
                Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                    Text(
                        "Umschließe Wörter mit {{c1::Begriff}}, um Lücken zu erzeugen.",
                        color = TextMuted,
                        fontSize = 12.sp
                    )

                    BasicTextField(
                        value = clozeText,
                        onValueChange = { clozeText = it },
                        textStyle = TextStyle(color = TextMain, fontSize = 14.sp),
                        cursorBrush = SolidColor(AccentBlue),
                        modifier = Modifier
                            .fillMaxWidth()
                            .heightIn(min = 100.dp)
                            .clip(RoundedCornerShape(8.dp))
                            .background(BgBubble)
                            .border(1.dp, BorderHairline, RoundedCornerShape(8.dp))
                            .padding(10.dp)
                    )
                }
            },
            confirmButton = {
                TextButton(
                    onClick = {
                        if (clozeText.isNotBlank()) {
                            coroutineScope.launch(Dispatchers.IO) {
                                try {
                                    core.createClozeCards(clozeText.trim(), targetDeck.trim(), null)
                                    withContext(Dispatchers.Main) {
                                        showClozeDialog = false
                                        reloadData()
                                        onRefresh()
                                    }
                                } catch (_: Exception) {}
                            }
                        }
                    }
                ) {
                    Text("Lückentext erstellen", color = AccentBlue, fontWeight = FontWeight.Bold)
                }
            },
            dismissButton = {
                TextButton(onClick = { showClozeDialog = false }) {
                    Text("Abbrechen", color = TextMuted)
                }
            },
            containerColor = BgElevated
        )
    }

    if (showNewDeckDialog) {
        var deckName by remember { mutableStateOf("") }

        AlertDialog(
            onDismissRequest = { showNewDeckDialog = false },
            title = { Text("🗂️ Neuer Stapel", color = TextMain, fontWeight = FontWeight.Bold) },
            text = {
                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text(
                        "Tipp: Nutze Doppel-Doppelpunkte für Unterstapel (z.B. Biologie::Genetik)",
                        color = TextMuted,
                        fontSize = 12.sp
                    )
                    BasicTextField(
                        value = deckName,
                        onValueChange = { deckName = it },
                        textStyle = TextStyle(color = TextMain, fontSize = 15.sp),
                        cursorBrush = SolidColor(AccentBlue),
                        modifier = Modifier
                            .fillMaxWidth()
                            .clip(RoundedCornerShape(8.dp))
                            .background(BgBubble)
                            .border(1.dp, BorderHairline, RoundedCornerShape(8.dp))
                            .padding(10.dp)
                    )
                }
            },
            confirmButton = {
                TextButton(
                    onClick = {
                        if (deckName.isNotBlank()) {
                            coroutineScope.launch(Dispatchers.IO) {
                                try {
                                    core.createDeck(deckName.trim())
                                    withContext(Dispatchers.Main) {
                                        showNewDeckDialog = false
                                        reloadData()
                                        onRefresh()
                                    }
                                } catch (_: Exception) {}
                            }
                        }
                    }
                ) {
                    Text("Stapel anlegen", color = AccentBlue, fontWeight = FontWeight.Bold)
                }
            },
            dismissButton = {
                TextButton(onClick = { showNewDeckDialog = false }) {
                    Text("Abbrechen", color = TextMuted)
                }
            },
            containerColor = BgElevated
        )
    }

    if (showDeckConfigDialog) {
        var currentConf by remember { mutableStateOf<DeckConfig?>(null) }
        var newPerDay by remember { mutableStateOf("20") }
        var revPerDay by remember { mutableStateOf("200") }

        LaunchedEffect(configDeckName) {
            withContext(Dispatchers.IO) {
                val conf = try {
                    core.deckConfig(configDeckName)
                } catch (_: Exception) {
                    null
                }
                withContext(Dispatchers.Main) {
                    currentConf = conf
                    if (conf != null) {
                        newPerDay = conf.newPerDay.toString()
                        revPerDay = conf.revPerDay.toString()
                    }
                }
            }
        }

        AlertDialog(
            onDismissRequest = { showDeckConfigDialog = false },
            title = {
                Text(
                    text = "⚙️ Optionen für ${configDeckName ?: "Alle Stapel"}",
                    color = TextMain,
                    fontWeight = FontWeight.Bold
                )
            },
            text = {
                Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                    Text("Neue Karten pro Tag:", color = TextSecondary, fontSize = 13.sp)
                    BasicTextField(
                        value = newPerDay,
                        onValueChange = { newPerDay = it },
                        textStyle = TextStyle(color = TextMain, fontSize = 14.sp),
                        cursorBrush = SolidColor(AccentBlue),
                        modifier = Modifier
                            .fillMaxWidth()
                            .clip(RoundedCornerShape(8.dp))
                            .background(BgBubble)
                            .border(1.dp, BorderHairline, RoundedCornerShape(8.dp))
                            .padding(10.dp)
                    )

                    Text("Max. Wiederholungen pro Tag:", color = TextSecondary, fontSize = 13.sp)
                    BasicTextField(
                        value = revPerDay,
                        onValueChange = { revPerDay = it },
                        textStyle = TextStyle(color = TextMain, fontSize = 14.sp),
                        cursorBrush = SolidColor(AccentBlue),
                        modifier = Modifier
                            .fillMaxWidth()
                            .clip(RoundedCornerShape(8.dp))
                            .background(BgBubble)
                            .border(1.dp, BorderHairline, RoundedCornerShape(8.dp))
                            .padding(10.dp)
                    )
                }
            },
            confirmButton = {
                TextButton(
                    onClick = {
                        val n = newPerDay.toUIntOrNull() ?: 20u
                        val r = revPerDay.toUIntOrNull() ?: 200u
                        val updated = currentConf?.copy(newPerDay = n, revPerDay = r) ?: DeckConfig(
                            newPerDay = n,
                            revPerDay = r,
                            leechThreshold = 8u,
                            leechAction = LeechAction.MARK
                        )
                        coroutineScope.launch(Dispatchers.IO) {
                            try {
                                core.setDeckConfig(configDeckName, updated)
                                withContext(Dispatchers.Main) {
                                    showDeckConfigDialog = false
                                    reloadData()
                                }
                            } catch (_: Exception) {}
                        }
                    }
                ) {
                    Text("Speichern", color = AccentBlue, fontWeight = FontWeight.Bold)
                }
            },
            dismissButton = {
                TextButton(onClick = { showDeckConfigDialog = false }) {
                    Text("Abbrechen", color = TextMuted)
                }
            },
            containerColor = BgElevated
        )
    }
}

/**
 * Rückwärtskompatible Überladung für `StudyScreen(core, initialDeck, onBack, modifier)`
 */
@Composable
fun StudyScreen(
    core: ImpalaCore,
    initialDeck: String?,
    onBack: () -> Unit,
    modifier: Modifier = Modifier
) {
    StudyScreen(
        core = core,
        initialDeckId = initialDeck,
        onRefresh = onBack,
        modifier = modifier
    )
}

// ============================================================================
// 1. STAPEL-TAB: Hierarchische Stapelliste & FSRS-Zusammenfassung
// ============================================================================

@Composable
private fun DecksOverviewTab(
    decks: List<DeckOverview>,
    feynmanMode: Boolean,
    onToggleFeynman: (Boolean) -> Unit,
    mixMode: Boolean,
    onToggleMix: (Boolean) -> Unit,
    onStudyDeck: (String?) -> Unit,
    onConfigureDeck: (String) -> Unit,
    onArchiveDeck: (String) -> Unit,
    onDeleteDeck: (String) -> Unit,
    modifier: Modifier = Modifier
) {
    val totalDue = decks.sumOf { (it.review + it.learn).toInt() }
    val totalNew = decks.sumOf { it.new.toInt() }
    val totalCards = decks.sumOf { it.total.toInt() }

    LazyColumn(
        modifier = modifier.fillMaxSize(),
        contentPadding = PaddingValues(horizontal = 16.dp, vertical = 18.dp),
        verticalArrangement = Arrangement.spacedBy(14.dp)
    ) {
        // Lead-Zeile
        item {
            Surface(
                color = BgCard,
                shape = RoundedCornerShape(12.dp),
                border = BorderStroke(1.dp, BorderHairline),
                modifier = Modifier.fillMaxWidth()
            ) {
                Column(modifier = Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text(
                        text = if (totalDue > 0) "$totalDue Karten warten auf dich — etwa ${(totalDue * 0.8).toInt()} Minuten."
                        else "Für heute ist alles erledigt. Gute Arbeit!",
                        color = TextMain,
                        fontSize = 15.sp,
                        fontWeight = FontWeight.Medium
                    )

                    // Modus-Pills: Feynman & Gemischt
                    Row(
                        horizontalArrangement = Arrangement.spacedBy(10.dp),
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        Surface(
                            shape = RoundedCornerShape(8.dp),
                            color = if (feynmanMode) AccentViolet.copy(alpha = 0.2f) else BgBubble,
                            border = BorderStroke(1.dp, if (feynmanMode) AccentViolet else BorderHairline),
                            modifier = Modifier.clickable { onToggleFeynman(!feynmanMode) }
                        ) {
                            Row(
                                modifier = Modifier.padding(horizontal = 10.dp, vertical = 6.dp),
                                verticalAlignment = Alignment.CenterVertically,
                                horizontalArrangement = Arrangement.spacedBy(6.dp)
                            ) {
                                Text("🧠 Feynman-Modus", color = if (feynmanMode) AccentViolet else TextSecondary, fontSize = 12.sp)
                                if (feynmanMode) {
                                    Icon(Icons.Rounded.Check, contentDescription = null, tint = AccentViolet, modifier = Modifier.size(14.dp))
                                }
                            }
                        }

                        Surface(
                            shape = RoundedCornerShape(8.dp),
                            color = if (mixMode) AccentBlueSoft else BgBubble,
                            border = BorderStroke(1.dp, if (mixMode) AccentBlue else BorderHairline),
                            modifier = Modifier.clickable { onToggleMix(!mixMode) }
                        ) {
                            Row(
                                modifier = Modifier.padding(horizontal = 10.dp, vertical = 6.dp),
                                verticalAlignment = Alignment.CenterVertically,
                                horizontalArrangement = Arrangement.spacedBy(6.dp)
                            ) {
                                Text("🔀 Gemischt lernen", color = if (mixMode) AccentBlue else TextSecondary, fontSize = 12.sp)
                                if (mixMode) {
                                    Icon(Icons.Rounded.Check, contentDescription = null, tint = AccentBlue, modifier = Modifier.size(14.dp))
                                }
                            }
                        }
                    }
                }
            }
        }

        // 2 Stat-Karten: Heute fällig & Neue Karten
        item {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(12.dp)
            ) {
                Surface(
                    color = if (totalDue > 0) AccentBlueSoft else BgCard,
                    shape = RoundedCornerShape(12.dp),
                    border = BorderStroke(1.dp, if (totalDue > 0) AccentBorder else BorderHairline),
                    modifier = Modifier
                        .weight(1f)
                        .clickable { onStudyDeck(null) }
                ) {
                    Column(modifier = Modifier.padding(14.dp)) {
                        Text("Heute fällig", color = TextSecondary, fontSize = 12.sp)
                        Text(
                            text = "$totalDue",
                            color = if (totalDue > 0) AccentBlue else SuccessGreen,
                            fontSize = 26.sp,
                            fontWeight = FontWeight.Bold
                        )
                        Text(
                            text = if (totalDue > 0) "Jetzt lernen →" else "Alles wiederholt ✓",
                            color = if (totalDue > 0) AccentBlue else TextMuted,
                            fontSize = 11.sp
                        )
                    }
                }

                Surface(
                    color = BgCard,
                    shape = RoundedCornerShape(12.dp),
                    border = BorderStroke(1.dp, BorderHairline),
                    modifier = Modifier.weight(1f)
                ) {
                    Column(modifier = Modifier.padding(14.dp)) {
                        Text("Neue Karten", color = TextSecondary, fontSize = 12.sp)
                        Text(
                            text = "$totalNew",
                            color = TextMain,
                            fontSize = 26.sp,
                            fontWeight = FontWeight.Bold
                        )
                        Text(
                            text = "von $totalCards gesamt",
                            color = TextMuted,
                            fontSize = 11.sp
                        )
                    }
                }
            }
        }

        // Hierarchische Stapelliste
        item {
            Text(
                text = "Deine Stapel",
                color = TextSecondary,
                fontSize = 12.sp,
                fontWeight = FontWeight.Bold,
                modifier = Modifier.padding(top = 4.dp, bottom = 2.dp)
            )
        }

        if (decks.isEmpty()) {
            item {
                Surface(
                    color = BgCard,
                    shape = RoundedCornerShape(12.dp),
                    border = BorderStroke(1.dp, BorderHairline),
                    modifier = Modifier.fillMaxWidth()
                ) {
                    Box(modifier = Modifier.padding(24.dp), contentAlignment = Alignment.Center) {
                        Text(
                            text = "Noch keine Stapel vorhanden. Klicke oben auf „+ Neu ▾“!",
                            color = TextMuted,
                            fontSize = 13.sp
                        )
                    }
                }
            }
        } else {
            items(decks, key = { it.name }) { deck ->
                var menuExpanded by remember { mutableStateOf(false) }

                Surface(
                    color = BgCard,
                    shape = RoundedCornerShape(10.dp),
                    border = BorderStroke(1.dp, BorderHairline),
                    modifier = Modifier.fillMaxWidth()
                ) {
                    Row(
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(horizontal = 14.dp, vertical = 10.dp),
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.SpaceBetween
                    ) {
                        Column(modifier = Modifier.weight(1f)) {
                            Text(
                                text = deck.name,
                                color = TextMain,
                                fontSize = 14.sp,
                                fontWeight = FontWeight.SemiBold,
                                maxLines = 1,
                                overflow = TextOverflow.Ellipsis
                            )
                            Row(
                                horizontalArrangement = Arrangement.spacedBy(8.dp),
                                verticalAlignment = Alignment.CenterVertically,
                                modifier = Modifier.padding(top = 2.dp)
                            ) {
                                if ((deck.review + deck.learn) > 0u) {
                                    Text(
                                        text = "${(deck.review + deck.learn)} fällig",
                                        color = AccentBlue,
                                        fontSize = 11.sp,
                                        fontWeight = FontWeight.Bold
                                    )
                                }
                                if (deck.new > 0u) {
                                    Text(
                                        text = "${deck.new} neu",
                                        color = SuccessGreen,
                                        fontSize = 11.sp
                                    )
                                }
                                Text(
                                    text = "${deck.total} gesamt",
                                    color = TextMuted,
                                    fontSize = 11.sp
                                )
                            }
                        }

                        Row(
                            verticalAlignment = Alignment.CenterVertically,
                            horizontalArrangement = Arrangement.spacedBy(4.dp)
                        ) {
                            Surface(
                                shape = RoundedCornerShape(8.dp),
                                color = if ((deck.review + deck.learn) > 0u) AccentBlue else BgBubble,
                                modifier = Modifier
                                    .clickable { onStudyDeck(deck.name) }
                                    .height(30.dp)
                            ) {
                                Box(
                                    contentAlignment = Alignment.Center,
                                    modifier = Modifier.padding(horizontal = 12.dp)
                                ) {
                                    Text(
                                        text = if ((deck.review + deck.learn) > 0u) "Lernen" else "Üben",
                                        color = if ((deck.review + deck.learn) > 0u) Color(0xFF081018) else TextMain,
                                        fontSize = 12.sp,
                                        fontWeight = FontWeight.Bold
                                    )
                                }
                            }

                            Box {
                                IconButton(
                                    onClick = { menuExpanded = true },
                                    modifier = Modifier.size(30.dp)
                                ) {
                                    Icon(
                                        imageVector = Icons.Rounded.Settings,
                                        contentDescription = "Optionen",
                                        tint = TextMuted,
                                        modifier = Modifier.size(16.dp)
                                    )
                                }

                                DropdownMenu(
                                    expanded = menuExpanded,
                                    onDismissRequest = { menuExpanded = false }
                                ) {
                                    DropdownMenuItem(
                                        text = { Text("⚙️ Deck-Optionen", color = TextMain) },
                                        onClick = {
                                            menuExpanded = false
                                            onConfigureDeck(deck.name)
                                        }
                                    )
                                    DropdownMenuItem(
                                        text = { Text("📦 Archivieren", color = TextSecondary) },
                                        onClick = {
                                            menuExpanded = false
                                            onArchiveDeck(deck.name)
                                        }
                                    )
                                    DropdownMenuItem(
                                        text = { Text("🗑️ In Papierkorb", color = DangerRed) },
                                        onClick = {
                                            menuExpanded = false
                                            onDeleteDeck(deck.name)
                                        }
                                    )
                                }
                            }
                        }
                    }
                }
            }
        }

        item {
            Spacer(modifier = Modifier.height(24.dp).navigationBarsPadding())
        }
    }
}

// ============================================================================
// 2. AKTIVER LERN-MODUS (Card Flip + Feynman + FSRS Rating Buttons)
// ============================================================================

@Composable
private fun StudyActiveSession(
    queue: StudyQueue?,
    currentCard: CardInfo?,
    isFlipped: Boolean,
    onFlip: () -> Unit,
    reviewIntervals: List<String>,
    feynmanMode: Boolean,
    feynmanExplanation: String,
    onFeynmanChange: (String) -> Unit,
    onGrade: (Int) -> Unit,
    onFinished: () -> Unit,
    modifier: Modifier = Modifier
) {
    if (currentCard == null) {
        Box(
            modifier = modifier
                .fillMaxSize()
                .padding(24.dp),
            contentAlignment = Alignment.Center
        ) {
            Column(
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.spacedBy(14.dp)
            ) {
                Text("🎉", fontSize = 48.sp)
                Text(
                    text = "Glückwunsch! Alle fälligen Karten erledigt.",
                    color = TextMain,
                    fontSize = 18.sp,
                    fontWeight = FontWeight.Bold,
                    textAlign = TextAlign.Center
                )
                Text(
                    text = "Komm später wieder oder lerne neue Karten.",
                    color = TextSecondary,
                    fontSize = 13.sp,
                    textAlign = TextAlign.Center
                )
                Surface(
                    shape = RoundedCornerShape(10.dp),
                    color = AccentBlue,
                    modifier = Modifier.clickable { onFinished() }
                ) {
                    Text(
                        text = "Zurück zur Übersicht",
                        color = Color(0xFF081018),
                        fontWeight = FontWeight.Bold,
                        fontSize = 14.sp,
                        modifier = Modifier.padding(horizontal = 16.dp, vertical = 10.dp)
                    )
                }
            }
        }
        return
    }

    val rotation by animateFloatAsState(
        targetValue = if (isFlipped) 180f else 0f,
        animationSpec = ImpalaBouncySpringFloat,
        label = "cardFlip"
    )

    Column(
        modifier = modifier
            .fillMaxSize()
            .padding(horizontal = 16.dp, vertical = 12.dp),
        verticalArrangement = Arrangement.SpaceBetween
    ) {
        // Fortschritt & Zähler
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically
        ) {
            Text(
                text = "Deck: ${currentCard.deck ?: "Standard"}",
                color = TextSecondary,
                fontSize = 12.sp
            )
            Text(
                text = "Verbleibend: ${queue?.dueNow?.size ?: 1}",
                color = AccentBlue,
                fontSize = 12.sp,
                fontWeight = FontWeight.Bold
            )
        }

        // Die Karteikarte
        Surface(
            color = BgCard,
            shape = RoundedCornerShape(18.dp),
            border = BorderStroke(1.dp, BorderHairline),
            modifier = Modifier
                .fillMaxWidth()
                .weight(1f)
                .padding(vertical = 14.dp)
                .clickable { if (!isFlipped) onFlip() }
        ) {
            Column(
                modifier = Modifier
                    .fillMaxSize()
                    .padding(20.dp)
                    .verticalScroll(rememberScrollState()),
                verticalArrangement = Arrangement.SpaceBetween
            ) {
                // Vorderseite (mit Cloze-Unterstützung)
                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text("FRAGE", color = TextMuted, fontSize = 11.sp, fontWeight = FontWeight.Bold)
                    val frontDisplay = renderClozeFront(currentCard.front)
                    Text(
                        text = frontDisplay,
                        color = TextMain,
                        fontSize = 20.sp,
                        fontWeight = FontWeight.Medium
                    )
                }

                // Feynman Eingabe (falls aktiviert & noch nicht aufgedeckt)
                if (feynmanMode && !isFlipped) {
                    Column(
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(vertical = 12.dp)
                    ) {
                        Text(
                            text = "🧠 Erkläre es kurz in eigenen Worten:",
                            color = AccentViolet,
                            fontSize = 12.sp,
                            fontWeight = FontWeight.SemiBold
                        )
                        BasicTextField(
                            value = feynmanExplanation,
                            onValueChange = onFeynmanChange,
                            textStyle = TextStyle(color = TextMain, fontSize = 13.sp),
                            cursorBrush = SolidColor(AccentViolet),
                            modifier = Modifier
                                .fillMaxWidth()
                                .heightIn(min = 60.dp)
                                .clip(RoundedCornerShape(8.dp))
                                .background(BgBubble)
                                .border(1.dp, BorderHairline, RoundedCornerShape(8.dp))
                                .padding(8.dp)
                        )
                    }
                }

                // Rückseite (nach dem Aufdecken)
                if (isFlipped) {
                    HorizontalDivider(color = BorderHairline, modifier = Modifier.padding(vertical = 12.dp))
                    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                        Text("ANTWORT", color = AccentBlue, fontSize = 11.sp, fontWeight = FontWeight.Bold)
                        val backDisplay = renderClozeBack(currentCard.back.ifBlank { currentCard.front })
                        Text(
                            text = backDisplay,
                            color = TextMain,
                            fontSize = 18.sp,
                            fontWeight = FontWeight.Normal
                        )
                    }
                } else {
                    Box(modifier = Modifier.fillMaxWidth(), contentAlignment = Alignment.Center) {
                        Text("Antippen zum Aufdecken", color = TextMuted, fontSize = 12.sp)
                    }
                }
            }
        }

        // Unten: Buttons (Antwort aufdecken ODER die 4 FSRS-Bewertungs-Buttons)
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .navigationBarsPadding(),
            verticalArrangement = Arrangement.spacedBy(8.dp)
        ) {
            if (!isFlipped) {
                Surface(
                    shape = RoundedCornerShape(12.dp),
                    color = AccentBlue,
                    modifier = Modifier
                        .fillMaxWidth()
                        .height(48.dp)
                        .clickable { onFlip() }
                ) {
                    Box(contentAlignment = Alignment.Center) {
                        Text(
                            text = "Antwort zeigen",
                            color = Color(0xFF081018),
                            fontSize = 15.sp,
                            fontWeight = FontWeight.Bold
                        )
                    }
                }
            } else {
                // 4 FSRS-Buttons mit echten Intervallen aus core.reviewPreview
                val againLabel = reviewIntervals.getOrNull(0) ?: "10m"
                val hardLabel = reviewIntervals.getOrNull(1) ?: "1d"
                val goodLabel = reviewIntervals.getOrNull(2) ?: "3d"
                val easyLabel = reviewIntervals.getOrNull(3) ?: "7d"

                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.spacedBy(8.dp)
                ) {
                    FsrsRatingButton(
                        label = "1 Nochmal",
                        interval = againLabel,
                        color = DangerRed,
                        onClick = { onGrade(1) },
                        modifier = Modifier.weight(1f)
                    )
                    FsrsRatingButton(
                        label = "2 Schwer",
                        interval = hardLabel,
                        color = WarningAmber,
                        onClick = { onGrade(2) },
                        modifier = Modifier.weight(1f)
                    )
                    FsrsRatingButton(
                        label = "3 Gut",
                        interval = goodLabel,
                        color = AccentBlue,
                        onClick = { onGrade(3) },
                        modifier = Modifier.weight(1f)
                    )
                    FsrsRatingButton(
                        label = "4 Leicht",
                        interval = easyLabel,
                        color = SuccessGreen,
                        onClick = { onGrade(4) },
                        modifier = Modifier.weight(1f)
                    )
                }
            }
        }
    }
}

@Composable
private fun FsrsRatingButton(
    label: String,
    interval: String,
    color: Color,
    onClick: () -> Unit,
    modifier: Modifier = Modifier
) {
    Surface(
        shape = RoundedCornerShape(10.dp),
        color = BgBubble,
        border = BorderStroke(1.dp, color.copy(alpha = 0.4f)),
        modifier = modifier
            .height(52.dp)
            .clickable { onClick() }
    ) {
        Column(
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.Center,
            modifier = Modifier.fillMaxSize()
        ) {
            Text(text = label, color = color, fontSize = 12.sp, fontWeight = FontWeight.Bold)
            Text(text = interval, color = TextMuted, fontSize = 11.sp)
        }
    }
}

// ============================================================================
// 3. KARTEN-BROWSER TAB
// ============================================================================

@Composable
private fun CardBrowserTab(
    core: ImpalaCore,
    decks: List<DeckOverview>,
    onMutation: () -> Unit,
    modifier: Modifier = Modifier
) {
    val coroutineScope = rememberCoroutineScope()
    var searchQuery by remember { mutableStateOf("") }
    var selectedDeckFilter by remember { mutableStateOf<String?>(null) }
    var loadedCards by remember { mutableStateOf<List<CardInfo>>(emptyList()) }

    fun refreshCards() {
        coroutineScope.launch(Dispatchers.IO) {
            val deckName = selectedDeckFilter ?: decks.firstOrNull()?.name ?: "Standard"
            val cards = try {
                core.cardsInDeckTree(deckName, false)
            } catch (_: Exception) {
                emptyList()
            }
            withContext(Dispatchers.Main) {
                loadedCards = cards
            }
        }
    }

    LaunchedEffect(selectedDeckFilter, decks) {
        refreshCards()
    }

    val filteredCards = remember(loadedCards, searchQuery) {
        if (searchQuery.isBlank()) loadedCards
        else loadedCards.filter {
            it.front.contains(searchQuery, ignoreCase = true) ||
            it.back.contains(searchQuery, ignoreCase = true)
        }
    }

    Column(
        modifier = modifier
            .fillMaxSize()
            .padding(horizontal = 16.dp, vertical = 12.dp),
        verticalArrangement = Arrangement.spacedBy(10.dp)
    ) {
        // Suchfeld & Deck-Auswahl
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(8.dp)
        ) {
            BasicTextField(
                value = searchQuery,
                onValueChange = { searchQuery = it },
                textStyle = TextStyle(color = TextMain, fontSize = 13.sp),
                cursorBrush = SolidColor(AccentBlue),
                decorationBox = { innerTextField ->
                    Row(
                        verticalAlignment = Alignment.CenterVertically,
                        modifier = Modifier
                            .fillMaxWidth()
                            .height(38.dp)
                            .clip(RoundedCornerShape(8.dp))
                            .background(BgBubble)
                            .border(1.dp, BorderHairline, RoundedCornerShape(8.dp))
                            .padding(horizontal = 10.dp)
                    ) {
                        Icon(Icons.Rounded.Search, contentDescription = null, tint = TextMuted, modifier = Modifier.size(16.dp))
                        Spacer(modifier = Modifier.width(6.dp))
                        if (searchQuery.isEmpty()) {
                            Text("Karten durchsuchen...", color = TextMuted, fontSize = 13.sp)
                        } else {
                            innerTextField()
                        }
                    }
                },
                modifier = Modifier.weight(1f)
            )
        }

        // Kartenliste
        LazyColumn(
            modifier = Modifier.weight(1f),
            verticalArrangement = Arrangement.spacedBy(8.dp)
        ) {
            if (filteredCards.isEmpty()) {
                item {
                    Text(
                        text = "Keine Karten gefunden.",
                        color = TextMuted,
                        fontSize = 13.sp,
                        modifier = Modifier.padding(20.dp)
                    )
                }
            } else {
                items(filteredCards, key = { it.id }) { card ->
                    Surface(
                        color = BgCard,
                        shape = RoundedCornerShape(8.dp),
                        border = BorderStroke(1.dp, BorderHairline),
                        modifier = Modifier.fillMaxWidth()
                    ) {
                        Row(
                            modifier = Modifier
                                .fillMaxWidth()
                                .padding(12.dp),
                            horizontalArrangement = Arrangement.SpaceBetween,
                            verticalAlignment = Alignment.CenterVertically
                        ) {
                            Column(modifier = Modifier.weight(1f)) {
                                Text(
                                    text = card.front,
                                    color = TextMain,
                                    fontSize = 13.sp,
                                    fontWeight = FontWeight.Medium,
                                    maxLines = 2,
                                    overflow = TextOverflow.Ellipsis
                                )
                                Text(
                                    text = card.back,
                                    color = TextMuted,
                                    fontSize = 12.sp,
                                    maxLines = 1,
                                    overflow = TextOverflow.Ellipsis
                                )
                            }

                            IconButton(
                                onClick = {
                                    coroutineScope.launch(Dispatchers.IO) {
                                        try {
                                            core.deleteCard(card.id)
                                            refreshCards()
                                            onMutation()
                                        } catch (_: Exception) {}
                                    }
                                },
                                modifier = Modifier.size(28.dp)
                            ) {
                                Icon(
                                    imageVector = Icons.Rounded.Delete,
                                    contentDescription = "Löschen",
                                    tint = DangerRed.copy(alpha = 0.8f),
                                    modifier = Modifier.size(16.dp)
                                )
                            }
                        }
                    }
                }
            }

            item {
                Spacer(modifier = Modifier.height(24.dp).navigationBarsPadding())
            }
        }
    }
}

// ============================================================================
// 4. STATISTIK TAB
// ============================================================================

@Composable
private fun StudyStatsTab(
    core: ImpalaCore,
    decks: List<DeckOverview>,
    modifier: Modifier = Modifier
) {
    val totalDue = decks.sumOf { (it.review + it.learn).toInt() }
    val totalNew = decks.sumOf { it.new.toInt() }
    val totalCards = decks.sumOf { it.total.toInt() }

    Column(
        modifier = modifier
            .fillMaxSize()
            .padding(16.dp)
            .verticalScroll(rememberScrollState()),
        verticalArrangement = Arrangement.spacedBy(14.dp)
    ) {
        Text("FSRS-5 Lernstatistik", color = TextMain, fontSize = 16.sp, fontWeight = FontWeight.Bold)

        Surface(
            color = BgCard,
            shape = RoundedCornerShape(12.dp),
            border = BorderStroke(1.dp, BorderHairline),
            modifier = Modifier.fillMaxWidth()
        ) {
            Column(modifier = Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                Text("Übersicht", color = TextSecondary, fontSize = 13.sp, fontWeight = FontWeight.SemiBold)

                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceBetween
                ) {
                    Text("Gesamtzahl Karten:", color = TextMuted, fontSize = 13.sp)
                    Text("$totalCards", color = TextMain, fontSize = 13.sp, fontWeight = FontWeight.Bold)
                }

                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceBetween
                ) {
                    Text("Heute fällig:", color = TextMuted, fontSize = 13.sp)
                    Text("$totalDue", color = AccentBlue, fontSize = 13.sp, fontWeight = FontWeight.Bold)
                }

                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceBetween
                ) {
                    Text("Noch nie gelernt (neu):", color = TextMuted, fontSize = 13.sp)
                    Text("$totalNew", color = SuccessGreen, fontSize = 13.sp, fontWeight = FontWeight.Bold)
                }
            }
        }

        Spacer(modifier = Modifier.height(24.dp).navigationBarsPadding())
    }
}

// ============================================================================
// 5. ARCHIV TAB
// ============================================================================

@Composable
private fun ArchivedDecksTab(
    archivedDecks: List<DeckInfo>,
    onRestore: (String) -> Unit,
    modifier: Modifier = Modifier
) {
    LazyColumn(
        modifier = modifier.fillMaxSize(),
        contentPadding = PaddingValues(16.dp),
        verticalArrangement = Arrangement.spacedBy(10.dp)
    ) {
        item {
            Text("Archivierte Stapel", color = TextMain, fontSize = 16.sp, fontWeight = FontWeight.Bold)
        }

        if (archivedDecks.isEmpty()) {
            item {
                Text("Keine archivierten Stapel vorhanden.", color = TextMuted, fontSize = 13.sp)
            }
        } else {
            items(archivedDecks, key = { it.name }) { deck ->
                Surface(
                    color = BgCard,
                    shape = RoundedCornerShape(10.dp),
                    border = BorderStroke(1.dp, BorderHairline),
                    modifier = Modifier.fillMaxWidth()
                ) {
                    Row(
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(14.dp),
                        horizontalArrangement = Arrangement.SpaceBetween,
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        Text(deck.name, color = TextMain, fontSize = 14.sp)
                        TextButton(onClick = { onRestore(deck.name) }) {
                            Text("Wiederherstellen", color = AccentBlue, fontSize = 12.sp)
                        }
                    }
                }
            }
        }

        item {
            Spacer(modifier = Modifier.height(24.dp).navigationBarsPadding())
        }
    }
}

// ============================================================================
// Cloze Hilfsfunktionen
// ============================================================================

private val CLOZE_REGEX = Regex("""\{\{c\d+::(.*?)\}\}""")

private fun renderClozeFront(text: String): String {
    return CLOZE_REGEX.replace(text) { "[...]" }
}

private fun renderClozeBack(text: String): String {
    return CLOZE_REGEX.replace(text) { matchResult ->
        matchResult.groupValues.getOrNull(1) ?: matchResult.value
    }
}
