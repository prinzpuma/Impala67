package org.impala67.app.ui.screens

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.expandVertically
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.shrinkVertically
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.ClickableText
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.rounded.ArrowForward
import androidx.compose.material.icons.automirrored.rounded.Note
import androidx.compose.material.icons.rounded.Add
import androidx.compose.material.icons.rounded.Analytics
import androidx.compose.material.icons.rounded.AutoAwesome
import androidx.compose.material.icons.rounded.AutoStories
import androidx.compose.material.icons.rounded.Calculate
import androidx.compose.material.icons.rounded.CameraAlt
import androidx.compose.material.icons.rounded.CheckCircle
import androidx.compose.material.icons.rounded.CloudDone
import androidx.compose.material.icons.rounded.CloudOff
import androidx.compose.material.icons.rounded.CloudSync
import androidx.compose.material.icons.rounded.DeleteOutline
import androidx.compose.material.icons.rounded.Description
import androidx.compose.material.icons.rounded.EditNote
import androidx.compose.material.icons.rounded.ExpandLess
import androidx.compose.material.icons.rounded.ExpandMore
import androidx.compose.material.icons.rounded.Hub
import androidx.compose.material.icons.rounded.LibraryBooks
import androidx.compose.material.icons.rounded.LocalFireDepartment
import androidx.compose.material.icons.rounded.Psychology
import androidx.compose.material.icons.rounded.School
import androidx.compose.material.icons.rounded.Settings
import androidx.compose.material.icons.rounded.WarningAmber
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.Surface
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
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.impala67.app.data.ImpalaRepository
import org.impala67.app.data.SyncUiModel
import org.impala67.app.ui.theme.Accent
import org.impala67.app.ui.theme.AccentBorder
import org.impala67.app.ui.theme.AccentSoft
import org.impala67.app.ui.theme.BgBubble
import org.impala67.app.ui.theme.BgDeep
import org.impala67.app.ui.theme.BgPanel
import org.impala67.app.ui.theme.BgSidebar
import org.impala67.app.ui.theme.Danger
import org.impala67.app.ui.theme.DangerBorder
import org.impala67.app.ui.theme.DangerSoft
import org.impala67.app.ui.theme.Edge
import org.impala67.app.ui.theme.EdgeSoft
import org.impala67.app.ui.theme.ImpalaPillShape
import org.impala67.app.ui.theme.Success
import org.impala67.app.ui.theme.SuccessBorder
import org.impala67.app.ui.theme.SuccessSoft
import org.impala67.app.ui.theme.SurfaceActive
import org.impala67.app.ui.theme.SurfaceHover
import org.impala67.app.ui.theme.SurfaceSubtle
import org.impala67.app.ui.theme.TextMuted
import org.impala67.app.ui.theme.TextPrimary
import org.impala67.app.ui.theme.TextSecondary
import org.impala67.app.ui.theme.Warn
import org.impala67.app.ui.theme.WarnSoft
import uniffi.impala_ffi.ArticleSource
import uniffi.impala_ffi.CardInfo
import uniffi.impala_ffi.CardStage
import uniffi.impala_ffi.DeckOverview
import uniffi.impala_ffi.HomeArticleInfo
import uniffi.impala_ffi.HomeArticleInput
import uniffi.impala_ffi.ImpalaCore
import uniffi.impala_ffi.LearningSessionInfo
import uniffi.impala_ffi.PageDetail
import uniffi.impala_ffi.PageKind
import uniffi.impala_ffi.PageSummary
import java.time.Instant
import java.time.LocalDate
import java.time.LocalTime
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.time.temporal.ChronoUnit
import java.util.Locale
import java.util.TimeZone
import kotlin.math.max
import kotlin.math.roundToInt

/**
 * Überladung für bestehende Aufrufer (z.B. ImpalaAppShell mit core & syncUiModel).
 */
@Composable
fun HomeScreen(
    core: ImpalaCore,
    syncUiModel: SyncUiModel?,
    onOpenNote: (String) -> Unit,
    onOpenHeft: (String) -> Unit,
    onStartStudy: (String?) -> Unit,
    onScanDocument: () -> Unit,
    onOpenSyncAndSettings: () -> Unit,
    onOpenLibrary: () -> Unit = {},
    onOpenTrash: () -> Unit = {},
    onOpenGraph: () -> Unit = {},
    onOpenNotebookLm: () -> Unit = {},
    onOpenGrades: () -> Unit = {},
    onOpenAiChat: () -> Unit = {},
    modifier: Modifier = Modifier
) {
    val scope = rememberCoroutineScope()
    val isSyncConfigured = syncUiModel != null && syncUiModel !is SyncUiModel.Disconnected

    HomeViewContent(
        core = core,
        externalPages = null,
        externalDecks = null,
        syncUiModel = syncUiModel,
        isSyncConfigured = isSyncConfigured,
        favoritePageIds = emptySet(),
        onOpenPage = { pageId ->
            scope.launch(Dispatchers.IO) {
                val pg = runCatching { core.page(pageId) }.getOrNull()
                withContext(Dispatchers.Main) {
                    if (pg?.summary?.kind == PageKind.HEFT) {
                        onOpenHeft(pageId)
                    } else {
                        onOpenNote(pageId)
                    }
                }
            }
        },
        onCreatePage = { isHeft ->
            scope.launch(Dispatchers.IO) {
                try {
                    if (isHeft) {
                        val id = core.createHeft("Neues Heft", null, null)
                        withContext(Dispatchers.Main) { onOpenHeft(id) }
                    } else {
                        val id = core.createPage("Neue Notiz", "", null, null)
                        withContext(Dispatchers.Main) { onOpenNote(id) }
                    }
                } catch (_: Exception) {
                }
            }
        },
        onOpenStudy = { onStartStudy(null) },
        onOpenAiChat = onOpenAiChat,
        onOpenSettings = onOpenSyncAndSettings,
        onOpenLibrary = onOpenLibrary,
        onOpenTrash = onOpenTrash,
        onOpenGraph = onOpenGraph,
        onOpenNotebookLm = onOpenNotebookLm,
        onOpenGrades = onOpenGrades,
        onScanDocument = onScanDocument,
        modifier = modifier
    )
}

/**
 * Vollständige Startseite nach dem Vorbild von `web/home-view.js` & `web/home.css`.
 */
