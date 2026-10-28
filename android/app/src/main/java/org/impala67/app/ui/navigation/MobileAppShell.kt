package org.impala67.app.ui.navigation

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
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
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.rounded.ArrowBack
import androidx.compose.material.icons.automirrored.rounded.NavigateNext
import androidx.compose.material.icons.rounded.Add
import androidx.compose.material.icons.rounded.Archive
import androidx.compose.material.icons.rounded.AutoAwesome
import androidx.compose.material.icons.rounded.CalendarToday
import androidx.compose.material.icons.rounded.Close
import androidx.compose.material.icons.rounded.ContentCopy
import androidx.compose.material.icons.rounded.Delete
import androidx.compose.material.icons.rounded.Edit
import androidx.compose.material.icons.rounded.Folder
import androidx.compose.material.icons.rounded.Home
import androidx.compose.material.icons.rounded.Menu
import androidx.compose.material.icons.rounded.MoreVert
import androidx.compose.material.icons.rounded.School
import androidx.compose.material.icons.rounded.Search
import androidx.compose.material.icons.rounded.Settings
import androidx.compose.material.icons.rounded.Star
import androidx.compose.material.icons.rounded.StarBorder
import androidx.compose.material.icons.rounded.Visibility
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Badge
import androidx.compose.material3.BadgedBox
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.impala67.app.data.ImpalaRepository
import org.impala67.app.data.SyncUiModel
import org.impala67.app.ui.editor.NoteEditorScreen
import org.impala67.app.ui.heft.HeftScreen
import org.impala67.app.ui.screens.GradesScreen
import org.impala67.app.ui.screens.HomeScreen
import org.impala67.app.ui.screens.KnowledgeGraphScreen
import org.impala67.app.ui.screens.LibraryScreen
import org.impala67.app.ui.screens.NotebookLmScreen
import org.impala67.app.ui.screens.StudyScreen
import org.impala67.app.ui.screens.TrashScreen
import org.impala67.app.ui.theme.AccentBlue
import org.impala67.app.ui.theme.AccentBlueSoft
import org.impala67.app.ui.theme.AccentBorder
import org.impala67.app.ui.theme.AccentGreen
import org.impala67.app.ui.theme.AccentOrange
import org.impala67.app.ui.theme.AccentViolet
import org.impala67.app.ui.theme.BgBubble
import org.impala67.app.ui.theme.BgCard
import org.impala67.app.ui.theme.BgElevated
import org.impala67.app.ui.theme.BgPanel
import org.impala67.app.ui.theme.BgSidebar
import org.impala67.app.ui.theme.BorderHairline
import org.impala67.app.ui.theme.BorderStrong
import org.impala67.app.ui.theme.DangerRed
import org.impala67.app.ui.theme.ImpalaPillShape
import org.impala67.app.ui.theme.SuccessGreen
import org.impala67.app.ui.theme.TextLight
import org.impala67.app.ui.theme.TextMain
import org.impala67.app.ui.theme.TextMuted
import org.impala67.app.ui.theme.TextSecondary
import org.impala67.app.ui.theme.WarningAmber
import uniffi.impala_ffi.DeckOverview
import uniffi.impala_ffi.ImpalaCore
import uniffi.impala_ffi.PageKind
import uniffi.impala_ffi.PageSummary
import uniffi.impala_ffi.WorkspaceInfo

/**
 * Haupt-Tabs der mobilen Hochkant-UI (`#mTabs`)
 */
enum class MobilePrimaryTab(val title: String) {
    START("Start"),
    NOTES("Notizen"),
    STUDY("Lernen"),
    MORE("Mehr")
}

/**
 * Unteransichten in der mobilen Hochkant-UI (überlagern den aktiven Haupt-Tab mit Zurück-Button oben)
 */
sealed class MobileSubRoute {
    data class Page(val pageId: String, val kind: PageKind) : MobileSubRoute()
    data class Library(val initialTab: String = "hefte") : MobileSubRoute()
    data object Graph : MobileSubRoute()
    data object NotebookLm : MobileSubRoute()
    data object Grades : MobileSubRoute()
    data object Trash : MobileSubRoute()
}

