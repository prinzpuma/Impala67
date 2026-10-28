package org.impala67.app.ui.navigation

import android.content.Context
import android.content.res.Configuration
import androidx.activity.compose.BackHandler
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.slideInHorizontally
import androidx.compose.animation.slideOutHorizontally
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.displayCutoutPadding
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.rounded.NavigateBefore
import androidx.compose.material.icons.automirrored.rounded.NavigateNext
import androidx.compose.material.icons.rounded.Add
import androidx.compose.material.icons.rounded.AutoAwesome
import androidx.compose.material.icons.rounded.Close
import androidx.compose.material.icons.rounded.Menu
import androidx.compose.material.icons.rounded.Search
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.VerticalDivider
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.impala67.app.data.ImpalaRepository
import org.impala67.app.data.SyncUiModel
import org.impala67.app.ui.components.ImpalaPwaSidebar
import org.impala67.app.ui.components.QuickSearchDialog
import org.impala67.app.ui.components.TemplatePickerDialog
import org.impala67.app.ui.editor.NoteEditorScreen
import org.impala67.app.ui.heft.HeftScreen
import org.impala67.app.ui.screens.AiChatSheet
import org.impala67.app.ui.screens.GradesScreen
import org.impala67.app.ui.screens.HomeScreen
import org.impala67.app.ui.screens.KnowledgeGraphScreen
import org.impala67.app.ui.screens.LibraryScreen
import org.impala67.app.ui.screens.NotebookLmScreen
import org.impala67.app.ui.screens.SettingsAndSyncSheet
import org.impala67.app.ui.screens.StudyScreen
import org.impala67.app.ui.screens.TrashScreen
import org.impala67.app.ui.theme.AccentBlue
import org.impala67.app.ui.theme.AccentBlueSoft
import org.impala67.app.ui.theme.AccentBorder
import org.impala67.app.ui.theme.BgBubble
import org.impala67.app.ui.theme.BgCard
import org.impala67.app.ui.theme.BgElevated
import org.impala67.app.ui.theme.BgPanel
import org.impala67.app.ui.theme.BgSidebar
import org.impala67.app.ui.theme.BorderHairline
import org.impala67.app.ui.theme.BorderStrong
import org.impala67.app.ui.theme.IMPALA_UI_PREFS
import org.impala67.app.ui.theme.PREF_UI_MODE_OVERRIDE
import org.impala67.app.ui.theme.TextLight
import org.impala67.app.ui.theme.TextMain
import org.impala67.app.ui.theme.TextMuted
import org.impala67.app.ui.theme.TextSecondary
import uniffi.impala_ffi.DeckOverview
import uniffi.impala_ffi.PageKind
import uniffi.impala_ffi.PageSummary
import java.util.TimeZone

/**
 * Statistik-Zusammenfassung für den Lern-Tab & die Badge-Anzeige
 */
data class StudyStatsSummary(
    val dueToday: Int = 0,
    val newToday: Int = 0,
    val reviewedToday: Int = 0,
    val totalCards: Int = 0,
    val streakDays: Int = 0,
    val minutesStudiedThisWeek: Int = 0
)

/**
 * Navigationsziele für Shortcuts & externe Intents
 */
sealed class NavTarget {
    data object Home : NavTarget()
    data class NoteEditor(val pageId: String) : NavTarget()
    data class Heft(val pageId: String) : NavTarget()
    data class Study(val deck: String? = null) : NavTarget()
}

/**
 * Geöffnete Tabs in der PWA-Tabbar (`#tabbar` / `.tabchip`)
 */