@Composable
fun HomeScreen(
    repository: ImpalaRepository,
    core: ImpalaCore = repository.core,
    pages: List<PageSummary> = emptyList(),
    decks: List<DeckOverview> = emptyList(),
    studyStats: Any? = null,
    syncState: Any? = null,
    favoritePageIds: Set<String> = emptySet(),
    onOpenPage: (String) -> Unit,
    onCreatePage: (isHeft: Boolean) -> Unit,
    onOpenStudy: () -> Unit,
    onOpenAiChat: () -> Unit = {},
    onOpenSettings: () -> Unit,
    onOpenSearch: () -> Unit = {},
    onOpenLibrary: () -> Unit = {},
    onOpenTrash: () -> Unit = {},
    onOpenGraph: () -> Unit = {},
    onOpenNotebookLm: () -> Unit = {},
    onOpenGrades: () -> Unit = {},
    onScanDocument: () -> Unit = {},
    modifier: Modifier = Modifier
) {
    val syncUiModel = syncState as? SyncUiModel
    val isSyncConfigured = !repository.securePrefs.cfSyncKey.isNullOrBlank() ||
        repository.driveAuthManager.isConfigured() ||
        (syncUiModel != null && syncUiModel !is SyncUiModel.Disconnected)

    HomeViewContent(
        core = core,
        externalPages = pages.takeIf { it.isNotEmpty() },
        externalDecks = decks.takeIf { it.isNotEmpty() },
        syncUiModel = syncUiModel,
        isSyncConfigured = isSyncConfigured,
        favoritePageIds = favoritePageIds,
        onOpenPage = onOpenPage,
        onCreatePage = onCreatePage,
        onOpenStudy = onOpenStudy,
        onOpenAiChat = onOpenAiChat,
        onOpenSettings = onOpenSettings,
        onOpenLibrary = onOpenLibrary,
        onOpenTrash = onOpenTrash,
        onOpenGraph = onOpenGraph,
        onOpenNotebookLm = onOpenNotebookLm,
        onOpenGrades = onOpenGrades,
        onScanDocument = onScanDocument,
        modifier = modifier
    )
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun HomeViewContent(
    core: ImpalaCore,
    externalPages: List<PageSummary>?,
    externalDecks: List<DeckOverview>?,
    syncUiModel: SyncUiModel?,
    isSyncConfigured: Boolean,
    favoritePageIds: Set<String>,
    onOpenPage: (String) -> Unit,
    onCreatePage: (isHeft: Boolean) -> Unit,
    onOpenStudy: () -> Unit,
    onOpenAiChat: () -> Unit,
    onOpenSettings: () -> Unit,
    onOpenLibrary: () -> Unit,
    onOpenTrash: () -> Unit,
    onOpenGraph: () -> Unit,
    onOpenNotebookLm: () -> Unit,
    onOpenGrades: () -> Unit,
    onScanDocument: () -> Unit,
    modifier: Modifier = Modifier
) {
    val coroutineScope = rememberCoroutineScope()

    var loadedPages by remember { mutableStateOf<List<PageSummary>>(emptyList()) }
    var loadedDecks by remember { mutableStateOf<List<DeckOverview>>(emptyList()) }
    var allCards by remember { mutableStateOf<List<CardInfo>>(emptyList()) }
    var sessions by remember { mutableStateOf<List<LearningSessionInfo>>(emptyList()) }
    var articles by remember { mutableStateOf<List<HomeArticleInfo>>(emptyList()) }
    var conflictCount by remember { mutableIntStateOf(0) }
    var lastPageDetail by remember { mutableStateOf<PageDetail?>(null) }
    var lastHeftPageCount by remember { mutableIntStateOf(1) }

    var weeklyGoalMin by remember { mutableIntStateOf(150) }
    var showGoalDialog by remember { mutableStateOf(false) }
    var isNewPageMenuOpen by remember { mutableStateOf(false) }
    var isRecallExpanded by remember { mutableStateOf(false) }
    var isArticleExpanded by remember { mutableStateOf(true) }
    var isAnalyticsExpanded by remember { mutableStateOf(false) }

    val utcOffsetMinutes = remember {
        TimeZone.getDefault().getOffset(System.currentTimeMillis()) / (1000 * 60)
    }

    fun refreshHomeData() {
        coroutineScope.launch(Dispatchers.IO) {
            runCatching {
                val recents = core.recentPages(24u)
                val deckList = core.deckOverview(utcOffsetMinutes, false)
                val cardList = deckList.flatMap { d ->
                    runCatching { core.cardsInDeck(d.name) }.getOrDefault(emptyList())
                }.distinctBy { it.id }
                val sess = core.learningSessions()
                val arts = core.homeArticles(10u)
                val conflicts = core.conflicts().size
                val topPage = (externalPages ?: recents).maxByOrNull { it.updated }
                val detail = topPage?.let { core.page(it.id) }
                val heftCount = if (topPage?.kind == PageKind.HEFT) {
                    core.heftPageIds(topPage.id).size.coerceAtLeast(1)
                } else 1

                withContext(Dispatchers.Main) {
                    loadedPages = recents
                    loadedDecks = deckList
                    allCards = cardList
                    sessions = sess
                    articles = arts
                    conflictCount = conflicts
                    lastPageDetail = detail
                    lastHeftPageCount = heftCount
                }
            }
        }
    }

    LaunchedEffect(externalPages, externalDecks) {
        refreshHomeData()
    }

    val pages = externalPages ?: loadedPages
    val decks = externalDecks ?: loadedDecks

    val lastPage = remember(pages) { pages.maxByOrNull { it.updated } }
    val nextRecentPages = remember(pages, lastPage) {
        pages.sortedByDescending { it.updated }
            .filter { it.id != lastPage?.id }
            .take(3)
    }

    val pinnedPages = remember(pages, favoritePageIds) {
        if (favoritePageIds.isNotEmpty()) {
            pages.filter { it.id in favoritePageIds }.take(6)
        } else {
            pages.take(5)
        }
    }

    // Fällige Karten & Schätzung
    val totalDue = remember(decks) {
        decks.filter { !it.name.contains("::") }.sumOf { (it.new + it.learn + it.review).toInt() }
            .takeIf { it > 0 }
            ?: decks.sumOf { (it.new + it.learn + it.review).toInt() }
    }
    val estMinutes = remember(totalDue) { max(1, (totalDue * 20.0 / 60.0).roundToInt()) }

    // Wochen-Lernzeit (Mo..So) & Streak berechnen
    val today = remember { LocalDate.now() }
    val todayDayIdx = remember(today) { today.dayOfWeek.value - 1 } // 0 = Mo .. 6 = So
    val weekStart = remember(today) { today.minusDays(todayDayIdx.toLong()) }

    val weekMinutesByDay = remember(sessions, weekStart) {
        val mins = FloatArray(7)
        for (s in sessions) {
            val date = parseIsoLocalDate(s.startedAt) ?: continue
            val diff = ChronoUnit.DAYS.between(weekStart, date).toInt()
            if (diff in 0..6) {
                mins[diff] += s.durationSeconds.toFloat() / 60f
            }
        }
        mins.toList()
    }
    val totalWeekMinutes = remember(weekMinutesByDay) { weekMinutesByDay.sum().roundToInt() }
    val todayMinutes = remember(weekMinutesByDay, todayDayIdx) {
        weekMinutesByDay.getOrElse(todayDayIdx) { 0f }.roundToInt()
    }

    val streakDays = remember(sessions, today) {
        val activeDays = sessions.mapNotNull { parseIsoLocalDate(it.startedAt) }.toSet()
        var streak = 0
        var cursor = if (today in activeDays) today else today.minusDays(1)
        while (cursor in activeDays) {
            streak++
            cursor = cursor.minusDays(1)
        }
        streak
    }

    // "Weißt du's noch?" Karte
    val recallCard = remember(allCards, today) {
        val pool = allCards.filter {
            !it.suspended && !it.trashed && !it.archived && it.front.trim().length >= 3
        }
        if (pool.isEmpty()) null
        else {
            val idx = ((today.toEpochDay() * 2654435761L).ushr(1) % pool.size.toLong()).toInt()
            pool[idx]
        }
    }

    // Formatiertes Datum auf Deutsch
    val dateLine = remember(today) {
        val fmt = DateTimeFormatter.ofPattern("EEEE, d. MMMM", Locale.GERMAN)
        today.format(fmt).replaceFirstChar { if (it.isLowerCase()) it.titlecase(Locale.GERMAN) else it.toString() }
    }

    // Tageszeitabhängiger Gruß
    val greeting = remember {
        val hour = LocalTime.now().hour
        when {
            hour < 5 -> "Noch wach?"
            hour < 11 -> "Guten Morgen"
            hour < 14 -> "Guten Tag"
            hour < 18 -> "Schönen Nachmittag"
            else -> "Guten Abend"
        }
    }

    BoxWithConstraints(
        modifier = modifier
            .fillMaxSize()
            .background(BgPanel)
    ) {
        val isWide = maxWidth >= 600.dp

        LazyColumn(
            modifier = Modifier
                .fillMaxSize()
                .navigationBarsPadding(),
            contentPadding = PaddingValues(
                start = if (isWide) 28.dp else 16.dp,
                end = if (isWide) 28.dp else 16.dp,
                top = 20.dp,
                bottom = 96.dp
            ),
            verticalArrangement = Arrangement.spacedBy(18.dp)
        ) {
            // 1. Top Row (hv-top): Datum links, "+ Neue Seite" & Zahnrad rechts
            item {
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Text(
                        text = dateLine,
                        color = TextMuted,
                        fontSize = 13.sp,
                        fontWeight = FontWeight.Medium
                    )

                    Row(
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(8.dp)
                    ) {
                        // Sync-Status Indikator
                        if (syncUiModel != null) {
                            SyncStatusBadge(
                                syncUiModel = syncUiModel,
                                onClick = onOpenSettings
                            )
                        }

                        // Kompakter Pill-Button "+ Neue Seite" mit Auswahlmenü
                        Box {
                            Surface(
                                shape = ImpalaPillShape,
                                color = BgSidebar,
                                border = BorderStroke(1.dp, Edge),
                                modifier = Modifier
                                    .clip(ImpalaPillShape)
                                    .clickable { isNewPageMenuOpen = true }
                            ) {
                                Row(
                                    modifier = Modifier.padding(horizontal = 12.dp, vertical = 6.dp),
                                    verticalAlignment = Alignment.CenterVertically
                                ) {
                                    Icon(
                                        imageVector = Icons.Rounded.Add,
                                        contentDescription = null,
                                        tint = TextPrimary,
                                        modifier = Modifier.size(15.dp)
                                    )
                                    Spacer(modifier = Modifier.width(4.dp))
                                    Text(
                                        text = "Neue Seite",
                                        color = TextPrimary,
                                        fontSize = 12.sp,
                                        fontWeight = FontWeight.Medium
                                    )
                                }
                            }

                            DropdownMenu(
                                expanded = isNewPageMenuOpen,
                                onDismissRequest = { isNewPageMenuOpen = false },
                                modifier = Modifier.background(BgSidebar)
                            ) {
                                DropdownMenuItem(
                                    text = { Text("📝 Notion-Seite (Markdown)", color = TextPrimary, fontSize = 13.sp) },
                                    onClick = {
                                        isNewPageMenuOpen = false
                                        onCreatePage(false)
                                    }
                                )
                                DropdownMenuItem(
                                    text = { Text("📓 GoodNotes-Heft (Stift & Papier)", color = TextPrimary, fontSize = 13.sp) },
                                    onClick = {
                                        isNewPageMenuOpen = false
                                        onCreatePage(true)
                                    }
                                )
                                DropdownMenuItem(
                                    text = { Text("📷 Dokument scannen", color = TextPrimary, fontSize = 13.sp) },
                                    onClick = {
                                        isNewPageMenuOpen = false
                                        onScanDocument()
                                    }
                                )
                            }
                        }

                        // Icon-Button ⚙️ (32.dp rund mit feinem Border)
                        Surface(
                            shape = CircleShape,
                            color = BgSidebar,
                            border = BorderStroke(1.dp, EdgeSoft),
                            modifier = Modifier
                                .size(32.dp)
                                .clip(CircleShape)
                                .clickable { onOpenSettings() }
                        ) {
                            Box(contentAlignment = Alignment.Center) {
                                Icon(
                                    imageVector = Icons.Rounded.Settings,
                                    contentDescription = "Einstellungen",
                                    tint = TextSecondary,
                                    modifier = Modifier.size(16.dp)
                                )
                            }
                        }
                    }
                }
            }

            // 2. Warn-/Sync-Banner (hv-alerts)
            if (conflictCount > 0 || !isSyncConfigured) {
                item {
                    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                        if (conflictCount > 0) {
                            Surface(
                                shape = RoundedCornerShape(12.dp),
                                color = DangerSoft,
                                border = BorderStroke(1.dp, DangerBorder),
                                modifier = Modifier
                                    .fillMaxWidth()
                                    .clip(RoundedCornerShape(12.dp))
                                    .clickable { onOpenSettings() }
                            ) {
                                Row(
                                    modifier = Modifier.padding(horizontal = 14.dp, vertical = 10.dp),
                                    verticalAlignment = Alignment.CenterVertically,
                                    horizontalArrangement = Arrangement.SpaceBetween
                                ) {
                                    Row(
                                        verticalAlignment = Alignment.CenterVertically,
                                        modifier = Modifier.weight(1f)
                                    ) {
                                        Icon(
                                            imageVector = Icons.Rounded.WarningAmber,
                                            contentDescription = null,
                                            tint = Danger,
                                            modifier = Modifier.size(16.dp)
                                        )
                                        Spacer(modifier = Modifier.width(8.dp))
                                        Text(
                                            text = if (conflictCount == 1) {
                                                "1 Sync-Konflikt wartet auf Lösung"
                                            } else {
                                                "$conflictCount Sync-Konflikte warten auf Lösung"
                                            },
                                            color = TextPrimary,
                                            fontSize = 12.sp,
                                            fontWeight = FontWeight.Medium
                                        )
                                    }
                                    Text(
                                        text = "Lösen →",
                                        color = Danger,
                                        fontSize = 12.sp,
                                        fontWeight = FontWeight.SemiBold
                                    )
                                }
                            }
                        }

                        if (!isSyncConfigured) {
                            Surface(
                                shape = RoundedCornerShape(12.dp),
                                color = WarnSoft,
                                border = BorderStroke(1.dp, Warn.copy(alpha = 0.45f)),
                                modifier = Modifier
                                    .fillMaxWidth()
                                    .clip(RoundedCornerShape(12.dp))
                                    .clickable { onOpenSettings() }
                            ) {
                                Row(
                                    modifier = Modifier.padding(horizontal = 14.dp, vertical = 10.dp),
                                    verticalAlignment = Alignment.CenterVertically,
                                    horizontalArrangement = Arrangement.SpaceBetween
                                ) {
                                    Text(
                                        text = "Kein Backup eingerichtet – Notizen liegen nur auf diesem Gerät",
                                        color = TextPrimary,
                                        fontSize = 12.sp,
                                        modifier = Modifier.weight(1f)
                                    )
                                    Spacer(modifier = Modifier.width(8.dp))
                                    Text(
                                        text = "Sync einrichten",
                                        color = Warn,
                                        fontSize = 12.sp,
                                        fontWeight = FontWeight.SemiBold
                                    )
                                }
                            }
                        }
                    }
                }
            }

            // 3. Begrüßungs-Leitsatz (hv-lead)
            item {
                GreetingLeadSection(
                    greeting = greeting,
                    pagesEmpty = pages.isEmpty() && allCards.isEmpty(),
                    dueCount = totalDue,
                    estMinutes = estMinutes,
                    todayMinutes = todayMinutes,
                    hasCards = allCards.isNotEmpty(),
                    streakDays = streakDays,
                    onOpenStudy = onOpenStudy
                )
            }

            // 4. Haupt-Grid (hv-grid — 2 Spalten ab 600.dp mit 60% links / 40% rechts, sonst 1 Spalte)
            item {
                if (isWide) {
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.spacedBy(16.dp),
                        verticalAlignment = Alignment.Top
                    ) {
                        Column(
                            modifier = Modifier.weight(0.6f),
                            verticalArrangement = Arrangement.spacedBy(14.dp)
                        ) {
                            LeftMainColumn(
                                lastPage = lastPage,
                                lastPageDetail = lastPageDetail,
                                lastHeftPageCount = lastHeftPageCount,
                                nextRecentPages = nextRecentPages,
                                pinnedPages = pinnedPages,
                                recallCard = recallCard,
                                isRecallExpanded = isRecallExpanded,
                                onToggleRecall = { isRecallExpanded = !isRecallExpanded },
                                onOpenPage = onOpenPage,
                                onCreatePage = onCreatePage,
                                onScanDocument = onScanDocument,
                                onOpenAiChat = onOpenAiChat,
                                onOpenStudy = onOpenStudy,
                                onOpenLibrary = onOpenLibrary,
                                onOpenGraph = onOpenGraph,
                                onOpenNotebookLm = onOpenNotebookLm,
                                onOpenGrades = onOpenGrades,
                                onOpenTrash = onOpenTrash
                            )
                        }

                        Column(
                            modifier = Modifier.weight(0.4f),
                            verticalArrangement = Arrangement.spacedBy(14.dp)
                        ) {
                            RightStatsColumn(
                                totalDue = totalDue,
                                estMinutes = estMinutes,
                                hasCards = allCards.isNotEmpty(),
                                todayMinutes = todayMinutes,
                                weekMinutesByDay = weekMinutesByDay,
                                totalWeekMinutes = totalWeekMinutes,
                                weeklyGoalMin = weeklyGoalMin,
                                todayDayIdx = todayDayIdx,
                                streakDays = streakDays,
                                onOpenStudy = onOpenStudy,
                                onEditGoal = { showGoalDialog = true }
                            )
                        }
                    }
                } else {
                    Column(
                        modifier = Modifier.fillMaxWidth(),
                        verticalArrangement = Arrangement.spacedBy(14.dp)
                    ) {
                        LeftMainColumn(
                            lastPage = lastPage,
                            lastPageDetail = lastPageDetail,
                            lastHeftPageCount = lastHeftPageCount,
                            nextRecentPages = nextRecentPages,
                            pinnedPages = pinnedPages,
                            recallCard = recallCard,
                            isRecallExpanded = isRecallExpanded,
                            onToggleRecall = { isRecallExpanded = !isRecallExpanded },
                            onOpenPage = onOpenPage,
                            onCreatePage = onCreatePage,
                            onScanDocument = onScanDocument,
                            onOpenAiChat = onOpenAiChat,
                            onOpenStudy = onOpenStudy,
                            onOpenLibrary = onOpenLibrary,
                            onOpenGraph = onOpenGraph,
                            onOpenNotebookLm = onOpenNotebookLm,
                            onOpenGrades = onOpenGrades,
                            onOpenTrash = onOpenTrash
                        )

                        RightStatsColumn(
                            totalDue = totalDue,
                            estMinutes = estMinutes,
                            hasCards = allCards.isNotEmpty(),
                            todayMinutes = todayMinutes,
                            weekMinutesByDay = weekMinutesByDay,
                            totalWeekMinutes = totalWeekMinutes,
                            weeklyGoalMin = weeklyGoalMin,
                            todayDayIdx = todayDayIdx,
                            streakDays = streakDays,
                            onOpenStudy = onOpenStudy,
                            onEditGoal = { showGoalDialog = true }
                        )
                    }
                }
            }

            // 5. Tagesartikel (hv-article)
            item {
                DailyArticleSection(
                    articles = articles,
                    pages = pages,
                    isExpanded = isArticleExpanded,
                    onToggleExpand = { isArticleExpanded = !isArticleExpanded },
                    onOpenPage = onOpenPage,
                    onMarkRead = { articleId ->
                        coroutineScope.launch(Dispatchers.IO) {
                            runCatching { core.markHomeArticleRead(articleId) }
                            refreshHomeData()
                        }
                    },
                    onGenerateArticle = {
                        coroutineScope.launch(Dispatchers.IO) {
                            runCatching {
                                val topSources = pages.take(3)
                                val snippetBuilder = StringBuilder()
                                for (src in topSources) {
                                    val detail = core.page(src.id)
                                    val clean = cleanMarkdownExcerpt(src.title, detail?.content ?: "")
                                        .joinToString(" ")
                                    if (clean.isNotBlank()) {
                                        snippetBuilder.append("### ${src.title}\n$clean\n\n")
                                    }
                                }
                                val bodyText = if (snippetBuilder.isNotEmpty()) {
                                    "Zusammenfassung deiner aktuellen Schwerpunkte:\n\n$snippetBuilder"
                                } else {
                                    "Halte deine wichtigsten Gedanken in Notizen oder Heften fest – hier erscheint täglich dein persönlicher Wissensimpuls."
                                }
                                core.saveHomeArticle(
                                    HomeArticleInput(
                                        id = null,
                                        day = LocalDate.now().toString(),
                                        title = topSources.firstOrNull()?.let { "Impuls: ${it.title}" }
                                            ?: "Dein täglicher Wissens-Impuls",
                                        body = bodyText.trim(),
                                        topics = topSources.map { it.title.take(20) },
                                        focus = topSources.firstOrNull()?.title,
                                        sources = topSources.map {
                                            ArticleSource(id = it.id, title = it.title, archived = false)
                                        }
                                    )
                                )
                            }
                            refreshHomeData()
                        }
                    }
                )
            }

            // 6. Lernanalyse (la Expandable Section)
            item {
                LearningAnalyticsSection(
                    isExpanded = isAnalyticsExpanded,
                    onToggleExpand = { isAnalyticsExpanded = !isAnalyticsExpanded },
                    sessions = sessions,
                    decks = decks,
                    allCards = allCards,
                    totalWeekMinutes = totalWeekMinutes
                )
            }
        }
    }

    if (showGoalDialog) {
        WeeklyGoalDialog(
            currentGoal = weeklyGoalMin,
            onDismiss = { showGoalDialog = false },
            onSelectGoal = { newGoal ->
                weeklyGoalMin = newGoal
                showGoalDialog = false
            }
        )
    }
}