/**
 * Dedizierte, einhandfreundliche Handy-Hochkant-UI (`MobileAppShell`, inspiriert von `web/mobile-view.js` & `web/mobile.css`):
 * 1. Top Bar (`#mBar`): Kontextabhängige Kopfzeile (Haupt-Tab vs. geöffnete Notiz/Heft/Unteransicht mit `👁️ Lesen` / `✏️ Zeichnen` Umschalter)
 * 2. Mitte (`#mMain`): `Start`, `Notizen`-Browser, `Lernen` oder `Mehr`-Launchpad bzw. geöffnete Unteransicht
 * 3. Unten (`#mTabs`): Expressive 5-Slot Bottom Navigation Bar mit zentralem `+` Action Sheet
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun MobileAppShell(
    repository: ImpalaRepository,
    core: ImpalaCore,
    pages: List<PageSummary>,
    decks: List<DeckOverview>,
    studyStats: StudyStatsSummary,
    syncState: SyncUiModel?,
    favoritePageIds: Set<String>,
    onToggleFavorite: (String) -> Unit,
    activePrimaryTab: MobilePrimaryTab,
    onSelectPrimaryTab: (MobilePrimaryTab) -> Unit,
    activeSubRoute: MobileSubRoute?,
    onSetSubRoute: (MobileSubRoute?) -> Unit,
    activeStudyDeck: String?,
    onSelectStudyDeck: (String?) -> Unit,
    isMobileReadOnly: Boolean,
    onToggleMobileReadOnly: () -> Unit,
    onOpenSearch: () -> Unit,
    onOpenAiForPage: (pageId: String?, initialPrompt: String?) -> Unit,
    onOpenSettings: () -> Unit,
    onOpenNewTemplateDialog: () -> Unit,
    onOpenOrCreateDailyNote: () -> Unit,
    onScanDocument: () -> Unit,
    onMutation: () -> Unit,
    modifier: Modifier = Modifier
) {
    val coroutineScope = rememberCoroutineScope()

    var showCreateBottomSheet by remember { mutableStateOf(false) }
    var showNewCardDialog by remember { mutableStateOf(false) }
    var newCardFront by remember { mutableStateOf("") }
    var newCardBack by remember { mutableStateOf("") }
    var newCardDeck by remember { mutableStateOf("Standard") }

    var showNewDeckDialog by remember { mutableStateOf(false) }
    var newDeckName by remember { mutableStateOf("") }

    var topBarPageMenuExpanded by remember { mutableStateOf(false) }
    var showRenameCurrentPageDialog by remember { mutableStateOf(false) }
    var renameCurrentPageTitle by remember { mutableStateOf("") }

    val activePageSummary = remember(activeSubRoute, pages) {
        val route = activeSubRoute as? MobileSubRoute.Page ?: return@remember null
        pages.find { it.id == route.pageId }
    }

    fun openPage(pageId: String) {
        coroutineScope.launch(Dispatchers.IO) {
            val detail = core.page(pageId)
            val kind = detail?.summary?.kind ?: PageKind.NOTE
            withContext(Dispatchers.Main) {
                onSetSubRoute(MobileSubRoute.Page(pageId, kind))
            }
        }
    }

    Column(
        modifier = modifier
            .fillMaxSize()
            .background(BgPanel)
    ) {
        // 1. TOP BAR (#mBar)
        Surface(
            color = BgSidebar,
            modifier = Modifier.fillMaxWidth()
        ) {
            Column {
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .height(52.dp)
                        .padding(horizontal = 12.dp),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.SpaceBetween
                ) {
                    if (activeSubRoute != null) {
                        // Unteransicht / Geöffnete Seite / Heft
                        Row(
                            verticalAlignment = Alignment.CenterVertically,
                            modifier = Modifier.weight(1f)
                        ) {
                            IconButton(
                                onClick = { onSetSubRoute(null) },
                                modifier = Modifier.size(36.dp)
                            ) {
                                Icon(
                                    imageVector = Icons.AutoMirrored.Rounded.ArrowBack,
                                    contentDescription = "Zurück",
                                    tint = TextMain,
                                    modifier = Modifier.size(20.dp)
                                )
                            }
                            Spacer(modifier = Modifier.width(6.dp))
                            val (iconEmoji, routeTitle) = when (activeSubRoute) {
                                is MobileSubRoute.Page -> {
                                    val emoji = if (activeSubRoute.kind == PageKind.HEFT) "📓" else "📄"
                                    val title = activePageSummary?.title?.ifBlank { "Ohne Titel" } ?: "Seite"
                                    emoji to title
                                }
                                is MobileSubRoute.Library -> {
                                    if (activeSubRoute.initialTab == "archive") "📦" to "Archiv"
                                    else "📚" to "Bibliothek"
                                }
                                MobileSubRoute.Graph -> "🕸️" to "Wissensgraph"
                                MobileSubRoute.NotebookLm -> "✦" to "Gemini Notebook"
                                MobileSubRoute.Grades -> "📊" to "Schulnoten & Schnitt"
                                MobileSubRoute.Trash -> "🗑️" to "Papierkorb"
                            }
                            Text(text = iconEmoji, fontSize = 15.sp)
                            Spacer(modifier = Modifier.width(6.dp))
                            Text(
                                text = routeTitle,
                                color = TextMain,
                                fontSize = 15.sp,
                                fontWeight = FontWeight.SemiBold,
                                maxLines = 1,
                                overflow = TextOverflow.Ellipsis
                            )
                        }

                        // Rechte Aktionen für Heft / Notiz
                        if (activeSubRoute is MobileSubRoute.Page) {
                            Row(
                                verticalAlignment = Alignment.CenterVertically,
                                horizontalArrangement = Arrangement.spacedBy(4.dp)
                            ) {
                                if (activeSubRoute.kind == PageKind.HEFT) {
                                    // Umschalter 👁️ Lesen / ✏️ Zeichnen
                                    Surface(
                                        shape = ImpalaPillShape,
                                        color = if (isMobileReadOnly) BgBubble else AccentBlueSoft,
                                        border = BorderStroke(
                                            1.dp,
                                            if (isMobileReadOnly) BorderHairline else AccentBlue
                                        ),
                                        modifier = Modifier.clickable { onToggleMobileReadOnly() }
                                    ) {
                                        Row(
                                            modifier = Modifier.padding(horizontal = 10.dp, vertical = 5.dp),
                                            verticalAlignment = Alignment.CenterVertically,
                                            horizontalArrangement = Arrangement.spacedBy(4.dp)
                                        ) {
                                            Text(
                                                text = if (isMobileReadOnly) "👁️ Lesen" else "✏️ Zeichnen",
                                                color = if (isMobileReadOnly) TextMain else AccentBlue,
                                                fontSize = 12.sp,
                                                fontWeight = FontWeight.SemiBold
                                            )
                                        }
                                    }
                                } else {
                                    // ★ Favorit bei Notiz
                                    val isFav = favoritePageIds.contains(activeSubRoute.pageId)
                                    IconButton(
                                        onClick = { onToggleFavorite(activeSubRoute.pageId) },
                                        modifier = Modifier.size(34.dp)
                                    ) {
                                        Icon(
                                            imageVector = if (isFav) Icons.Rounded.Star else Icons.Rounded.StarBorder,
                                            contentDescription = "Favorit",
                                            tint = if (isFav) WarningAmber else TextSecondary,
                                            modifier = Modifier.size(19.dp)
                                        )
                                    }
                                }

                                // ✦ KI-Button
                                IconButton(
                                    onClick = { onOpenAiForPage(activeSubRoute.pageId, null) },
                                    modifier = Modifier.size(34.dp)
                                ) {
                                    Text(
                                        text = "✦",
                                        color = AccentBlue,
                                        fontSize = 17.sp,
                                        fontWeight = FontWeight.Bold
                                    )
                                }

                                // ⋯ Menü
                                Box {
                                    IconButton(
                                        onClick = { topBarPageMenuExpanded = true },
                                        modifier = Modifier.size(34.dp)
                                    ) {
                                        Icon(
                                            imageVector = Icons.Rounded.MoreVert,
                                            contentDescription = "Menü",
                                            tint = TextSecondary,
                                            modifier = Modifier.size(19.dp)
                                        )
                                    }

                                    DropdownMenu(
                                        expanded = topBarPageMenuExpanded,
                                        onDismissRequest = { topBarPageMenuExpanded = false },
                                        modifier = Modifier.background(BgElevated)
                                    ) {
                                        val isFav = favoritePageIds.contains(activeSubRoute.pageId)
                                        DropdownMenuItem(
                                            text = {
                                                Text(
                                                    if (isFav) "★ Aus Favoriten entfernen" else "★ Zu Favoriten",
                                                    color = TextMain
                                                )
                                            },
                                            onClick = {
                                                topBarPageMenuExpanded = false
                                                onToggleFavorite(activeSubRoute.pageId)
                                            }
                                        )
                                        DropdownMenuItem(
                                            text = { Text("Umbenennen", color = TextMain) },
                                            onClick = {
                                                topBarPageMenuExpanded = false
                                                renameCurrentPageTitle = activePageSummary?.title ?: ""
                                                showRenameCurrentPageDialog = true
                                            }
                                        )
                                        DropdownMenuItem(
                                            text = { Text("Duplizieren", color = TextMain) },
                                            onClick = {
                                                topBarPageMenuExpanded = false
                                                val pageId = activeSubRoute.pageId
                                                coroutineScope.launch(Dispatchers.IO) {
                                                    try {
                                                        val detail = core.page(pageId)
                                                        if (detail != null) {
                                                            val copyTitle = "${detail.summary.title.ifBlank { "Ohne Titel" }} (Kopie)"
                                                            val newId = if (detail.summary.kind == PageKind.HEFT) {
                                                                core.createHeft(copyTitle, detail.summary.parentId, detail.summary.workspaceId)
                                                            } else {
                                                                core.createPage(copyTitle, detail.content, detail.summary.parentId, detail.summary.workspaceId)
                                                            }
                                                            withContext(Dispatchers.Main) {
                                                                onMutation()
                                                                openPage(newId)
                                                            }
                                                        }
                                                    } catch (_: Exception) {
                                                    }
                                                }
                                            }
                                        )
                                        DropdownMenuItem(
                                            text = { Text("Archivieren", color = TextSecondary) },
                                            onClick = {
                                                topBarPageMenuExpanded = false
                                                val pageId = activeSubRoute.pageId
                                                coroutineScope.launch(Dispatchers.IO) {
                                                    try {
                                                        core.archivePage(pageId)
                                                        withContext(Dispatchers.Main) {
                                                            onMutation()
                                                            onSetSubRoute(null)
                                                        }
                                                    } catch (_: Exception) {
                                                    }
                                                }
                                            }
                                        )
                                        HorizontalDivider(color = BorderHairline)
                                        DropdownMenuItem(
                                            text = { Text("🗑️ In Papierkorb", color = DangerRed) },
                                            onClick = {
                                                topBarPageMenuExpanded = false
                                                val pageId = activeSubRoute.pageId
                                                coroutineScope.launch(Dispatchers.IO) {
                                                    try {
                                                        core.trashPage(pageId)
                                                        withContext(Dispatchers.Main) {
                                                            onMutation()
                                                            onSetSubRoute(null)
                                                        }
                                                    } catch (_: Exception) {
                                                    }
                                                }
                                            }
                                        )
                                    }
                                }
                            }
                        }
                    } else {
                        // Haupt-Tab Kopfzeile (`Start`, `Notizen`, `Lernen`, `Mehr`)
                        Row(
                            verticalAlignment = Alignment.CenterVertically,
                            modifier = Modifier.weight(1f)
                        ) {
                            val syncDotColor = when (syncState) {
                                is SyncUiModel.Synced, is SyncUiModel.Idle -> SuccessGreen
                                is SyncUiModel.Syncing -> AccentBlue
                                is SyncUiModel.Error -> DangerRed
                                else -> TextMuted
                            }
                            Box(
                                modifier = Modifier
                                    .size(9.dp)
                                    .clip(CircleShape)
                                    .background(syncDotColor)
                            )
                            Spacer(modifier = Modifier.width(8.dp))
                            Text(
                                text = activePrimaryTab.title,
                                color = TextMain,
                                fontSize = 17.sp,
                                fontWeight = FontWeight.Bold
                            )
                            Spacer(modifier = Modifier.width(8.dp))
                            val chipLabel = when (activePrimaryTab) {
                                MobilePrimaryTab.START -> {
                                    when (syncState) {
                                        is SyncUiModel.Synced -> "Sync aktiv"
                                        is SyncUiModel.Syncing -> "Synchronisiere…"
                                        else -> "${pages.size} Seiten"
                                    }
                                }
                                MobilePrimaryTab.NOTES -> "${pages.size} Einträge"
                                MobilePrimaryTab.STUDY -> "${studyStats.dueToday} fällig"
                                MobilePrimaryTab.MORE -> "Impala67"
                            }
                            Surface(
                                shape = ImpalaPillShape,
                                color = BgBubble,
                                border = BorderStroke(1.dp, BorderHairline)
                            ) {
                                Text(
                                    text = chipLabel,
                                    color = TextMuted,
                                    fontSize = 11.sp,
                                    fontWeight = FontWeight.Medium,
                                    modifier = Modifier.padding(horizontal = 8.dp, vertical = 2.dp)
                                )
                            }
                        }

                        // Rechts: 🔍 Suche, 📅 Tagesnotiz, ✦ KI-Coach
                        Row(
                            verticalAlignment = Alignment.CenterVertically,
                            horizontalArrangement = Arrangement.spacedBy(2.dp)
                        ) {
                            IconButton(
                                onClick = onOpenSearch,
                                modifier = Modifier.size(36.dp)
                            ) {
                                Icon(
                                    imageVector = Icons.Rounded.Search,
                                    contentDescription = "Suche",
                                    tint = TextSecondary,
                                    modifier = Modifier.size(20.dp)
                                )
                            }
                            IconButton(
                                onClick = onOpenOrCreateDailyNote,
                                modifier = Modifier.size(36.dp)
                            ) {
                                Icon(
                                    imageVector = Icons.Rounded.CalendarToday,
                                    contentDescription = "Heutige Tagesnotiz",
                                    tint = TextSecondary,
                                    modifier = Modifier.size(18.dp)
                                )
                            }
                            IconButton(
                                onClick = { onOpenAiForPage(null, null) },
                                modifier = Modifier.size(36.dp)
                            ) {
                                Text(
                                    text = "✦",
                                    color = AccentBlue,
                                    fontSize = 17.sp,
                                    fontWeight = FontWeight.Bold
                                )
                            }
                        }
                    }
                }
                HorizontalDivider(color = BorderHairline, thickness = 1.dp)
            }
        }

        // 2. MITTE (#mMain)
        Box(
            modifier = Modifier
                .weight(1f)
                .fillMaxWidth()
        ) {
            when (val sub = activeSubRoute) {
                is MobileSubRoute.Page -> {
                    if (sub.kind == PageKind.HEFT) {
                        HeftScreen(
                            core = core,
                            pageId = sub.pageId,
                            onNavigateBack = { onSetSubRoute(null) },
                            onOpenAiForPage = { id -> onOpenAiForPage(id, null) },
                            onMutation = onMutation,
                            isTabletUi = false,
                            isMobileReadOnly = isMobileReadOnly,
                            onToggleMobileReadOnly = onToggleMobileReadOnly,
                            onToggleSidebar = { onSetSubRoute(null) },
                            modifier = Modifier.fillMaxSize()
                        )
                    } else {
                        val isFav = favoritePageIds.contains(sub.pageId)
                        NoteEditorScreen(
                            core = core,
                            pageId = sub.pageId,
                            onNavigateBack = { onSetSubRoute(null) },
                            onOpenAiForPage = { id -> onOpenAiForPage(id, null) },
                            onMutation = onMutation,
                            isTabletUi = false,
                            isFavorite = isFav,
                            onToggleFavorite = { onToggleFavorite(sub.pageId) },
                            onOpenPage = { id -> openPage(id) },
                            modifier = Modifier.fillMaxSize()
                        )
                    }
                }

                is MobileSubRoute.Library -> {
                    LibraryScreen(
                        core = core,
                        pages = pages,
                        initialTab = sub.initialTab,
                        onOpenPage = { id -> openPage(id) },
                        onCreatePage = { isHeft, folderId ->
                            coroutineScope.launch(Dispatchers.IO) {
                                try {
                                    val newId = if (isHeft) {
                                        val id = core.createHeft("Neues Heft", null, null)
                                        if (!folderId.isNullOrBlank()) {
                                            core.heftMoveToFolder(id, folderId, null)
                                        }
                                        id
                                    } else {
                                        core.createPage("Neue Notiz", "", null, null)
                                    }
                                    withContext(Dispatchers.Main) {
                                        onMutation()
                                        openPage(newId)
                                    }
                                } catch (_: Exception) {
                                }
                            }
                        },
                        onMutation = onMutation,
                        modifier = Modifier.fillMaxSize()
                    )
                }

                MobileSubRoute.Graph -> {
                    KnowledgeGraphScreen(
                        core = core,
                        pages = pages,
                        onOpenPage = { id -> openPage(id) },
                        modifier = Modifier.fillMaxSize()
                    )
                }

                MobileSubRoute.NotebookLm -> {
                    NotebookLmScreen(
                        core = core,
                        pages = pages,
                        onOpenPage = { id -> openPage(id) },
                        onOpenAiWithPrompt = { prompt -> onOpenAiForPage(null, prompt) },
                        onMutation = onMutation,
                        modifier = Modifier.fillMaxSize()
                    )
                }

                MobileSubRoute.Grades -> {
                    GradesScreen(
                        core = core,
                        onMutation = onMutation,
                        modifier = Modifier.fillMaxSize()
                    )
                }

                MobileSubRoute.Trash -> {
                    TrashScreen(
                        core = core,
                        onMutation = onMutation,
                        modifier = Modifier.fillMaxSize()
                    )
                }

                null -> {
                    when (activePrimaryTab) {
                        MobilePrimaryTab.START -> {
                            HomeScreen(
                                repository = repository,
                                core = core,
                                pages = pages,
                                decks = decks,
                                studyStats = studyStats,
                                syncState = syncState,
                                favoritePageIds = favoritePageIds,
                                onOpenPage = { id -> openPage(id) },
                                onCreatePage = { isHeft ->
                                    coroutineScope.launch(Dispatchers.IO) {
                                        try {
                                            val newId = if (isHeft) {
                                                core.createHeft("Neues Heft", null, null)
                                            } else {
                                                core.createPage("Neue Notiz", "", null, null)
                                            }
                                            withContext(Dispatchers.Main) {
                                                onMutation()
                                                openPage(newId)
                                            }
                                        } catch (_: Exception) {
                                        }
                                    }
                                },
                                onOpenStudy = { onSelectStudyDeck(null); onSelectPrimaryTab(MobilePrimaryTab.STUDY) },
                                onOpenAiChat = { onOpenAiForPage(null, null) },
                                onOpenSettings = onOpenSettings,
                                onOpenSearch = onOpenSearch,
                                onOpenLibrary = { onSetSubRoute(MobileSubRoute.Library("hefte")) },
                                onOpenTrash = { onSetSubRoute(MobileSubRoute.Trash) },
                                onOpenGraph = { onSetSubRoute(MobileSubRoute.Graph) },
                                onOpenNotebookLm = { onSetSubRoute(MobileSubRoute.NotebookLm) },
                                onOpenGrades = { onSetSubRoute(MobileSubRoute.Grades) },
                                onScanDocument = onScanDocument,
                                modifier = Modifier.fillMaxSize()
                            )
                        }

                        MobilePrimaryTab.NOTES -> {
                            MobileNotesBrowserTab(
                                core = core,
                                allPages = pages,
                                favoritePageIds = favoritePageIds,
                                onToggleFavorite = onToggleFavorite,
                                onOpenPage = { id -> openPage(id) },
                                onMutation = onMutation
                            )
                        }

                        MobilePrimaryTab.STUDY -> {
                            StudyScreen(
                                core = core,
                                decks = decks,
                                studyStats = studyStats,
                                onRefresh = onMutation,
                                initialDeckId = activeStudyDeck,
                                modifier = Modifier.fillMaxSize()
                            )
                        }

                        MobilePrimaryTab.MORE -> {
                            MobileMoreLaunchpadTab(
                                core = core,
                                syncState = syncState,
                                onOpenLibrary = { tab -> onSetSubRoute(MobileSubRoute.Library(tab)) },
                                onOpenGraph = { onSetSubRoute(MobileSubRoute.Graph) },
                                onOpenNotebookLm = { onSetSubRoute(MobileSubRoute.NotebookLm) },
                                onOpenGrades = { onSetSubRoute(MobileSubRoute.Grades) },
                                onOpenTrash = { onSetSubRoute(MobileSubRoute.Trash) },
                                onOpenSettings = onOpenSettings,
                                onOpenSearch = onOpenSearch
                            )
                        }
                    }
                }
            }
        }

        // 3. UNTEN: Expressive 5-Slot Bottom Navigation Bar (#mTabs)
        Surface(
            color = BgSidebar,
            modifier = Modifier.fillMaxWidth()
        ) {
            Column {
                HorizontalDivider(color = BorderHairline, thickness = 1.dp)
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .height(62.dp)
                        .padding(horizontal = 6.dp),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.SpaceEvenly
                ) {
                    // Slot 1: 🏠 Start
                    MobileBottomTabItem(
                        icon = Icons.Rounded.Home,
                        label = "Start",
                        isSelected = activeSubRoute == null && activePrimaryTab == MobilePrimaryTab.START,
                        onClick = {
                            onSetSubRoute(null)
                            onSelectPrimaryTab(MobilePrimaryTab.START)
                        },
                        modifier = Modifier.weight(1f)
                    )

                    // Slot 2: 📁 Notizen
                    MobileBottomTabItem(
                        icon = Icons.Rounded.Folder,
                        label = "Notizen",
                        isSelected = activeSubRoute == null && activePrimaryTab == MobilePrimaryTab.NOTES,
                        onClick = {
                            onSetSubRoute(null)
                            onSelectPrimaryTab(MobilePrimaryTab.NOTES)
                        },
                        modifier = Modifier.weight(1f)
                    )

                    // Slot 3: Zentraler hervorgehobener + Button (Neu) in AccentBlue
                    Box(
                        modifier = Modifier.weight(1f),
                        contentAlignment = Alignment.Center
                    ) {
                        Surface(
                            shape = RoundedCornerShape(16.dp),
                            color = AccentBlue,
                            shadowElevation = 6.dp,
                            modifier = Modifier
                                .size(width = 48.dp, height = 40.dp)
                                .clickable { showCreateBottomSheet = true }
                        ) {
                            Box(contentAlignment = Alignment.Center) {
                                Icon(
                                    imageVector = Icons.Rounded.Add,
                                    contentDescription = "Neu anlegen",
                                    tint = Color(0xFF081018),
                                    modifier = Modifier.size(24.dp)
                                )
                            }
                        }
                    }

                    // Slot 4: 🎓 Lernen (mit Badge für dueTodayCount)
                    MobileBottomTabItem(
                        icon = Icons.Rounded.School,
                        label = "Lernen",
                        isSelected = activeSubRoute == null && activePrimaryTab == MobilePrimaryTab.STUDY,
                        badgeCount = studyStats.dueToday,
                        onClick = {
                            onSetSubRoute(null)
                            onSelectPrimaryTab(MobilePrimaryTab.STUDY)
                        },
                        modifier = Modifier.weight(1f)
                    )

                    // Slot 5: ☰ Mehr
                    MobileBottomTabItem(
                        icon = Icons.Rounded.Menu,
                        label = "Mehr",
                        isSelected = activeSubRoute != null || activePrimaryTab == MobilePrimaryTab.MORE,
                        onClick = {
                            onSetSubRoute(null)
                            onSelectPrimaryTab(MobilePrimaryTab.MORE)
                        },
                        modifier = Modifier.weight(1f)
                    )
                }
            }
        }
    }

    // Expressive "+" Neu-Erstellen Bottom Sheet
    if (showCreateBottomSheet) {
        ModalBottomSheet(
            onDismissRequest = { showCreateBottomSheet = false },
            sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true),
            containerColor = BgElevated
        ) {
            Column(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 18.dp, vertical = 8.dp)
                    .padding(bottom = 24.dp),
                verticalArrangement = Arrangement.spacedBy(8.dp)
            ) {
                Text(
                    text = "Schnell erstellen",
                    color = TextMain,
                    fontSize = 17.sp,
                    fontWeight = FontWeight.Bold,
                    modifier = Modifier.padding(bottom = 4.dp)
                )

                MobileQuickCreateRow(
                    emoji = "📝",
                    title = "Neue Notion-Seite",
                    subtitle = "Markdown-Notiz oder Vorlage auswählen",
                    onClick = {
                        showCreateBottomSheet = false
                        onOpenNewTemplateDialog()
                    }
                )
                MobileQuickCreateRow(
                    emoji = "📓",
                    title = "Neues GoodNotes-Heft",
                    subtitle = "Handschriftliches Heft für Stift & Skizzen",
                    onClick = {
                        showCreateBottomSheet = false
                        coroutineScope.launch(Dispatchers.IO) {
                            try {
                                val id = core.createHeft("Neues Heft", null, null)
                                withContext(Dispatchers.Main) {
                                    onMutation()
                                    openPage(id)
                                }
                            } catch (_: Exception) {
                            }
                        }
                    }
                )
                MobileQuickCreateRow(
                    emoji = "📷",
                    title = "Dokument scannen",
                    subtitle = "Kamerascan direkt in ein Heft einfügen",
                    onClick = {
                        showCreateBottomSheet = false
                        onScanDocument()
                    }
                )
                MobileQuickCreateRow(
                    emoji = "📅",
                    title = "Heutige Tagesnotiz",
                    subtitle = "Öffnet oder erstellt das Journal für heute",
                    onClick = {
                        showCreateBottomSheet = false
                        onOpenOrCreateDailyNote()
                    }
                )
                MobileQuickCreateRow(
                    emoji = "🃏",
                    title = "Neue Karteikarte",
                    subtitle = "FSRS-Lernkarte in einem Stapel anlegen",
                    onClick = {
                        showCreateBottomSheet = false
                        newCardFront = ""
                        newCardBack = ""
                        newCardDeck = decks.firstOrNull()?.name ?: "Standard"
                        showNewCardDialog = true
                    }
                )
                MobileQuickCreateRow(
                    emoji = "🗂️",
                    title = "Neuer Stapel",
                    subtitle = "Neuen Karteikarten-Stapel erstellen",
                    onClick = {
                        showCreateBottomSheet = false
                        newDeckName = ""
                        showNewDeckDialog = true
                    }
                )
            }
        }
    }

    // Dialog: Aktuelle Seite umbenennen
    if (showRenameCurrentPageDialog && activeSubRoute is MobileSubRoute.Page) {
        AlertDialog(
            onDismissRequest = { showRenameCurrentPageDialog = false },
            title = { Text("Umbenennen", color = TextMain, fontSize = 16.sp, fontWeight = FontWeight.SemiBold) },
            text = {
                BasicTextField(
                    value = renameCurrentPageTitle,
                    onValueChange = { renameCurrentPageTitle = it },
                    textStyle = TextStyle(color = TextMain, fontSize = 14.sp),
                    cursorBrush = SolidColor(AccentBlue),
                    singleLine = true,
                    modifier = Modifier
                        .fillMaxWidth()
                        .background(BgBubble, RoundedCornerShape(8.dp))
                        .border(1.dp, BorderHairline, RoundedCornerShape(8.dp))
                        .padding(12.dp)
                )
            },
            confirmButton = {
                TextButton(
                    onClick = {
                        val pageId = activeSubRoute.pageId
                        val newTitle = renameCurrentPageTitle.trim().ifBlank { "Ohne Titel" }
                        showRenameCurrentPageDialog = false
                        coroutineScope.launch(Dispatchers.IO) {
                            try {
                                core.updatePage(pageId, newTitle, null)
                                withContext(Dispatchers.Main) { onMutation() }
                            } catch (_: Exception) {
                            }
                        }
                    }
                ) {
                    Text("Speichern", color = AccentBlue)
                }
            },
            dismissButton = {
                TextButton(onClick = { showRenameCurrentPageDialog = false }) {
                    Text("Abbrechen", color = TextMuted)
                }
            },
            containerColor = BgElevated
        )
    }

    // Dialog: Neue Karteikarte
    if (showNewCardDialog) {
        AlertDialog(
            onDismissRequest = { showNewCardDialog = false },
            title = { Text("🃏 Neue Karteikarte", color = TextMain, fontSize = 16.sp, fontWeight = FontWeight.SemiBold) },
            text = {
                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text("Stapel", color = TextMuted, fontSize = 12.sp)
                    BasicTextField(
                        value = newCardDeck,
                        onValueChange = { newCardDeck = it },
                        textStyle = TextStyle(color = TextMain, fontSize = 13.5.sp),
                        cursorBrush = SolidColor(AccentBlue),
                        singleLine = true,
                        modifier = Modifier
                            .fillMaxWidth()
                            .background(BgBubble, RoundedCornerShape(8.dp))
                            .border(1.dp, BorderHairline, RoundedCornerShape(8.dp))
                            .padding(10.dp)
                    )
                    Text("Vorderseite (Frage)", color = TextMuted, fontSize = 12.sp)
                    BasicTextField(
                        value = newCardFront,
                        onValueChange = { newCardFront = it },
                        textStyle = TextStyle(color = TextMain, fontSize = 13.5.sp),
                        cursorBrush = SolidColor(AccentBlue),
                        modifier = Modifier
                            .fillMaxWidth()
                            .height(68.dp)
                            .background(BgBubble, RoundedCornerShape(8.dp))
                            .border(1.dp, BorderHairline, RoundedCornerShape(8.dp))
                            .padding(10.dp)
                    )
                    Text("Rückseite (Antwort)", color = TextMuted, fontSize = 12.sp)
                    BasicTextField(
                        value = newCardBack,
                        onValueChange = { newCardBack = it },
                        textStyle = TextStyle(color = TextMain, fontSize = 13.5.sp),
                        cursorBrush = SolidColor(AccentBlue),
                        modifier = Modifier
                            .fillMaxWidth()
                            .height(68.dp)
                            .background(BgBubble, RoundedCornerShape(8.dp))
                            .border(1.dp, BorderHairline, RoundedCornerShape(8.dp))
                            .padding(10.dp)
                    )
                }
            },
            confirmButton = {
                TextButton(
                    onClick = {
                        val f = newCardFront.trim()
                        val b = newCardBack.trim()
                        val d = newCardDeck.trim().ifBlank { "Standard" }
                        showNewCardDialog = false
                        if (f.isNotEmpty() && b.isNotEmpty()) {
                            coroutineScope.launch(Dispatchers.IO) {
                                try {
                                    core.createCard(f, b, d, null)
                                    withContext(Dispatchers.Main) { onMutation() }
                                } catch (_: Exception) {
                                }
                            }
                        }
                    }
                ) {
                    Text("Speichern", color = AccentBlue)
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

    // Dialog: Neuer Stapel
    if (showNewDeckDialog) {
        AlertDialog(
            onDismissRequest = { showNewDeckDialog = false },
            title = { Text("🗂️ Neuer Stapel", color = TextMain, fontSize = 16.sp, fontWeight = FontWeight.SemiBold) },
            text = {
                BasicTextField(
                    value = newDeckName,
                    onValueChange = { newDeckName = it },
                    textStyle = TextStyle(color = TextMain, fontSize = 14.sp),
                    cursorBrush = SolidColor(AccentBlue),
                    singleLine = true,
                    modifier = Modifier
                        .fillMaxWidth()
                        .background(BgBubble, RoundedCornerShape(8.dp))
                        .border(1.dp, BorderHairline, RoundedCornerShape(8.dp))
                        .padding(12.dp)
                )
            },
            confirmButton = {
                TextButton(
                    onClick = {
                        val name = newDeckName.trim()
                        showNewDeckDialog = false
                        if (name.isNotEmpty()) {
                            coroutineScope.launch(Dispatchers.IO) {
                                try {
                                    val created = core.createDeck(name)
                                    withContext(Dispatchers.Main) {
                                        onMutation()
                                        onSelectStudyDeck(created)
                                        onSelectPrimaryTab(MobilePrimaryTab.STUDY)
                                    }
                                } catch (_: Exception) {
                                }
                            }
                        }
                    }
                ) {
                    Text("Anlegen", color = AccentBlue)
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
}

@Composable
private fun MobileBottomTabItem(
    icon: ImageVector,
    label: String,
    isSelected: Boolean,
    badgeCount: Int = 0,
    onClick: () -> Unit,
    modifier: Modifier = Modifier
) {
    val tint = if (isSelected) AccentBlue else TextMuted

    Column(
        modifier = modifier
            .clip(RoundedCornerShape(12.dp))
            .clickable(onClick = onClick)
            .padding(vertical = 6.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center
    ) {
        Box(
            modifier = Modifier
                .clip(ImpalaPillShape)
                .background(if (isSelected) AccentBlueSoft else Color.Transparent)
                .padding(horizontal = 14.dp, vertical = 3.dp),
            contentAlignment = Alignment.Center
        ) {
            if (badgeCount > 0) {
                BadgedBox(
                    badge = {
                        Badge(
                            containerColor = AccentBlue,
                            contentColor = Color(0xFF081018)
                        ) {
                            Text(
                                text = if (badgeCount > 99) "99+" else badgeCount.toString(),
                                fontSize = 9.sp,
                                fontWeight = FontWeight.Bold
                            )
                        }
                    }
                ) {
                    Icon(
                        imageVector = icon,
                        contentDescription = label,
                        tint = tint,
                        modifier = Modifier.size(20.dp)
                    )
                }
            } else {
                Icon(
                    imageVector = icon,
                    contentDescription = label,
                    tint = tint,
                    modifier = Modifier.size(20.dp)
                )
            }
        }
        Spacer(modifier = Modifier.height(2.dp))
        Text(
            text = label,
            color = tint,
            fontSize = 10.5.sp,
            fontWeight = if (isSelected) FontWeight.SemiBold else FontWeight.Normal,
            maxLines = 1
        )
    }
}

@Composable
private fun MobileQuickCreateRow(
    emoji: String,
    title: String,
    subtitle: String,
    onClick: () -> Unit
) {
    Surface(
        shape = RoundedCornerShape(12.dp),
        color = BgCard,
        border = BorderStroke(1.dp, BorderHairline),
        modifier = Modifier
            .fillMaxWidth()
            .clickable(onClick = onClick)
    ) {
        Row(
            modifier = Modifier.padding(horizontal = 14.dp, vertical = 12.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            Box(
                modifier = Modifier
                    .size(38.dp)
                    .background(AccentBlueSoft, RoundedCornerShape(10.dp)),
                contentAlignment = Alignment.Center
            ) {
                Text(text = emoji, fontSize = 18.sp)
            }
            Spacer(modifier = Modifier.width(12.dp))
            Column(modifier = Modifier.weight(1f)) {
                Text(
                    text = title,
                    color = TextMain,
                    fontSize = 14.sp,
                    fontWeight = FontWeight.SemiBold
                )
                Text(
                    text = subtitle,
                    color = TextMuted,
                    fontSize = 12.sp,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis
                )
            }
            Icon(
                imageVector = Icons.AutoMirrored.Rounded.NavigateNext,
                contentDescription = null,
                tint = TextMuted,
                modifier = Modifier.size(18.dp)
            )
        }
    }
}

/**
 * Tab 2 (`Notizen`): Dedizierter mobiler Notizen- & Hefte-Browser:
 * - Suchleiste oben + Filter-Pills (`Alle`, `📝 Seiten`, `📓 Hefte`, `★ Favoriten`)
 * - Horizontale Workspace-Auswahl (`Alle Bereiche` oder einzelne Workspaces) + Drill-Down in Unterseiten
 * - Übersichtliche Karten/Zeilen mit Icon, Titel, Vorschau/Typ, Zeitstempel und `⋯`-Aktions-Sheet
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun MobileNotesBrowserTab(
    core: ImpalaCore,
    allPages: List<PageSummary>,
    favoritePageIds: Set<String>,
    onToggleFavorite: (String) -> Unit,
    onOpenPage: (String) -> Unit,
    onMutation: () -> Unit
) {
    val coroutineScope = rememberCoroutineScope()

    var filterQuery by remember { mutableStateOf("") }
    var selectedFilter by remember { mutableStateOf("all") } // "all", "notes", "hefte", "favorites"
    var workspaces by remember { mutableStateOf<List<WorkspaceInfo>>(emptyList()) }
    var selectedWorkspaceId by remember { mutableStateOf<String?>(null) } // null = Alle Bereiche
    var currentParentPage by remember { mutableStateOf<PageSummary?>(null) }
    var childPages by remember { mutableStateOf<List<PageSummary>>(emptyList()) }

    var actionSheetPage by remember { mutableStateOf<PageSummary?>(null) }
    var renameDialogPage by remember { mutableStateOf<PageSummary?>(null) }
    var renameText by remember { mutableStateOf("") }

    LaunchedEffect(allPages, currentParentPage, selectedWorkspaceId) {
        withContext(Dispatchers.IO) {
            try {
                workspaces = core.workspaces()
                val p = currentParentPage
                if (p != null) {
                    childPages = core.childrenOf(p.id, p.workspaceId)
                }
            } catch (_: Exception) {
            }
        }
    }

    val displayedPages = remember(
        allPages,
        childPages,
        currentParentPage,
        selectedWorkspaceId,
        selectedFilter,
        filterQuery,
        favoritePageIds
    ) {
        val baseList = if (currentParentPage != null) {
            childPages
        } else {
            allPages.filter { pg ->
                val wsMatch = selectedWorkspaceId == null || pg.workspaceId == selectedWorkspaceId
                wsMatch
            }
        }
        baseList.filter { pg ->
            val kindMatch = when (selectedFilter) {
                "notes" -> pg.kind == PageKind.NOTE
                "hefte" -> pg.kind == PageKind.HEFT
                "favorites" -> favoritePageIds.contains(pg.id)
                else -> true
            }
            val queryMatch = filterQuery.isBlank() ||
                pg.title.contains(filterQuery.trim(), ignoreCase = true)
            kindMatch && queryMatch
        }
    }

    Column(
        modifier = Modifier
            .fillMaxSize()
            .padding(horizontal = 14.dp, vertical = 10.dp)
    ) {
        // Suchleiste oben
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .background(BgBubble, RoundedCornerShape(12.dp))
                .border(1.dp, BorderHairline, RoundedCornerShape(12.dp))
                .padding(horizontal = 12.dp, vertical = 9.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            Icon(
                imageVector = Icons.Rounded.Search,
                contentDescription = null,
                tint = TextMuted,
                modifier = Modifier.size(18.dp)
            )
            Spacer(modifier = Modifier.width(8.dp))
            BasicTextField(
                value = filterQuery,
                onValueChange = { filterQuery = it },
                textStyle = TextStyle(color = TextMain, fontSize = 14.sp),
                cursorBrush = SolidColor(AccentBlue),
                singleLine = true,
                modifier = Modifier.weight(1f),
                decorationBox = { inner ->
                    if (filterQuery.isEmpty()) {
                        Text("Notizen & Hefte filtern...", color = TextMuted, fontSize = 14.sp)
                    }
                    inner()
                }
            )
            if (filterQuery.isNotEmpty()) {
                Icon(
                    imageVector = Icons.Rounded.Close,
                    contentDescription = "Leeren",
                    tint = TextMuted,
                    modifier = Modifier
                        .size(16.dp)
                        .clickable { filterQuery = "" }
                )
            }
        }

        Spacer(modifier = Modifier.height(10.dp))

        // Filter-Pills (Alle, 📝 Seiten, 📓 Hefte, ★ Favoriten)
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .horizontalScroll(rememberScrollState()),
            horizontalArrangement = Arrangement.spacedBy(8.dp)
        ) {
            val pills = listOf(
                "all" to "Alle",
                "notes" to "📝 Seiten",
                "hefte" to "📓 Hefte",
                "favorites" to "★ Favoriten"
            )
            for ((key, label) in pills) {
                val active = selectedFilter == key
                Surface(
                    shape = ImpalaPillShape,
                    color = if (active) AccentBlueSoft else BgCard,
                    border = BorderStroke(1.dp, if (active) AccentBlue else BorderHairline),
                    modifier = Modifier.clickable { selectedFilter = key }
                ) {
                    Text(
                        text = label,
                        color = if (active) AccentBlue else TextSecondary,
                        fontSize = 12.5.sp,
                        fontWeight = if (active) FontWeight.SemiBold else FontWeight.Normal,
                        modifier = Modifier.padding(horizontal = 12.dp, vertical = 6.dp)
                    )
                }
            }
        }

        Spacer(modifier = Modifier.height(8.dp))

        // Horizontale Workspace-Auswahl (Alle Bereiche oder einzelne Workspaces)
        if (workspaces.size > 1) {
            LazyRow(
                horizontalArrangement = Arrangement.spacedBy(6.dp),
                modifier = Modifier.fillMaxWidth()
            ) {
                item(key = "ws_all") {
                    val isAll = selectedWorkspaceId == null
                    Surface(
                        shape = RoundedCornerShape(8.dp),
                        color = if (isAll) BgElevated else Color.Transparent,
                        border = BorderStroke(1.dp, if (isAll) BorderStrong else BorderHairline),
                        modifier = Modifier.clickable {
                            selectedWorkspaceId = null
                            currentParentPage = null
                        }
                    ) {
                        Text(
                            text = "Alle Bereiche",
                            color = if (isAll) TextMain else TextMuted,
                            fontSize = 11.5.sp,
                            fontWeight = if (isAll) FontWeight.SemiBold else FontWeight.Normal,
                            modifier = Modifier.padding(horizontal = 10.dp, vertical = 5.dp)
                        )
                    }
                }
                items(workspaces, key = { it.id }) { ws ->
                    val isSelected = selectedWorkspaceId == ws.id
                    Surface(
                        shape = RoundedCornerShape(8.dp),
                        color = if (isSelected) BgElevated else Color.Transparent,
                        border = BorderStroke(1.dp, if (isSelected) BorderStrong else BorderHairline),
                        modifier = Modifier.clickable {
                            selectedWorkspaceId = ws.id
                            currentParentPage = null
                        }
                    ) {
                        Text(
                            text = ws.name,
                            color = if (isSelected) TextMain else TextMuted,
                            fontSize = 11.5.sp,
                            fontWeight = if (isSelected) FontWeight.SemiBold else FontWeight.Normal,
                            modifier = Modifier.padding(horizontal = 10.dp, vertical = 5.dp)
                        )
                    }
                }
            }
            Spacer(modifier = Modifier.height(8.dp))
        }

        // Drill-Down Leiste falls in einer Elternseite
        val parent = currentParentPage
        if (parent != null) {
            Surface(
                shape = RoundedCornerShape(10.dp),
                color = BgSidebar,
                border = BorderStroke(1.dp, BorderHairline),
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(bottom = 8.dp)
            ) {
                Row(
                    modifier = Modifier.padding(horizontal = 10.dp, vertical = 8.dp),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.SpaceBetween
                ) {
                    Row(
                        verticalAlignment = Alignment.CenterVertically,
                        modifier = Modifier
                            .weight(1f)
                            .clickable { currentParentPage = null }
                    ) {
                        Icon(
                            imageVector = Icons.AutoMirrored.Rounded.ArrowBack,
                            contentDescription = "Zurück",
                            tint = AccentBlue,
                            modifier = Modifier.size(16.dp)
                        )
                        Spacer(modifier = Modifier.width(6.dp))
                        Text(
                            text = "Unterseiten von: ${parent.title.ifBlank { "Ohne Titel" }}",
                            color = TextMain,
                            fontSize = 12.5.sp,
                            fontWeight = FontWeight.SemiBold,
                            maxLines = 1,
                            overflow = TextOverflow.Ellipsis
                        )
                    }
                    Text(
                        text = "Öffnen →",
                        color = AccentBlue,
                        fontSize = 12.sp,
                        fontWeight = FontWeight.SemiBold,
                        modifier = Modifier.clickable { onOpenPage(parent.id) }
                    )
                }
            }
        }

        // Liste der Seiten & Hefte
        if (displayedPages.isEmpty()) {
            Box(
                modifier = Modifier
                    .fillMaxSize()
                    .padding(24.dp),
                contentAlignment = Alignment.Center
            ) {
                Text(
                    text = "Keine passenden Seiten oder Hefte gefunden.",
                    color = TextMuted,
                    fontSize = 13.5.sp
                )
            }
        } else {
            LazyColumn(
                modifier = Modifier.fillMaxSize(),
                verticalArrangement = Arrangement.spacedBy(8.dp),
                contentPadding = PaddingValues(bottom = 16.dp)
            ) {
                items(displayedPages, key = { it.id }) { pg ->
                    val isFav = favoritePageIds.contains(pg.id)
                    val hasSubPages = remember(pg.id, allPages) {
                        allPages.any { it.parentId == pg.id }
                    }

                    Surface(
                        shape = RoundedCornerShape(14.dp),
                        color = BgCard,
                        border = BorderStroke(1.dp, BorderHairline),
                        modifier = Modifier
                            .fillMaxWidth()
                            .clickable { onOpenPage(pg.id) }
                    ) {
                        Row(
                            modifier = Modifier.padding(horizontal = 14.dp, vertical = 12.dp),
                            verticalAlignment = Alignment.CenterVertically
                        ) {
                            Box(
                                modifier = Modifier
                                    .size(38.dp)
                                    .background(BgBubble, RoundedCornerShape(10.dp)),
                                contentAlignment = Alignment.Center
                            ) {
                                Text(
                                    text = if (pg.kind == PageKind.HEFT) "📓" else "📄",
                                    fontSize = 18.sp
                                )
                            }
                            Spacer(modifier = Modifier.width(12.dp))
                            Column(modifier = Modifier.weight(1f)) {
                                Row(verticalAlignment = Alignment.CenterVertically) {
                                    Text(
                                        text = pg.title.ifBlank { "Ohne Titel" },
                                        color = TextMain,
                                        fontSize = 14.5.sp,
                                        fontWeight = FontWeight.SemiBold,
                                        maxLines = 1,
                                        overflow = TextOverflow.Ellipsis,
                                        modifier = Modifier.weight(1f, fill = false)
                                    )
                                    if (isFav) {
                                        Spacer(modifier = Modifier.width(6.dp))
                                        Text(text = "★", color = WarningAmber, fontSize = 12.sp)
                                    }
                                }
                                Spacer(modifier = Modifier.height(2.dp))
                                val typeLabel = if (pg.kind == PageKind.HEFT) "GoodNotes-Heft" else "Notion-Seite"
                                val dateStr = pg.updated.take(10)
                                Text(
                                    text = "$typeLabel • $dateStr",
                                    color = TextMuted,
                                    fontSize = 11.5.sp,
                                    maxLines = 1
                                )
                            }

                            if (hasSubPages) {
                                Surface(
                                    shape = ImpalaPillShape,
                                    color = AccentBlueSoft,
                                    modifier = Modifier
                                        .padding(end = 4.dp)
                                        .clickable { currentParentPage = pg }
                                ) {
                                    Text(
                                        text = "Unterseiten ▸",
                                        color = AccentBlue,
                                        fontSize = 10.5.sp,
                                        fontWeight = FontWeight.SemiBold,
                                        modifier = Modifier.padding(horizontal = 8.dp, vertical = 4.dp)
                                    )
                                }
                            }

                            IconButton(
                                onClick = { actionSheetPage = pg },
                                modifier = Modifier.size(30.dp)
                            ) {
                                Icon(
                                    imageVector = Icons.Rounded.MoreVert,
                                    contentDescription = "Aktionen",
                                    tint = TextMuted,
                                    modifier = Modifier.size(18.dp)
                                )
                            }
                        }
                    }
                }
            }
        }
    }

    // ⋯ Aktions-Sheet für eine ausgewählte Seite
    val targetPage = actionSheetPage
    if (targetPage != null) {
        ModalBottomSheet(
            onDismissRequest = { actionSheetPage = null },
            sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true),
            containerColor = BgElevated
        ) {
            val isFav = favoritePageIds.contains(targetPage.id)
            Column(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 18.dp, vertical = 8.dp)
                    .padding(bottom = 24.dp),
                verticalArrangement = Arrangement.spacedBy(6.dp)
            ) {
                Text(
                    text = targetPage.title.ifBlank { "Ohne Titel" },
                    color = TextMain,
                    fontSize = 16.sp,
                    fontWeight = FontWeight.Bold,
                    modifier = Modifier.padding(bottom = 6.dp)
                )

                MobileSheetActionItem("📄 Öffnen", TextMain) {
                    actionSheetPage = null
                    onOpenPage(targetPage.id)
                }
                MobileSheetActionItem("➕ Unterseite anlegen", AccentBlue) {
                    actionSheetPage = null
                    coroutineScope.launch(Dispatchers.IO) {
                        try {
                            val newId = core.createPage(
                                "Neue Unterseite",
                                "",
                                targetPage.id,
                                targetPage.workspaceId
                            )
                            withContext(Dispatchers.Main) {
                                onMutation()
                                onOpenPage(newId)
                            }
                        } catch (_: Exception) {
                        }
                    }
                }
                MobileSheetActionItem("✏️ Umbenennen", TextMain) {
                    actionSheetPage = null
                    renameText = targetPage.title
                    renameDialogPage = targetPage
                }
                MobileSheetActionItem("📋 Duplizieren", TextMain) {
                    actionSheetPage = null
                    coroutineScope.launch(Dispatchers.IO) {
                        try {
                            val detail = core.page(targetPage.id)
                            val copyTitle = "${targetPage.title.ifBlank { "Ohne Titel" }} (Kopie)"
                            val newId = if (targetPage.kind == PageKind.HEFT) {
                                core.createHeft(copyTitle, targetPage.parentId, targetPage.workspaceId)
                            } else {
                                core.createPage(copyTitle, detail?.content ?: "", targetPage.parentId, targetPage.workspaceId)
                            }
                            withContext(Dispatchers.Main) {
                                onMutation()
                                onOpenPage(newId)
                            }
                        } catch (_: Exception) {
                        }
                    }
                }
                MobileSheetActionItem(
                    if (isFav) "★ Aus Favoriten entfernen" else "★ Zu Favoriten hinzufügen",
                    WarningAmber
                ) {
                    actionSheetPage = null
                    onToggleFavorite(targetPage.id)
                }
                MobileSheetActionItem("📦 Archivieren", TextSecondary) {
                    actionSheetPage = null
                    coroutineScope.launch(Dispatchers.IO) {
                        try {
                            core.archivePage(targetPage.id)
                            withContext(Dispatchers.Main) { onMutation() }
                        } catch (_: Exception) {
                        }
                    }
                }
                MobileSheetActionItem("🗑️ In Papierkorb verschieben", DangerRed) {
                    actionSheetPage = null
                    coroutineScope.launch(Dispatchers.IO) {
                        try {
                            core.trashPage(targetPage.id)
                            withContext(Dispatchers.Main) { onMutation() }
                        } catch (_: Exception) {
                        }
                    }
                }
            }
        }
    }

    val rPage = renameDialogPage
    if (rPage != null) {
        AlertDialog(
            onDismissRequest = { renameDialogPage = null },
            title = { Text("Seite umbenennen", color = TextMain, fontSize = 16.sp, fontWeight = FontWeight.SemiBold) },
            text = {
                BasicTextField(
                    value = renameText,
                    onValueChange = { renameText = it },
                    textStyle = TextStyle(color = TextMain, fontSize = 14.sp),
                    cursorBrush = SolidColor(AccentBlue),
                    singleLine = true,
                    modifier = Modifier
                        .fillMaxWidth()
                        .background(BgBubble, RoundedCornerShape(8.dp))
                        .border(1.dp, BorderHairline, RoundedCornerShape(8.dp))
                        .padding(12.dp)
                )
            },
            confirmButton = {
                TextButton(
                    onClick = {
                        val newTitle = renameText.trim().ifBlank { "Ohne Titel" }
                        renameDialogPage = null
                        coroutineScope.launch(Dispatchers.IO) {
                            try {
                                core.updatePage(rPage.id, newTitle, null)
                                withContext(Dispatchers.Main) { onMutation() }
                            } catch (_: Exception) {
                            }
                        }
                    }
                ) {
                    Text("Speichern", color = AccentBlue)
                }
            },
            dismissButton = {
                TextButton(onClick = { renameDialogPage = null }) {
                    Text("Abbrechen", color = TextMuted)
                }
            },
            containerColor = BgElevated
        )
    }
}

@Composable
private fun MobileSheetActionItem(
    label: String,
    color: Color,
    onClick: () -> Unit
) {
    Surface(
        shape = RoundedCornerShape(10.dp),
        color = BgCard,
        border = BorderStroke(1.dp, BorderHairline),
        modifier = Modifier
            .fillMaxWidth()
            .clickable(onClick = onClick)
    ) {
        Text(
            text = label,
            color = color,
            fontSize = 14.sp,
            fontWeight = FontWeight.Medium,
            modifier = Modifier.padding(horizontal = 14.dp, vertical = 12.dp)
        )
    }
}

/**
 * Tab 4 (`Mehr`): Das mobile "Mehr"-Launchpad (wie `renderMobileMehr` in `web/mobile-view.js`):
 * - Oben: Sync-Status-Karte mit pulsierendem Punkt -> Klick öffnet Einstellungen
 * - Sektion BEREICHE: 2x2 Expressive Bento-Karten (`📚 Bibliothek`, `🕸️ Wissensgraph`, `✦ Gemini Notebook`, `📊 Schulnoten & Schnitt`)
 * - Sektion ABLAGE: `📦 Archiv`, `🗑️ Papierkorb`
 * - Sektion APP: `⚙️ Einstellungen, Darstellung & Sync`, `🔍 Globale Suche`
 */