sealed class OpenTab(val tabId: String, val title: String, val icon: String) {
    data object Home : OpenTab("home", "Start", "🏠")
    data class PageTab(val pageId: String, val pageTitle: String, val isHeft: Boolean) :
        OpenTab(pageId, pageTitle.ifBlank { if (isHeft) "Heft" else "Notiz" }, if (isHeft) "📓" else "📄")
    data class StudyTab(val deckName: String?) :
        OpenTab("study_${deckName ?: "all"}", deckName ?: "Karteikarten", "🃏")
    data class LibraryTab(val initialTab: String = "notion") :
        OpenTab("library", "Bibliothek", "📚")
    data object Graph : OpenTab("graph", "Wissensgraph", "🕸️")
    data object NotebookLm : OpenTab("notebooklm", "Gemini Notebook", "✦")
    data object Grades : OpenTab("grades", "Schulnoten", "📊")
    data object Trash : OpenTab("trash", "Papierkorb", "🗑️")
    data class FullAiChat(val chatId: String?) :
        OpenTab("ai_full", "KI-Coach", "✦")
}

/**
 * Haupt-Anwendungs-Shell von Impala67.
 * Schaltet vollautomatisch um:
 * - Hochkant am Handy: Mobile UI (`MobileAppShell`)
 * - Querformat am Handy ODER Tablet/Desktop: Echte PWA-Ansicht mit 3-Spalten-Layout
 *   (#sidebar links, #tabbar + #main mittig, einklappbares #panel KI-Coach rechts)
 * und behebt alle Systemleisten-Überlappungen (`systemBarsPadding` + `displayCutoutPadding`).
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ImpalaAppShell(
    repository: ImpalaRepository,
    initialTarget: NavTarget? = null,
    onThemeChanged: () -> Unit = {},
    onScanDocumentRequested: () -> Unit = {},
    modifier: Modifier = Modifier
) {
    val coroutineScope = rememberCoroutineScope()
    val configuration = LocalConfiguration.current
    val context = LocalContext.current

    // Orientierungs- & Bildschirm-Erkennung
    val isLandscape = configuration.orientation == Configuration.ORIENTATION_LANDSCAPE
    val isWideScreen = configuration.screenWidthDp >= 600

    val prefs = remember { context.getSharedPreferences(IMPALA_UI_PREFS, Context.MODE_PRIVATE) }
    val uiModeOverride = prefs.getString(PREF_UI_MODE_OVERRIDE, "auto") ?: "auto"

    val useTabletUi = when (uiModeOverride) {
        "tablet" -> true
        "mobile" -> false
        else -> isLandscape || isWideScreen
    }

    // Sync-Zustand abonnieren
    val syncUiModel by repository.syncManager.syncState.collectAsStateWithLifecycle()

    // Datenzustand
    var refreshTrigger by remember { mutableIntStateOf(0) }
    var pagesList by remember { mutableStateOf<List<PageSummary>>(emptyList()) }
    var decksList by remember { mutableStateOf<List<DeckOverview>>(emptyList()) }
    var studyStats by remember { mutableStateOf(StudyStatsSummary()) }
    val favoritePageIds = remember { mutableStateListOf<String>() }

    // Dialoge & Overlays
    var isSearchOpen by remember { mutableStateOf(false) }
    var isSettingsOpen by remember { mutableStateOf(false) }
    var isTemplatePickerOpen by remember { mutableStateOf(false) }
    var isAiPanelOpen by remember { mutableStateOf(false) }
    var isSidebarOpen by remember { mutableStateOf(true) }

    // PWA Tabs & Historie
    val openTabs = remember { mutableStateListOf<OpenTab>(OpenTab.Home) }
    var activeTabIndex by remember { mutableIntStateOf(0) }
    val tabHistory = remember { mutableStateListOf<Int>(0) }
    var historyCursor by remember { mutableIntStateOf(0) }

    // Mobile Navigation
    var mobilePrimaryTab by remember { mutableStateOf(MobilePrimaryTab.START) }
    var mobileSubRoute by remember { mutableStateOf<MobileSubRoute?>(null) }
    var isMobileReadOnly by remember { mutableStateOf(true) }

    val utcOffsetMinutes = remember {
        TimeZone.getDefault().getOffset(System.currentTimeMillis()) / (1000 * 60)
    }

    // Daten aktualisieren
    fun reloadAllData() {
        coroutineScope.launch(Dispatchers.IO) {
            val pages = try { repository.core.recentPages(500u) } catch (_: Exception) { emptyList() }
            val decks = try { repository.core.deckOverview(utcOffsetMinutes, false) } catch (_: Exception) { emptyList() }
            val totalDue = decks.sumOf { (it.review + it.learn).toInt() }
            val totalNew = decks.sumOf { it.new.toInt() }
            val totalCards = decks.sumOf { it.total.toInt() }
            val stats = StudyStatsSummary(
                dueToday = totalDue,
                newToday = totalNew,
                totalCards = totalCards
            )
            withContext(Dispatchers.Main) {
                pagesList = pages
                decksList = decks
                studyStats = stats
                refreshTrigger++
            }
        }
    }

    LaunchedEffect(Unit) {
        reloadAllData()
    }

    // Tab-Öffnen Helfer
    fun openTab(tab: OpenTab) {
        val existingIndex = openTabs.indexOfFirst { it.tabId == tab.tabId }
        if (existingIndex >= 0) {
            activeTabIndex = existingIndex
        } else {
            openTabs.add(tab)
            activeTabIndex = openTabs.lastIndex
        }
    }

    fun openPageInTab(pageId: String, inNewTab: Boolean = false) {
        coroutineScope.launch(Dispatchers.IO) {
            val detail = try { repository.core.page(pageId) } catch (_: Exception) { null }
            val isHeft = detail?.summary?.kind == PageKind.HEFT
            val title = detail?.summary?.title ?: (if (isHeft) "Heft" else "Notiz")
            withContext(Dispatchers.Main) {
                val tab = OpenTab.PageTab(pageId, title, isHeft)
                openTab(tab)
            }
        }
    }

    fun closeTab(index: Int) {
        if (openTabs.size <= 1) return
        openTabs.removeAt(index)
        if (activeTabIndex >= openTabs.size) {
            activeTabIndex = openTabs.lastIndex
        }
    }

    // Initialer Target
    LaunchedEffect(initialTarget) {
        when (initialTarget) {
            is NavTarget.NoteEditor -> openPageInTab(initialTarget.pageId)
            is NavTarget.Heft -> openPageInTab(initialTarget.pageId)
            is NavTarget.Study -> openTab(OpenTab.StudyTab(initialTarget.deck))
            else -> {}
        }
    }

    // Back-Handler
    BackHandler(
        enabled = isSearchOpen || isSettingsOpen || isTemplatePickerOpen || (useTabletUi && openTabs.size > 1) || (!useTabletUi && (mobileSubRoute != null || mobilePrimaryTab != MobilePrimaryTab.START))
    ) {
        when {
            isSearchOpen -> isSearchOpen = false
            isSettingsOpen -> isSettingsOpen = false
            isTemplatePickerOpen -> isTemplatePickerOpen = false
            useTabletUi && openTabs.size > 1 -> closeTab(activeTabIndex)
            !useTabletUi && mobileSubRoute != null -> mobileSubRoute = null
            !useTabletUi && mobilePrimaryTab != MobilePrimaryTab.START -> mobilePrimaryTab = MobilePrimaryTab.START
        }
    }

    val currentActiveTab = openTabs.getOrElse(activeTabIndex) { OpenTab.Home }
    val currentActivePageId = (currentActiveTab as? OpenTab.PageTab)?.pageId

    // ========================================================================
    // AUSWAHL: TABLET/PWA-UI (Querformat) VS. MOBILE-UI (Hochkant)
    // ========================================================================
    if (!useTabletUi) {
        // Handy im Hochformat: Mobile UI
        MobileAppShell(
            repository = repository,
            core = repository.core,
            pages = pagesList,
            decks = decksList,
            studyStats = studyStats,
            syncState = syncUiModel,
            favoritePageIds = favoritePageIds.toSet(),
            onToggleFavorite = { id ->
                if (favoritePageIds.contains(id)) favoritePageIds.remove(id)
                else favoritePageIds.add(id)
            },
            activePrimaryTab = mobilePrimaryTab,
            onSelectPrimaryTab = { mobilePrimaryTab = it },
            activeSubRoute = mobileSubRoute,
            onSetSubRoute = { mobileSubRoute = it },
            activeStudyDeck = null,
            onSelectStudyDeck = {},
            isMobileReadOnly = isMobileReadOnly,
            onToggleMobileReadOnly = { isMobileReadOnly = !isMobileReadOnly },
            onOpenSearch = { isSearchOpen = true },
            onOpenAiForPage = { pageId, prompt ->
                isAiPanelOpen = true
            },
            onOpenSettings = { isSettingsOpen = true },
            onOpenNewTemplateDialog = { isTemplatePickerOpen = true },
            onOpenOrCreateDailyNote = {
                coroutineScope.launch(Dispatchers.IO) {
                    val page = try { repository.core.createPage("Tagesnotiz", "", null, null) } catch (_: Exception) { "" }
                    if (page.isNotBlank()) {
                        withContext(Dispatchers.Main) {
                            mobileSubRoute = MobileSubRoute.Page(page, PageKind.NOTE)
                        }
                    }
                }
            },
            onScanDocument = onScanDocumentRequested,
            onMutation = { reloadAllData() },
            modifier = modifier
        )
    } else {
        // Handy im Querformat ODER Tablet/Desktop: Echte PWA-Ansicht mit 3-Spalten
        BoxWithConstraints(
            modifier = modifier
                .fillMaxSize()
                .background(BgPanel)
                .statusBarsPadding()
                .navigationBarsPadding()
                .displayCutoutPadding()
        ) {
            val isNarrowLandscape = maxWidth < 840.dp
            val sidebarWidth = if (isNarrowLandscape) 216.dp else 250.dp
            val aiPanelWidth = if (isNarrowLandscape) 280.dp else 320.dp

            Row(modifier = Modifier.fillMaxSize()) {
                // ============================================================
                // 1. LINKE SPALTE: #sidebar
                // ============================================================
                AnimatedVisibility(
                    visible = isSidebarOpen,
                    enter = slideInHorizontally(animationSpec = tween(180)) + fadeIn(),
                    exit = slideOutHorizontally(animationSpec = tween(150)) + fadeOut()
                ) {
                    ImpalaPwaSidebar(
                        core = repository.core,
                        sidebarMode = "files",
                        onSidebarModeChange = {},
                        activePageId = currentActivePageId,
                        activeChatId = null,
                        activeDeckName = (currentActiveTab as? OpenTab.StudyTab)?.deckName,
                        activeSpecialRoute = currentActiveTab.tabId,
                        favoritePageIds = favoritePageIds.toSet(),
                        onToggleFavorite = { id ->
                            if (favoritePageIds.contains(id)) favoritePageIds.remove(id)
                            else favoritePageIds.add(id)
                        },
                        onOpenPage = { pageId, inNewTab ->
                            openPageInTab(pageId, inNewTab)
                        },
                        onOpenHome = { openTab(OpenTab.Home) },
                        onOpenSearch = { isSearchOpen = true },
                        onOpenNewTemplateModal = { _, _ -> isTemplatePickerOpen = true },
                        onOpenChat = { chatId ->
                            if (isNarrowLandscape) {
                                openTab(OpenTab.FullAiChat(chatId))
                            } else {
                                isAiPanelOpen = true
                            }
                        },
                        onOpenStudyDeck = { deck -> openTab(OpenTab.StudyTab(deck)) },
                        onOpenNotebookLm = { openTab(OpenTab.NotebookLm) },
                        onOpenGraph = { openTab(OpenTab.Graph) },
                        onOpenLibrary = { openTab(OpenTab.LibraryTab()) },
                        onOpenTrash = { openTab(OpenTab.Trash) },
                        onOpenSettings = { isSettingsOpen = true },
                        syncState = syncUiModel,
                        refreshTrigger = refreshTrigger,
                        onMutation = { reloadAllData() },
                        modifier = Modifier
                            .width(sidebarWidth)
                            .fillMaxHeight()
                    )
                }

                // ============================================================
                // 2. MITTLERE SPALTE: #mainWrap (#tabbar + #main)
                // ============================================================
                Column(
                    modifier = Modifier
                        .weight(1f)
                        .fillMaxHeight()
                        .background(BgPanel)
                ) {
                    // Top #tabbar (Höhe: 38.dp)
                    Surface(
                        color = BgSidebar,
                        modifier = Modifier.fillMaxWidth()
                    ) {
                        Row(
                            modifier = Modifier
                                .fillMaxWidth()
                                .height(38.dp)
                                .padding(horizontal = 6.dp),
                            verticalAlignment = Alignment.CenterVertically
                        ) {
                            // ☰ Sidebar Toggle
                            IconButton(
                                onClick = { isSidebarOpen = !isSidebarOpen },
                                modifier = Modifier.size(30.dp)
                            ) {
                                Icon(
                                    imageVector = Icons.Rounded.Menu,
                                    contentDescription = "Seitenleiste umschalten",
                                    tint = if (isSidebarOpen) AccentBlue else TextSecondary,
                                    modifier = Modifier.size(18.dp)
                                )
                            }

                            // ‹ Nav Back & › Nav Forward
                            IconButton(
                                onClick = {
                                    if (activeTabIndex > 0) activeTabIndex--
                                },
                                enabled = activeTabIndex > 0,
                                modifier = Modifier.size(26.dp)
                            ) {
                                Icon(
                                    imageVector = Icons.AutoMirrored.Rounded.NavigateBefore,
                                    contentDescription = "Zurück",
                                    tint = if (activeTabIndex > 0) TextMain else TextLight,
                                    modifier = Modifier.size(18.dp)
                                )
                            }

                            IconButton(
                                onClick = {
                                    if (activeTabIndex < openTabs.lastIndex) activeTabIndex++
                                },
                                enabled = activeTabIndex < openTabs.lastIndex,
                                modifier = Modifier.size(26.dp)
                            ) {
                                Icon(
                                    imageVector = Icons.AutoMirrored.Rounded.NavigateNext,
                                    contentDescription = "Vorwärts",
                                    tint = if (activeTabIndex < openTabs.lastIndex) TextMain else TextLight,
                                    modifier = Modifier.size(18.dp)
                                )
                            }

                            Spacer(modifier = Modifier.width(4.dp))
                            VerticalDivider(
                                color = BorderHairline,
                                modifier = Modifier.height(20.dp).padding(horizontal = 2.dp)
                            )

                            // .tabstrip: Horizontal scrollbare Liste der offenen Tabs
                            Row(
                                modifier = Modifier
                                    .weight(1f)
                                    .horizontalScroll(rememberScrollState()),
                                verticalAlignment = Alignment.CenterVertically,
                                horizontalArrangement = Arrangement.spacedBy(3.dp)
                            ) {
                                openTabs.forEachIndexed { index, tab ->
                                    val isActive = activeTabIndex == index
                                    Surface(
                                        shape = RoundedCornerShape(topStart = 8.dp, topEnd = 8.dp),
                                        color = if (isActive) BgPanel else Color.Transparent,
                                        border = if (isActive) BorderStroke(1.dp, BorderHairline) else null,
                                        modifier = Modifier
                                            .height(30.dp)
                                            .clip(RoundedCornerShape(topStart = 8.dp, topEnd = 8.dp))
                                            .clickable { activeTabIndex = index }
                                    ) {
                                        Row(
                                            modifier = Modifier.padding(horizontal = 10.dp),
                                            verticalAlignment = Alignment.CenterVertically,
                                            horizontalArrangement = Arrangement.spacedBy(6.dp)
                                        ) {
                                            Text(tab.icon, fontSize = 12.sp)
                                            Text(
                                                text = tab.title,
                                                color = if (isActive) TextMain else TextSecondary,
                                                fontSize = 12.sp,
                                                fontWeight = if (isActive) FontWeight.SemiBold else FontWeight.Normal,
                                                maxLines = 1,
                                                overflow = TextOverflow.Ellipsis,
                                                modifier = Modifier.widthIn(max = 120.dp)
                                            )
                                            if (openTabs.size > 1) {
                                                Icon(
                                                    imageVector = Icons.Rounded.Close,
                                                    contentDescription = "Tab schließen",
                                                    tint = if (isActive) TextSecondary else TextLight,
                                                    modifier = Modifier
                                                        .size(14.dp)
                                                        .clickable { closeTab(index) }
                                                )
                                            }
                                        }
                                    }
                                }
                            }

                            // + Neuer Tab (Template Picker)
                            IconButton(
                                onClick = { isTemplatePickerOpen = true },
                                modifier = Modifier.size(28.dp)
                            ) {
                                Icon(
                                    imageVector = Icons.Rounded.Add,
                                    contentDescription = "Neuer Tab",
                                    tint = TextSecondary,
                                    modifier = Modifier.size(18.dp)
                                )
                            }

                            // ✦ KI-Coach Toggle (wenn Panel geschlossen)
                            if (!isAiPanelOpen) {
                                IconButton(
                                    onClick = { isAiPanelOpen = true },
                                    modifier = Modifier.size(28.dp)
                                ) {
                                    Icon(
                                        imageVector = Icons.Rounded.AutoAwesome,
                                        contentDescription = "KI-Coach öffnen",
                                        tint = AccentBlue,
                                        modifier = Modifier.size(17.dp)
                                    )
                                }
                            }
                        }
                        HorizontalDivider(color = BorderHairline, thickness = 1.dp)
                    }

                    // #main Content Area
                    Box(modifier = Modifier.weight(1f).fillMaxWidth()) {
                        when (val active = currentActiveTab) {
                            is OpenTab.Home -> {
                                HomeScreen(
                                    repository = repository,
                                    core = repository.core,
                                    pages = pagesList,
                                    decks = decksList,
                                    studyStats = studyStats,
                                    syncState = syncUiModel,
                                    favoritePageIds = favoritePageIds.toSet(),
                                    onOpenPage = { id -> openPageInTab(id) },
                                    onCreatePage = { isHeft ->
                                        coroutineScope.launch(Dispatchers.IO) {
                                            val newId = if (isHeft) {
                                                repository.core.createHeft("Neues Heft", null, null)
                                            } else {
                                                repository.core.createPage("Neue Notiz", "", null, null)
                                            }
                                            withContext(Dispatchers.Main) {
                                                reloadAllData()
                                                openPageInTab(newId)
                                            }
                                        }
                                    },
                                    onOpenStudy = { openTab(OpenTab.StudyTab(null)) },
                                    onOpenAiChat = { isAiPanelOpen = true },
                                    onOpenSettings = { isSettingsOpen = true },
                                    onOpenSearch = { isSearchOpen = true },
                                    onOpenLibrary = { openTab(OpenTab.LibraryTab()) },
                                    onOpenTrash = { openTab(OpenTab.Trash) },
                                    onOpenGraph = { openTab(OpenTab.Graph) },
                                    onOpenNotebookLm = { openTab(OpenTab.NotebookLm) },
                                    onOpenGrades = { openTab(OpenTab.Grades) },
                                    onScanDocument = onScanDocumentRequested,
                                    modifier = Modifier.fillMaxSize()
                                )
                            }

                            is OpenTab.PageTab -> {
                                if (active.isHeft) {
                                    HeftScreen(
                                        core = repository.core,
                                        pageId = active.pageId,
                                        onNavigateBack = { closeTab(activeTabIndex) },
                                        onOpenAiForPage = { isAiPanelOpen = true },
                                        onMutation = { reloadAllData() },
                                        isTabletUi = true,
                                        onToggleSidebar = { isSidebarOpen = !isSidebarOpen },
                                        modifier = Modifier.fillMaxSize()
                                    )
                                } else {
                                    NoteEditorScreen(
                                        core = repository.core,
                                        pageId = active.pageId,
                                        onNavigateBack = { closeTab(activeTabIndex) },
                                        onOpenAiForPage = { isAiPanelOpen = true },
                                        onMutation = { reloadAllData() },
                                        isTabletUi = true,
                                        isFavorite = favoritePageIds.contains(active.pageId),
                                        onToggleFavorite = {
                                            if (favoritePageIds.contains(active.pageId)) favoritePageIds.remove(active.pageId)
                                            else favoritePageIds.add(active.pageId)
                                        },
                                        onOpenPage = { id -> openPageInTab(id) },
                                        modifier = Modifier.fillMaxSize()
                                    )
                                }
                            }

                            is OpenTab.StudyTab -> {
                                StudyScreen(
                                    core = repository.core,
                                    decks = decksList,
                                    studyStats = studyStats,
                                    onRefresh = { reloadAllData() },
                                    initialDeckId = active.deckName,
                                    modifier = Modifier.fillMaxSize()
                                )
                            }

                            is OpenTab.LibraryTab -> {
                                LibraryScreen(
                                    core = repository.core,
                                    pages = pagesList,
                                    initialTab = active.initialTab,
                                    onOpenPage = { id -> openPageInTab(id) },
                                    onCreatePage = { isHeft, folderId ->
                                        coroutineScope.launch(Dispatchers.IO) {
                                            val newId = if (isHeft) {
                                                repository.core.createHeft("Neues Heft", folderId, null)
                                            } else {
                                                repository.core.createPage("Neue Notiz", "", folderId, null)
                                            }
                                            withContext(Dispatchers.Main) {
                                                reloadAllData()
                                                openPageInTab(newId)
                                            }
                                        }
                                    },
                                    onMutation = { reloadAllData() },
                                    modifier = Modifier.fillMaxSize()
                                )
                            }

                            is OpenTab.Graph -> {
                                KnowledgeGraphScreen(
                                    core = repository.core,
                                    pages = pagesList,
                                    onOpenPage = { id -> openPageInTab(id) },
                                    modifier = Modifier.fillMaxSize()
                                )
                            }

                            is OpenTab.NotebookLm -> {
                                NotebookLmScreen(
                                    core = repository.core,
                                    pages = pagesList,
                                    onOpenPage = { id -> openPageInTab(id) },
                                    onOpenAiWithPrompt = { prompt ->
                                        isAiPanelOpen = true
                                    },
                                    onMutation = { reloadAllData() },
                                    modifier = Modifier.fillMaxSize()
                                )
                            }

                            is OpenTab.Grades -> {
                                GradesScreen(
                                    core = repository.core,
                                    onMutation = { reloadAllData() },
                                    modifier = Modifier.fillMaxSize()
                                )
                            }

                            is OpenTab.Trash -> {
                                TrashScreen(
                                    core = repository.core,
                                    onMutation = { reloadAllData() },
                                    modifier = Modifier.fillMaxSize()
                                )
                            }

                            is OpenTab.FullAiChat -> {
                                AiChatSheet(
                                    core = repository.core,
                                    currentPageId = currentActivePageId,
                                    onDismiss = { closeTab(activeTabIndex) },
                                    onMutation = { reloadAllData() },
                                    isSidePanel = false,
                                    initialChatId = active.chatId,
                                    modifier = Modifier.fillMaxSize()
                                )
                            }
                        }
                    }
                }

                // ============================================================
                // 3. RECHTE SPALTE: #panel (Einklappbares KI-Coach Seitenpanel)
                // ============================================================
                AnimatedVisibility(
                    visible = isAiPanelOpen,
                    enter = slideInHorizontally(initialOffsetX = { it }, animationSpec = tween(180)) + fadeIn(),
                    exit = slideOutHorizontally(targetOffsetX = { it }, animationSpec = tween(150)) + fadeOut()
                ) {
                    AiChatSheet(
                        core = repository.core,
                        currentPageId = currentActivePageId,
                        onDismiss = { isAiPanelOpen = false },
                        onMutation = { reloadAllData() },
                        isSidePanel = true,
                        onExpandToFullTab = {
                            isAiPanelOpen = false
                            openTab(OpenTab.FullAiChat(null))
                        },
                        modifier = Modifier
                            .width(aiPanelWidth)
                            .fillMaxHeight()
                    )
                }
            }

            // Schwebender #btnAiFab (wenn Panel geschlossen und nicht im Heft-Vollbild)
            if (!isAiPanelOpen && currentActiveTab !is OpenTab.FullAiChat) {
                Surface(
                    shape = CircleShape,
                    color = AccentBlue,
                    shadowElevation = 8.dp,
                    modifier = Modifier
                        .align(Alignment.BottomEnd)
                        .padding(18.dp)
                        .size(44.dp)
                        .clickable { isAiPanelOpen = true }
                ) {
                    Box(contentAlignment = Alignment.Center) {
                        Icon(
                            imageVector = Icons.Rounded.AutoAwesome,
                            contentDescription = "KI-Coach",
                            tint = Color(0xFF081018),
                            modifier = Modifier.size(20.dp)
                        )
                    }
                }
            }
        }
    }

    // ========================================================================
    // GLOBALE DIALOGE (Template-Picker, Suche, Einstellungen)
    // ========================================================================
    TemplatePickerDialog(
        isOpen = isTemplatePickerOpen,
        onDismiss = { isTemplatePickerOpen = false },
        onCreateNoteWithTemplate = { title, content ->
            coroutineScope.launch(Dispatchers.IO) {
                val newId = try { repository.core.createPage(title, content, null, null) } catch (_: Exception) { "" }
                withContext(Dispatchers.Main) {
                    isTemplatePickerOpen = false
                    reloadAllData()
                    if (newId.isNotBlank()) {
                        if (useTabletUi) openPageInTab(newId)
                        else mobileSubRoute = MobileSubRoute.Page(newId, PageKind.NOTE)
                    }
                }
            }
        },
        onCreateHeftWithPaper = { title, paper ->
            coroutineScope.launch(Dispatchers.IO) {
                val newId = try { repository.core.createHeft(title, null, null) } catch (_: Exception) { "" }
                withContext(Dispatchers.Main) {
                    isTemplatePickerOpen = false
                    reloadAllData()
                    if (newId.isNotBlank()) {
                        if (useTabletUi) openPageInTab(newId)
                        else mobileSubRoute = MobileSubRoute.Page(newId, PageKind.HEFT)
                    }
                }
            }
        }
    )

    QuickSearchDialog(
        core = repository.core,
        isOpen = isSearchOpen,
        onDismiss = { isSearchOpen = false },
        onSelectPage = { pageId ->
            isSearchOpen = false
            if (useTabletUi) openPageInTab(pageId)
            else {
                coroutineScope.launch(Dispatchers.IO) {
                    val detail = try { repository.core.page(pageId) } catch (_: Exception) { null }
                    val kind = detail?.summary?.kind ?: PageKind.NOTE
                    withContext(Dispatchers.Main) {
                        mobileSubRoute = MobileSubRoute.Page(pageId, kind)
                    }
                }
            }
        }
    )

    if (isSettingsOpen) {
        SettingsAndSyncSheet(
            repository = repository,
            core = repository.core,
            onDismiss = { isSettingsOpen = false },
            onMutation = { reloadAllData() },
            onThemeChanged = onThemeChanged
        )
    }
}