@Composable
private fun SyncStatusBadge(
    syncUiModel: SyncUiModel,
    onClick: () -> Unit
) {
    val isSyncing = syncUiModel is SyncUiModel.Syncing
    val hasError = syncUiModel is SyncUiModel.Error
    val isDisconnected = syncUiModel is SyncUiModel.Disconnected

    val syncIcon = when {
        hasError -> Icons.Rounded.CloudOff
        isSyncing -> Icons.Rounded.CloudSync
        isDisconnected -> Icons.Rounded.CloudOff
        else -> Icons.Rounded.CloudDone
    }
    val syncColor = when {
        hasError -> Danger
        isSyncing -> Accent
        isDisconnected -> TextMuted
        else -> Success
    }
    val syncText = when (syncUiModel) {
        is SyncUiModel.Syncing -> syncUiModel.label.ifEmpty { "Sync…" }
        is SyncUiModel.Error -> "Sync-Fehler"
        is SyncUiModel.Disconnected -> "Offline"
        is SyncUiModel.Idle -> "Bereit"
        is SyncUiModel.Synced -> "Aktuell"
    }

    Surface(
        shape = ImpalaPillShape,
        color = BgSidebar,
        border = BorderStroke(1.dp, EdgeSoft),
        modifier = Modifier
            .clip(ImpalaPillShape)
            .clickable(onClick = onClick)
    ) {
        Row(
            modifier = Modifier.padding(horizontal = 10.dp, vertical = 6.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            Icon(
                imageVector = syncIcon,
                contentDescription = "Sync",
                tint = syncColor,
                modifier = Modifier.size(14.dp)
            )
            Spacer(modifier = Modifier.width(5.dp))
            Text(
                text = syncText,
                color = TextSecondary,
                fontSize = 11.sp
            )
        }
    }
}

@Composable
private fun GreetingLeadSection(
    greeting: String,
    pagesEmpty: Boolean,
    dueCount: Int,
    estMinutes: Int,
    todayMinutes: Int,
    hasCards: Boolean,
    streakDays: Int,
    onOpenStudy: () -> Unit
) {
    val annotated = buildAnnotatedString {
        withStyle(SpanStyle(color = TextPrimary, fontWeight = FontWeight.SemiBold)) {
            append("$greeting. ")
        }
        when {
            pagesEmpty -> {
                withStyle(SpanStyle(color = TextSecondary)) {
                    append("Willkommen! Lege deine erste Notiz an oder richte den Sync ein.")
                }
            }
            dueCount > 0 -> {
                pushStringAnnotation(tag = "STUDY", annotation = "study")
                withStyle(
                    SpanStyle(
                        color = Accent,
                        fontWeight = FontWeight.SemiBold,
                        textDecoration = TextDecoration.Underline
                    )
                ) {
                    append("$dueCount ${if (dueCount == 1) "Karte" else "Karten"}")
                }
                pop()
                withStyle(SpanStyle(color = TextSecondary)) {
                    append(
                        " ${if (dueCount == 1) "wartet" else "warten"}, etwa $estMinutes ${if (estMinutes == 1) "Minute" else "Minuten"}."
                    )
                }
            }
            hasCards -> {
                withStyle(SpanStyle(color = TextSecondary)) {
                    if (todayMinutes > 0) {
                        append("Heute schon ${formatDurationMin(todayMinutes)} gelernt — alles erledigt.")
                    } else {
                        append("Für heute ist alles gelernt.")
                    }
                }
            }
            else -> {
                withStyle(SpanStyle(color = TextSecondary)) {
                    append("Noch keine Karteikarten angelegt.")
                }
            }
        }
        if (streakDays > 0 && todayMinutes == 0 && LocalTime.now().hour >= 14) {
            withStyle(SpanStyle(color = Warn)) {
                append(" Dein Streak von $streakDays ${if (streakDays == 1) "Tag" else "Tagen"} wartet noch auf heute.")
            }
        }
    }

    ClickableText(
        text = annotated,
        style = TextStyle(
            fontSize = 21.sp,
            lineHeight = 29.sp
        ),
        onClick = { offset ->
            annotated.getStringAnnotations(tag = "STUDY", start = offset, end = offset)
                .firstOrNull()?.let { onOpenStudy() }
        }
    )
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun LeftMainColumn(
    lastPage: PageSummary?,
    lastPageDetail: PageDetail?,
    lastHeftPageCount: Int,
    nextRecentPages: List<PageSummary>,
    pinnedPages: List<PageSummary>,
    recallCard: CardInfo?,
    isRecallExpanded: Boolean,
    onToggleRecall: () -> Unit,
    onOpenPage: (String) -> Unit,
    onCreatePage: (isHeft: Boolean) -> Unit,
    onScanDocument: () -> Unit,
    onOpenAiChat: () -> Unit,
    onOpenStudy: () -> Unit,
    onOpenLibrary: () -> Unit,
    onOpenGraph: () -> Unit,
    onOpenNotebookLm: () -> Unit,
    onOpenGrades: () -> Unit,
    onOpenTrash: () -> Unit
) {
    // Weitermachen-Karte (hv-continue)
    ContinueCard(
        lastPage = lastPage,
        lastPageDetail = lastPageDetail,
        heftPageCount = lastHeftPageCount,
        onOpenPage = onOpenPage,
        onCreateFirstPage = { onCreatePage(false) }
    )

    // Kompakte Liste der nächsten 3 kürzlich bearbeiteten Seiten (hv-recent-row)
    if (nextRecentPages.isNotEmpty()) {
        Surface(
            shape = RoundedCornerShape(14.dp),
            color = BgSidebar,
            border = BorderStroke(1.dp, EdgeSoft),
            modifier = Modifier.fillMaxWidth()
        ) {
            Column(modifier = Modifier.padding(vertical = 6.dp)) {
                nextRecentPages.forEachIndexed { index, pg ->
                    if (index > 0) {
                        HorizontalDivider(color = EdgeSoft, modifier = Modifier.padding(horizontal = 12.dp))
                    }
                    Row(
                        modifier = Modifier
                            .fillMaxWidth()
                            .clickable { onOpenPage(pg.id) }
                            .padding(horizontal = 14.dp, vertical = 9.dp),
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.SpaceBetween
                    ) {
                        Row(
                            verticalAlignment = Alignment.CenterVertically,
                            modifier = Modifier.weight(1f)
                        ) {
                            Icon(
                                imageVector = if (pg.kind == PageKind.HEFT) Icons.Rounded.AutoStories else Icons.AutoMirrored.Rounded.Note,
                                contentDescription = null,
                                tint = if (pg.kind == PageKind.HEFT) Warn else Accent,
                                modifier = Modifier.size(16.dp)
                            )
                            Spacer(modifier = Modifier.width(10.dp))
                            Text(
                                text = pg.title.ifEmpty { "Ohne Titel" },
                                color = TextPrimary,
                                fontSize = 13.sp,
                                fontWeight = FontWeight.Medium,
                                maxLines = 1,
                                overflow = TextOverflow.Ellipsis
                            )
                        }
                        Spacer(modifier = Modifier.width(8.dp))
                        Text(
                            text = formatRelativeTime(pg.updated),
                            color = TextMuted,
                            fontSize = 11.sp
                        )
                    }
                }
            }
        }
    }

    // Angeheftet / Favoriten & Schnellzugriff-Pills (hv-pins)
    FlowRow(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.spacedBy(8.dp),
        verticalArrangement = Arrangement.spacedBy(8.dp)
    ) {
        for (pin in pinnedPages) {
            PinPillChip(
                label = pin.title.ifEmpty { "Ohne Titel" },
                icon = if (pin.kind == PageKind.HEFT) "📓" else "📄",
                onClick = { onOpenPage(pin.id) }
            )
        }
        PinPillChip(
            label = "Neues Heft",
            icon = "📓",
            accent = true,
            onClick = { onCreatePage(true) }
        )
        PinPillChip(
            label = "Scan",
            icon = "📷",
            accent = true,
            onClick = onScanDocument
        )
        PinPillChip(
            label = "KI-Coach",
            icon = "✦",
            accent = true,
            onClick = onOpenAiChat
        )
        PinPillChip(
            label = "Bibliothek",
            icon = "📚",
            onClick = onOpenLibrary
        )
        PinPillChip(
            label = "Wissensgraph",
            icon = "🕸️",
            onClick = onOpenGraph
        )
        PinPillChip(
            label = "Gemini Notebook",
            icon = "✨",
            onClick = onOpenNotebookLm
        )
        PinPillChip(
            label = "Schulnoten",
            icon = "🎓",
            onClick = onOpenGrades
        )
        PinPillChip(
            label = "Papierkorb",
            icon = "🗑️",
            onClick = onOpenTrash
        )
    }

    // "Weißt du's noch?" (hv-recall)
    if (recallCard != null) {
        RecallCardSection(
            card = recallCard,
            isExpanded = isRecallExpanded,
            onToggle = onToggleRecall,
            onOpenStudy = onOpenStudy
        )
    }
}

@Composable
private fun ContinueCard(
    lastPage: PageSummary?,
    lastPageDetail: PageDetail?,
    heftPageCount: Int,
    onOpenPage: (String) -> Unit,
    onCreateFirstPage: () -> Unit
) {
    Surface(
        shape = RoundedCornerShape(16.dp),
        color = BgSidebar,
        border = BorderStroke(1.dp, Edge),
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(16.dp))
            .clickable {
                if (lastPage != null) onOpenPage(lastPage.id) else onCreateFirstPage()
            }
    ) {
        if (lastPage == null) {
            Row(
                modifier = Modifier.padding(18.dp),
                verticalAlignment = Alignment.CenterVertically
            ) {
                Box(
                    modifier = Modifier
                        .size(64.dp)
                        .clip(RoundedCornerShape(12.dp))
                        .background(SurfaceSubtle)
                        .border(1.dp, EdgeSoft, RoundedCornerShape(12.dp)),
                    contentAlignment = Alignment.Center
                ) {
                    Text("+", color = TextMuted, fontSize = 24.sp, fontWeight = FontWeight.Light)
                }
                Spacer(modifier = Modifier.width(16.dp))
                Column {
                    Text(
                        text = "NOCH KEINE SEITEN",
                        color = TextMuted,
                        fontSize = 10.sp,
                        fontWeight = FontWeight.Bold,
                        letterSpacing = 0.8.sp
                    )
                    Spacer(modifier = Modifier.height(4.dp))
                    Text(
                        text = "Erste Seite anlegen",
                        color = TextPrimary,
                        fontSize = 16.sp,
                        fontWeight = FontWeight.SemiBold
                    )
                }
            }
        } else {
            val isHeft = lastPage.kind == PageKind.HEFT
            val excerptLines = remember(lastPage.id, lastPageDetail?.content) {
                cleanMarkdownExcerpt(lastPage.title, lastPageDetail?.content ?: "")
            }

            Column(modifier = Modifier.padding(14.dp)) {
                // Visueller Preview-Kasten (hv-continue-preview)
                Box(
                    modifier = Modifier
                        .fillMaxWidth()
                        .height(92.dp)
                        .clip(RoundedCornerShape(10.dp))
                        .background(if (isHeft) Color(0xFF1B222C) else BgDeep.copy(alpha = 0.65f))
                        .border(1.dp, EdgeSoft, RoundedCornerShape(10.dp))
                ) {
                    if (isHeft) {
                        // Karo-/Linien-Papier-Vorschau
                        Canvas(modifier = Modifier.fillMaxSize()) {
                            val step = 18.dp.toPx()
                            var x = step
                            while (x < size.width) {
                                drawLine(
                                    color = Color.White.copy(alpha = 0.05f),
                                    start = Offset(x, 0f),
                                    end = Offset(x, size.height),
                                    strokeWidth = 1f
                                )
                                x += step
                            }
                            var y = step
                            while (y < size.height) {
                                drawLine(
                                    color = Color.White.copy(alpha = 0.05f),
                                    start = Offset(0f, y),
                                    end = Offset(size.width, y),
                                    strokeWidth = 1f
                                )
                                y += step
                            }
                            // Dekorative Handschrift-Wellenlinie
                            drawLine(
                                color = Accent.copy(alpha = 0.45f),
                                start = Offset(step * 1.5f, step * 2f),
                                end = Offset(step * 6.5f, step * 2f),
                                strokeWidth = 3.5f
                            )
                            drawLine(
                                color = Warn.copy(alpha = 0.4f),
                                start = Offset(step * 1.5f, step * 3.1f),
                                end = Offset(step * 4.8f, step * 3.1f),
                                strokeWidth = 3f
                            )
                        }
                        Surface(
                            shape = ImpalaPillShape,
                            color = BgSidebar.copy(alpha = 0.9f),
                            border = BorderStroke(1.dp, Edge),
                            modifier = Modifier
                                .align(Alignment.BottomEnd)
                                .padding(8.dp)
                        ) {
                            Row(
                                modifier = Modifier.padding(horizontal = 8.dp, vertical = 4.dp),
                                verticalAlignment = Alignment.CenterVertically
                            ) {
                                Icon(
                                    imageVector = Icons.Rounded.AutoStories,
                                    contentDescription = null,
                                    tint = Warn,
                                    modifier = Modifier.size(13.dp)
                                )
                                Spacer(modifier = Modifier.width(4.dp))
                                Text(
                                    text = "$heftPageCount ${if (heftPageCount == 1) "Seite" else "Seiten"}",
                                    color = TextPrimary,
                                    fontSize = 10.sp,
                                    fontWeight = FontWeight.Medium
                                )
                            }
                        }
                    } else {
                        Column(
                            modifier = Modifier
                                .fillMaxSize()
                                .padding(horizontal = 12.dp, vertical = 10.dp),
                            verticalArrangement = Arrangement.spacedBy(4.dp)
                        ) {
                            if (excerptLines.isEmpty()) {
                                Text(
                                    text = "Leere Seite – tippe hier, um weiterzuschreiben…",
                                    color = TextMuted,
                                    fontSize = 12.sp,
                                    fontStyle = FontStyle.Italic
                                )
                            } else {
                                excerptLines.take(3).forEach { line ->
                                    Text(
                                        text = line,
                                        color = TextSecondary,
                                        fontSize = 12.sp,
                                        maxLines = 1,
                                        overflow = TextOverflow.Ellipsis
                                    )
                                }
                            }
                        }
                    }
                }

                Spacer(modifier = Modifier.height(12.dp))

                Row(
                    modifier = Modifier.fillMaxWidth(),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.SpaceBetween
                ) {
                    Column(modifier = Modifier.weight(1f)) {
                        Text(
                            text = "WEITERMACHEN",
                            color = TextMuted,
                            fontSize = 10.sp,
                            fontWeight = FontWeight.Bold,
                            letterSpacing = 0.8.sp
                        )
                        Spacer(modifier = Modifier.height(2.dp))
                        Text(
                            text = lastPage.title.ifEmpty { "Ohne Titel" },
                            color = TextPrimary,
                            fontSize = 16.sp,
                            fontWeight = FontWeight.SemiBold,
                            maxLines = 1,
                            overflow = TextOverflow.Ellipsis
                        )
                        Spacer(modifier = Modifier.height(2.dp))
                        val metaPrefix = if (isHeft) {
                            "Heft · $heftPageCount ${if (heftPageCount == 1) "Seite" else "Seiten"}"
                        } else {
                            "Notiz"
                        }
                        val rel = formatRelativeTime(lastPage.updated)
                        Text(
                            text = if (rel.isNotEmpty()) "$metaPrefix · $rel" else metaPrefix,
                            color = TextMuted,
                            fontSize = 12.sp
                        )
                    }

                    Icon(
                        imageVector = Icons.AutoMirrored.Rounded.ArrowForward,
                        contentDescription = "Öffnen",
                        tint = TextSecondary,
                        modifier = Modifier.size(18.dp)
                    )
                }
            }
        }
    }
}

@Composable
private fun PinPillChip(
    label: String,
    icon: String,
    accent: Boolean = false,
    onClick: () -> Unit
) {
    Surface(
        shape = ImpalaPillShape,
        color = if (accent) AccentSoft else BgSidebar,
        border = BorderStroke(1.dp, if (accent) AccentBorder else EdgeSoft),
        modifier = Modifier
            .clip(ImpalaPillShape)
            .clickable(onClick = onClick)
    ) {
        Row(
            modifier = Modifier.padding(horizontal = 11.dp, vertical = 6.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            Text(text = icon, fontSize = 12.sp)
            Spacer(modifier = Modifier.width(6.dp))
            Text(
                text = label,
                color = if (accent) TextPrimary else TextSecondary,
                fontSize = 12.sp,
                fontWeight = FontWeight.Medium,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis
            )
        }
    }
}

@Composable
private fun RecallCardSection(
    card: CardInfo,
    isExpanded: Boolean,
    onToggle: () -> Unit,
    onOpenStudy: () -> Unit
) {
    val clozeRegex = remember { Regex("""\{\{c\d+::(.*?)(?:::[^}]*)?\}\}""") }
    val hasCloze = remember(card.front) { clozeRegex.containsMatchIn(card.front) }
    val question = remember(card.front, hasCloze) {
        val raw = if (hasCloze) card.front.replace(clozeRegex, "＿＿＿") else card.front
        stripMarkdownInline(raw).take(160)
    }
    val answer = remember(card.front, card.back, hasCloze) {
        val raw = if (hasCloze) {
            clozeRegex.findAll(card.front).map { it.groupValues[1] }.joinToString(" · ")
        } else {
            card.back
        }
        stripMarkdownInline(raw).take(260)
    }

    Surface(
        shape = RoundedCornerShape(14.dp),
        color = BgSidebar,
        border = BorderStroke(1.dp, EdgeSoft),
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(14.dp))
            .clickable(onClick = onToggle)
    ) {
        Column(modifier = Modifier.padding(14.dp)) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically
            ) {
                Text(
                    text = "💭 Weißt du's noch?",
                    color = TextMuted,
                    fontSize = 11.sp,
                    fontWeight = FontWeight.SemiBold
                )
                Text(
                    text = if (isExpanded) "Antwort verbergen" else "Antwort zeigen",
                    color = Accent,
                    fontSize = 11.sp,
                    fontWeight = FontWeight.Medium
                )
            }

            Spacer(modifier = Modifier.height(6.dp))

            Text(
                text = question,
                color = TextPrimary,
                fontSize = 14.sp,
                fontWeight = FontWeight.Medium
            )

            AnimatedVisibility(
                visible = isExpanded,
                enter = expandVertically() + fadeIn(),
                exit = shrinkVertically() + fadeOut()
            ) {
                Column(modifier = Modifier.padding(top = 10.dp)) {
                    HorizontalDivider(color = EdgeSoft)
                    Spacer(modifier = Modifier.height(8.dp))
                    Text(
                        text = answer.ifEmpty { "—" },
                        color = TextSecondary,
                        fontSize = 13.sp
                    )
                    Spacer(modifier = Modifier.height(8.dp))
                    Text(
                        text = "Jetzt alle fälligen lernen →",
                        color = Accent,
                        fontSize = 12.sp,
                        fontWeight = FontWeight.SemiBold,
                        modifier = Modifier
                            .clip(RoundedCornerShape(6.dp))
                            .clickable(onClick = onOpenStudy)
                            .padding(vertical = 2.dp)
                    )
                }
            }
        }
    }
}