@Composable
private fun MobileMoreLaunchpadTab(
    core: ImpalaCore,
    syncState: SyncUiModel?,
    onOpenLibrary: (initialTab: String) -> Unit,
    onOpenGraph: () -> Unit,
    onOpenNotebookLm: () -> Unit,
    onOpenGrades: () -> Unit,
    onOpenTrash: () -> Unit,
    onOpenSettings: () -> Unit,
    onOpenSearch: () -> Unit
) {
    var conflictCount by remember { mutableStateOf(0u) }
    var trashCount by remember { mutableStateOf(0) }
    var archiveCount by remember { mutableStateOf(0) }

    LaunchedEffect(Unit) {
        withContext(Dispatchers.IO) {
            try {
                conflictCount = core.conflictCount()
                trashCount = core.trashedPages().size
                archiveCount = core.archivedPages().size
            } catch (_: Exception) {
            }
        }
    }

    val infiniteTransition = rememberInfiniteTransition(label = "syncPulse")
    val pulseAlpha by infiniteTransition.animateFloat(
        initialValue = 0.45f,
        targetValue = 1.0f,
        animationSpec = infiniteRepeatable(
            animation = tween(900),
            repeatMode = RepeatMode.Reverse
        ),
        label = "pulseAlpha"
    )

    Column(
        modifier = Modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .padding(horizontal = 16.dp, vertical = 14.dp),
        verticalArrangement = Arrangement.spacedBy(18.dp)
    ) {
        // Oben: Sync-Status-Karte mit pulsierendem Punkt
        val (dotColor, statusTitle, statusSubtitle) = when {
            conflictCount > 0u -> Triple(
                WarningAmber,
                "$conflictCount Sync-Konflikte offen",
                "Tippe hier, um Konflikte in den Einstellungen aufzulösen"
            )
            syncState is SyncUiModel.Synced -> Triple(
                SuccessGreen,
                "Verbunden & Synchronisiert",
                "Cloudflare E2EE Live-Sync ist aktiv"
            )
            syncState is SyncUiModel.Syncing -> Triple(
                AccentBlue,
                syncState.label,
                "Echtzeit-Abgleich läuft..."
            )
            syncState is SyncUiModel.Idle -> Triple(
                SuccessGreen,
                "Live-Sync bereit",
                "Änderungen werden Ende-zu-Ende verschlüsselt übertragen"
            )
            syncState is SyncUiModel.Error -> Triple(
                DangerRed,
                "Sync-Hinweis",
                syncState.message
            )
            else -> Triple(
                TextMuted,
                "Lokal & Offline bereit",
                "Tippe hier, um Cloudflare Live-Sync oder Google Drive einzurichten"
            )
        }

        Surface(
            shape = RoundedCornerShape(16.dp),
            color = BgCard,
            border = BorderStroke(1.dp, BorderStrong),
            modifier = Modifier
                .fillMaxWidth()
                .clickable(onClick = onOpenSettings)
        ) {
            Row(
                modifier = Modifier.padding(16.dp),
                verticalAlignment = Alignment.CenterVertically
            ) {
                Box(
                    modifier = Modifier
                        .size(12.dp)
                        .alpha(pulseAlpha)
                        .clip(CircleShape)
                        .background(dotColor)
                )
                Spacer(modifier = Modifier.width(12.dp))
                Column(modifier = Modifier.weight(1f)) {
                    Text(
                        text = statusTitle,
                        color = TextMain,
                        fontSize = 14.5.sp,
                        fontWeight = FontWeight.Bold
                    )
                    Text(
                        text = statusSubtitle,
                        color = TextMuted,
                        fontSize = 12.sp,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis
                    )
                }
                Icon(
                    imageVector = Icons.AutoMirrored.Rounded.NavigateNext,
                    contentDescription = null,
                    tint = TextMuted,
                    modifier = Modifier.size(20.dp)
                )
            }
        }

        // Sektion BEREICHE: 2x2 Expressive Bento-Karten
        Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
            Text(
                text = "BEREICHE",
                color = TextMuted,
                fontSize = 11.sp,
                fontWeight = FontWeight.Bold,
                letterSpacing = 0.8.sp
            )

            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(10.dp)
            ) {
                MoreBentoCard(
                    emoji = "📚",
                    title = "Bibliothek",
                    subtitle = "Hefte & Ordner",
                    accentColor = AccentBlue,
                    onClick = { onOpenLibrary("hefte") },
                    modifier = Modifier.weight(1f)
                )
                MoreBentoCard(
                    emoji = "🕸️",
                    title = "Wissensgraph",
                    subtitle = "Wiki-Vernetzungen",
                    accentColor = AccentViolet,
                    onClick = onOpenGraph,
                    modifier = Modifier.weight(1f)
                )
            }

            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(10.dp)
            ) {
                MoreBentoCard(
                    emoji = "✦",
                    title = "Gemini Notebook",
                    subtitle = "Quellen & Podcast",
                    accentColor = AccentOrange,
                    onClick = onOpenNotebookLm,
                    modifier = Modifier.weight(1f)
                )
                MoreBentoCard(
                    emoji = "📊",
                    title = "Schulnoten",
                    subtitle = "Fächer & Schnitt",
                    accentColor = AccentGreen,
                    onClick = onOpenGrades,
                    modifier = Modifier.weight(1f)
                )
            }
        }

        // Sektion ABLAGE
        Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Text(
                text = "ABLAGE",
                color = TextMuted,
                fontSize = 11.sp,
                fontWeight = FontWeight.Bold,
                letterSpacing = 0.8.sp
            )
            MoreListRow(
                emoji = "📦",
                title = "Archiv",
                badge = if (archiveCount > 0) archiveCount.toString() else null,
                onClick = { onOpenLibrary("archive") }
            )
            MoreListRow(
                emoji = "🗑️",
                title = "Papierkorb",
                badge = if (trashCount > 0) trashCount.toString() else null,
                onClick = onOpenTrash
            )
        }

        // Sektion APP
        Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Text(
                text = "APP",
                color = TextMuted,
                fontSize = 11.sp,
                fontWeight = FontWeight.Bold,
                letterSpacing = 0.8.sp
            )
            MoreListRow(
                emoji = "⚙️",
                title = "Einstellungen, Darstellung & Sync",
                onClick = onOpenSettings
            )
            MoreListRow(
                emoji = "🔍",
                title = "Globale Suche",
                onClick = onOpenSearch
            )
        }
    }
}

@Composable
private fun MoreBentoCard(
    emoji: String,
    title: String,
    subtitle: String,
    accentColor: Color,
    onClick: () -> Unit,
    modifier: Modifier = Modifier
) {
    Surface(
        shape = RoundedCornerShape(16.dp),
        color = BgCard,
        border = BorderStroke(1.dp, BorderHairline),
        modifier = modifier.clickable(onClick = onClick)
    ) {
        Column(
            modifier = Modifier.padding(14.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp)
        ) {
            Box(
                modifier = Modifier
                    .size(36.dp)
                    .background(accentColor.copy(alpha = 0.16f), RoundedCornerShape(10.dp)),
                contentAlignment = Alignment.Center
            ) {
                Text(text = emoji, fontSize = 18.sp)
            }
            Column {
                Text(
                    text = title,
                    color = TextMain,
                    fontSize = 14.sp,
                    fontWeight = FontWeight.Bold,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis
                )
                Text(
                    text = subtitle,
                    color = TextMuted,
                    fontSize = 11.5.sp,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis
                )
            }
        }
    }
}

@Composable
private fun MoreListRow(
    emoji: String,
    title: String,
    badge: String? = null,
    onClick: () -> Unit
) {
    Surface(
        shape = RoundedCornerShape(12.dp),
        color = BgCard,
        border = BorderStroke(1.dp, BorderHairline),
        modifier = Modifier
            .fillMaxWidth()
            .clickable(onClick = onClick)
    ) {
        Row(
            modifier = Modifier.padding(horizontal = 14.dp, vertical = 12.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            Text(text = emoji, fontSize = 16.sp)
            Spacer(modifier = Modifier.width(12.dp))
            Text(
                text = title,
                color = TextMain,
                fontSize = 14.sp,
                fontWeight = FontWeight.Medium,
                modifier = Modifier.weight(1f)
            )
            if (badge != null) {
                Box(
                    modifier = Modifier
                        .padding(end = 6.dp)
                        .background(BgBubble, ImpalaPillShape)
                        .padding(horizontal = 8.dp, vertical = 2.dp)
                ) {
                    Text(
                        text = badge,
                        color = TextMuted,
                        fontSize = 11.sp,
                        fontWeight = FontWeight.SemiBold
                    )
                }
            }
            Icon(
                imageVector = Icons.AutoMirrored.Rounded.NavigateNext,
                contentDescription = null,
                tint = TextMuted,
                modifier = Modifier.size(18.dp)
            )
        }
    }
}