@Composable
private fun RightStatsColumn(
    totalDue: Int,
    estMinutes: Int,
    hasCards: Boolean,
    todayMinutes: Int,
    weekMinutesByDay: List<Float>,
    totalWeekMinutes: Int,
    weeklyGoalMin: Int,
    todayDayIdx: Int,
    streakDays: Int,
    onOpenStudy: () -> Unit,
    onEditGoal: () -> Unit
) {
    // Stat-Karte 1: Heute fällig (hv-stat hv-cards)
    val isDue = totalDue > 0
    Surface(
        shape = RoundedCornerShape(16.dp),
        color = if (isDue) AccentSoft else BgSidebar,
        border = BorderStroke(1.dp, if (isDue) AccentBorder else EdgeSoft),
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(16.dp))
            .clickable(onClick = onOpenStudy)
    ) {
        Column(modifier = Modifier.padding(16.dp)) {
            Text(
                text = "HEUTE FÄLLIG",
                color = if (isDue) Accent else TextMuted,
                fontSize = 10.sp,
                fontWeight = FontWeight.Bold,
                letterSpacing = 0.8.sp
            )
            Spacer(modifier = Modifier.height(6.dp))
            if (isDue) {
                Text(
                    text = "$totalDue ${if (totalDue == 1) "Karte" else "Karten"}",
                    color = TextPrimary,
                    fontSize = 24.sp,
                    fontWeight = FontWeight.Bold
                )
                Spacer(modifier = Modifier.height(4.dp))
                Text(
                    text = "~$estMinutes Min. · Jetzt lernen →",
                    color = Accent,
                    fontSize = 12.sp,
                    fontWeight = FontWeight.SemiBold
                )
            } else if (hasCards) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Icon(
                        imageVector = Icons.Rounded.CheckCircle,
                        contentDescription = null,
                        tint = Success,
                        modifier = Modifier.size(22.dp)
                    )
                    Spacer(modifier = Modifier.width(8.dp))
                    Text(
                        text = "Heute alles gelernt",
                        color = TextPrimary,
                        fontSize = 18.sp,
                        fontWeight = FontWeight.Bold
                    )
                }
                Spacer(modifier = Modifier.height(4.dp))
                Text(
                    text = if (todayMinutes > 0) "${formatDurationMin(todayMinutes)} heute wiederholt" else "Morgen geht's weiter",
                    color = TextSecondary,
                    fontSize = 12.sp
                )
            } else {
                Text(
                    text = "Keine Karten",
                    color = TextPrimary,
                    fontSize = 18.sp,
                    fontWeight = FontWeight.SemiBold
                )
                Spacer(modifier = Modifier.height(4.dp))
                Text(
                    text = "Karten anlegen →",
                    color = TextMuted,
                    fontSize = 12.sp
                )
            }
        }
    }

    // Stat-Karte 2: Diese Woche gelernt (hv-stat hv-week)
    val goalPct = (totalWeekMinutes.toFloat() / weeklyGoalMin.coerceAtLeast(1).toFloat()).coerceIn(0f, 1f)
    val dayNames = listOf("Mo", "Di", "Mi", "Do", "Fr", "Sa", "So")
    val maxDayScale = max(weeklyGoalMin / 7f, (weekMinutesByDay.maxOrNull() ?: 1f)).coerceAtLeast(1f)

    Surface(
        shape = RoundedCornerShape(16.dp),
        color = BgSidebar,
        border = BorderStroke(1.dp, if (goalPct >= 1f) SuccessBorder else EdgeSoft),
        modifier = Modifier.fillMaxWidth()
    ) {
        Column(modifier = Modifier.padding(16.dp)) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically
            ) {
                Text(
                    text = "DIESE WOCHE GELERNT",
                    color = TextMuted,
                    fontSize = 10.sp,
                    fontWeight = FontWeight.Bold,
                    letterSpacing = 0.8.sp
                )

                if (streakDays > 0) {
                    Surface(
                        shape = ImpalaPillShape,
                        color = WarnSoft,
                        border = BorderStroke(1.dp, Warn.copy(alpha = 0.4f))
                    ) {
                        Row(
                            modifier = Modifier.padding(horizontal = 8.dp, vertical = 2.dp),
                            verticalAlignment = Alignment.CenterVertically
                        ) {
                            Text(
                                text = "🔥 $streakDays ${if (streakDays == 1) "Tag" else "Tage"}",
                                color = Warn,
                                fontSize = 10.sp,
                                fontWeight = FontWeight.SemiBold
                            )
                        }
                    }
                }
            }

            Spacer(modifier = Modifier.height(6.dp))

            Row(verticalAlignment = Alignment.Bottom) {
                Text(
                    text = formatDurationMin(totalWeekMinutes),
                    color = TextPrimary,
                    fontSize = 22.sp,
                    fontWeight = FontWeight.Bold
                )
                Spacer(modifier = Modifier.width(6.dp))
                Text(
                    text = if (goalPct >= 1f) "· Ziel geschafft!" else "von ${formatDurationMin(weeklyGoalMin)}",
                    color = if (goalPct >= 1f) Success else TextMuted,
                    fontSize = 12.sp,
                    modifier = Modifier.padding(bottom = 2.dp)
                )
            }

            Spacer(modifier = Modifier.height(10.dp))

            // Fortschrittsbalken (hv-goalbar)
            Box(
                modifier = Modifier
                    .fillMaxWidth()
                    .height(6.dp)
                    .clip(ImpalaPillShape)
                    .background(BgBubble)
            ) {
                Box(
                    modifier = Modifier
                        .fillMaxWidth(goalPct)
                        .fillMaxHeight()
                        .clip(ImpalaPillShape)
                        .background(if (goalPct >= 1f) Success else Accent)
                )
            }

            Spacer(modifier = Modifier.height(14.dp))

            // Mo-So Balkendiagramm (hv-bars)
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .height(68.dp),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.Bottom
            ) {
                dayNames.forEachIndexed { idx, label ->
                    val mins = weekMinutesByDay.getOrElse(idx) { 0f }
                    val ratio = if (mins >= 1f) (mins / maxDayScale).coerceIn(0.12f, 1f) else 0.04f
                    val isToday = idx == todayDayIdx
                    val barColor = when {
                        isToday -> Accent
                        mins >= 1f -> Accent.copy(alpha = 0.5f)
                        else -> EdgeSoft
                    }

                    Column(
                        horizontalAlignment = Alignment.CenterHorizontally,
                        verticalArrangement = Arrangement.Bottom,
                        modifier = Modifier
                            .weight(1f)
                            .fillMaxHeight()
                    ) {
                        Box(
                            modifier = Modifier
                                .weight(1f)
                                .width(14.dp)
                                .clip(RoundedCornerShape(4.dp))
                                .background(SurfaceSubtle),
                            contentAlignment = Alignment.BottomCenter
                        ) {
                            Box(
                                modifier = Modifier
                                    .fillMaxWidth()
                                    .fillMaxHeight(ratio)
                                    .clip(RoundedCornerShape(4.dp))
                                    .background(barColor)
                            )
                        }
                        Spacer(modifier = Modifier.height(4.dp))
                        Text(
                            text = label,
                            color = if (isToday) Accent else TextMuted,
                            fontSize = 10.sp,
                            fontWeight = if (isToday) FontWeight.Bold else FontWeight.Normal
                        )
                    }
                }
            }

            Spacer(modifier = Modifier.height(10.dp))

            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically
            ) {
                Text(
                    text = if (streakDays > 0) "$streakDays ${if (streakDays == 1) "Tag" else "Tage"} in Folge" else "Heute lernen startet einen Streak",
                    color = TextMuted,
                    fontSize = 11.sp
                )
                Text(
                    text = "Ziel ändern",
                    color = Accent,
                    fontSize = 11.sp,
                    fontWeight = FontWeight.Medium,
                    modifier = Modifier
                        .clip(RoundedCornerShape(4.dp))
                        .clickable(onClick = onEditGoal)
                        .padding(horizontal = 4.dp, vertical = 2.dp)
                )
            }
        }
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun DailyArticleSection(
    articles: List<HomeArticleInfo>,
    pages: List<PageSummary>,
    isExpanded: Boolean,
    onToggleExpand: () -> Unit,
    onOpenPage: (String) -> Unit,
    onMarkRead: (String) -> Unit,
    onGenerateArticle: () -> Unit
) {
    val latest = articles.firstOrNull()

    Surface(
        shape = RoundedCornerShape(16.dp),
        color = BgSidebar,
        border = BorderStroke(1.dp, EdgeSoft),
        modifier = Modifier.fillMaxWidth()
    ) {
        Column(modifier = Modifier.padding(16.dp)) {
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .clickable(onClick = onToggleExpand),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically
            ) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Icon(
                        imageVector = Icons.Rounded.AutoAwesome,
                        contentDescription = null,
                        tint = Warn,
                        modifier = Modifier.size(16.dp)
                    )
                    Spacer(modifier = Modifier.width(8.dp))
                    Text(
                        text = if (latest != null) "TAGESARTIKEL · ${latest.day}" else "TAGESARTIKEL",
                        color = TextMuted,
                        fontSize = 11.sp,
                        fontWeight = FontWeight.Bold,
                        letterSpacing = 0.8.sp
                    )
                }

                Icon(
                    imageVector = if (isExpanded) Icons.Rounded.ExpandLess else Icons.Rounded.ExpandMore,
                    contentDescription = null,
                    tint = TextMuted,
                    modifier = Modifier.size(18.dp)
                )
            }

            if (latest == null) {
                Spacer(modifier = Modifier.height(10.dp))
                Text(
                    text = "Lass dir aus deinen aktuellen Notizen einen kompakten Tagesartikel zusammenstellen.",
                    color = TextSecondary,
                    fontSize = 13.sp
                )
                Spacer(modifier = Modifier.height(10.dp))
                Surface(
                    shape = ImpalaPillShape,
                    color = AccentSoft,
                    border = BorderStroke(1.dp, AccentBorder),
                    modifier = Modifier
                        .clip(ImpalaPillShape)
                        .clickable(onClick = onGenerateArticle)
                ) {
                    Text(
                        text = "✨ Tagesartikel aus deinen Notizen generieren",
                        color = TextPrimary,
                        fontSize = 12.sp,
                        fontWeight = FontWeight.Medium,
                        modifier = Modifier.padding(horizontal = 14.dp, vertical = 8.dp)
                    )
                }
            } else {
                Spacer(modifier = Modifier.height(8.dp))
                val readTimeMin = max(1, latest.body.split(Regex("\\s+")).size / 180)
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Text(
                        text = latest.title,
                        color = TextPrimary,
                        fontSize = 16.sp,
                        fontWeight = FontWeight.SemiBold,
                        modifier = Modifier.weight(1f)
                    )
                    Spacer(modifier = Modifier.width(8.dp))
                    Text(
                        text = "~$readTimeMin Min. Lesezeit",
                        color = TextMuted,
                        fontSize = 11.sp
                    )
                }

                AnimatedVisibility(
                    visible = isExpanded,
                    enter = expandVertically() + fadeIn(),
                    exit = shrinkVertically() + fadeOut()
                ) {
                    Column(modifier = Modifier.padding(top = 10.dp)) {
                        Text(
                            text = latest.body,
                            color = TextSecondary,
                            fontSize = 13.sp,
                            lineHeight = 20.sp
                        )

                        if (latest.sources.isNotEmpty()) {
                            Spacer(modifier = Modifier.height(12.dp))
                            FlowRow(
                                horizontalArrangement = Arrangement.spacedBy(6.dp),
                                verticalArrangement = Arrangement.spacedBy(6.dp)
                            ) {
                                for (src in latest.sources) {
                                    Surface(
                                        shape = ImpalaPillShape,
                                        color = BgBubble,
                                        border = BorderStroke(1.dp, EdgeSoft),
                                        modifier = Modifier
                                            .clip(ImpalaPillShape)
                                            .clickable { onOpenPage(src.id) }
                                    ) {
                                        Text(
                                            text = "📄 ${src.title.ifEmpty { "Quelle" }}",
                                            color = TextSecondary,
                                            fontSize = 11.sp,
                                            modifier = Modifier.padding(horizontal = 10.dp, vertical = 4.dp)
                                        )
                                    }
                                }
                            }
                        }

                        Spacer(modifier = Modifier.height(10.dp))
                        Row(
                            modifier = Modifier.fillMaxWidth(),
                            horizontalArrangement = Arrangement.SpaceBetween,
                            verticalAlignment = Alignment.CenterVertically
                        ) {
                            if (latest.readAt == null) {
                                Text(
                                    text = "✓ Als gelesen markieren",
                                    color = Success,
                                    fontSize = 12.sp,
                                    fontWeight = FontWeight.Medium,
                                    modifier = Modifier
                                        .clip(RoundedCornerShape(6.dp))
                                        .clickable { onMarkRead(latest.id) }
                                        .padding(vertical = 4.dp)
                                )
                            } else {
                                Text(
                                    text = "✓ Gelesen",
                                    color = TextMuted,
                                    fontSize = 12.sp
                                )
                            }

                            Text(
                                text = "Neu generieren",
                                color = Accent,
                                fontSize = 12.sp,
                                modifier = Modifier
                                    .clip(RoundedCornerShape(6.dp))
                                    .clickable(onClick = onGenerateArticle)
                                    .padding(vertical = 4.dp)
                            )
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun LearningAnalyticsSection(
    isExpanded: Boolean,
    onToggleExpand: () -> Unit,
    sessions: List<LearningSessionInfo>,
    decks: List<DeckOverview>,
    allCards: List<CardInfo>,
    totalWeekMinutes: Int
) {
    val avgPerDay = (totalWeekMinutes / 7.0).roundToInt()
    val totalCardsCount = allCards.size

    // Zeit nach Fach / Stapel
    val subjectMinutes = remember(sessions) {
        val map = mutableMapOf<String, Long>()
        for (s in sessions) {
            val key = s.subject?.takeIf { it.isNotBlank() }
                ?: when (s.category) {
                    "cards" -> "Karteikarten"
                    "notebook" -> "Hefte"
                    "notes" -> "Notizen"
                    "ai" -> "KI-Coach"
                    else -> "Allgemein"
                }
            map[key] = (map[key] ?: 0L) + (s.durationSeconds.toLong() / 60L)
        }
        map.entries.sortedByDescending { it.value }.take(5)
    }

    // Fällige Karten nächste 7 Tage
    val today = remember { LocalDate.now() }
    val forecast7Days = remember(allCards, today) {
        val counts = IntArray(7)
        for (card in allCards) {
            if (card.suspended || card.trashed || card.archived) continue
            val dueDate = parseIsoLocalDate(card.due)
            if (dueDate == null) {
                if (card.stage == CardStage.NEW) counts[0]++
            } else {
                val diff = ChronoUnit.DAYS.between(today, dueDate).toInt()
                when {
                    diff <= 0 -> counts[0]++
                    diff in 1..6 -> counts[diff]++
                }
            }
        }
        counts.toList()
    }

    Surface(
        shape = RoundedCornerShape(16.dp),
        color = BgSidebar,
        border = BorderStroke(1.dp, EdgeSoft),
        modifier = Modifier.fillMaxWidth()
    ) {
        Column(modifier = Modifier.padding(16.dp)) {
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .clickable(onClick = onToggleExpand),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically
            ) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Icon(
                        imageVector = Icons.Rounded.Analytics,
                        contentDescription = null,
                        tint = Accent,
                        modifier = Modifier.size(18.dp)
                    )
                    Spacer(modifier = Modifier.width(8.dp))
                    Text(
                        text = "Lernanalyse",
                        color = TextPrimary,
                        fontSize = 15.sp,
                        fontWeight = FontWeight.SemiBold
                    )
                }

                Icon(
                    imageVector = if (isExpanded) Icons.Rounded.ExpandLess else Icons.Rounded.ExpandMore,
                    contentDescription = null,
                    tint = TextMuted,
                    modifier = Modifier.size(18.dp)
                )
            }

            AnimatedVisibility(
                visible = isExpanded,
                enter = expandVertically() + fadeIn(),
                exit = shrinkVertically() + fadeOut()
            ) {
                Column(
                    modifier = Modifier.padding(top = 14.dp),
                    verticalArrangement = Arrangement.spacedBy(16.dp)
                ) {
                    // 3 Summary-Zahlen
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.spacedBy(10.dp)
                    ) {
                        AnalyticsStatBox(
                            label = "Lernzeit (7 Tage)",
                            value = formatDurationMin(totalWeekMinutes),
                            modifier = Modifier.weight(1f)
                        )
                        AnalyticsStatBox(
                            label = "Ø pro Tag",
                            value = "$avgPerDay Min.",
                            modifier = Modifier.weight(1f)
                        )
                        AnalyticsStatBox(
                            label = "Karten gesamt",
                            value = "$totalCardsCount",
                            modifier = Modifier.weight(1f)
                        )
                    }

                    // Zeit nach Fach / Stapel
                    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                        Text(
                            text = "ZEIT NACH FACH / STAPEL",
                            color = TextMuted,
                            fontSize = 10.sp,
                            fontWeight = FontWeight.Bold,
                            letterSpacing = 0.8.sp
                        )
                        if (subjectMinutes.isEmpty()) {
                            Text(
                                text = "Noch keine Lernsitzungen aufgezeichnet.",
                                color = TextMuted,
                                fontSize = 12.sp
                            )
                        } else {
                            val maxSub = subjectMinutes.maxOf { it.value }.coerceAtLeast(1L)
                            for ((subj, mins) in subjectMinutes) {
                                Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                                    Row(
                                        modifier = Modifier.fillMaxWidth(),
                                        horizontalArrangement = Arrangement.SpaceBetween
                                    ) {
                                        Text(text = subj, color = TextPrimary, fontSize = 12.sp)
                                        Text(text = "$mins Min.", color = TextMuted, fontSize = 11.sp)
                                    }
                                    Box(
                                        modifier = Modifier
                                            .fillMaxWidth()
                                            .height(6.dp)
                                            .clip(ImpalaPillShape)
                                            .background(BgBubble)
                                    ) {
                                        Box(
                                            modifier = Modifier
                                                .fillMaxWidth((mins.toFloat() / maxSub.toFloat()).coerceIn(0.05f, 1f))
                                                .fillMaxHeight()
                                                .clip(ImpalaPillShape)
                                                .background(Accent)
                                        )
                                    }
                                }
                            }
                        }
                    }

                    // Fällige Karten · nächste 7 Tage
                    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                        Text(
                            text = "FÄLLIGE KARTEN · NÄCHSTE 7 TAGE",
                            color = TextMuted,
                            fontSize = 10.sp,
                            fontWeight = FontWeight.Bold,
                            letterSpacing = 0.8.sp
                        )
                        val maxForecast = (forecast7Days.maxOrNull() ?: 1).coerceAtLeast(1)
                        Row(
                            modifier = Modifier
                                .fillMaxWidth()
                                .height(64.dp),
                            horizontalArrangement = Arrangement.SpaceBetween,
                            verticalAlignment = Alignment.Bottom
                        ) {
                            forecast7Days.forEachIndexed { idx, count ->
                                val d = today.plusDays(idx.toLong())
                                val lbl = if (idx == 0) "Heute" else d.dayOfWeek.getDisplayName(
                                    java.time.format.TextStyle.SHORT,
                                    Locale.GERMAN
                                ).take(2)
                                val ratio = if (count > 0) (count.toFloat() / maxForecast.toFloat()).coerceIn(0.15f, 1f) else 0.05f

                                Column(
                                    horizontalAlignment = Alignment.CenterHorizontally,
                                    verticalArrangement = Arrangement.Bottom,
                                    modifier = Modifier
                                        .weight(1f)
                                        .fillMaxHeight()
                                ) {
                                    Text(
                                        text = if (count > 0) "$count" else "",
                                        color = TextMuted,
                                        fontSize = 9.sp
                                    )
                                    Box(
                                        modifier = Modifier
                                            .weight(1f)
                                            .width(14.dp)
                                            .clip(RoundedCornerShape(4.dp))
                                            .background(SurfaceSubtle),
                                        contentAlignment = Alignment.BottomCenter
                                    ) {
                                        Box(
                                            modifier = Modifier
                                                .fillMaxWidth()
                                                .fillMaxHeight(ratio)
                                                .clip(RoundedCornerShape(4.dp))
                                                .background(if (idx == 0) Warn else Accent)
                                        )
                                    }
                                    Spacer(modifier = Modifier.height(3.dp))
                                    Text(
                                        text = lbl,
                                        color = TextMuted,
                                        fontSize = 10.sp
                                    )
                                }
                            }
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun AnalyticsStatBox(
    label: String,
    value: String,
    modifier: Modifier = Modifier
) {
    Surface(
        shape = RoundedCornerShape(10.dp),
        color = BgBubble,
        border = BorderStroke(1.dp, EdgeSoft),
        modifier = modifier
    ) {
        Column(modifier = Modifier.padding(10.dp)) {
            Text(
                text = label,
                color = TextMuted,
                fontSize = 10.sp,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis
            )
            Spacer(modifier = Modifier.height(4.dp))
            Text(
                text = value,
                color = TextPrimary,
                fontSize = 15.sp,
                fontWeight = FontWeight.Bold
            )
        }
    }
}

@Composable
private fun WeeklyGoalDialog(
    currentGoal: Int,
    onDismiss: () -> Unit,
    onSelectGoal: (Int) -> Unit
) {
    val presets = listOf(60, 120, 150, 240, 300, 420)
    AlertDialog(
        onDismissRequest = onDismiss,
        containerColor = BgSidebar,
        title = { Text("Wochenziel anpassen", color = TextPrimary, fontSize = 17.sp, fontWeight = FontWeight.SemiBold) },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Text("Wie viele Minuten möchtest du pro Woche lernen?", color = TextSecondary, fontSize = 13.sp)
                for (preset in presets) {
                    val isSelected = preset == currentGoal
                    Surface(
                        shape = RoundedCornerShape(10.dp),
                        color = if (isSelected) AccentSoft else BgBubble,
                        border = BorderStroke(1.dp, if (isSelected) AccentBorder else EdgeSoft),
                        modifier = Modifier
                            .fillMaxWidth()
                            .clip(RoundedCornerShape(10.dp))
                            .clickable { onSelectGoal(preset) }
                    ) {
                        Row(
                            modifier = Modifier.padding(horizontal = 14.dp, vertical = 10.dp),
                            horizontalArrangement = Arrangement.SpaceBetween,
                            verticalAlignment = Alignment.CenterVertically
                        ) {
                            Text(
                                text = "${formatDurationMin(preset)} pro Woche",
                                color = TextPrimary,
                                fontSize = 13.sp,
                                fontWeight = if (isSelected) FontWeight.SemiBold else FontWeight.Normal
                            )
                            Text(
                                text = "Ø ${(preset / 7.0).roundToInt()} Min./Tag",
                                color = TextMuted,
                                fontSize = 11.sp
                            )
                        }
                    }
                }
            }
        },
        confirmButton = {
            TextButton(onClick = onDismiss) {
                Text("Schließen", color = Accent)
            }
        }
    )
}

// ============================================================================
// Hilfsfunktionen (entsprechend web/home-view.js)
// ============================================================================

private fun formatDurationMin(minutes: Int): String {
    val m = minutes.coerceAtLeast(0)
    val h = m / 60
    val rem = m % 60
    return when {
        h > 0 && rem > 0 -> "$h h $rem Min."
        h > 0 -> "$h h"
        else -> "$m Min."
    }
}

private fun parseIsoLocalDate(iso: String?): LocalDate? {
    if (iso.isNullOrBlank()) return null
    return runCatching {
        if (iso.length == 10) {
            LocalDate.parse(iso)
        } else {
            Instant.parse(iso).atZone(ZoneId.systemDefault()).toLocalDate()
        }
    }.getOrNull()
}

private fun formatRelativeTime(iso: String?): String {
    if (iso.isNullOrBlank()) return ""
    return runCatching {
        val instant = Instant.parse(iso)
        val now = Instant.now()
        val diffMin = ChronoUnit.MINUTES.between(instant, now)
        when {
            diffMin < 1 -> "gerade eben"
            diffMin < 60 -> "vor $diffMin Min."
            diffMin < 24 * 60 -> {
                val hours = diffMin / 60
                "vor $hours Std."
            }
            diffMin < 48 * 60 -> "gestern"
            else -> {
                val zdt = instant.atZone(ZoneId.systemDefault())
                DateTimeFormatter.ofPattern("d. MMM", Locale.GERMAN).format(zdt)
            }
        }
    }.getOrDefault("")
}

private fun cleanMarkdownExcerpt(title: String, content: String): List<String> {
    if (content.isBlank()) return emptyList()
    val normalizedTitle = title.trim().lowercase()
    return content.lineSequence()
        .map { line ->
            line.trim()
                .removePrefix("#").removePrefix("#").removePrefix("#").removePrefix("#")
                .removePrefix("- [ ]").removePrefix("- [x]")
                .removePrefix("- ").removePrefix("* ").removePrefix("> ")
                .replace(Regex("""!\[[^\]]*]\([^)]*\)"""), "")
                .replace(Regex("""\[([^\]]+)]\([^)]*\)"""), "$1")
                .replace("**", "")
                .replace("__", "")
                .replace("`", "")
                .trim()
        }
        .filter { it.isNotEmpty() && it.lowercase() != normalizedTitle }
        .take(3)
        .toList()
}

private fun stripMarkdownInline(md: String): String {
    return md
        .replace(Regex("""!\[[^\]]*]\([^)]*\)"""), "")
        .replace(Regex("""\[([^\]]+)]\([^)]*\)"""), "$1")
        .replace("**", "")
        .replace("__", "")
        .replace("`", "")
        .replace(Regex("""\s+"""), " ")
        .trim()
}
